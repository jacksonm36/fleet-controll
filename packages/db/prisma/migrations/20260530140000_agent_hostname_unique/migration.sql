-- Collapse FQDN enrollments to short hostname (matches fleet-agent enrollHostnameFlag).
UPDATE "Agent"
SET hostname = split_part(hostname, '.', 1)
WHERE position('.' in hostname) > 0;

-- Drop duplicate hostnames; keep the most recently seen (or newest enrollment).
DELETE FROM "Agent" a
USING (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY hostname
      ORDER BY "lastSeenAt" DESC NULLS LAST, "enrolledAt" DESC
    ) AS rn
  FROM "Agent"
) ranked
WHERE a.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "Agent_hostname_key" ON "Agent"("hostname");
