import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { AlertEntity, AlertType, ProjectEntity } from '../database/entities/index.js';
import type { NotificationJobData } from './notification.processor.js';
import { AlertStateService } from './alert-state.service.js';

interface MetricRow {
  project_id: string;
  value: string;
}

/**
 * Core evaluation logic for the alert engine.
 * Designed for testability: each metric-fetching method accepts an optional
 * DataSource so tests can inject a mock.
 */
@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  constructor(
    @InjectRepository(AlertEntity)
    private readonly alertRepo: Repository<AlertEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly alertState: AlertStateService,
    @InjectQueue('notification-dispatch')
    private readonly notificationQueue: Queue<NotificationJobData>,
  ) {}

  /**
   * Evaluates all active alerts in a single pass.
   * Uses one aggregate SQL query per alert type so the total number of DB
   * round-trips is O(distinct alert types) rather than O(alerts).
   * Expected to complete in < 10 s for up to 1 000 active alerts.
   */
  async evaluateAllAlerts(): Promise<void> {
    const alerts = await this.alertRepo.find({ where: { isActive: true } });
    if (alerts.length === 0) return;

    // --- batch-fetch project names for notification messages ----------------
    const projectIds = [...new Set(alerts.map((a) => a.projectId))];
    const projects = await this.projectRepo.findByIds(projectIds);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));

    // --- group alerts by type so we run one query per type ------------------
    const byType = new Map<AlertType, AlertEntity[]>();
    for (const alert of alerts) {
      const list = byType.get(alert.type) ?? [];
      list.push(alert);
      byType.set(alert.type, list);
    }

    // --- compute metric values per project, per type ------------------------
    const metricsByAlert = new Map<string, number>(); // alertId → currentValue

    for (const [type, typeAlerts] of byType) {
      const ids = [...new Set(typeAlerts.map((a) => a.projectId))];
      const projectMetrics = await this.computeMetricsForType(type, ids);
      for (const alert of typeAlerts) {
        const value = projectMetrics.get(alert.projectId);
        if (value !== undefined) {
          metricsByAlert.set(alert.id, value);
        }
      }
    }

    // --- evaluate each alert ------------------------------------------------
    const dashboardBase = process.env['DASHBOARD_URL'] ?? 'https://app.agentlens.ai';

    for (const alert of alerts) {
      const currentValue = metricsByAlert.get(alert.id);
      if (currentValue === undefined) {
        // No data in window — nothing to fire on.
        continue;
      }

      const threshold = parseFloat(alert.threshold);

      try {
        if (currentValue > threshold) {
          const canFire = await this.alertState.canFire(alert.id);
          if (canFire) {
            const projectName = projectNames.get(alert.projectId) ?? alert.projectId;
            await this.dispatchNotification(alert, projectName, currentValue, threshold, dashboardBase);
            await this.alertState.setLastFired(alert.id);
            this.logger.log({
              event: 'alert.fired',
              alertId: alert.id,
              alertType: alert.type,
              projectId: alert.projectId,
              currentValue,
              threshold,
            });
          } else {
            this.logger.debug({
              event: 'alert.skipped',
              alertId: alert.id,
              reason: 'cooldown',
              currentValue,
              threshold,
            });
          }
        } else {
          this.logger.debug({
            event: 'alert.ok',
            alertId: alert.id,
            alertType: alert.type,
            currentValue,
            threshold,
          });
        }
      } catch (err) {
        this.logger.error({
          event: 'alert.error',
          alertId: alert.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Runs a single aggregate SQL query for the given alert type and returns
   * a map of projectId → metric value.
   *
   * Public so unit tests can call it directly with a mock DataSource.
   */
  async computeMetricsForType(
    type: AlertType,
    projectIds: string[],
    ds: DataSource = this.dataSource,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    switch (type) {
      case AlertType.ERROR_RATE:
        return this.fetchErrorRateMetrics(projectIds, ds);
      case AlertType.COST_SPIKE:
        return this.fetchCostSpikeMetrics(projectIds, ds);
      case AlertType.LATENCY_P95:
        return this.fetchLatencyP95Metrics(projectIds, ds);
      case AlertType.FAILURE:
        return this.fetchFailureMetrics(projectIds, ds);
    }
  }

  /**
   * Error rate = (error spans / total spans) * 100 in the last 5 minutes.
   */
  async fetchErrorRateMetrics(
    projectIds: string[],
    ds: DataSource = this.dataSource,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await ds.query<MetricRow[]>(
      `SELECT project_id,
              COUNT(CASE WHEN status = 'error' THEN 1 END) * 100.0
                / NULLIF(COUNT(*), 0) AS value
       FROM spans
       WHERE started_at >= NOW() - INTERVAL '5 minutes'
         AND project_id = ANY($1::uuid[])
       GROUP BY project_id`,
      [projectIds],
    );
    return new Map(rows.map((r) => [r.project_id, parseFloat(r.value)]));
  }

  /**
   * Cost spike = total cost_usd summed over all spans in the last 5 minutes.
   */
  async fetchCostSpikeMetrics(
    projectIds: string[],
    ds: DataSource = this.dataSource,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await ds.query<MetricRow[]>(
      `SELECT project_id,
              COALESCE(SUM(cost_usd), 0) AS value
       FROM spans
       WHERE started_at >= NOW() - INTERVAL '5 minutes'
         AND project_id = ANY($1::uuid[])
       GROUP BY project_id`,
      [projectIds],
    );
    return new Map(rows.map((r) => [r.project_id, parseFloat(r.value)]));
  }

  /**
   * Latency P95 = 95th percentile of latency_ms over spans in the last 5 min.
   */
  async fetchLatencyP95Metrics(
    projectIds: string[],
    ds: DataSource = this.dataSource,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await ds.query<MetricRow[]>(
      `SELECT project_id,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS value
       FROM spans
       WHERE started_at >= NOW() - INTERVAL '5 minutes'
         AND project_id = ANY($1::uuid[])
         AND latency_ms IS NOT NULL
       GROUP BY project_id`,
      [projectIds],
    );
    return new Map(rows.map((r) => [r.project_id, parseFloat(r.value)]));
  }

  /**
   * Failure count = number of traces with status='error' in the last 5 min.
   */
  async fetchFailureMetrics(
    projectIds: string[],
    ds: DataSource = this.dataSource,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await ds.query<MetricRow[]>(
      `SELECT project_id,
              COUNT(*) AS value
       FROM traces
       WHERE started_at >= NOW() - INTERVAL '5 minutes'
         AND project_id = ANY($1::uuid[])
         AND status = 'error'
       GROUP BY project_id`,
      [projectIds],
    );
    return new Map(rows.map((r) => [r.project_id, parseFloat(r.value)]));
  }

  // ---------------------------------------------------------------------------

  private async dispatchNotification(
    alert: AlertEntity,
    projectName: string,
    currentValue: number,
    threshold: number,
    dashboardBase: string,
  ): Promise<void> {
    const jobData: NotificationJobData = {
      alertId: alert.id,
      channel: alert.channel,
      channelConfig: alert.channelConfig,
      payload: {
        projectName,
        alertName: alert.name,
        alertType: alert.type,
        currentValue,
        threshold,
        dashboardUrl: `${dashboardBase}/projects/${alert.projectId}/alerts`,
      },
    };

    await this.notificationQueue.add('send-notification', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
    });
  }
}
