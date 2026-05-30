import type { AppReply } from "../types/app-instance.js";
import { shellAutomationDisabled } from "./security-config.js";

export function rejectShellAutomationIfDisabled(
  jobType: string,
  reply: AppReply,
): boolean {
  if (jobType !== "SHELL_SCRIPT") return false;
  if (!shellAutomationDisabled()) return false;
  void reply.code(403).send({
    error: "shell_automation_disabled",
    message:
      "SHELL_SCRIPT jobs are disabled on this controller (AUTOMATION_DISABLE_SHELL)",
  });
  return true;
}
