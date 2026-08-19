import { describe, expect, it } from 'vitest';
import { computeDocumentStatus, assertActionAllowed } from '../../src/modules/document-workflow/workflow-state-machine';

describe('workflow state machine', () => {
  it('moves draft to in_review on submit', () => {
    expect(computeDocumentStatus([], 'draft', 'submit')).toBe('in_review');
  });

  it('moves approved on approve when all steps are done', () => {
    const status = computeDocumentStatus(
      [{ status: 'approved' }, { status: 'signed_by_proxy' }, { status: 'skipped' }],
      'in_review',
      'approve',
    );
    expect(status).toBe('approved');
  });

  it('moves rejected on reject', () => {
    expect(computeDocumentStatus([{ status: 'rejected' }], 'in_review', 'reject')).toBe('rejected');
  });

  it('throws when action is not allowed', () => {
    expect(() => assertActionAllowed('completed', 'submit')).toThrowError();
  });
});
