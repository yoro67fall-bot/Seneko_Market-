-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "visitCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shop" ADD COLUMN "contactCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShopEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopEvent_shopId_type_day_key" ON "ShopEvent"("shopId", "type", "day");
CREATE INDEX "ShopEvent_shopId_type_day_idx" ON "ShopEvent"("shopId", "type", "day");

ALTER TABLE "ShopEvent" ADD CONSTRAINT "ShopEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
