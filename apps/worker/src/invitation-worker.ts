import type { PrismaClient } from '@dharma-events/database';
import {
  buildQrUrl,
  generateQrToken,
  hashQrToken,
  renderQrPng,
  renderQrDataUrl,
  invitationPdfFilename,
  renderInvitationPdf,
  renderInvitationEmail,
  mergePdfDocuments,
  retryDelayMs,
  type Env,
} from '@dharma-events/shared';
import type { Mailer } from './mailer.js';

export interface InvitationWorkerDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  env: Env;
  /** Injectable clock so retry-scheduling/stale-job tests don't depend on wall-clock time. */
  now?: () => Date;
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
}

/** Jobs stuck in PROCESSING longer than this are assumed to belong to a crashed worker and are requeued. */
const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Requeues jobs left in PROCESSING by a worker that crashed or was killed
 * mid-send, back to PENDING so they get retried. This is what makes the
 * worker "survive restart" (REQUIREMENTS.md Section 78 acceptance
 * criteria) instead of leaking jobs into limbo forever.
 */
async function requeueStaleProcessingJobs(prisma: PrismaClient, now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);
  const result = await prisma.invitationJob.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
    data: { status: 'PENDING', nextAttemptAt: now },
  });
  return result.count;
}

function formatEventDate(eventDate: Date): string {
  return eventDate.toISOString().slice(0, 10);
}

/**
 * Processes up to `env.EMAIL_WORKER_BATCH_SIZE` due invitation jobs: for
 * each, generates a fresh QR token (only its hash is ever persisted -
 * Section 13), renders the PDF/email (Section 19), sends via SMTP, and
 * updates the job + registration according to the outcome. Failures follow
 * the Section 21 backoff schedule up to `env.EMAIL_MAX_RETRIES` attempts,
 * after which the job is marked FAILED permanently.
 */
export async function processInvitationJobs(deps: InvitationWorkerDeps): Promise<ProcessResult> {
  const { prisma, mailer, env } = deps;
  const now = deps.now ?? (() => new Date());
  const currentTime = now();

  await requeueStaleProcessingJobs(prisma, currentTime);

  const jobs = await prisma.invitationJob.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: currentTime } }],
    },
    orderBy: { createdAt: 'asc' },
    take: env.EMAIL_WORKER_BATCH_SIZE,
    include: {
      registration: { include: { category: true, volunteer: true } },
      event: true,
    },
  });

  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, retried: 0 };

  for (const job of jobs) {
    result.processed += 1;
    const attemptCount = job.attemptCount + 1;

    await prisma.invitationJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', attemptCount, lastAttemptAt: now() },
    });

    try {
      const token = generateQrToken(env.QR_TOKEN_BYTES);
      const qrUrl = buildQrUrl(env.PUBLIC_URL, token);
      const [qrPngBytes, qrDataUrl] = await Promise.all([
        renderQrPng(qrUrl),
        renderQrDataUrl(qrUrl),
      ]);

      const registration = job.registration;
      const event = job.event;

      const pdfBytes = await renderInvitationPdf({
        eventName: event.eventName,
        participantName: registration.name,
        registrationNo: registration.registrationNo,
        registeredCount: registration.registeredCount,
        eventDateLabel: formatEventDate(event.eventDate),
        venue: event.venue,
        instructions: event.description,
        qrPngBytes,
      });

      // Section 19: if the event has an optional invite attachment PDF
      // (flyer/brochure/formal letter) uploaded, its pages are merged with
      // the generated ticket page(s) into a single combined PDF attachment
      // rather than separate files. A category's own attachment (if
      // uploaded) takes priority over the event's common one, so different
      // guest categories (e.g. "VIP" vs "General") can use different invite
      // templates. Merge order: attachment pages first, then the ticket
      // page(s) with the QR code, per the customer's requested reading order.
      const attachmentBytes = registration.category.inviteAttachmentData ?? event.inviteAttachmentData;
      const finalPdfBytes = attachmentBytes ? await mergePdfDocuments(attachmentBytes, pdfBytes) : pdfBytes;

      const email = renderInvitationEmail({
        eventName: event.eventName,
        participantName: registration.name,
        registrationNo: registration.registrationNo,
        registeredCount: registration.registeredCount,
        eventDateLabel: formatEventDate(event.eventDate),
        venue: event.venue,
        instructions: event.description,
        qrDataUrl,
      });

      const cc: string[] = [];
      if (env.INVITATION_CC_VOLUNTEER && registration.volunteer?.email) {
        cc.push(registration.volunteer.email);
      }
      if (env.INVITATION_CC_REGISTRATION_MAILBOX) {
        cc.push(env.INVITATION_CC_REGISTRATION_MAILBOX);
      }

      await mailer.sendMail({
        to: registration.email,
        cc: cc.length > 0 ? cc : undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: [
          {
            filename: invitationPdfFilename(registration.registrationNo),
            content: Buffer.from(finalPdfBytes),
            contentType: 'application/pdf',
          },
        ],
      });

      const sentAt = now();
      await prisma.$transaction([
        prisma.invitationJob.update({
          where: { id: job.id },
          data: { status: 'SENT', sentAt, errorMessage: null },
        }),
        prisma.registration.update({
          where: { id: registration.id },
          data: {
            qrTokenHash: hashQrToken(token),
            invitationStatus: 'SENT',
            invitationSentAt: sentAt,
          },
        }),
      ]);
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanentlyFailed = attemptCount >= env.EMAIL_MAX_RETRIES;

      await prisma.$transaction([
        prisma.invitationJob.update({
          where: { id: job.id },
          data: permanentlyFailed
            ? { status: 'FAILED', errorMessage: message }
            : {
                status: 'PENDING',
                errorMessage: message,
                nextAttemptAt: new Date(now().getTime() + retryDelayMs(attemptCount + 1)),
              },
        }),
        prisma.registration.update({
          where: { id: job.registrationId },
          data: { invitationStatus: permanentlyFailed ? 'FAILED' : 'PENDING' },
        }),
      ]);

      if (permanentlyFailed) {
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}
