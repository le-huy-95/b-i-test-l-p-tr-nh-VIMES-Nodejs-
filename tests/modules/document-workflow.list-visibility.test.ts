import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockWorkflowFindMany = vi.fn();
const mockWorkflowCount = vi.fn();

const mockPrisma = {
  $transaction: vi.fn(),
  documentWorkflow: {
    findFirst: vi.fn(),
    findMany: mockWorkflowFindMany,
    create: vi.fn(),
    update: vi.fn(),
    count: mockWorkflowCount,
  },
  documentWorkflowStep: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  documentStepAuthorization: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  documentStatusHistory: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  stockIssue: { findMany: vi.fn() },
  stockReceipt: { findMany: vi.fn() },
  stockOpeningBalance: { findMany: vi.fn() },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/cache-invalidation', () => ({
  cacheInvalidationService: {
    invalidateStockDocuments: vi.fn(),
    invalidateStockMutations: vi.fn(),
  },
}));

describe('document workflow list visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowFindMany.mockResolvedValue([]);
    mockWorkflowCount.mockResolvedValue(0);
  });

  it('admin sees all workflows without related-step filter', async () => {
    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    await documentWorkflowService.listWorkflows(
      'tenant-1',
      { page: 1, limit: 20 },
      { userId: 'admin-1', role: 'admin' },
    );

    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
      }),
    );
  });

  it('staff only sees workflows where they are creator/approver/signer on a step', async () => {
    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    await documentWorkflowService.listWorkflows(
      'tenant-1',
      { documentType: 'stock_issue', page: 1, limit: 20 },
      { userId: 'staff-unassigned', role: 'staff' },
    );

    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          documentType: 'stock_issue',
          steps: {
            some: {
              OR: [
                { assignedApproverId: 'staff-unassigned' },
                { requiredSignerId: 'staff-unassigned' },
                { actualSignerId: 'staff-unassigned' },
              ],
            },
          },
        },
      }),
    );
  });

  it('staff related filter ANDs with assignedApproverId pending filter', async () => {
    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    await documentWorkflowService.listWorkflows(
      'tenant-1',
      {
        assignedApproverId: 'staff-unassigned',
        page: 1,
        limit: 20,
      },
      { userId: 'staff-unassigned', role: 'staff' },
    );

    const where = mockWorkflowFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          steps: {
            some: {
              assignedApproverId: 'staff-unassigned',
              status: 'pending',
            },
          },
        },
        {
          steps: {
            some: {
              OR: [
                { assignedApproverId: 'staff-unassigned' },
                { requiredSignerId: 'staff-unassigned' },
                { actualSignerId: 'staff-unassigned' },
              ],
            },
          },
        },
      ]),
    );
  });
});
