-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "event_id" TEXT;

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "event_code" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "description" TEXT,
    "event_date" DATE NOT NULL,
    "venue" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "registration_open" BOOLEAN NOT NULL DEFAULT false,
    "checkin_open" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volunteers" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volunteers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_event_code_key" ON "events"("event_code");

-- CreateIndex
CREATE INDEX "categories_event_id_idx" ON "categories"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_event_id_name_key" ON "categories"("event_id", "name");

-- CreateIndex
CREATE INDEX "volunteers_event_id_idx" ON "volunteers"("event_id");

-- CreateIndex
CREATE INDEX "volunteers_user_id_idx" ON "volunteers"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_event_id_idx" ON "audit_logs"("event_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

