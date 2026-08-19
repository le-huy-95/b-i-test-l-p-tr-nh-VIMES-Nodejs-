import { describe, it, expect } from 'vitest';
import { getWorkflowTemplate } from '../../src/modules/document-workflow/workflow-templates';

describe('workflow templates', () => {
  it('has 4 steps for stock_receipt', () => {
    const template = getWorkflowTemplate('stock_receipt');
    expect(template.steps).toHaveLength(4);
    expect(template.steps.map((s) => s.stepCode)).toEqual([
      'creator',
      'delivery',
      'warehouse',
      'chief_accountant',
    ]);
  });

  it('has 4 steps for stock_issue', () => {
    const template = getWorkflowTemplate('stock_issue');
    expect(template.steps).toHaveLength(4);
    expect(template.steps.map((s) => s.stepCode)).toEqual([
      'creator',
      'delivery',
      'warehouse',
      'chief_accountant',
    ]);
  });

  it('has 4 steps for stock_opening (creator, warehouse, chief_accountant, admin)', () => {
    const template = getWorkflowTemplate('stock_opening');
    expect(template.steps).toHaveLength(4);
    expect(template.steps.map((s) => s.stepCode)).toEqual([
      'creator',
      'warehouse',
      'chief_accountant',
      'admin',
    ]);
  });

  it('assigns correct sequences', () => {
    const template = getWorkflowTemplate('stock_issue');
    template.steps.forEach((s, i) => {
      expect(s.sequence).toBe(i + 1);
    });
  });

  it('delivery step is optional', () => {
    const template = getWorkflowTemplate('stock_receipt');
    const delivery = template.steps.find((s) => s.stepCode === 'delivery');
    expect(delivery?.optional).toBe(true);
  });

  it('chief_accountant requires accountant role', () => {
    const template = getWorkflowTemplate('stock_receipt');
    const chief = template.steps.find((s) => s.stepCode === 'chief_accountant');
    expect(chief?.requiredRole).toBe('accountant');
  });

  it('admin step requires admin role for stock_opening', () => {
    const template = getWorkflowTemplate('stock_opening');
    const adminStep = template.steps.find((s) => s.stepCode === 'admin');
    expect(adminStep?.requiredRole).toBe('admin');
  });
});
