import { prisma } from "@fleet/db";

/** Apply enum values that may be missing when SQL migrations were not run. */
export async function ensureDatabaseEnums(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'HOST_KERNEL_MAINTENANCE'`,
  );
}
