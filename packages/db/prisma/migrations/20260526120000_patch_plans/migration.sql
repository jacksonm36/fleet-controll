-- PatchMon-inspired patch plan / run tables (apply with prisma db push or migrate)

CREATE TYPE "PatchPlanStatus" AS ENUM (
  'PENDING_DRY_RUN',
  'READY',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED'
);

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PACKAGE_PATCH_PLAN';

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "result" JSONB;

CREATE TABLE IF NOT EXISTS "PatchPlan" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" "PatchPlanStatus" NOT NULL DEFAULT 'PENDING_DRY_RUN',
  "manager" TEXT NOT NULL,
  "securityOnly" BOOLEAN NOT NULL DEFAULT false,
  "packages" JSONB NOT NULL DEFAULT '[]',
  "dryRunJobId" TEXT,
  "executeJobId" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  CONSTRAINT "PatchPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PatchRun" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "patchPlanId" TEXT,
  "jobId" TEXT NOT NULL,
  "manager" TEXT NOT NULL,
  "packageCount" INTEGER NOT NULL,
  "exitStatus" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "summary" JSONB,
  CONSTRAINT "PatchRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PatchPlan_dryRunJobId_key" ON "PatchPlan"("dryRunJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "PatchPlan_executeJobId_key" ON "PatchPlan"("executeJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "PatchRun_jobId_key" ON "PatchRun"("jobId");
CREATE INDEX IF NOT EXISTS "PatchPlan_agentId_status_idx" ON "PatchPlan"("agentId", "status");
CREATE INDEX IF NOT EXISTS "PatchPlan_createdAt_idx" ON "PatchPlan"("createdAt");
CREATE INDEX IF NOT EXISTS "PatchRun_agentId_idx" ON "PatchRun"("agentId");
CREATE INDEX IF NOT EXISTS "PatchRun_startedAt_idx" ON "PatchRun"("startedAt");

ALTER TABLE "PatchPlan" ADD CONSTRAINT "PatchPlan_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatchPlan" ADD CONSTRAINT "PatchPlan_dryRunJobId_fkey"
  FOREIGN KEY ("dryRunJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchPlan" ADD CONSTRAINT "PatchPlan_executeJobId_fkey"
  FOREIGN KEY ("executeJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchRun" ADD CONSTRAINT "PatchRun_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatchRun" ADD CONSTRAINT "PatchRun_patchPlanId_fkey"
  FOREIGN KEY ("patchPlanId") REFERENCES "PatchPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchRun" ADD CONSTRAINT "PatchRun_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
