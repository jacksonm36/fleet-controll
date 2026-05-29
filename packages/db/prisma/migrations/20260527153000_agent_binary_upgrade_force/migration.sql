-- Used to force agent binary upgrades even when FLEET_AUTO_UPDATE is disabled.
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "binaryUpgradeForcedBuildId" TEXT;

