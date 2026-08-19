/**
 * Xóa dữ liệu role tenant cũ còn dùng `viewer` / `approver`.
 *
 * Usage:
 *   bun run scripts/fix-tenant-roles.ts
 *   bun run scripts/fix-tenant-roles.ts --dry-run
 */
import 'dotenv/config';
import { Pool } from 'pg';

const dryRun = process.argv.includes('--dry-run');

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const [userTenantOldRoles, invitationOldRoles] = await Promise.all([
        client.query<{ viewer_count: string; approver_count: string }>(
          `
            SELECT
              COUNT(*) FILTER (WHERE role = 'viewer') AS viewer_count,
              COUNT(*) FILTER (WHERE role = 'approver') AS approver_count
            FROM user_tenants
          `,
        ),
        client.query<{ viewer_count: string; approver_count: string }>(
          `
            SELECT
              COUNT(*) FILTER (WHERE role = 'viewer') AS viewer_count,
              COUNT(*) FILTER (WHERE role = 'approver') AS approver_count
            FROM invitations
          `,
        ),
      ]);

      const userTenantViewerCount = Number(userTenantOldRoles.rows[0]?.viewer_count ?? 0);
      const userTenantApproverCount = Number(userTenantOldRoles.rows[0]?.approver_count ?? 0);
      const invitationViewerCount = Number(invitationOldRoles.rows[0]?.viewer_count ?? 0);
      const invitationApproverCount = Number(invitationOldRoles.rows[0]?.approver_count ?? 0);

      console.log('[tenant-roles] user_tenants:', {
        viewer: userTenantViewerCount,
        approver: userTenantApproverCount,
      });
      console.log('[tenant-roles] invitations:', {
        viewer: invitationViewerCount,
        approver: invitationApproverCount,
      });

      if (dryRun) {
        await client.query('ROLLBACK');
        console.log('[tenant-roles] dry-run only, no changes applied.');
        return;
      }

      const userTenantDeleteResult = await client.query(
        `
          DELETE FROM user_tenants
          WHERE role IN ('viewer', 'approver')
        `,
      );

      const invitationDeleteResult = await client.query(
        `
          DELETE FROM invitations
          WHERE role IN ('viewer', 'approver')
        `,
      );

      await client.query('COMMIT');

      console.log('[tenant-roles] deleted user_tenants rows:', userTenantDeleteResult.rowCount ?? 0);
      console.log('[tenant-roles] deleted invitations rows:', invitationDeleteResult.rowCount ?? 0);
      console.log('[tenant-roles] done.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[tenant-roles] failed:', err);
  process.exit(1);
});
