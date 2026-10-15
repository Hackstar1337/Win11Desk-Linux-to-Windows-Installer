import {
  WINDOWS_PASSWORD_MIN_LENGTH,
  WINDOWS_PASSWORD_MAX_LENGTH,
  windowsPasswordIssue,
} from "../shared/windowsPassword";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { deploymentSchema } from "../shared/deployment";
import {
  bashQuote,
  installTargetSchema,
  installerIssues,
  linuxInstaller,
} from "../shared/installer";
import { sha256 } from "./installerTicketCrypto";
import { reusableSettingsSchema } from "../shared/reusableInstaller";
import { trackingConfigSchema } from "../shared/installerTrackingHooks";
import { createTrackingGroup, registerTrackingRoutes } from "./installTracking";

export const deliveryMs = 30 * 60 * 1000;
const inputSchema = z
  .object({
    settings: reusableSettingsSchema,
    automatic: z.boolean().optional().default(false),
    tracking: trackingConfigSchema.optional(),
    password: z
      .string()
      .min(WINDOWS_PASSWORD_MIN_LENGTH)
      .max(WINDOWS_PASSWORD_MAX_LENGTH)
      .refine(s => windowsPasswordIssue(s) === null),
  })
  .strict();
const envelopeSchema = z
  .object({
    data: z.string().max(20000),
    key: z.string().max(43),
    iv: z.string().max(16),
    tag: z.string().max(22),
  })
  .strict();
function decode(value: string, length?: number) {
  const b = Buffer.from(value, "base64url");
  if (
    b.toString("base64url") !== value ||
    (length !== undefined && b.length !== length)
  )
    throw new Error("Invalid envelope.");
  return b;
}
export function sealPageSettings(input: unknown) {
  const settings = inputSchema.parse(input);
  const expiresAt = new Date(Date.now() + deliveryMs);
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("win11desk-page-v1"));
  const data = Buffer.concat([
    cipher.update(
      JSON.stringify({ settings, expiresAt: expiresAt.toISOString() }),
      "utf8"
    ),
    cipher.final(),
  ]);
  return {
    envelope: {
      data: data.toString("base64url"),
      key: key.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    },
    expiresAt,
  };
}
export function pageScript(value: unknown) {
  const e = envelopeSchema.parse(value);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decode(e.key, 32),
    decode(e.iv, 12)
  );
  decipher.setAAD(Buffer.from("win11desk-page-v1"));
  decipher.setAuthTag(decode(e.tag, 16));
  const plaintext = Buffer.concat([
    decipher.update(decode(e.data)),
    decipher.final(),
  ]).toString("utf8");
  const input = z
    .object({ settings: inputSchema, expiresAt: z.string().datetime() })
    .strict()
    .parse(JSON.parse(plaintext));
  const time = Date.parse(input.expiresAt);
  if (time <= Date.now() || time > Date.now() + deliveryMs + 60000)
    throw new Error("Delivery expired.");
  const { settings, password } = input.settings;
  const config = deploymentSchema.parse({
    os: "Windows 11 Pro",
    username: settings.username,
    password,
    remotePort: settings.remotePort,
    randomUsername: false,
    apps: [],
    fileUrl: "",
    node: "auto",
    privateTracking: true,
    preConfirmed: false,
    initScript: true,
    hostname: "",
    imageUrl: "",
    bootMode: "auto",
    retries: settings.retries,
    timezone: "UTC",
  });
  const issues = installerIssues(config, settings.target);
  if (issues.length) throw new Error("Invalid inputs.");
  return linuxInstaller(config, settings.target, true, {
    automatic: input.settings.automatic,
    tracking: input.settings.tracking,
  });
}
export function pageCommand(
  origin: string,
  envelope: ReturnType<typeof sealPageSettings>["envelope"],
  digest: string,
  retries: number
) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !Number.isInteger(retries) ||
    retries < 1 ||
    retries > 20
  )
    throw new Error("Invalid command.");
  const payload = JSON.stringify(envelopeSchema.parse(envelope));
  return `#!/bin/bash
# PRIVATE: valid 30 minutes. Pasting authorizes system-disk erasure and automatic reboot for new automatic scripts. Do not share.
(
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run sudo -i on the intended VPS first.' >&2; exit 1; }
umask 077
work=$(mktemp -d /root/win11desk-command.XXXXXX)
trap 'rm -rf "$work"' EXIT
payload=${bashQuote(payload)}
tries=${retries}
downloaded=0
while [ "$tries" -gt 0 ]; do
  if printf '%s' "$payload" | curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 -H 'Content-Type: application/json' --data-binary @- ${bashQuote(origin + "/api/installer/page-setup.sh")} -o "$work/setup.sh"; then downloaded=1; break; fi
  tries=$((tries-1))
  [ "$tries" -gt 0 ] && { echo "Download failed, $tries attempts remaining"; sleep 10; }
done
unset payload
[[ "$downloaded" == 1 ]] || { echo 'Delivery expired or unavailable. Generate a fresh command.' >&2; exit 1; }
printf '%s  %s\\n' ${bashQuote(digest)} "$work/setup.sh" | sha256sum --check --status || { echo 'Installer hash mismatch.' >&2; exit 1; }
bash "$work/setup.sh" --install
)`;
}
export function registerPageInstallerRoutes(app: Express) {
  registerTrackingRoutes(app);
  app.post("/api/installer/page-command", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    if (req.get("X-Win11Desk-Request") !== "1") {
      res.sendStatus(403);
      return;
    }
    try {
      const data = z
        .object({ input: inputSchema, origin: z.string().url() })
        .strict()
        .parse(req.body);
      const publicOrigin = new URL(data.origin);
      if (
        publicOrigin.protocol !== "https:" ||
        publicOrigin.origin !== data.origin ||
        publicOrigin.username ||
        publicOrigin.password
      )
        throw new Error("Invalid HTTPS origin.");
      const tracking = await createTrackingGroup();
      const sealed = sealPageSettings({
        ...data.input,
        automatic: true,
        tracking: {
          origin: data.origin,
          groupId: tracking.groupId,
          writeToken: tracking.writeToken,
        },
      });
      const script = pageScript(sealed.envelope),
        hash = sha256(script);
      res.json({
        command: pageCommand(
          data.origin,
          sealed.envelope,
          hash,
          data.input.settings.retries
        ),
        scriptHash: hash,
        expiresAt: sealed.expiresAt.toISOString(),
        trackingId: tracking.groupId,
        trackingUrl: `${data.origin}/track/${tracking.groupId}#${tracking.readToken}`,
      });
    } catch {
      res.status(400).json({
        error:
          "Could not generate automatic script. Check valid username/password/media, HTTPS origin and tracker database readiness.",
      });
    }
  });
  app.post("/api/installer/page-setup.sh", (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    try {
      res.type("text/plain").send(pageScript(req.body));
    } catch {
      res
        .status(410)
        .type("text/plain")
        .send("Settings expired or invalid. Generate a fresh command.\n");
    }
  });
}
