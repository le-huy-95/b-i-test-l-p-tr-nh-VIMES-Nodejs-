import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockTransaction = vi.fn();
const mockWorkflowFindFirst = vi.fn();
const mockWorkflowCreate = vi.fn();
const mockWorkflowUpdate = vi.fn();
const mockStepCreateMany = vi.fn();
const mockStepFindMany = vi.fn();
const mockStepUpdate = vi.fn();
const mockStepUpdateMany = vi.fn();
const mockAuthFindMany = vi.fn();
const mockAuthCreate = vi.fn();
const mockHistoryCreate = vi.fn();
const mockWorkflowCount = vi.fn();
const mockWorkflowFindMany = vi.fn();
const mockQueryRaw = vi.fn();

const mockPrisma = {
  $transaction: mockTransaction,
  documentWorkflow: {
    findFirst: mockWorkflowFindFirst,
    findMany: mockWorkflowFindMany,
    create: mockWorkflowCreate,
    update: mockWorkflowUpdate,
    count: mockWorkflowCount,
  },
  documentWorkflowStep: {
    findFirst: vi.fn(),
    findMany: mockStepFindMany,
    createMany: mockStepCreateMany,
    update: mockStepUpdate,
    updateMany: mockStepUpdateMany,
  },
  documentStepAuthorization: {
    findMany: mockAuthFindMany,
    create: mockAuthCreate,
  },
  documentStatusHistory: {
    create: mockHistoryCreate,
    findMany: vi.fn(),
  },
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

vi.mock('../../src/shared/notifications/stock-doc-notify', () => ({
  notifyIssueSubmitted: vi.fn(),
  notifyIssueApproved: vi.fn(),
  notifyIssueRejected: vi.fn(),
  notifyIssueCompleted: vi.fn(),
  notifyIssueCancelled: vi.fn(),
  notifyReceiptSubmitted: vi.fn(),
  notifyReceiptApproved: vi.fn(),
  notifyReceiptRejected: vi.fn(),
  notifyReceiptCompleted: vi.fn(),
  notifyReceiptCancelled: vi.fn(),
}));

vi.mock('../../src/utils/numbering', () => ({
  generateNextCode: vi.fn().mockResolvedValue('CODE-001'),
}));

vi.mock('../../src/modules/stock-balance/qty', () => ({
  resolveQtyBaseUnit: vi.fn(),
}));

vi.mock('../../src/modules/stock-balance/stock-balance.service', () => ({
  stockBalanceService: {
    getAvailable: vi.fn(),
  },
}));

vi.mock('../../src/modules/stock-balance/stock-posting.service', () => ({
  stockPostingService: {
    apply: vi.fn(),
  },
}));

vi.mock('../../src/modules/stock-balance/batch.service', () => ({
  ensureBatch: vi.fn(),
}));

vi.mock('../../src/modules/stock-balance/lot-picking', () => ({
  loadPickableLots: vi.fn(),
}));

vi.mock('../../src/modules/stock-balance/lot-allocation', () => ({
  consumeLots: vi.fn(),
}));

const actor = { userId: 'user-1', name: 'Tester', role: 'warehouse_keeper' as const };

const mockAdapter = {
  getDocumentInfo: vi.fn(),
  onStatusChanged: vi.fn(),
  onEnteredPendingApproval: vi.fn(),
  onComplete: vi.fn(),
  resolveInitialSigner: vi.fn(),
};

function makeTrx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: mockQueryRaw,
    documentWorkflow: {
      findFirst: vi.fn(),
      update: mockWorkflowUpdate,
    },
    documentWorkflowStep: {
      findMany: mockStepFindMany,
      update: mockStepUpdate,
      updateMany: mockStepUpdateMany,
    },
    documentStepAuthorization: {
      findMany: mockAuthFindMany,
    },
    documentStatusHistory: {
      create: mockHistoryCreate,
    },
    ...overrides,
  };
}

describe('document workflow service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initWorkflow', () => {
    it('creates workflow and steps from template', async () => {
      mockWorkflowFindFirst.mockResolvedValue(null);
      mockAdapter.getDocumentInfo.mockResolvedValue({ id: 'doc-1', code: 'PXK-001', createdById: 'user-1', currentStatus: 'draft' });
      mockAdapter.resolveInitialSigner.mockResolvedValue({ requiredSignerId: 'user-1', assignedApproverId: 'user-1' });
      mockWorkflowCreate.mockResolvedValue({ id: 'wf-1' });
      mockStepFindMany.mockResolvedValue([]);

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.initWorkflow(
        'tenant-1',
        'stock_issue',
        'doc-1',
        actor,
        mockAdapter,
        ['user-warehouse', 'user-accountant'],
      );

      expect(mockWorkflowCreate).toHaveBeenCalled();
      expect(mockStepCreateMany).toHaveBeenCalled();
      const stepsArg = mockStepCreateMany.mock.calls[0][0].data;
      expect(stepsArg.map((s: { stepCode: string }) => s.stepCode)).toEqual([
        'creator',
        'warehouse',
        'chief_accountant',
      ]);
      expect(result.id).toBe('wf-1');
    });

    it('throws if workflow already exists', async () => {
      mockWorkflowFindFirst.mockResolvedValue({ id: 'existing-wf' });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.initWorkflow('tenant-1', 'stock_issue', 'doc-1', actor, mockAdapter),
      ).rejects.toThrowError('Workflow already exists');
    });

    it('throws if document not found', async () => {
      mockWorkflowFindFirst.mockResolvedValue(null);
      mockAdapter.getDocumentInfo.mockResolvedValue(null);

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.initWorkflow('tenant-1', 'stock_issue', 'doc-1', actor, mockAdapter),
      ).rejects.toThrowError('Document not found');
    });
  });

  describe('startReviewOnCreate', () => {
    it('approves creator and sets in_review without adapter status sync', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'draft', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'draft',
        steps: [
          { id: 'step-1', stepCode: 'creator', stepName: 'Người lập phiếu', sequence: 1, status: 'pending' },
          { id: 'step-2', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 2, status: 'pending' },
        ],
      });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', stepCode: 'creator', status: 'approved' },
        { id: 'step-2', stepCode: 'warehouse', status: 'pending' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'warehouse',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.startReviewOnCreate(
        'tenant-1',
        'stock_issue',
        'doc-1',
        actor,
        mockAdapter,
      );

      expect(result.status).toBe('in_review');
      expect(result.currentStepCode).toBe('warehouse');
      expect(mockAdapter.onStatusChanged).not.toHaveBeenCalled();
      expect(mockStepUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'step-1' },
          data: expect.objectContaining({ status: 'approved' }),
        }),
      );
    });
  });

  describe('performAction - submit', () => {
    it('transitions from draft to in_review', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'draft', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'draft',
        currentStepCode: 'creator',
        currentStepStatus: 'pending',
        currentStepUpdatedAt: new Date(),
        lastActionById: null,
        lastActionAt: null,
        steps: [],
      });
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'creator',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1',
        'stock_issue',
        'doc-1',
        { action: 'submit', note: 'Submitting' },
        actor,
        mockAdapter,
      );

      expect(result.status).toBe('in_review');
      expect(mockAdapter.onStatusChanged).toHaveBeenCalledWith(
        'tenant-1', 'doc-1', 'draft', 'in_review', actor, expect.anything(),
      );
    });

    it('throws when trying to submit a non-draft workflow', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction('tenant-1', 'stock_issue', 'doc-1', { action: 'submit' }, actor, mockAdapter),
      ).rejects.toThrowError('is not allowed');
    });
  });

  describe('performAction - approve', () => {
    it('approves a step and moves to next pending step', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        currentStepCode: 'creator',
        currentStepStatus: 'pending',
        steps: [
          { id: 'step-1', stepCode: 'creator', stepName: 'Người lập phiếu', sequence: 1, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
          { id: 'step-2', stepCode: 'delivery', stepName: 'Người giao hàng', sequence: 2, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-2' },
        ],
      });
      mockStepUpdate.mockResolvedValue({ id: 'step-1', status: 'approved' });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', status: 'approved' },
        { id: 'step-2', status: 'pending' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'delivery',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1',
        'stock_issue',
        'doc-1',
        { action: 'approve', stepId: 'step-1', note: 'OK' },
        actor,
        mockAdapter,
      );

      expect(result.currentStepCode).toBe('delivery');
    });

    it('calls onEnteredPendingApproval on first post-creator approve', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-1', stepCode: 'creator', stepName: 'Người lập phiếu', sequence: 1, status: 'approved', workflowId: 'wf-1', assignedApproverId: 'user-1' },
          { id: 'step-2', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 2, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockStepUpdate.mockResolvedValue({ id: 'step-2', status: 'approved' });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', stepCode: 'creator', status: 'approved' },
        { id: 'step-2', stepCode: 'warehouse', status: 'approved' },
        { id: 'step-3', stepCode: 'chief_accountant', status: 'pending' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'chief_accountant',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      await documentWorkflowService.performAction(
        'tenant-1',
        'stock_issue',
        'doc-1',
        { action: 'approve', stepId: 'step-2', note: 'OK' },
        actor,
        mockAdapter,
      );

      expect(mockAdapter.onEnteredPendingApproval).toHaveBeenCalledWith(
        'tenant-1',
        'doc-1',
        actor,
        expect.anything(),
      );
    });

    it('approves last step and transitions document to approved', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-4', stepCode: 'chief_accountant', stepName: 'Kế toán trưởng', sequence: 4, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockStepUpdate.mockResolvedValue({ id: 'step-4', status: 'approved' });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', status: 'approved' },
        { id: 'step-2', status: 'skipped' },
        { id: 'step-3', status: 'approved' },
        { id: 'step-4', status: 'approved' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'approved',
        currentStepCode: null,
        currentStepStatus: null,
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1',
        'stock_issue',
        'doc-1',
        { action: 'approve', stepId: 'step-4', note: 'Final approval' },
        { ...actor, role: 'accountant' },
        mockAdapter,
      );

      expect(result.status).toBe('approved');
      expect(result.currentStepCode).toBeNull();
      expect(mockAdapter.onStatusChanged).toHaveBeenCalledWith(
        'tenant-1', 'doc-1', 'in_review', 'approved', expect.anything(), expect.anything(),
      );
    });
  });

  describe('performAction - reject', () => {
    it('rejects a step and sets document to rejected, cancels remaining steps', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-2', stepCode: 'delivery', stepName: 'Người giao hàng', sequence: 2, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockStepUpdate.mockResolvedValue({ id: 'step-2', status: 'rejected' });
      mockStepUpdateMany.mockResolvedValue({ count: 2 });
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'rejected',
        currentStepCode: null,
        currentStepStatus: null,
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1',
        'stock_issue',
        'doc-1',
        { action: 'reject', stepId: 'step-2', note: 'Thiếu hàng' },
        actor,
        mockAdapter,
      );

      expect(result.status).toBe('rejected');
      expect(mockStepUpdateMany).toHaveBeenCalledWith({
        where: { workflowId: 'wf-1', status: 'pending' },
        data: { status: 'cancelled' },
      });
      expect(mockAdapter.onStatusChanged).toHaveBeenCalledWith(
        'tenant-1', 'doc-1', 'in_review', 'rejected', expect.anything(), expect.anything(),
      );
    });
  });

  describe('performAction - proxy_sign', () => {
    it('requires proxySignerId', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-3', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 3, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction(
          'tenant-1', 'stock_issue', 'doc-1',
          { action: 'proxy_sign', stepId: 'step-3' },
          actor, mockAdapter,
        ),
      ).rejects.toThrowError('proxySignerId is required');
    });

    it('requires authorization documents', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-3', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 3, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction(
          'tenant-1', 'stock_issue', 'doc-1',
          { action: 'proxy_sign', stepId: 'step-3', proxySignerId: 'user-proxy' },
          actor, mockAdapter,
        ),
      ).rejects.toThrowError('authorization document is required');
    });

    it('rejects expired authorization', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-3', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 3, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockAuthFindMany.mockResolvedValue([
        { id: 'auth-1', authorizationNo: 'UQ-001', validFrom: new Date('2020-01-01'), validTo: new Date('2020-12-31'), fileUrl: 'https://example.com/file.pdf' },
      ]);

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction(
          'tenant-1', 'stock_issue', 'doc-1',
          { action: 'proxy_sign', stepId: 'step-3', proxySignerId: 'user-proxy', authorizationIds: ['auth-1'] },
          actor, mockAdapter,
        ),
      ).rejects.toThrowError('has expired');
    });

    it('successfully signs by proxy with valid authorization', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-3', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 3, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
          { id: 'step-4', stepCode: 'chief_accountant', stepName: 'Kế toán trưởng', sequence: 4, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockAuthFindMany.mockResolvedValue([
        { id: 'auth-1', authorizationNo: 'UQ-001', validFrom: new Date('2026-01-01'), validTo: new Date('2027-12-31'), fileUrl: 'https://example.com/file.pdf' },
      ]);
      mockStepUpdate.mockResolvedValue({ id: 'step-3', status: 'signed_by_proxy' });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', status: 'approved' },
        { id: 'step-2', status: 'skipped' },
        { id: 'step-3', status: 'signed_by_proxy' },
        { id: 'step-4', status: 'pending' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'chief_accountant',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1', 'stock_issue', 'doc-1',
        { action: 'proxy_sign', stepId: 'step-3', proxySignerId: 'user-proxy', authorizationIds: ['auth-1'], note: 'Ký thay' },
        actor, mockAdapter,
      );

      expect(result.currentStepCode).toBe('chief_accountant');
    });
  });

  describe('performAction - cancel', () => {
    it('cancels workflow from in_review', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [{ id: 'step-2', stepCode: 'delivery', status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' }],
      });
      mockStepUpdateMany.mockResolvedValue({ count: 1 });
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'cancelled',
        currentStepCode: null,
        currentStepStatus: null,
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1', 'stock_issue', 'doc-1',
        { action: 'cancel', note: 'Hủy phiếu' },
        actor, mockAdapter,
      );

      expect(result.status).toBe('cancelled');
      expect(mockAdapter.onStatusChanged).toHaveBeenCalledWith(
        'tenant-1', 'doc-1', 'in_review', 'cancelled', expect.anything(), expect.anything(),
      );
    });

    it('throws when trying to cancel a completed workflow', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'completed', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'completed',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction('tenant-1', 'stock_issue', 'doc-1', { action: 'cancel' }, actor, mockAdapter),
      ).rejects.toThrowError('is not allowed');
    });
  });

  describe('performAction - complete', () => {
    it('completes an approved workflow', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'approved', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'approved',
        steps: [],
      });
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'completed',
        currentStepCode: null,
        currentStepStatus: null,
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1', 'stock_issue', 'doc-1',
        { action: 'complete', note: 'Done' },
        actor, mockAdapter,
      );

      expect(result.status).toBe('completed');
      expect(mockAdapter.onComplete).toHaveBeenCalledWith('tenant-1', 'doc-1', actor, expect.anything());
    });

    it('throws when trying to complete a non-approved workflow', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction('tenant-1', 'stock_issue', 'doc-1', { action: 'complete' }, actor, mockAdapter),
      ).rejects.toThrowError('is not allowed');
    });
  });

  describe('performAction - skip', () => {
    it('skips an optional step', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-2', stepCode: 'delivery', stepName: 'Người giao hàng', sequence: 2, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
          { id: 'step-3', stepCode: 'warehouse', stepName: 'Thủ kho', sequence: 3, status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });
      mockStepUpdate.mockResolvedValue({ id: 'step-2', status: 'skipped' });
      mockStepFindMany.mockResolvedValue([
        { id: 'step-1', status: 'approved' },
        { id: 'step-2', status: 'skipped' },
        { id: 'step-3', status: 'pending' },
        { id: 'step-4', status: 'pending' },
      ]);
      mockWorkflowUpdate.mockResolvedValue({
        id: 'wf-1',
        status: 'in_review',
        currentStepCode: 'warehouse',
        currentStepStatus: 'pending',
        steps: [],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.performAction(
        'tenant-1', 'stock_issue', 'doc-1',
        { action: 'skip', stepId: 'step-2', note: 'Skip delivery' },
        actor, mockAdapter,
      );

      expect(result.currentStepCode).toBe('warehouse');
    });
  });

  describe('assignStep', () => {
    it('assigns a new approver to a pending step', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      trx.documentWorkflowStep = {
        findFirst: vi.fn().mockResolvedValue({ id: 'step-3', status: 'pending', workflowId: 'wf-1' }),
        update: vi.fn(),
      };
      trx.documentWorkflow = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'wf-1', status: 'in_review', steps: [{ id: 'step-3' }],
        }),
      };

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.assignStep('tenant-1', 'stock_issue', 'doc-1', 'step-3', 'user-new');

      expect(result).toBeDefined();
    });

    it('throws when trying to assign a non-pending step', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      trx.documentWorkflowStep = {
        findFirst: vi.fn().mockResolvedValue({ id: 'step-3', status: 'approved', workflowId: 'wf-1' }),
        update: vi.fn(),
      };

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.assignStep('tenant-1', 'stock_issue', 'doc-1', 'step-3', 'user-new'),
      ).rejects.toThrowError('Cannot reassign');
    });
  });

  describe('getWorkflow', () => {
    it('returns workflow with steps', async () => {
      mockWorkflowFindFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        currentStepCode: 'warehouse',
        currentStepStatus: 'pending',
        currentStepUpdatedAt: new Date(),
        lastActionById: 'user-1',
        lastActionAt: new Date(),
        steps: [
          { id: 'step-1', stepCode: 'creator', stepName: 'Người lập phiếu', sequence: 1, status: 'approved', requiredSignerId: 'user-1', assignedApproverId: 'user-1', actualSignerId: 'user-1', authorizedSignerId: null, note: 'OK', actionAt: new Date() },
        ],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.getWorkflow('tenant-1', 'stock_issue', 'doc-1');

      expect(result.id).toBe('wf-1');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].status).toBe('approved');
    });

    it('throws when workflow not found', async () => {
      mockWorkflowFindFirst.mockResolvedValue(null);

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.getWorkflow('tenant-1', 'stock_issue', 'doc-1'),
      ).rejects.toThrowError('Workflow not found');
    });
  });

  describe('uploadAuthorization', () => {
    it('creates an authorization record for a step', async () => {
      const mockStepFindFirstFn = vi.fn().mockResolvedValue({ id: 'step-3', workflowId: 'wf-1' });
      mockPrisma.documentWorkflowStep.findFirst = mockStepFindFirstFn;
      mockAuthCreate.mockResolvedValue({ id: 'auth-1' });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');
      const result = await documentWorkflowService.uploadAuthorization(
        'tenant-1', 'stock_issue', 'doc-1', 'step-3',
        {
          uploadedById: 'user-1',
          fileUrl: 'https://example.com/auth.pdf',
          fileName: 'auth.pdf',
          authorizationNo: 'UQ-001',
          validFrom: new Date('2026-01-01'),
          validTo: new Date('2027-12-31'),
        },
      );

      expect(result.id).toBe('auth-1');
    });

    it('throws when step not found', async () => {
      const mockStepFindFirstFn = vi.fn().mockResolvedValue(null);
      mockPrisma.documentWorkflowStep.findFirst = mockStepFindFirstFn;

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.uploadAuthorization(
          'tenant-1', 'stock_issue', 'doc-1', 'step-99',
          { uploadedById: 'user-1' },
        ),
      ).rejects.toThrowError('Step not found');
    });
  });

  describe('performAction - edge cases', () => {
    it('throws when action is unknown', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-1', stepCode: 'creator', status: 'pending', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction(
          'tenant-1', 'stock_issue', 'doc-1',
          { action: 'return' as const, stepId: 'step-1' },
          actor, mockAdapter,
        ),
      ).rejects.toThrowError();
    });

    it('throws when no pending step is found for approve', async () => {
      const trx = makeTrx();
      mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));
      mockQueryRaw.mockResolvedValue([{ id: 'wf-1', status: 'in_review', version: 0 }]);
      trx.documentWorkflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-1',
        status: 'in_review',
        steps: [
          { id: 'step-1', stepCode: 'creator', status: 'approved', workflowId: 'wf-1', assignedApproverId: 'user-1' },
        ],
      });

      const { documentWorkflowService } = await import('../../src/modules/document-workflow/document-workflow.service');

      await expect(
        documentWorkflowService.performAction(
          'tenant-1', 'stock_issue', 'doc-1',
          { action: 'approve' },
          actor, mockAdapter,
        ),
      ).rejects.toThrowError('No pending step found');
    });
  });
});
