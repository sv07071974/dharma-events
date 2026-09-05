-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "invite_attachment_data" BYTEA,
ADD COLUMN     "invite_attachment_filename" TEXT,
ADD COLUMN     "invite_attachment_size" INTEGER;
