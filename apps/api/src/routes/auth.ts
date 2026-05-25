import { prisma } from "@fleet/db";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Permissive: seed default is admin@localhost, rejected by z.string().email().
const looseEmailSchema = z
  .string()
  .trim()
  .min(3)
  .refine((s) => /^[^\s@]+@[^\s@]+$/.test(s), "email");

const loginSchema = z.object({
  email: looseEmailSchema,
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const token = await reply.jwtSign(
      { sub: user.id, role: user.role },
      { expiresIn: "8h" },
    );
    return {
      token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  });
}
