import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tenants = await pool.query('SELECT id, code, name, status FROM tenants ORDER BY created_at DESC LIMIT 30');
  console.log('TENANTS:');
  console.table(tenants.rows);

  for (const t of tenants.rows) {
    const wh = await pool.query(
      'SELECT id, code, name, address, is_active FROM warehouses WHERE tenant_id = $1 ORDER BY code',
      [t.id],
    );
    console.log(`WAREHOUSES [tenant=${t.code} ${t.id}]:`);
    console.table(wh.rows);
  }

  const users = await pool.query('SELECT id, email, full_name FROM users ORDER BY created_at DESC LIMIT 10');
  console.log('USERS:');
  console.table(users.rows);

  const userTenants = await pool.query(
    `SELECT ut.user_id, ut.tenant_id, ut.role FROM user_tenants ut ORDER BY ut.created_at DESC LIMIT 20`,
  );
  console.log('USER_TENANTS:');
  console.table(userTenants.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());