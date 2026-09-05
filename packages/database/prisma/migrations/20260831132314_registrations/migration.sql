-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('NOT_SENT', 'PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'WARNING', 'ERROR');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "registration_no" TEXT NOT NULL,
    "source_timestamp" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "registered_count" INTEGER NOT NULL,
    "category_id" TEXT NOT NULL,
    "volunteer_id" TEXT,
    "qr_token_hash" TEXT,
    "invitation_status" "InvitationStatus" NOT NULL DEFAULT 'NOT_SENT',
    "invitation_sent_at" TIMESTAMP(3),
    "validation_status" "ValidationStatus" NOT NULL DEFAULT 'VALID',
    "duplicate_flag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registrations_event_id_idx" ON "registrations"("event_id");

-- CreateIndex
CREATE INDEX "registrations_category_id_idx" ON "registrations"("category_id");

-- CreateIndex
CREATE INDEX "registrations_volunteer_id_idx" ON "registrations"("volunteer_id");

-- CreateIndex
CREATE INDEX "registrations_email_idx" ON "registrations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_event_id_registration_no_key" ON "registrations"("event_id", "registration_no");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

