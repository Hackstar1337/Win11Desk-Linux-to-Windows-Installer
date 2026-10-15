import type { Express } from "express";
import { z } from "zod";
import {
  reusableSettingsSchema,
  reusableScript,
  reusableCommand,
  testedMedia,
} from "../shared/reusableInstaller";
import { sha256 } from "./installerTicketCrypto";

export function decodeReusableSettings(encoded: string) {
  if (!/^[A-Za-z0-9_-]{1,12000}$/.test(encoded))
    throw new Error("Invalid settings encoding.");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded || bytes.length > 8000)
    throw new Error("Invalid settings encoding.");
  return reusableSettingsSchema.parse(JSON.parse(bytes.toString("utf8")));
}
export function registerReusableInstallerRoutes(app: Express) {
  app.get("/api/installer/tested-media", (_req, res) =>
    res.set("Cache-Control", "no-store").json(testedMedia)
  );
  app.post("/api/installer/reusable-command", (req, res) => {
    res.set("Cache-Control", "private, no-store");
    if (req.get("X-Win11Desk-Request") !== "1") {
      res.status(403).json({ error: "Dashboard request required." });
      return;
    }
    try {
      const input = z
        .object({ settings: reusableSettingsSchema, origin: z.string().url() })
        .strict()
        .parse(req.body);
      // This public helper has no cookie authority or database mutation.
      // Preview may rewrite Origin; command construction still enforces exact HTTPS origins.
      const encoded = Buffer.from(JSON.stringify(input.settings)).toString(
        "base64url"
      );
      const script = reusableScript(decodeReusableSettings(encoded));
      const digest = sha256(script);
      res.json({
        command: reusableCommand(input.origin, encoded, digest),
        scriptHash: digest,
        passwordDelivery: "SSH prompt",
        reusable: true,
      });
    } catch {
      res.status(400).json({
        error:
          "Invalid reusable installer settings. Passwords must not be included. Use a valid HTTPS origin and media.",
      });
    }
  });
  app.post("/api/installer/setup.sh", (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    try {
      if (typeof req.body.settings !== "string")
        throw new Error("Missing settings.");
      const script = reusableScript(decodeReusableSettings(req.body.settings));
      res.type("text/plain").send(script);
    } catch {
      res
        .status(400)
        .type("text/plain")
        .send("Invalid installer settings; regenerate from Win11Desk.\n");
    }
  });
}
