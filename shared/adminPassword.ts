export const ADMIN_PASSWORD_MIN_LENGTH = 15;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;
export const ADMIN_PASSWORD_HINT =
  "Use 15–128 characters. A long, unique passphrase is fine; spaces are allowed.";

const blockedPasswords = new Set([
  "passwordpassword",
  "123456789012345",
  "qwertyuiopasdfg",
  "letmeinletmein12",
  "changemechangeme",
]);

export function adminPasswordIssue(value: unknown): {
  code: "INVALID_PASSWORD_LENGTH" | "WEAK_PASSWORD";
  message: string;
} | null {
  if (typeof value !== "string") {
    return {
      code: "INVALID_PASSWORD_LENGTH",
      message: "Enter a new password with 15–128 characters.",
    };
  }
  if (value.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return {
      code: "INVALID_PASSWORD_LENGTH",
      message: `Your password is too short (${value.length} characters). Use at least 15 characters.`,
    };
  }
  if (value.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return {
      code: "INVALID_PASSWORD_LENGTH",
      message: "Your password is too long. Use no more than 128 characters.",
    };
  }
  if (blockedPasswords.has(value.toLowerCase())) {
    return {
      code: "WEAK_PASSWORD",
      message: "Choose a less common password with at least 15 characters.",
    };
  }
  return null;
}
