-- Add unique username; backfill from email for existing rows.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;

UPDATE "User"
SET "username" = replace(replace(trim(both from email), '@', '_'), ' ', '_')
WHERE "username" IS NULL OR trim(both from "username") = '';

-- Resolve duplicate usernames by appending id suffix.
UPDATE "User" u
SET "username" = left(u."username", 96) || '_' || right(u.id, 6)
WHERE EXISTS (
  SELECT 1
  FROM "User" other
  WHERE other."username" = u."username"
    AND other.id <> u.id
);

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
