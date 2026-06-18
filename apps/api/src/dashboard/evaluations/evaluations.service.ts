import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  F1BreakdownRowDto,
  F1GroupBy,
  F1QueryDto,
  F1ResponseDto,
  F1SummaryDto,
  MisclassificationsQueryDto,
  MisclassificationsResponseDto,
} from './dto/evaluations.dto.js';

/* ── Raw SQL result-shape interfaces ── */

interface EvaluationRow {
  id: string;
  trace_id: string;
  model: string | null;
  started_at: string | Date;
  input: string | null;
  output: string | null;
  expected: string | null;
  predicted: string | null;
  task: string;
  split: string;
  agent_name: string | null;
}

/** A normalized evaluation row with guaranteed non-empty labels. */
export interface NormalizedEvalRow {
  spanId: string;
  traceId: string;
  model: string | null;
  startedAt: string;
  input: string | null;
  output: string | null;
  expected: string;
  predicted: string;
  task: string;
  split: string;
  agentName: string | null;
}

interface CountSet {
  evaluated: number;
  correct: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  support: number;
}

/* ── Pure metric calculation helpers ── */

/**
 * Compute micro-averaged precision/recall/F1/accuracy from raw counts.
 * Returns 0 for any metric whose denominator is 0.
 */
export function computeMetrics(counts: CountSet): {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
} {
  const { evaluated, correct, truePositive, falsePositive, falseNegative } = counts;
  const precision =
    truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 0;
  const recall =
    truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = evaluated > 0 ? correct / evaluated : 0;
  return { accuracy, precision, recall, f1 };
}

/**
 * Compute the micro-averaged summary across all rows. Each row is one
 * evaluation; a correct row contributes one TP, an incorrect row contributes
 * one FP and one FN (under micro-averaging these are equal across all labels).
 */
export function computeSummary(rows: NormalizedEvalRow[]): F1SummaryDto {
  let correct = 0;
  for (const row of rows) {
    if (row.expected === row.predicted) correct += 1;
  }
  const evaluated = rows.length;
  const incorrect = evaluated - correct;
  // Micro-averaged counts: TP = correct; each incorrect row adds 1 FP and 1 FN.
  const truePositive = correct;
  const falsePositive = incorrect;
  const falseNegative = incorrect;
  const metrics = computeMetrics({
    evaluated,
    correct,
    truePositive,
    falsePositive,
    falseNegative,
    support: evaluated,
  });
  return {
    evaluated,
    correct,
    accuracy: metrics.accuracy,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    truePositive,
    falsePositive,
    falseNegative,
  };
}

/**
 * Compute per-label breakdown rows. For each distinct label that appears as an
 * expected or predicted value, compute label-specific TP/FP/FN and metrics.
 * Sorted by lowest F1 first, then highest support.
 */
export function computeLabelBreakdown(rows: NormalizedEvalRow[]): F1BreakdownRowDto[] {
  const labels = new Set<string>();
  for (const row of rows) {
    labels.add(row.expected);
    labels.add(row.predicted);
  }

  const breakdown: F1BreakdownRowDto[] = [];
  for (const label of labels) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    let support = 0;
    for (const row of rows) {
      const expectedIs = row.expected === label;
      const predictedIs = row.predicted === label;
      if (expectedIs) support += 1;
      if (expectedIs && predictedIs) truePositive += 1;
      else if (!expectedIs && predictedIs) falsePositive += 1;
      else if (expectedIs && !predictedIs) falseNegative += 1;
    }
    // For a label, "evaluated" rows are those touching the label, and "correct"
    // are the true positives for that label.
    const evaluated = truePositive + falsePositive + falseNegative;
    const metrics = computeMetrics({
      evaluated,
      correct: truePositive,
      truePositive,
      falsePositive,
      falseNegative,
      support,
    });
    breakdown.push({
      key: label,
      evaluated,
      support,
      correct: truePositive,
      accuracy: support > 0 ? truePositive / support : 0,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      truePositive,
      falsePositive,
      falseNegative,
    });
  }

  return sortBreakdown(breakdown);
}

/**
 * Compute breakdown grouped by an arbitrary key (agent, model, task). Each
 * group is treated as an independent dataset and its micro summary is computed.
 */
export function computeGroupedBreakdown(
  rows: NormalizedEvalRow[],
  keyFn: (row: NormalizedEvalRow) => string,
): F1BreakdownRowDto[] {
  const groups = new Map<string, NormalizedEvalRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const breakdown: F1BreakdownRowDto[] = [];
  for (const [key, groupRows] of groups) {
    const summary = computeSummary(groupRows);
    breakdown.push({
      key,
      evaluated: summary.evaluated,
      support: summary.evaluated,
      correct: summary.correct,
      accuracy: summary.accuracy,
      precision: summary.precision,
      recall: summary.recall,
      f1: summary.f1,
      truePositive: summary.truePositive,
      falsePositive: summary.falsePositive,
      falseNegative: summary.falseNegative,
    });
  }

  return sortBreakdown(breakdown);
}

/** Sort breakdown rows by lowest F1 first, then highest support. */
function sortBreakdown(breakdown: F1BreakdownRowDto[]): F1BreakdownRowDto[] {
  return breakdown.sort((a, b) => {
    if (a.f1 !== b.f1) return a.f1 - b.f1;
    return b.support - a.support;
  });
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function preview(text: string | null, max = 200): string | null {
  if (text == null) return null;
  return text.length > max ? text.slice(0, max) : text;
}

@Injectable()
export class EvaluationsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolve the effective date range. If dateTo is omitted, use now. If
   * dateFrom is omitted, use 30 days before dateTo.
   */
  private resolveRange(
    dateFrom?: string,
    dateTo?: string,
  ): { from: string; to: string } {
    const to = dateTo ? new Date(dateTo) : new Date();
    const from = dateFrom
      ? new Date(dateFrom)
      : new Date(to.getTime() - 30 * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  /**
   * Load normalized evaluation rows from PostgreSQL, filtered by project, date
   * range, and optional task/split/model/agentName. Only rows with non-empty
   * expected and predicted labels are returned.
   */
  async loadEvaluationRows(
    projectId: string,
    filters: {
      from: string;
      to: string;
      task?: string;
      split?: string;
      model?: string;
      agentName?: string;
      expected?: string;
      predicted?: string;
    },
  ): Promise<NormalizedEvalRow[]> {
    const params: unknown[] = [projectId, filters.from, filters.to];
    const conditions: string[] = [
      's.project_id = $1',
      's.started_at >= $2',
      's.started_at <= $3',
      "COALESCE(s.metadata #>> '{agentlens,eval,expected}', '') <> ''",
      "COALESCE(s.metadata #>> '{agentlens,eval,predicted}', '') <> ''",
    ];

    if (filters.task) {
      params.push(filters.task);
      conditions.push(`COALESCE(s.metadata #>> '{agentlens,eval,task}', 'default') = $${params.length}`);
    }
    if (filters.split) {
      params.push(filters.split);
      conditions.push(`COALESCE(s.metadata #>> '{agentlens,eval,split}', 'default') = $${params.length}`);
    }
    if (filters.model) {
      params.push(filters.model);
      conditions.push(`s.model = $${params.length}`);
    }
    if (filters.agentName) {
      params.push(filters.agentName);
      conditions.push(`t.agent_name = $${params.length}`);
    }
    if (filters.expected) {
      params.push(filters.expected);
      conditions.push(`s.metadata #>> '{agentlens,eval,expected}' = $${params.length}`);
    }
    if (filters.predicted) {
      params.push(filters.predicted);
      conditions.push(`s.metadata #>> '{agentlens,eval,predicted}' = $${params.length}`);
    }

    const rows = await this.dataSource.query<EvaluationRow[]>(
      `SELECT
         s.id,
         s.trace_id,
         s.model,
         s.started_at,
         s.input,
         s.output,
         s.metadata #>> '{agentlens,eval,expected}' AS expected,
         s.metadata #>> '{agentlens,eval,predicted}' AS predicted,
         COALESCE(s.metadata #>> '{agentlens,eval,task}', 'default') AS task,
         COALESCE(s.metadata #>> '{agentlens,eval,split}', 'default') AS split,
         t.agent_name
       FROM spans s
       LEFT JOIN traces t ON t.id = s.trace_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.started_at DESC`,
      params,
    );

    return rows.map((row) => ({
      spanId: row.id,
      traceId: row.trace_id,
      model: row.model ?? null,
      startedAt: toIso(row.started_at),
      input: row.input ?? null,
      output: row.output ?? null,
      expected: row.expected ?? '',
      predicted: row.predicted ?? '',
      task: row.task,
      split: row.split,
      agentName: row.agent_name ?? null,
    }));
  }

  async getF1Summary(projectId: string, query: F1QueryDto): Promise<F1ResponseDto> {
    const { from, to } = this.resolveRange(query.dateFrom, query.dateTo);
    const rows = await this.loadEvaluationRows(projectId, {
      from,
      to,
      task: query.task,
      split: query.split,
      model: query.model,
      agentName: query.agentName,
    });

    const summary = computeSummary(rows);

    const groupBy = query.groupBy ?? F1GroupBy.LABEL;
    let breakdown: F1BreakdownRowDto[];
    switch (groupBy) {
      case F1GroupBy.AGENT:
        breakdown = computeGroupedBreakdown(rows, (r) => r.agentName ?? 'unknown');
        break;
      case F1GroupBy.MODEL:
        breakdown = computeGroupedBreakdown(rows, (r) => r.model ?? 'unknown');
        break;
      case F1GroupBy.TASK:
        breakdown = computeGroupedBreakdown(rows, (r) => r.task);
        break;
      case F1GroupBy.LABEL:
      default:
        breakdown = computeLabelBreakdown(rows);
        break;
    }

    return { dateFrom: from, dateTo: to, summary, breakdown };
  }

  async getMisclassifications(
    projectId: string,
    query: MisclassificationsQueryDto,
  ): Promise<MisclassificationsResponseDto> {
    const { from, to } = this.resolveRange(query.dateFrom, query.dateTo);
    const rows = await this.loadEvaluationRows(projectId, {
      from,
      to,
      task: query.task,
      split: query.split,
      model: query.model,
      agentName: query.agentName,
      expected: query.expected,
      predicted: query.predicted,
    });

    const wrong = rows.filter((r) => r.expected !== r.predicted);
    const total = wrong.length;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const page = wrong.slice(offset, offset + limit);

    return {
      total,
      items: page.map((r) => ({
        spanId: r.spanId,
        traceId: r.traceId,
        agentName: r.agentName,
        model: r.model,
        expected: r.expected,
        predicted: r.predicted,
        task: r.task,
        split: r.split,
        startedAt: r.startedAt,
        inputPreview: preview(r.input),
        outputPreview: preview(r.output),
      })),
    };
  }
}
