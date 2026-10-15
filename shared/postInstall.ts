import { z } from "zod";
export const postInstallAppIds = [
  "chrome",
  "firefox",
  "edge",
  "brave",
  "7zip",
] as const;
// Edge remains decodable for previously issued immutable commands/reports only.
export const selectablePostInstallAppIds = [
  "firefox",
  "brave",
  "7zip",
] as const;
export type PostInstallAppId = (typeof postInstallAppIds)[number];
export const postInstallAppNames: Record<PostInstallAppId, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  edge: "Edge",
  brave: "Brave",
  "7zip": "7-Zip",
};
export const attachedScript = {
  name: "MAS_AIO.bat",
  version: "User-supplied MAS 3.12",
  sha256: "17f10848ae162dd6e68c0e19080474e043ecad3caba4b10a50368006d2788e90",
  bytes: 761356,
} as const;
export function isPublicFileUrl(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value),
      h = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      u.port === "" &&
      /\.(zip|iso)$/i.test(u.pathname) &&
      !/[\x00-\x20'"`$\\]/.test(value) &&
      h.includes(".") &&
      !/^(localhost|.*\.(localhost|local|internal|test)|\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(
        h
      )
    );
  } catch {
    return false;
  }
}
export const postInstallOptionsSchema = z
  .object({
    getFiles: z.boolean().default(false),
    apps: z.array(z.enum(postInstallAppIds)).max(5).default([]),
    customFileUrl: z
      .string()
      .max(4096)
      .refine(
        isPublicFileUrl,
        "Use a public direct HTTPS .zip or .iso URL without credentials."
      )
      .default(""),
    runAttachedScript: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.apps.includes("chrome") || v.apps.includes("edge"))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This bundled installer is not distributed in the public repository.",
      });
    if (v.runAttachedScript)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attached scripts are not distributed in the public repository.",
      });
    if (new Set(v.apps).size !== v.apps.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select each file once.",
      });
    if (!v.getFiles && (v.apps.length || v.customFileUrl))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enable Get files before selecting files.",
      });
    if (v.getFiles && !v.apps.length && !v.customFileUrl)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one installer file or enter a custom link.",
      });
  });
export type PostInstallOptions = z.infer<typeof postInstallOptionsSchema>;
export const defaultPostInstallOptions: PostInstallOptions = {
  getFiles: false,
  apps: [],
  customFileUrl: "",
  runAttachedScript: false,
};
export function hasPostInstall(options?: PostInstallOptions | null) {
  return Boolean(options && (options.getFiles || options.runAttachedScript));
}
export function scriptCompatible(osId: string) {
  return /^windows-(10|11)-/.test(osId);
}
export type PostInstallFile = {
  id: PostInstallAppId | "custom";
  name: string;
  version: string;
  filename: string;
  url: string;
  sha256: string | null;
  maxBytes: number;
  publisher: string | null;
  requireSignature: boolean;
  minBuild: number;
};
export type PostInstallPlan = {
  version: 1;
  options: PostInstallOptions;
  files: PostInstallFile[];
  script: typeof attachedScript | null;
};
export type PostInstallPayload = {
  plan: PostInstallPlan;
  scriptBase64?: string;
};
export const postInstallStatusSchema = z.enum([
  "waiting",
  "running",
  "completed",
  "failed",
  "timed_out",
  "interrupted",
]);
export const fileOutcomeSchema = z
  .object({
    id: z.enum([...postInstallAppIds, "custom"]),
    status: z.enum(["pending", "downloading", "downloaded", "failed"]),
    bytes: z.number().int().min(0).max(1073741824).default(0),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .nullable()
      .default(null),
  })
  .strict();
export const postInstallReportSchema = z
  .object({
    status: postInstallStatusSchema,
    files: z.array(fileOutcomeSchema).max(6),
    script: z
      .object({
        enabled: z.boolean(),
        status: z.enum([
          "disabled",
          "pending",
          "running",
          "completed",
          "failed",
          "timed_out",
          "interrupted",
        ]),
        exitCode: z
          .number()
          .int()
          .min(-2147483648)
          .max(2147483647)
          .nullable()
          .default(null),
        activationObserved: z.boolean().nullable().default(null),
        errorCode: z
          .string()
          .regex(/^[A-Z0-9_]{1,64}$/)
          .nullable()
          .default(null),
      })
      .strict(),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type PostInstallReport = z.infer<typeof postInstallReportSchema>;
export type PostInstallView = {
  options: Omit<PostInstallOptions, "customFileUrl"> & { customFile: boolean };
  files: { id: string; name: string; version: string; filename: string }[];
  script: { name: string; version: string; sha256: string } | null;
  report: PostInstallReport | null;
  updatedAt: string | null;
  desktopFolder?: string;
};
export function postInstallView(
  plan: PostInstallPlan,
  report: PostInstallReport | null = null,
  updatedAt: string | null = null,
  runId?: string
): PostInstallView {
  return {
    options: {
      getFiles: plan.options.getFiles,
      apps: plan.options.apps,
      customFile: !!plan.options.customFileUrl,
      runAttachedScript: plan.options.runAttachedScript,
    },
    files: plan.files.map(({ id, name, version, filename }) => ({
      id,
      name,
      version,
      filename,
    })),
    script: plan.script
      ? {
          name: plan.script.name,
          version: plan.script.version,
          sha256: plan.script.sha256,
        }
      : null,
    report,
    updatedAt,
    ...(runId ? { desktopFolder: "Win11Desk Installers\\" + runId } : {}),
  };
}
