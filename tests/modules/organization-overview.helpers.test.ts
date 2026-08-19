import { describe, expect, it } from 'vitest';
import {
  buildDocumentScopeFilter,
  resolveVisibilityScope,
  toDocStatusBlock,
} from '../../src/modules/report/organization-overview.helpers';

describe('organization overview helpers', () => {
  it('grants organization scope to admin, accountant', () => {
    expect(resolveVisibilityScope('admin')).toBe('organization');
    expect(resolveVisibilityScope('accountant')).toBe('organization');
    expect(resolveVisibilityScope('accountant')).toBe('organization');
  });

  it('limits warehouse_keeper and staff to own documents', () => {
    expect(resolveVisibilityScope('warehouse_keeper')).toBe('own_documents');
    expect(resolveVisibilityScope('staff')).toBe('own_documents');
  });

  it('filters own documents by creator or approver', () => {
    expect(buildDocumentScopeFilter('own_documents', 'user-1')).toEqual({
      OR: [{ createdById: 'user-1' }, { approvedById: 'user-1' }],
    });
    expect(buildDocumentScopeFilter('organization', 'user-1')).toEqual({});
  });

  it('builds document status block', () => {
    const block = toDocStatusBlock([
      { status: 'completed', _count: { _all: 10 } },
      { status: 'pending_approval', _count: { _all: 2 } },
    ]);
    expect(block.total).toBe(12);
    expect(block.completed).toBe(10);
    expect(block.pendingApproval).toBe(2);
  });
});
