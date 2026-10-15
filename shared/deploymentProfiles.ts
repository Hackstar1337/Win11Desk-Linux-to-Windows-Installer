import { z } from "zod";

export interface OsDefinition {
  id: string;
  name: string;
  family: "Windows client" | "Windows Server";
  imageName: string;
  editions: string[];
  minBuild: number;
  maxBuild: number;
  installationType: "Client" | "Server";
  tested: boolean;
  note: string;
}
const client = (
  version: 10 | 11,
  suffix: string,
  imageSuffix: string,
  editions: string[],
  tested = false
): OsDefinition => ({
  id: `windows-${version}-${suffix}`,
  name: `Windows ${version} ${imageSuffix}`,
  family: "Windows client",
  imageName: `Windows ${version} ${imageSuffix}`,
  editions,
  minBuild: version === 11 ? 22000 : 10240,
  maxBuild: version === 11 ? 99999 : 19045,
  installationType: "Client",
  tested,
  note:
    version === 10
      ? "Check the chosen release's support/licensing lifecycle. x64 English ISO with the exact image name required."
      : "x64 English ISO with the exact image name required; hardware bypass remains provider-dependent.",
});
const server = (
  year: number,
  edition: "Standard" | "Datacenter",
  build: number,
  evaluation = false
): OsDefinition => ({
  id: `windows-server-${year}-${edition.toLowerCase()}${evaluation ? "-evaluation" : ""}`,
  name: `Windows Server ${year} ${edition}${evaluation ? " Evaluation" : ""} (Desktop Experience)`,
  family: "Windows Server",
  imageName: `Windows Server ${year} ${edition}${evaluation ? " Evaluation" : ""} (Desktop Experience)`,
  editions: [`Server${edition}${evaluation ? "Eval" : ""}`],
  minBuild: build,
  maxBuild: build,
  installationType: "Server",
  tested: false,
  note: "Desktop Experience only, not Server Core. Supply the matching x64 English ISO; licensed and evaluation media are separate.",
});
export const osCatalog: OsDefinition[] = [
  client(11, "pro", "Pro", ["Professional"], true),
  client(11, "pro-n", "Pro N", ["ProfessionalN"]),
  client(11, "enterprise", "Enterprise", ["Enterprise"]),
  client(11, "enterprise-n", "Enterprise N", ["EnterpriseN"]),
  client(11, "education", "Education", ["Education"]),
  client(11, "education-n", "Education N", ["EducationN"]),
  client(11, "pro-education", "Pro Education", ["ProfessionalEducation"]),
  client(11, "pro-education-n", "Pro Education N", ["ProfessionalEducationN"]),
  client(11, "pro-workstations", "Pro for Workstations", [
    "ProfessionalWorkstation",
  ]),
  client(11, "pro-workstations-n", "Pro N for Workstations", [
    "ProfessionalWorkstationN",
  ]),
  client(10, "pro", "Pro", ["Professional"]),
  client(10, "pro-n", "Pro N", ["ProfessionalN"]),
  client(10, "enterprise", "Enterprise", ["Enterprise"]),
  client(10, "enterprise-n", "Enterprise N", ["EnterpriseN"]),
  client(10, "education", "Education", ["Education"]),
  client(10, "education-n", "Education N", ["EducationN"]),
  client(10, "pro-education", "Pro Education", ["ProfessionalEducation"]),
  client(10, "pro-education-n", "Pro Education N", ["ProfessionalEducationN"]),
  client(10, "pro-workstations", "Pro for Workstations", [
    "ProfessionalWorkstation",
  ]),
  client(10, "pro-workstations-n", "Pro N for Workstations", [
    "ProfessionalWorkstationN",
  ]),
  ...([2019, 2022, 2025] as const).flatMap((year, i) =>
    (["Standard", "Datacenter"] as const).flatMap(edition =>
      [false, true].map(evaluation =>
        server(year, edition, [17763, 20348, 26100][i], evaluation)
      )
    )
  ),
];
export function getOs(id: string): OsDefinition {
  const os = osCatalog.find(o => o.id === id);
  if (!os) throw new Error("Unsupported operating system.");
  return os;
}
export function directIsoUrl(value: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !!u.hostname &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !/[\x00-\x20'\"`$\\]/.test(value)
    );
  } catch {
    return false;
  }
}
export const profileInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .transform(v => v.replace(/\s+/g, " ")),
    osId: z
      .string()
      .refine(
        v => osCatalog.some(o => o.id === v),
        "Choose a supported ISO operating system."
      ),
    isoUrl: z
      .string()
      .max(4096)
      .refine(
        directIsoUrl,
        "Use a direct HTTPS ISO URL without embedded credentials."
      ),
    imageName: z
      .string()
      .trim()
      .max(160)
      .regex(
        /^[A-Za-z0-9 ._()\-]*$/,
        "Use the exact English WIM image name (letters, numbers, spaces, periods, hyphens or parentheses)."
      )
      .default(""),
    description: z.string().max(1000).default(""),
    username: z
      .string()
      .regex(/^[A-Za-z](?:[A-Za-z0-9._-]{0,18}[A-Za-z0-9_-])?$/)
      .refine(v => v.toLowerCase() !== "none")
      .default("Administrator"),
    remotePort: z.number().int().min(1).max(65535).default(22),
    retries: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileInputSchema>;
export interface DeploymentProfile extends ProfileInput {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  commandCount: number;
  deploymentCount: number;
}
export interface ProfileSnapshot extends ProfileInput {
  id: string;
  revision: number;
}
export interface ReadyProfile {
  id: string;
  name: string;
  osId: string;
  osName: string;
  group: "Windows 11" | "Windows 10" | "Windows Server";
  revision: number;
  username: string;
  remotePort: number;
  retries: number;
  tested: boolean;
}
export function isProfileReady(
  p: Pick<
    DeploymentProfile,
    | "name"
    | "osId"
    | "isoUrl"
    | "imageName"
    | "description"
    | "username"
    | "remotePort"
    | "retries"
    | "archivedAt"
  >
): boolean {
  if (p.archivedAt || typeof p.isoUrl !== "string" || !p.isoUrl.trim())
    return false;
  const parsed = profileInputSchema.safeParse({
    name: p.name,
    osId: p.osId,
    isoUrl: p.isoUrl,
    imageName: p.imageName,
    description: p.description,
    username: p.username,
    remotePort: p.remotePort,
    retries: p.retries,
  });
  return parsed.success && directIsoUrl(parsed.data.isoUrl);
}
export function readyProfile(
  p: DeploymentProfile | ProfileSnapshot
): ReadyProfile {
  const os = getOs(p.osId);
  return {
    id: p.id,
    name: p.name,
    osId: p.osId,
    osName: os.name,
    group:
      os.family === "Windows Server"
        ? "Windows Server"
        : os.id.startsWith("windows-11-")
          ? "Windows 11"
          : "Windows 10",
    revision: p.revision,
    username: p.username,
    remotePort: p.remotePort,
    retries: p.retries,
    tested: os.tested,
  };
}
export function profileSnapshot(p: DeploymentProfile): ProfileSnapshot {
  return {
    ...profileInputSchema.parse(pickProfile(p)),
    imageName: p.imageName || getOs(p.osId).imageName,
    id: p.id,
    revision: p.revision,
  };
}
export function pickProfile(p: ProfileInput): ProfileInput {
  return {
    name: p.name,
    osId: p.osId,
    isoUrl: p.isoUrl,
    imageName: p.imageName || "",
    description: p.description,
    username: p.username,
    remotePort: p.remotePort,
    retries: p.retries,
  };
}
export function hasOsProof(
  os: OsDefinition,
  edition: unknown,
  build: unknown,
  installationType: unknown
): boolean {
  return (
    typeof edition === "string" &&
    os.editions.some(e => e.toLowerCase() === edition.toLowerCase()) &&
    typeof build === "number" &&
    Number.isInteger(build) &&
    build >= os.minBuild &&
    build <= os.maxBuild &&
    installationType === os.installationType
  );
}
