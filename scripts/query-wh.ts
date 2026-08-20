import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const tenants = await pool.query(`SELECT id, code, name, status FROM tenant ORDER BY created_at DESC LIMIT 20`);
  console.log('=== TENANTS ===');
  console.table(tenants.rows);
  const wh = await pool.query(`SELECT w.id, w.tenant_id, w.code, w.name, w.address, w.is_active FROM warehouse w ORDER BY w.code LIMIT 50`);
  console.log('=== WAREHOUSES ===');
  console.table(wh.rows);
  const prod = await pool.query(`SELECT id, tenant_id, sku, name, is_active FROM product ORDER BY created_at LIMIT 10`);
  console.log('=== PRODUCTS ===');
  console.table(prod.rows);
  await pool.end();
}
run().catch(err => { console.error(err); process.exit(1); });