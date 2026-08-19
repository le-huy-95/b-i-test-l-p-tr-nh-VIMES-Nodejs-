import { describe, expect, it } from 'vitest';
import {
  aggregateQtyByUnit,
  emptyStatusCounts,
  groupDocCountsByWarehouse,
  rowsToStatusCounts,
  sumQtyByWarehouseId,
  sumStatusCountRows,
  totalFromStatusCounts,
} from '../../src/modules/report/warehouse-overview.helpers';

describe('warehouse overview helpers', () => {
  it('builds status counts from groupBy rows', () => {
    const counts = rowsToStatusCounts([
      { status: 'draft', _count: { _all: 2 } },
      { status: 'pending_approval', _count: { _all: 3 } },
    ]);

    expect(counts).toEqual({
      ...emptyStatusCounts(),
      draft: 2,
      pending_approval: 3,
    });
    expect(totalFromStatusCounts(counts)).toBe(5);
  });

  it('groups document counts by warehouse', () => {
    const map = groupDocCountsByWarehouse([
      { warehouseId: 'wh-1', status: 'draft', _count: { _all: 1 } },
      { warehouseId: 'wh-1', status: 'completed', _count: { _all: 4 } },
      { warehouseId: 'wh-2', status: 'pending_approval', _count: { _all: 2 } },
    ]);

    expect(map.get('wh-1')).toEqual({
      ...emptyStatusCounts(),
      draft: 1,
      completed: 4,
    });
    expect(map.get('wh-2')?.pending_approval).toBe(2);
  });

  it('sums status counts across warehouses', () => {
    const rows = sumStatusCountRows([
      { status: 'completed', _count: { _all: 4 } },
      { status: 'completed', _count: { _all: 6 } },
      { status: 'draft', _count: { _all: 1 } },
    ]);

    expect(rows.find((row) => row.status === 'completed')?._count._all).toBe(10);
    expect(rows.find((row) => row.status === 'draft')?._count._all).toBe(1);
  });

  it('returns empty inventory metrics when there are no warehouses', async () => {
    const { computeOrganizationInventoryMetrics, emptyInventoryMetrics } = await import(
      '../../src/modules/report/warehouse-overview.helpers'
    );
    const data = await computeOrganizationInventoryMetrics({} as never, 'tenant-1', [], 30);
    expect(data).toEqual(emptyInventoryMetrics());
  });

  it('aggregates qty by unit and warehouse', () => {
    expect(
      aggregateQtyByUnit([
        { baseUnitName: 'kg', qty: '2.0000' },
        { baseUnitName: 'cái', qty: '10.0000' },
        { baseUnitName: 'cái', qty: '5.0000' },
      ]),
    ).toEqual([
      { baseUnitName: 'cái', qty: '15.0000' },
      { baseUnitName: 'kg', qty: '2.0000' },
    ]);
    expect(
      sumQtyByWarehouseId([
        { warehouseId: 'wh-1', qty: '10.0000' },
        { warehouseId: 'wh-1', qty: '5.0000' },
        { warehouseId: 'wh-2', qty: '1.0000' },
      ]).get('wh-1'),
    ).toBe('15.0000');
  });
});
