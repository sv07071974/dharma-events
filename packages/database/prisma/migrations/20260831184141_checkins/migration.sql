-- CreateEnum
CREATE TYPE "CheckinStatus" AS ENUM ('VALID', 'OVERRIDE', 'REVERSED');

-- CreateTable
CREATE TABLE "checkins" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "attendee_count" INTEGER NOT NULL,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" TEXT NOT NULL,
    "counter_name" TEXT,
    "device_id" TEXT,
    "status" "CheckinStatus" NOT NULL DEFAULT 'VALID',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkins_event_id_idx" ON "checkins"("event_id");

-- CreateIndex
CREATE INDEX "checkins_registration_id_idx" ON "checkins"("registration_id");

-- CreateIndex
CREATE INDEX "checkins_status_idx" ON "checkins"("status");

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

