/**
 * Shared contracts between central API, web UI, and agents (inventory v1, job v1).
 */

export type OsType = "linux" | "windows";

export interface InventoryPackageV1 {
  name: string;
  version: string;
  manager: string;
  source?: string;
}

export interface InventoryServiceV1 {
  name: string;
  kind: "systemd" | "windows_service";
  state: string;
  enabled?: boolean;
}

export interface InventoryPayloadV1 {
  schemaVersion: 1;
  collectedAt: string;
  packages: InventoryPackageV1[];
  services: InventoryServiceV1[];
  rebootRequired?: boolean;
  crowdsecInstalled?: boolean;
}

export type JobTypeV1 =
  | "PACKAGE_UPGRADE"
  | "PACKAGE_REFRESH"
  | "SERVICE_RESTART"
  | "SERVICE_STOP"
  | "SERVICE_START"
  | "CROWDSEC_DECISION_ADD";

export interface JobPayloadPackageUpgrade {
  manager: string;
  packageNames?: string[];
  /** When true, upgrade all pending (best-effort per OS). */
  all?: boolean;
}

export interface JobPayloadServiceAction {
  unitOrServiceName: string;
}

export interface JobPayloadCrowdSecDecision {
  ip: string;
  duration?: string;
  reason?: string;
}

export type JobPayloadV1 =
  | JobPayloadPackageUpgrade
  | JobPayloadServiceAction
  | JobPayloadCrowdSecDecision
  | Record<string, unknown>;

export interface CrowdSecSnapshotV1 {
  schemaVersion: 1;
  capturedAt: string;
  /** cscli version or crowdsec version string when detectable */
  version?: string;
  healthy?: boolean;
  alerts?: unknown[];
  decisions?: unknown[];
  bouncers?: unknown[];
  raw?: Record<string, unknown>;
}

export interface FleetSummaryV1 {
  agentCount: number;
  onlineCount: number;
  staleCount: number;
  pendingJobs: number;
  packagesTracked: number;
  rebootRequiredCount: number;
  crowdsecHosts: number;
}
