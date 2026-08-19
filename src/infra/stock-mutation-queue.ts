import IORedis from 'ioredis';
import { Job, Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import type { StockDocActor } from '../shared/notifications/stock-doc-notify';

export type StockMutationDocumentType = 'stock_issue' | 'stock_receipt';

export interface StockMutationCompletionJobData {
  tenantId: string;
  documentType: StockMutationDocumentType;
  documentId: string;
  actor: StockDocActor;
}

const QUEUE_NAME = 'stock-mutation-completions';
const JOB_NAME = 'complete-document';
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 1_500;
const DEFAULT_WORKER_CONCURRENCY = 5;
const MAX_COMPLETED_JOB_AGE_SECONDS = 24 * 60 * 60;

let queue: Queue<StockMutationCompletionJobData> | null = null;
let worker: Worker<StockMutationCompletionJobData> | null = null;

function createConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: false,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  });
}

function getQueue(): Queue<StockMutationCompletionJobData> {
  if (!queue) {
    queue = new Queue<StockMutationCompletionJobData>(QUEUE_NAME, {
      connection: createConnection(),
      defaultJobOptions: {
        attempts: DEFAULT_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: DEFAULT_BACKOFF_MS,
        },
        removeOnComplete: {
          age: MAX_COMPLETED_JOB_AGE_SECONDS,
          count: 1_000,
        },
        removeOnFail: {
          age: MAX_COMPLETED_JOB_AGE_SECONDS,
        },
      },
    });
  }
  return queue;
}

function getJobId(job: StockMutationCompletionJobData): string {
  return `${job.documentType}:${job.tenantId}:${job.documentId}:complete`;
}

async function processCompletionJob(job: Job<StockMutationCompletionJobData>): Promise<void> {
  const { documentType, documentId, tenantId, actor } = job.data;

  if (documentType === 'stock_issue') {
    const { stockIssueService } = await import('../modules/stock-issue/stock-issue.service');
    await stockIssueService.completeNow(tenantId, documentId, actor);
    return;
  }

  if (documentType === 'stock_receipt') {
    const { stockReceiptService } = await import('../modules/stock-receipt/stock-receipt.service');
    await stockReceiptService.completeNow(tenantId, documentId, actor);
    return;
  }

  throw new Error(`Unsupported stock mutation document type: ${documentType}`);
}

export async function enqueueStockMutationCompletion(
  job: StockMutationCompletionJobData,
): Promise<{ jobId: string }> {
  const queueInstance = getQueue();
  const jobId = getJobId(job);
  await queueInstance.add(JOB_NAME, job, { jobId });
  return { jobId };
}

export async function startStockMutationWorker(): Promise<void> {
  if (worker) return;

  try {
    worker = new Worker<StockMutationCompletionJobData>(QUEUE_NAME, processCompletionJob, {
      connection: createConnection(),
      concurrency: DEFAULT_WORKER_CONCURRENCY,
    });

    worker.on('failed', (job, err) => {
      if (!job) {
        console.error('[stock-mutation-queue] job failed before persistence:', err);
        return;
      }
      console.error(`[stock-mutation-queue] job ${job.id} failed:`, err);
    });

    worker.on('error', (err) => {
      console.error('[stock-mutation-queue] worker error:', err);
    });

    console.log('[stock-mutation-queue] worker started');
  } catch (err) {
    worker = null;
    console.warn('[stock-mutation-queue] worker unavailable, completion will fall back to inline execution:', err);
  }
}

export async function stopStockMutationWorker(): Promise<void> {
  if (worker) {
    await worker.close().catch(() => undefined);
    worker = null;
  }

  if (queue) {
    await queue.close().catch(() => undefined);
    queue = null;
  }
}
