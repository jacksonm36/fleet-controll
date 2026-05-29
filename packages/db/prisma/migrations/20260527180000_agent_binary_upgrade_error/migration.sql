ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "binaryUpgradeLastError" TEXT;
