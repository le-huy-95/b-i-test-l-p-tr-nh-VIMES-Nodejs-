import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const tenants = await pool.query('SELECT id, code, name, status FROM tenants ORDER BY created_at DESC');
  console.log('TENANTS:', JSON.stringify(tenants.rows, null, 2));
  for (const t of tenants.rows) {
    const wh = await pool.query('SELECT id, code, name, address, is_active FROM warehouses WHERE tenant_id = $1 ORDER BY code', [t.id]);
    console.log(`WAREHOUSES tenant=${t.code}(${t.id}):`, JSON.stringify(wh.rows, null, 2));
  }
}
main().finally(() => pool.end());
