-- User management: profile fields, TOTP, WebAuthn, recovery codes, auth challenges

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "totpSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "WebAuthnCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT,
  "nickname" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebAuthnCredential_credentialId_key"
  ON "WebAuthnCredential"("credentialId");
CREATE INDEX IF NOT EXISTS "WebAuthnCredential_userId_idx"
  ON "WebAuthnCredential"("userId");

DO $$ BEGIN
  ALTER TABLE "WebAuthnCredential"
    ADD CONSTRAINT "WebAuthnCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserRecoveryCode_userId_idx"
  ON "UserRecoveryCode"("userId");

DO $$ BEGIN
  ALTER TABLE "UserRecoveryCode"
    ADD CONSTRAINT "UserRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AuthChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT,
  "type" TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthChallenge_expiresAt_idx"
  ON "AuthChallenge"("expiresAt");
CREATE INDEX IF NOT EXISTS "AuthChallenge_userId_type_idx"
  ON "AuthChallenge"("userId", "type");
