-- CreateEnum
CREATE TYPE "InvitationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "invitation_jobs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "status" "InvitationJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invitation_jobs_event_id_idx" ON "invitation_jobs"("event_id");

-- CreateIndex
CREATE INDEX "invitation_jobs_registration_id_idx" ON "invitation_jobs"("registration_id");

-- CreateIndex
CREATE INDEX "invitation_jobs_status_idx" ON "invitation_jobs"("status");

-- AddForeignKey
ALTER TABLE "invitation_jobs" ADD CONSTRAINT "invitation_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_jobs" ADD CONSTRAINT "invitation_jobs_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

