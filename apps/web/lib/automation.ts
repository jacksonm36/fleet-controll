export type AutomationTool =
  | "shell"
  | "ansible"
  | "terraform"
  | "opentofu"
  | "puppet"
  | "chef"
  | "custom";

export const AUTOMATION_TOOLS: { id: AutomationTool; label: string; hint: string }[] = [
  { id: "shell", label: "Shell", hint: "bash / PowerShell on the agent" },
  { id: "ansible", label: "Ansible", hint: "playbooks & ad-hoc (ansible on agent)" },
  { id: "terraform", label: "Terraform", hint: "init / plan / apply (terraform CLI)" },
  { id: "opentofu", label: "OpenTofu", hint: "same as Terraform, uses tofu binary" },
  { id: "puppet", label: "Puppet", hint: "runs as shell until agent has puppet" },
  { id: "chef", label: "Chef", hint: "runs as shell until agent has chef" },
  { id: "custom", label: "Custom", hint: "any script body you define" },
];

export const JOB_TYPE_LABELS: Record<string, string> = {
  SHELL_SCRIPT: "Shell script",
  ANSIBLE_PLAYBOOK: "Ansible playbook",
  ANSIBLE_ADHOC: "Ansible ad-hoc command",
  TERRAFORM_INIT: "Terraform init",
  TERRAFORM_PLAN: "Terraform plan",
  TERRAFORM_APPLY: "Terraform apply",
};

export function jobTypesForTool(tool: AutomationTool): string[] {
  switch (tool) {
    case "ansible":
      return ["ANSIBLE_PLAYBOOK", "ANSIBLE_ADHOC"];
    case "terraform":
    case "opentofu":
      return ["TERRAFORM_INIT", "TERRAFORM_PLAN", "TERRAFORM_APPLY"];
    default:
      return ["SHELL_SCRIPT"];
  }
}

export function defaultJobTypeForTool(tool: AutomationTool): string {
  return jobTypesForTool(tool)[0];
}

export const SETUP_STEPS = [
  {
    title: "Enroll an agent",
    body: "Mint a token under Agents → Enroll new agent, then run the install script on the host you want to automate.",
    href: "/agents#enroll",
    cta: "Open Agents",
  },
  {
    title: "Install tools on the agent (optional)",
    body: "Shell works out of the box. For Ansible: apt install ansible (or pip). For Terraform: install terraform or tofu on the agent PATH.",
    href: "/agents",
    cta: "View agents",
  },
  {
    title: "Run a script",
    body: "Pick an online agent, choose a preset or library script, then Run. Logs stream below when the job starts.",
    href: "/automation",
    cta: "You are here",
  },
] as const;

export const inputClass =
  "mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[#1a2332] px-3 py-2 text-sm text-white shadow-inner focus:border-[hsl(var(--accent))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))]";

export const selectClass =
  "mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[#1a2332] px-3 py-2 text-sm text-white shadow-inner focus:border-[hsl(var(--accent))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))] [&>option]:bg-[#1a2332] [&>option]:text-white";
