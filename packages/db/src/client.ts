import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as { __fleetPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__fleetPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__fleetPrisma = prisma;
}
