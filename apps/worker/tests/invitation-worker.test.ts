import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { getPrismaClient, resetPrismaClientForTests, type PrismaClient } from '@dharma-events/database';
import { PDFDocument } from 'pdf-lib';
import { buildTestEnv } from './helpers/build-test-env.js';
import { processInvitationJobs } from '../src/invitation-worker.js';
import type { Mailer, MailMessage } from '../src/mailer.js';

class FakeMailer implements Mailer {
  calls: MailMessage[] = [];
  failNextCalls: number;

  constructor(failNextCalls = 0) {
    this.failNextCalls = failNextCalls;
  }

  async sendMail(message: MailMessage): Promise<void> {
    this.calls.push(message);
    if (this.failNextCalls > 0) {
      this.failNextCalls -= 1;
      throw new Error('SMTP send failed (test)');
    }
  }
}

let testDb: TestDatabase;
let prisma: PrismaClient;

beforeAll(async () => {
  testDb = await startTestDatabase();
  prisma = getPrismaClient(testDb.databaseUrl);
});

afterAll(async () => {
  await resetPrismaClientForTests();
  await testDb.stop();
});

beforeEach(async () => {
  await prisma.invitationJob.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.volunteer.deleteMany();
  await prisma.category.deleteMany();
  await prisma.event.deleteMany();
});

async function seedRegistrationWithJob(overrides?: {
  jobStatus?: 'PENDING' | 'PROCESSING' | 'FAILED';
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  staleMinutesAgo?: number;
}) {
  const event = await prisma.event.create({
    data: {
      eventCode: 'MDF26',
      eventName: 'myDharma Fest 2026',
      eventDate: new Date('2026-09-12'),
      venue: 'Main Hall',
      description: 'Please arrive 30 minutes early.',
    },
  });
  const category = await prisma.category.create({ data: { eventId: event.id, name: 'Participant' } });
  const registration = await prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0001',
      name: 'Example Participant',
      email: 'participant@example.test',
      registeredCount: 2,
      categoryId: category.id,
      invitationStatus: 'PENDING',
    },
  });
  const job = await prisma.invitationJob.create({
    data: {
      eventId: event.id,
      registrationId: registration.id,
      status: overrides?.jobStatus ?? 'PENDING',
      attemptCount: overrides?.attemptCount ?? 0,
      nextAttemptAt: overrides?.nextAttemptAt,
    },
  });

  if (overrides?.staleMinutesAgo !== undefined) {
    // Bypass Prisma's automatic @updatedAt so we can simulate a job that has
    // been stuck in PROCESSING since before the crash-recovery threshold.
    // The stale instant is computed in JS (UTC) and passed as a plain ISO
    // string cast to `timestamp` - binding a JS Date object directly (or
    // using Postgres's own NOW()) here would be silently reinterpreted
    // using the database server's local time zone for a "timestamp without
    // time zone" column, which does not match how Prisma (and this app)
    // otherwise always treats these columns as UTC.
    const staleIso = new Date(Date.now() - overrides.staleMinutesAgo * 60 * 1000).toISOString().replace('Z', '');
    await prisma.$executeRawUnsafe(
      'UPDATE invitation_jobs SET updated_at = $1::timestamp WHERE id = $2',
      staleIso,
      job.id,
    );
  }

  return { event, category, registration, job };
}

describe('processInvitationJobs', () => {
  it('sends a due job successfully and updates job + registration state', async () => {
    const { registration, job } = await seedRegistrationWithJob();
    const mailer = new FakeMailer();

    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv() });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, retried: 0 });
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0]!.to).toBe('participant@example.test');
    expect(mailer.calls[0]!.attachments[0]!.filename).toBe('MDF26-0001-Invitation.pdf');

    const updatedJob = await prisma.invitationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe('SENT');
    expect(updatedJob.sentAt).not.toBeNull();
    expect(updatedJob.attemptCount).toBe(1);

    const updatedRegistration = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(updatedRegistration.invitationStatus).toBe('SENT');
    expect(updatedRegistration.invitationSentAt).not.toBeNull();
    expect(updatedRegistration.qrTokenHash).not.toBeNull();
    expect(updatedRegistration.qrTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not process a job whose nextAttemptAt is in the future', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    await seedRegistrationWithJob({ attemptCount: 1, nextAttemptAt: futureDate });
    const mailer = new FakeMailer();

    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv() });

    expect(result).toEqual({ processed: 0, sent: 0, failed: 0, retried: 0 });
    expect(mailer.calls).toHaveLength(0);
  });

  it('schedules a backoff retry on transient SMTP failure without exceeding max retries', async () => {
    const { registration, job } = await seedRegistrationWithJob();
    const mailer = new FakeMailer(1); // fail once

    const before = Date.now();
    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv({ EMAIL_MAX_RETRIES: '4' }) });

    expect(result).toEqual({ processed: 1, sent: 0, failed: 0, retried: 1 });

    const updatedJob = await prisma.invitationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe('PENDING');
    expect(updatedJob.attemptCount).toBe(1);
    expect(updatedJob.errorMessage).toContain('SMTP send failed');
    // Attempt 1 failed -> retry delay is 60s (Section 21 schedule).
    expect(updatedJob.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 59_000);

    const updatedRegistration = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(updatedRegistration.invitationStatus).toBe('PENDING');
  });

  it('marks the job permanently FAILED after exhausting all retries', async () => {
    const { registration, job } = await seedRegistrationWithJob({ attemptCount: 3 });
    const mailer = new FakeMailer(1); // always fails on this single attempt

    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv({ EMAIL_MAX_RETRIES: '4' }) });

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1, retried: 0 });

    const updatedJob = await prisma.invitationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe('FAILED');
    expect(updatedJob.attemptCount).toBe(4);
    expect(updatedJob.errorMessage).toContain('SMTP send failed');

    const updatedRegistration = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(updatedRegistration.invitationStatus).toBe('FAILED');
  });

  it('requeues a job stuck in PROCESSING from a crashed worker and sends it (worker survives restart)', async () => {
    const { job } = await seedRegistrationWithJob({ jobStatus: 'PROCESSING', staleMinutesAgo: 10 });
    const mailer = new FakeMailer();

    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv() });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, retried: 0 });
    const updatedJob = await prisma.invitationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe('SENT');
  });

  it('merges the event invite attachment PDF pages with the ticket in the emailed attachment (attachment first, ticket after)', async () => {
    const { registration } = await seedRegistrationWithJob();

    const attachmentPdf = await PDFDocument.create();
    attachmentPdf.addPage([200, 200]);
    attachmentPdf.addPage([200, 200]);
    const attachmentBytes = await attachmentPdf.save();

    await prisma.event.update({
      where: { id: registration.eventId },
      data: {
        inviteAttachmentData: Buffer.from(attachmentBytes),
        inviteAttachmentFilename: 'invite.pdf',
        inviteAttachmentSize: attachmentBytes.byteLength,
      },
    });

    const mailer = new FakeMailer();
    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv() });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, retried: 0 });
    expect(mailer.calls).toHaveLength(1);

    const sentBytes = mailer.calls[0]!.attachments[0]!.content as Buffer;
    const mergedDoc = await PDFDocument.load(sentBytes);
    // 2 ticket guest pages (seeded registration's registeredCount=2) + 2 attachment pages
    expect(mergedDoc.getPageCount()).toBe(4);
    // Attachment pages (200x200, seeded above) must come first, followed by
    // the ticket pages (420x594) - per the customer's requested reading order.
    expect(mergedDoc.getPage(0).getSize()).toEqual({ width: 200, height: 200 });
    expect(mergedDoc.getPage(1).getSize()).toEqual({ width: 200, height: 200 });
    expect(mergedDoc.getPage(2).getSize()).toEqual({ width: 420, height: 594 });
    expect(mergedDoc.getPage(3).getSize()).toEqual({ width: 420, height: 594 });
  });

  it('prefers the category-specific invite attachment over the event-wide one when both are set', async () => {
    const { registration } = await seedRegistrationWithJob();

    const eventPdf = await PDFDocument.create();
    eventPdf.addPage([200, 200]);
    const eventAttachmentBytes = await eventPdf.save();
    await prisma.event.update({
      where: { id: registration.eventId },
      data: {
        inviteAttachmentData: Buffer.from(eventAttachmentBytes),
        inviteAttachmentFilename: 'event-invite.pdf',
        inviteAttachmentSize: eventAttachmentBytes.byteLength,
      },
    });

    const categoryPdf = await PDFDocument.create();
    categoryPdf.addPage([200, 200]);
    categoryPdf.addPage([200, 200]);
    categoryPdf.addPage([200, 200]);
    const categoryAttachmentBytes = await categoryPdf.save();
    await prisma.category.update({
      where: { id: registration.categoryId },
      data: {
        inviteAttachmentData: Buffer.from(categoryAttachmentBytes),
        inviteAttachmentFilename: 'category-invite.pdf',
        inviteAttachmentSize: categoryAttachmentBytes.byteLength,
      },
    });

    const mailer = new FakeMailer();
    const result = await processInvitationJobs({ prisma, mailer, env: buildTestEnv() });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, retried: 0 });
    const sentBytes = mailer.calls[0]!.attachments[0]!.content as Buffer;
    const mergedDoc = await PDFDocument.load(sentBytes);
    // 2 ticket guest pages + 3 category attachment pages (not the 1-page event attachment)
    expect(mergedDoc.getPageCount()).toBe(5);
  });
});
