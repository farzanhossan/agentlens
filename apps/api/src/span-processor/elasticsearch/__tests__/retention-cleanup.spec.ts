import { RetentionCleanupService } from '../retention-cleanup.service';
import type { Repository } from 'typeorm';
import type { ProjectEntity } from '../../../database/entities/index';
import type { ConfigService } from '@nestjs/config';

interface DeleteByQueryArgs {
  index: string;
  body: { query: { bool: { filter: Array<Record<string, unknown>> } } };
}

function makeService(
  projects: Array<{ id: string; name: string; retentionDays: number }>,
  deleteResult = { deleted: 10 },
): { svc: RetentionCleanupService; projectRepo: { find: jest.Mock }; deleteByQuery: jest.Mock } {
  const projectRepo = {
    find: jest.fn().mockResolvedValue(projects),
  };

  const deleteByQuery = jest.fn().mockResolvedValue(deleteResult);
  const mockClient = { deleteByQuery };

  const svc = new RetentionCleanupService(
    projectRepo as unknown as Repository<ProjectEntity>,
    { getOrThrow: () => 'http://localhost:9200' } as unknown as ConfigService,
  );

  // Replace internal client
  Object.assign(svc, { client: mockClient });

  return { svc, projectRepo, deleteByQuery };
}

describe('RetentionCleanupService', () => {
  it('deletes spans older than retentionDays for each project', async () => {
    const { svc, deleteByQuery } = makeService([
      { id: 'proj-1', name: 'Test Project', retentionDays: 30 },
    ]);

    await svc.handleCleanup();

    expect(deleteByQuery).toHaveBeenCalledTimes(1);
    const calls = deleteByQuery.mock.calls as DeleteByQueryArgs[][];
    const callArgs = calls[0][0];
    expect(callArgs.index).toBe('agentlens_spans');
    expect(callArgs.body.query.bool.filter[0]).toEqual({ term: { projectId: 'proj-1' } });
    expect(callArgs.body.query.bool.filter[1]).toBeDefined();
  });

  it('handles multiple projects', async () => {
    const { svc, deleteByQuery } = makeService([
      { id: 'proj-1', name: 'Project A', retentionDays: 7 },
      { id: 'proj-2', name: 'Project B', retentionDays: 90 },
    ]);

    await svc.handleCleanup();

    expect(deleteByQuery).toHaveBeenCalledTimes(2);
  });

  it('skips when no projects have custom retention', async () => {
    const { svc, deleteByQuery } = makeService([]);

    await svc.handleCleanup();

    expect(deleteByQuery).not.toHaveBeenCalled();
  });

  it('continues with other projects when one fails', async () => {
    const { svc, deleteByQuery } = makeService([
      { id: 'proj-1', name: 'Project A', retentionDays: 7 },
      { id: 'proj-2', name: 'Project B', retentionDays: 30 },
    ]);

    // First call fails, second succeeds
    deleteByQuery
      .mockRejectedValueOnce(new Error('ES error'))
      .mockResolvedValueOnce({ deleted: 5 });

    await svc.handleCleanup();

    expect(deleteByQuery).toHaveBeenCalledTimes(2);
  });
});
