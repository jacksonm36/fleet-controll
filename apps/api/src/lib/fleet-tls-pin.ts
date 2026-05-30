import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fleetCaCertPath } from "./fleet-urls.js";

export type TlsPinAlgorithm = "spki-sha512" | "spki-sha256";

export type TlsPinInfo = {
  /** Recommended: SPKI digest with SHA-512 (128 hex chars). */
  spkiSha512: string;
  /** Agent env one-liner, e.g. sha512:<hex> */
  fleetTlsPin: string;
  /** @deprecated Use spkiSha512 / fleetTlsPin — kept for existing agents. */
  spkiSha256: string;
  certSha512: string;
  certSha256: string;
  certPath: string;
  algorithm: TlsPinAlgorithm;
  hash: "sha512" | "sha256";
  hint: string;
};

function spkiDigests(pem: string): {
  spki: Buffer;
  spkiSha512: string;
  spkiSha256: string;
  certSha512: string;
  certSha256: string;
} | null {
  try {
    const cert = new X509Certificate(pem);
    const spki = cert.publicKey.export({ type: "spki", format: "der" });
    return {
      spki,
      spkiSha512: createHash("sha512").update(spki).digest("hex"),
      spkiSha256: createHash("sha256").update(spki).digest("hex"),
      certSha512: createHash("sha512").update(cert.raw).digest("hex"),
      certSha256: createHash("sha256").update(cert.raw).digest("hex"),
    };
  } catch {
    return null;
  }
}

export function controllerTlsPinInfo(): TlsPinInfo | null {
  const certPath = fleetCaCertPath();
  if (!certPath) return null;
  try {
    const pem = readFileSync(certPath, "utf8");
    const d = spkiDigests(pem);
    if (!d) return null;
    return {
      spkiSha512: d.spkiSha512,
      fleetTlsPin: `sha512:${d.spkiSha512}`,
      spkiSha256: d.spkiSha256,
      certSha512: d.certSha512,
      certSha256: d.certSha256,
      certPath,
      algorithm: "spki-sha512",
      hash: "sha512",
      hint: "Set FLEET_TLS_PIN to fleetTlsPin on agents (SHA-512 SPKI pin). FLEET_TLS_PIN_SHA256 still accepted.",
    };
  } catch {
    return null;
  }
}
