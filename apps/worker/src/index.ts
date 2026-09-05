import { loadEnv } from '@dharma-events/shared';
import { getPrismaClient } from '@dharma-events/database';
import { nextPollDelayMs } from './poll.js';
import { createMailer } from './mailer.js';
import { processInvitationJobs } from './invitation-worker.js';

/**
 * Background worker entrypoint.
 *
 * Polls the `invitation_jobs` queue (Phase 4 - QR and Invitation System)
 * for pending invitation emails and processes them in batches. Also
 * requeues jobs abandoned mid-send by a previous, crashed worker process
 * (see `invitation-worker.ts`'s `requeueStaleProcessingJobs`), satisfying
 * the "worker survives restart" acceptance criterion.
 */
const env = loadEnv();
const prisma = getPrismaClient(env.DATABASE_URL);
const mailer = createMailer(env);

let shuttingDown = false;

async function runCycle(): Promise<boolean> {
  const result = await processInvitationJobs({ prisma, mailer, env });
  if (result.processed > 0) {
    console.log(
      `Invitation jobs processed=${result.processed} sent=${result.sent} retried=${result.retried} failed=${result.failed}`,
    );
  }
  return result.processed > 0;
}

async function mainLoop(): Promise<void> {
  console.log(`Dharma Events worker starting (env=${env.NODE_ENV})`);

  while (!shuttingDown) {
    const hasPendingWork = await runCycle();
    const delay = nextPollDelayMs(5000, hasPendingWork);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  console.log('Dharma Events worker shutting down');
  await prisma.$disconnect();
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

mainLoop().catch((err) => {
  console.error(err);
  process.exit(1);
});
