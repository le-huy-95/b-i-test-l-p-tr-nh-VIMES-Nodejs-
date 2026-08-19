import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function sql(q: string, params: unknown[] = []) {
  return (await pool.query(q, params)).rows;
}

async function explain(label: string, q: string, params: unknown[] = []) {
  const rows = await sql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`, params);
  const plan = rows[0]['QUERY PLAN'][0];
  console.log(
    `\n=== ${label} ===\nexecutionMs=${plan['Execution Time']}\nplanningMs=${plan['Planning Time']}\n`,
  );
  const walk = (node: Record<string, unknown>, depth = 0) => {
    const pad = '  '.repeat(depth);
    console.log(
      `${pad}${node['Node Type']}  cost=${node['Total Cost']}  actual=${node['Actual Total Time']}ms rows=${node['Actual Rows']}  ${node['Index Name'] ?? ''} ${node['Relation Name'] ?? ''}`,
    );
    const plans = node['Plans'] as Record<string, unknown>[] | undefined;
    plans?.forEach((child) => walk(child, depth + 1));
  };
  walk(plan.Plan);
}

async function main() {
  const tables = await sql(`
    SELECT relname AS table, n_live_tup AS rows
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
    LIMIT 25
  `);
  console.log('TABLE_ROWS', JSON.stringify(tables, null, 2));

  const tenants = await sql(`
    SELECT t.id, t.code, t.name,
      (SELECT COUNT(*) FROM warehouses w WHERE w.tenant_id = t.id AND w.is_active) AS warehouses,
      (SELECT COUNT(*) FROM products p WHERE p.tenant_id = t.id) AS products,
      (SELECT COUNT(*) FROM stock_receipts r WHERE r.tenant_id = t.id) AS receipts,
      (SELECT COUNT(*) FROM stock_issues i WHERE i.tenant_id = t.id) AS issues,
      (SELECT COUNT(*) FROM stock_balances b WHERE b.tenant_id = t.id) AS balances
    FROM tenants t
    ORDER BY receipts DESC
    LIMIT 5
  `);
  console.log('TENANTS', JSON.stringify(tenants, null, 2));

  const tenantId = tenants[0]?.id as string | undefined;
  if (!tenantId) {
    console.log('NO_TENANT_DATA');
    return;
  }

  await explain(
    'receipts groupBy status',
    `SELECT status, COUNT(*) FROM stock_receipts WHERE tenant_id = $1 GROUP BY status`,
    [tenantId],
  );
  await explain(
    'receipt details SUM qty completed',
    `SELECT COALESCE(SUM(d.qty_base_unit), 0)
     FROM stock_receipt_details d
     JOIN stock_receipts r ON r.id = d.receipt_id
     WHERE r.tenant_id = $1 AND r.status = 'completed'`,
    [tenantId],
  );
  await explain(
    'top imported products',
    `SELECT d.product_id, SUM(d.qty_base_unit) AS qty, COUNT(d.receipt_id)
     FROM stock_receipt_details d
     JOIN stock_receipts r ON r.id = d.receipt_id
     WHERE r.tenant_id = $1 AND r.status = 'completed'
     GROUP BY d.product_id
     ORDER BY qty DESC
     LIMIT 5`,
    [tenantId],
  );
  await explain(
    'receipts groupBy warehouse+status',
    `SELECT warehouse_id, status, COUNT(*) FROM stock_receipts WHERE tenant_id = $1 GROUP BY warehouse_id, status`,
    [tenantId],
  );
  await explain(
    'products by tenant',
    `SELECT id, min_stock_level, average_cost FROM products WHERE tenant_id = $1 AND is_active = true`,
    [tenantId],
  );
  await explain(
    'balances by warehouse',
    `SELECT product_id, batch_id, onhand_qty FROM stock_balances WHERE tenant_id = $1 AND warehouse_id = (SELECT id FROM warehouses WHERE tenant_id = $1 LIMIT 1)`,
    [tenantId],
  );
  await explain(
    'own documents OR filter',
    `SELECT status, COUNT(*) FROM stock_receipts
     WHERE tenant_id = $1 AND (created_by_id = $2 OR approved_by_id = $2)
     GROUP BY status`,
    [tenantId, 'missing-user'],
  );
  await explain(
    'completedAt date filter',
    `SELECT COALESCE(SUM(d.qty_base_unit), 0)
     FROM stock_receipt_details d
     JOIN stock_receipts r ON r.id = d.receipt_id
     WHERE r.tenant_id = $1 AND r.status = 'completed'
       AND r.completed_at >= NOW() - INTERVAL '30 days'`,
    [tenantId],
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
