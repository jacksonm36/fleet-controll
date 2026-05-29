-- Track whether an agent is currently in the middle of an agent-binary auto-update.
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "binaryUpgradeInProgress" BOOLEAN NOT NULL DEFAULT false;

