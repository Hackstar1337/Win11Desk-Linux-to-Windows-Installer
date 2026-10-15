export const WINDOWS_PASSWORD_MIN_LENGTH = 8;
export const WINDOWS_PASSWORD_MAX_LENGTH = 128;
export const WINDOWS_PASSWORD_HINT =
  "8–128 printable characters. This is the Windows RDP password, not your admin login password.";

export function windowsPasswordIssue(value: unknown): string | null {
  if (typeof value !== "string")
    return "Enter a Windows password with 8–128 characters.";
  if (value.length < WINDOWS_PASSWORD_MIN_LENGTH)
    return "Windows password must have at least 8 characters.";
  if (value.length > WINDOWS_PASSWORD_MAX_LENGTH)
    return "Windows password must have no more than 128 characters.";
  if (/[^\x20-\x7e]/.test(value))
    return "Windows password must use printable ASCII characters, without newlines or control characters.";
  return null;
}
