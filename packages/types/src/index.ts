/**
 * Shared contracts between central API, web UI, and agents (inventory v1, job v1).
 */

export type OsType = "linux" | "windows";

export interface InventoryPackageV1 {
  name: string;
  version: string;
  manager: string;
  source?: string;
  updateAvailable?: boolean;
  availableVersion?: string;
}

export interface InventoryVulnerabilityV1 {
  cveId: string;
  packageName?: string;
  packageVersion?: string;
  manager?: string;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  summary?: string;
  fixedVersion?: string;
  source: string;
}

export interface InventoryKernelV1 {
  running?: string;
  latestInstalled?: string;
  updatePending?: boolean;
  rebootRequired?: boolean;
}

export interface InventoryServiceV1 {
  name: string;
  kind:
    | "systemd"
    | "windows_service"
    | "docker"
    | "podman"
    | "snap"
    | "launchd";
  state: string;
  enabled?: boolean;
  detail?: string;
}

export interface InventoryContainerV1 {
  name: string;
  image: string;
  imageId?: string;
  runtime: "docker" | "podman";
  status: string;
  ports?: string;
  composeProject?: string;
}

export interface InventoryPayloadV1 {
  schemaVersion: 1;
  collectedAt: string;
  packages: InventoryPackageV1[];
  services: InventoryServiceV1[];
  containers?: InventoryContainerV1[];
  kernel?: InventoryKernelV1;
  packageUpdatesPending?: number;
  vulnerabilities?: InventoryVulnerabilityV1[];
  rebootRequired?: boolean;
  crowdsecInstalled?: boolean;
}

export type JobTypeV1 =
  | "PACKAGE_UPGRADE"
  | "PACKAGE_PATCH_PLAN"
  | "PACKAGE_REFRESH"
  | "HOST_KERNEL_MAINTENANCE"
  | "SERVICE_RESTART"
  | "SERVICE_STOP"
  | "SERVICE_START"
  | "CROWDSEC_DECISION_ADD"
  | "SHELL_SCRIPT"
  | "ANSIBLE_PLAYBOOK"
  | "ANSIBLE_ADHOC"
  | "TERRAFORM_INIT"
  | "TERRAFORM_PLAN"
  | "TERRAFORM_APPLY";

export type AutomationToolV1 =
  | "shell"
  | "ansible"
  | "terraform"
  | "opentofu"
  | "puppet"
  | "chef"
  | "custom";

export interface AutomationScriptV1 {
  id: string;
  name: string;
  description?: string | null;
  tool: AutomationToolV1;
  content: string;
  defaultPayload?: Record<string, unknown> | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JobPayloadPackageUpgrade {
  manager: string;
  packageNames?: string[];
  /** When true, upgrade all pending (best-effort per OS). */
  all?: boolean;
  securityOnly?: boolean;
  patchPlanId?: string;
}

export interface PatchPlanPackageV1 {
  name: string;
  currentVersion?: string;
  targetVersion?: string;
  security?: boolean;
}

export interface PatchPlanV1 {
  id: string;
  agentId: string;
  status: string;
  manager: string;
  securityOnly: boolean;
  packages: PatchPlanPackageV1[];
  dryRunJobId?: string | null;
  executeJobId?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  executedAt?: string | null;
}

export interface PatchRunV1 {
  id: string;
  agentId: string;
  patchPlanId?: string | null;
  jobId: string;
  manager: string;
  packageCount: number;
  exitStatus: string;
  startedAt: string;
  finishedAt?: string | null;
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

export interface FleetTlsSetupV1 {
  tlsRequired: boolean;
  autoEncrypt?: boolean;
  publicUrl: string;
  caAvailable: boolean;
  caDownloadUrl: string;
  controllerHost: string;
  tlsProxy?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
  issuer: string;
  trustProxy?: boolean;
}

export interface MetricsPayloadV1 {
  schemaVersion: 1;
  collectedAt: string;
  cpu?: { percent: number; cores?: number };
  memory?: { totalBytes: number; usedBytes: number; usedPercent: number };
  network?: { rxBps: number; txBps: number };
  disk?: { rootUsedPercent: number };
  load?: { load1: number; load5: number; load15: number };
  users?: { loggedIn: number };
  health?: { score: number; status: string };
}

export interface FleetSummaryV1 {
  agentCount: number;
  onlineCount: number;
  staleCount: number;
  pendingJobs: number;
  packagesTracked: number;
  rebootRequiredCount: number;
  kernelUpdatePendingCount: number;
  packageUpdatesPendingCount: number;
  outdatedPackagesCount: number;
  cveCount: number;
  cveCriticalCount: number;
  cveHighCount: number;
  agentsWithCves: number;
  crowdsecHosts: number;
}

export interface CveFindingV1 {
  id: string;
  agentId: string;
  cveId: string;
  packageName?: string | null;
  packageVersion?: string | null;
  manager?: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  summary?: string | null;
  fixedVersion?: string | null;
  source: string;
  scannedAt: string;
}
