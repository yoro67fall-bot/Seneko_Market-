-- Multi-country support: countryCode scoping + contact fields

-- PlatformConfig: migrate single "config" row to country-keyed rows
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "contactAddress" TEXT NOT NULL DEFAULT '';

UPDATE "PlatformConfig" SET "countryCode" = 'SN', "id" = 'SN' WHERE "id" = 'config';
UPDATE "PlatformConfig" SET "countryCode" = COALESCE("countryCode", 'SN') WHERE "countryCode" IS NULL;

ALTER TABLE "PlatformConfig" ALTER COLUMN "countryCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformConfig_countryCode_key" ON "PlatformConfig"("countryCode");

INSERT INTO "PlatformConfig" ("id", "countryCode", "rentAmount", "rentDurationDays", "sponsorPrice7", "sponsorPrice15", "sponsorPrice30", "sponsorPrice60", "currency", "contactPhone", "contactEmail", "contactAddress", "updatedAt")
VALUES
  ('BJ', 'BJ', 5000, 30, 5000, 8000, 12000, 20000, 'XOF', '', '', '', NOW()),
  ('TG', 'TG', 5000, 30, 5000, 8000, 12000, 20000, 'XOF', '', '', '', NOW()),
  ('CD', 'CD', 5000, 30, 5000, 8000, 12000, 20000, 'CDF', '', '', '', NOW())
ON CONFLICT ("id") DO NOTHING;

-- User: add countryCode, change email uniqueness to (countryCode, email)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'SN';
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_countryCode_email_key" ON "User"("countryCode", "email");
CREATE INDEX IF NOT EXISTS "User_countryCode_idx" ON "User"("countryCode");

-- Shop: add countryCode, change nameNormalized uniqueness
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'SN';
DROP INDEX IF EXISTS "Shop_nameNormalized_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_countryCode_nameNormalized_key" ON "Shop"("countryCode", "nameNormalized");
CREATE INDEX IF NOT EXISTS "Shop_countryCode_idx" ON "Shop"("countryCode");

-- Agent: add countryCode, change code uniqueness
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'SN';
DROP INDEX IF EXISTS "Agent_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Agent_countryCode_code_key" ON "Agent"("countryCode", "code");
CREATE INDEX IF NOT EXISTS "Agent_countryCode_idx" ON "Agent"("countryCode");

-- Banner: add countryCode
ALTER TABLE "Banner" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'SN';
CREATE INDEX IF NOT EXISTS "Banner_countryCode_idx" ON "Banner"("countryCode");

-- CategoryBanner: add countryCode, change categoryName uniqueness
ALTER TABLE "CategoryBanner" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'SN';
DROP INDEX IF EXISTS "CategoryBanner_categoryName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryBanner_countryCode_categoryName_key" ON "CategoryBanner"("countryCode", "categoryName");
CREATE INDEX IF NOT EXISTS "CategoryBanner_countryCode_idx" ON "CategoryBanner"("countryCode");
