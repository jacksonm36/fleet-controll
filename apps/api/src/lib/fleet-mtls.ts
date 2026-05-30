import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type AgentMtlsMaterial = {
  certPem: string;
  keyPem: string;
  expiresAt: string;
};

export function fleetMtlsCaCertPath(): string | null {
  const p = process.env.FLEET_MTLS_CA_CERT?.trim();
  return p && existsSync(p) ? p : null;
}

export function fleetMtlsCaKeyPath(): string | null {
  const p = process.env.FLEET_MTLS_CA_KEY?.trim();
  return p && existsSync(p) ? p : null;
}

export function fleetMtlsCaReady(): boolean {
  return !!fleetMtlsCaCertPath() && !!fleetMtlsCaKeyPath();
}

/** Issue a short-lived client cert with CN = agentId (optional mTLS). */
export function issueAgentClientCert(agentId: string): AgentMtlsMaterial | null {
  if (!AGENT_ID_RE.test(agentId)) return null;
  const caCert = fleetMtlsCaCertPath();
  const caKey = fleetMtlsCaKeyPath();
  if (!caCert || !caKey) return null;

  const days = Math.min(
    825,
    Math.max(30, Number(process.env.FLEET_MTLS_CLIENT_DAYS ?? 365) || 365),
  );

  const dir = mkdtempSync(join(tmpdir(), "fleet-mtls-"));
  try {
    const keyPath = join(dir, "client.key");
    const csrPath = join(dir, "client.csr");
    const certPath = join(dir, "client.crt");

    execFileSync("openssl", ["genrsa", "-out", keyPath, "2048"], {
      stdio: "pipe",
    });
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        keyPath,
        "-subj",
        `/CN=${agentId}/O=Fleet Agent`,
        "-out",
        csrPath,
      ],
      { stdio: "pipe" },
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csrPath,
        "-CA",
        caCert,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        certPath,
        "-days",
        String(days),
        "-sha256",
      ],
      { stdio: "pipe" },
    );

    const keyPem = readFileSync(keyPath, "utf8");
    const certPem = readFileSync(certPath, "utf8");
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();

    return { certPem, keyPem, expiresAt };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function certFingerprintSha256Hex(certPem: string): string | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), "fleet-mtls-fp-"));
    try {
      const certPath = join(dir, "client.crt");
      writeFileSync(certPath, certPem, "utf8");
      const out = execFileSync(
        "openssl",
        ["x509", "-in", certPath, "-noout", "-fingerprint", "-sha256"],
        { encoding: "utf8" },
      );
      const m = out.match(/SHA256 Fingerprint=([0-9A-F:]+)/i);
      if (!m) return null;
      return m[1].replace(/:/g, "").toLowerCase();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return null;
  }
}

export function spkiSha256HexFromCertPem(certPem: string): string | null {
  try {
    const cert = new X509Certificate(certPem);
    const spki = cert.publicKey.export({ type: "spki", format: "der" });
    return createHash("sha256").update(spki).digest("hex");
  } catch {
    return null;
  }
}
