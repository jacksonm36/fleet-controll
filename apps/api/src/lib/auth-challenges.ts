import { prisma } from "@fleet/db";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function storeAuthChallenge(input: {
  userId?: string | null;
  email?: string | null;
  type: string;
  challenge: string;
}): Promise<string> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  if (input.userId) {
    await prisma.authChallenge.deleteMany({
      where: { userId: input.userId, type: input.type },
    });
  } else if (input.email) {
    await prisma.authChallenge.deleteMany({
      where: { email: input.email, type: input.type },
    });
  }
  const row = await prisma.authChallenge.create({
    data: {
      userId: input.userId ?? null,
      email: input.email ?? null,
      type: input.type,
      challenge: input.challenge,
      expiresAt,
    },
  });
  return row.id;
}

export async function consumeAuthChallenge(input: {
  id?: string;
  userId?: string | null;
  email?: string | null;
  type: string;
  challenge: string;
}): Promise<boolean> {
  const now = new Date();
  const row = input.id
    ? await prisma.authChallenge.findFirst({
        where: { id: input.id, type: input.type, expiresAt: { gt: now } },
      })
    : await prisma.authChallenge.findFirst({
        where: {
          type: input.type,
          challenge: input.challenge,
          expiresAt: { gt: now },
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.email ? { email: input.email } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
  if (!row || row.challenge !== input.challenge) return false;
  await prisma.authChallenge.delete({ where: { id: row.id } });
  return true;
}

export async function purgeExpiredAuthChallenges(): Promise<void> {
  await prisma.authChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
