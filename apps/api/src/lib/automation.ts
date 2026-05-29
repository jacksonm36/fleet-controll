import type { AutomationTool, JobType } from "@prisma/client";

export const AUTOMATION_JOB_TYPES = [
  "SHELL_SCRIPT",
  "ANSIBLE_PLAYBOOK",
  "ANSIBLE_ADHOC",
  "TERRAFORM_INIT",
  "TERRAFORM_PLAN",
  "TERRAFORM_APPLY",
] as const;

export type AutomationJobType = (typeof AUTOMATION_JOB_TYPES)[number];

export function toolToDefaultJobType(tool: AutomationTool): JobType {
  switch (tool) {
    case "ansible":
      return "ANSIBLE_PLAYBOOK";
    case "terraform":
    case "opentofu":
      return "TERRAFORM_PLAN";
    case "shell":
    case "puppet":
    case "chef":
    case "custom":
    default:
      return "SHELL_SCRIPT";
  }
}

export function buildPayloadFromScript(
  tool: AutomationTool,
  content: string,
  defaultPayload: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> | undefined,
  jobType?: JobType,
): Record<string, unknown> {
  const base = { ...(defaultPayload ?? {}), ...(overrides ?? {}) };
  const type = jobType ?? toolToDefaultJobType(tool);

  switch (type) {
    case "SHELL_SCRIPT":
      return {
        script: (base.script as string) ?? content,
        args: base.args,
        cwd: base.cwd ?? "/tmp",
        timeoutSec: base.timeoutSec ?? 600,
        interpreter: base.interpreter,
        ...base,
      };
    case "ANSIBLE_PLAYBOOK":
      return {
        playbookYaml: (base.playbookYaml as string) ?? content,
        extraVars: base.extraVars ?? {},
        inventory: base.inventory ?? "localhost,",
        checkMode: base.checkMode ?? false,
        ...base,
      };
    case "ANSIBLE_ADHOC":
      return {
        module: (base.module as string) ?? "ping",
        args: (base.args as string) ?? "all",
        inventory: base.inventory ?? "localhost,",
        ...base,
      };
    case "TERRAFORM_INIT":
    case "TERRAFORM_PLAN":
    case "TERRAFORM_APPLY":
      return {
        workingDir: base.workingDir ?? "/tmp/fleet-terraform",
        configHcl: (base.configHcl as string) ?? content,
        varFiles: base.varFiles ?? [],
        autoApprove: base.autoApprove ?? type === "TERRAFORM_APPLY",
        useOpenTofu: base.useOpenTofu ?? tool === "opentofu",
        ...base,
      };
    default:
      return { ...base, script: content };
  }
}
