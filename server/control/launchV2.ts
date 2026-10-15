import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { rows } from "./db";
import { SETUP_V2_SHA256, SETUP_V2_VERSION } from "./launcherV2";

export const LAUNCH_V2_PATH = "/api/installer/launch/v2";
type DeliveryHandler = (req: Request, res: Response) => Promise<unknown>;

/** Only a per-command opaque ticket is accepted; settings are never client overrides. */
export function parseLaunchTicket(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 1 ||
    keys[0] !== "ticket" ||
    typeof record.ticket !== "string" ||
    !/^[0-9a-f]{64}$/i.test(record.ticket)
  )
    return null;
  return record.ticket.toLowerCase();
}

function originalSetupMatches(value: unknown): boolean {
  try {
    const saved = typeof value === "string" ? JSON.parse(value) : value;
    return (
      !!saved &&
      typeof saved === "object" &&
      (saved as any).launcher?.version === SETUP_V2_VERSION &&
      (saved as any).launcher?.sha256 === SETUP_V2_SHA256
    );
  } catch {
    return false;
  }
}

/**
 * Indexed hash lookup reveals no command/profile IDs to the client. Delegate to
 * the original delivery handler so token/expiry/revocation/vault/digest behavior
 * stays centralized and old {id,token} delivery remains untouched.
 */
export function createLaunchV2Handler(deliver: DeliveryHandler) {
  return async (req: Request, res: Response): Promise<unknown> => {
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const ticket = parseLaunchTicket(req.body);
    if (!ticket || Object.keys(req.query || {}).length) {
      return res
        .status(400)
        .json({ error: "Invalid installation ticket request." });
    }
    try {
      const digest = createHash("sha256").update(ticket).digest("hex");
      const commands = await rows<{ id: string; config_json: unknown }>(
        "SELECT id,config_json FROM wc_commands WHERE delivery_hash=? LIMIT 2",
        [digest]
      );
      if (
        commands.length !== 1 ||
        !originalSetupMatches(commands[0].config_json)
      ) {
        return res
          .status(404)
          .json({ error: "Delivery capability unavailable." });
      }
      const originalBody = req.body;
      try {
        // No client identity or settings are trusted. The existing handler
        // performs a fresh command lookup and all its normal delivery checks.
        req.body = { id: commands[0].id, token: ticket };
        return await deliver(req, res);
      } finally {
        req.body = originalBody;
      }
    } catch {
      // Never log the body, ticket, SQL parameters or decrypted artifact.
      if (!res.headersSent) {
        return res
          .status(503)
          .json({ error: "Installer delivery temporarily unavailable." });
      }
      return undefined;
    }
  };
}

export function registerLaunchV2Routes(
  app: Express,
  deliver: DeliveryHandler
): void {
  app.post(LAUNCH_V2_PATH, createLaunchV2Handler(deliver));
}
