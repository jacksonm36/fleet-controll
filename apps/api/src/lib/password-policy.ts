export function validateNewPassword(password: string): string | null {
  if (password.length < 1) {
    return "Password is required";
  }
  return null;
}

export function passwordPolicyHint(): string {
  return "Any non-empty password is accepted";
}
