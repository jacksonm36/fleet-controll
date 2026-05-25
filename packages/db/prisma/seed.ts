import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const seedDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(seedDir, "../../../.env") });

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@localhost";

  let password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password?.length) {
    console.warn(
      "[seed] SEED_ADMIN_PASSWORD not set — using insecure default \"changeme123\". Add npm run env:generate to .env for a generated password.",
    );
    password = "changeme123";
  }

  const hash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, role: "ADMIN" },
    create: {
      email,
      passwordHash: hash,
      role: "ADMIN",
    },
  });

  console.log(`Seed OK: admin user "${email}" (password hash updated)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
