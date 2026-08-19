import { Router, Request, Response } from 'express';
import { prisma } from '../infra/prisma';
import { getRedis } from '../infra/redis';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; detail?: unknown }> = {};
  let allHealthy = true;

  try {
    const rows = await prisma.$queryRaw<Array<{ current_time: Date; pg_version: string }>>`
      SELECT NOW() AS current_time, version() AS pg_version
    `;
    checks.database = { status: 'healthy', detail: rows[0] };
  } catch (err) {
    checks.database = { status: 'unhealthy', detail: err instanceof Error ? err.message : 'Unknown error' };
    allHealthy = false;
  }

  try {
    const redis = getRedis();
    if (redis) {
      const pong = await redis.ping();
      checks.redis = { status: 'healthy', detail: pong };
    } else {
      checks.redis = { status: 'degraded', detail: 'Redis not connected (running in DB-only mode)' };
    }
  } catch (err) {
    checks.redis = { status: 'unhealthy', detail: err instanceof Error ? err.message : 'Unknown error' };
    allHealthy = false;
  }

  res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    data: {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    },
  });
});

export default router;
