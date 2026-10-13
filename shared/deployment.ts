import { z } from "zod";
import { osCatalog } from "./deploymentProfiles";

export const appChoices = [
  "chrome",
  "firefox",
  "edge",
  "brave",
  "7zip",
] as const;
export type AppChoice = (typeof appChoices)[number];
function validHttpsUrl(value: string, requireFile = false) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      (!requireFile || /\.(zip|iso)$/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}
export const deploymentSchema = z.object({
  os: z.enum(osCatalog.map(o => o.name) as [string, ...string[]]),
  username: z
    .string()
    .min(1, "Enter a username.")
    .max(20, "Use 20 characters or fewer.")
    .refine(
      v => !/["/\\[\]:;|=,+*?<>\x00-\x1f]/.test(v) && !/[.\s]$/.test(v),
      "Use a valid Windows username without special characters or a trailing space/period."
    ),
  password: z.string().max(128, "Use 128 characters or fewer."),
  remotePort: z
    .number()
    .int()
    .min(1, "Port must be between 1 and 65535.")
    .max(65535, "Port must be between 1 and 65535."),
  randomUsername: z.boolean(),
  apps: z.array(z.enum(appChoices)),
  fileUrl: z
    .string()
    .refine(
      v => validHttpsUrl(v, true),
      "Use a valid direct HTTPS URL ending in .zip or .iso."
    ),
  node: z.enum(["auto", "asia", "europe", "north-america"]),
  privateTracking: z.boolean(),
  preConfirmed: z.boolean(),
  initScript: z.boolean(),
  hostname: z
    .string()
    .max(15, "Hostname must be 15 characters or fewer.")
    .refine(
      v => !v || /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(v),
      "Use letters, numbers and internal hyphens."
    ),
  imageUrl: z
    .string()
    .refine(
      v => validHttpsUrl(v),
      "Use a valid HTTPS image URL without embedded credentials."
    ),
  bootMode: z.enum(["uefi", "auto"]),
  retries: z.number().int().min(1).max(20),
  timezone: z.enum([
    "UTC",
    "India Standard Time",
    "Pacific Standard Time",
    "GMT Standard Time",
  ]),
});
export type DeploymentConfig = z.infer<typeof deploymentSchema>;
export const defaults: DeploymentConfig = {
  os: "Windows 11 Pro",
  username: "Administrator",
  password: "",
  remotePort: 22,
  randomUsername: false,
  apps: [],
  fileUrl: "",
  node: "auto",
  privateTracking: true,
  preConfirmed: false,
  initScript: false,
  hostname: "",
  imageUrl: "",
  bootMode: "uefi",
  retries: 10,
  timezone: "UTC",
};
export function osOnlyConfig(config: DeploymentConfig): DeploymentConfig {
  return {
    ...defaults,
    username: config.username,
    password: config.password,
    remotePort: config.remotePort,
    randomUsername: config.randomUsername,
    initScript: config.initScript,
    retries: config.initScript ? config.retries : 3,
  };
}
export function nonSensitiveConfig(config: DeploymentConfig) {
  const { password: _password, ...safe } = config;
  return safe;
}
export function randomName() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return `WinUser${bytes[0].toString(16).slice(0, 6)}`;
}
export function randomPassword() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return "W1!" + Array.from(bytes, b => chars[b % chars.length]).join("");
}
export function commandPreview(
  config: DeploymentConfig,
  platform: "linux" | "windows",
  includePassword = false
) {
  const password = config.password
    ? includePassword
      ? config.password
      : "<PASSWORD_REDACTED>"
    : "<GENERATE_ON_INSTALL>";
  const payload = { ...config, password };
  const lines = [
    "# PREVIEW ONLY — no installer connected; this script performs no installation.",
    "# Profile: Windows 11 Pro | x64 | Customer license required",
    "# Configuration below describes requested settings, not applied changes.",
    ...JSON.stringify(payload, null, 2)
      .split("\n")
      .map(line => `# ${line}`),
    "#",
    "# Proposed integration contract (not an existing installer API):",
  ];
  if (platform === "linux") {
    lines.unshift("#!/usr/bin/env bash");
    if (config.initScript)
      lines.push(
        `# Init mode: retry download up to ${config.retries} times, once an installer is connected.`
      );
    lines.push(
      "# curl --fail --location <VERIFIED_INSTALLER_URL> --output win11-setup.sh",
      "# bash win11-setup.sh --config <PRIVATE_JOB_CONFIG>"
    );
  } else {
    if (config.initScript)
      lines.push(
        `# Init mode: retry download up to ${config.retries} times, once an installer is connected.`
      );
    lines.push(
      "# Invoke-WebRequest -Uri '<VERIFIED_INSTALLER_URL>' -OutFile 'win11-setup.ps1'",
      "# & .\\win11-setup.ps1 -Config '<PRIVATE_JOB_CONFIG>'"
    );
  }
  if (config.preConfirmed)
    lines.push(
      "# Confirmation preference: skip terminal prompt; a live integration must still confirm disk replacement."
    );
  lines.push(
    "# No downloads, disk writes, credential changes, or network requests are executed."
  );
  return lines.join("\n");
}
