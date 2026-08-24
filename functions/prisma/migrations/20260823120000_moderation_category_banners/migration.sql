-- AlterTable
ALTER TABLE "Product" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Product" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Product" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "Product" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Product_approvalStatus_createdAt_idx" ON "Product"("approvalStatus", "createdAt");

-- CreateTable
CREATE TABLE "CategoryBanner" (
    "id" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "link" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBanner_categoryName_key" ON "CategoryBanner"("categoryName");

-- Existing products are treated as approved for backward compatibility
UPDATE "Product" SET "approvalStatus" = 'approved' WHERE "approvalStatus" = 'pending';
