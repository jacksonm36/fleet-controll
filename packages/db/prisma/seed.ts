import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword } from "../src/crypto.js";

const seedDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(seedDir, "../../../.env"), override: true });

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin";

  let password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password?.length) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SEED_ADMIN_PASSWORD is required in production. Run: npm run env:generate",
      );
    }
    console.warn(
      '[seed] SEED_ADMIN_PASSWORD not set — dev-only default "changeme123". Run: npm run env:generate',
    );
    password = "changeme123";
  }

  const passwordHash = await hashPassword(password);
  const usernameFromEmail = (value: string) =>
    (value.split("@")[0]?.trim() || value.trim())
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 64) || "user";

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN" },
    create: {
      username: usernameFromEmail(email),
      email,
      passwordHash,
      role: "ADMIN",
    },
  });

  // Keep legacy login alias in sync (same password).
  if (email !== "admin@localhost") {
    await prisma.user.upsert({
      where: { email: "admin@localhost" },
      update: { passwordHash, role: "ADMIN" },
      create: {
        username: usernameFromEmail("admin@localhost"),
        email: "admin@localhost",
        passwordHash,
        role: "ADMIN",
      },
    });
  }

  const scriptSeeds = [
    {
      name: "Hello shell",
      tool: "shell" as const,
      description: "Quick connectivity check",
      content:
        '#!/bin/bash\nset -euo pipefail\necho "Fleet automation OK on $(hostname)"\nuname -a\n',
      defaultPayload: { cwd: "/tmp", timeoutSec: 120 },
      tags: ["demo", "shell"],
    },
    {
      name: "Ansible ping",
      tool: "ansible" as const,
      description: "Ping localhost via ansible-playbook",
      content: `---
- hosts: all
  gather_facts: false
  tasks:
    - name: Ping
      ansible.builtin.ping:
`,
      defaultPayload: { inventory: "localhost,", checkMode: false },
      tags: ["demo", "ansible"],
    },
    {
      name: "Terraform init smoke",
      tool: "terraform" as const,
      description: "Minimal HCL for terraform init/plan",
      content: `terraform {
  required_version = ">= 1.0"
}
`,
      defaultPayload: { workingDir: "/tmp/fleet-terraform-demo" },
      tags: ["demo", "terraform"],
    },
  ];

  for (const s of scriptSeeds) {
    await prisma.automationScript.upsert({
      where: { name: s.name },
      update: {
        description: s.description,
        content: s.content,
        defaultPayload: s.defaultPayload,
        tags: s.tags,
      },
      create: s,
    });
  }

  console.log(
    `Seed OK: admin "${email}" + alias admin@localhost (password from SEED_ADMIN_PASSWORD), ${scriptSeeds.length} automation scripts`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
