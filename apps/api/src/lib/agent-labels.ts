export type AgentLabels = {
  /** OS / template hostname at first enroll (unchanged when renamed in Fleet). */
  machineHostname?: string;
};

export function machineHostnameFromLabels(labels: unknown): string | null {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return null;
  const mh = (labels as AgentLabels).machineHostname;
  return typeof mh === "string" && mh.trim() ? mh.trim() : null;
}

export function agentWasRenamedInFleet(
  hostname: string,
  labels: unknown,
): boolean {
  const machine = machineHostnameFromLabels(labels);
  return !!machine && machine !== hostname;
}

export function agentLabelsJson(input: AgentLabels): AgentLabels {
  const out: AgentLabels = {};
  if (input.machineHostname?.trim()) {
    out.machineHostname = input.machineHostname.trim().slice(0, 128);
  }
  return out;
}
