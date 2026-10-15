import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { rows } from "./db";
import { parseLaunchTicket } from "./launchV2";
import { SETUP_V3_SHA256, SETUP_V3_VERSION } from "./launcherV3";
export const LAUNCH_V3_PATH = "/api/installer/launch/v3";
type DeliveryHandler = (req: Request, res: Response) => Promise<unknown>;
function matches(value: unknown) {
  try {
    const saved = typeof value === "string" ? JSON.parse(value) : value;
    return (
      !!saved &&
      typeof saved === "object" &&
      (saved as any).launcher?.version === SETUP_V3_VERSION &&
      (saved as any).launcher?.sha256 === SETUP_V3_SHA256
    );
  } catch {
    return false;
  }
}
export function createLaunchV3Handler(deliver: DeliveryHandler) {
  return async (req: Request, res: Response): Promise<unknown> => {
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const ticket = parseLaunchTicket(req.body);
    if (!ticket || Object.keys(req.query || {}).length)
      return res
        .status(400)
        .json({ error: "Invalid installation ticket request." });
    try {
      const digest = createHash("sha256").update(ticket).digest("hex");
      const commands = await rows<{ id: string; config_json: unknown }>(
        "SELECT id,config_json FROM wc_commands WHERE delivery_hash=? LIMIT 2",
        [digest]
      );
      if (commands.length !== 1 || !matches(commands[0].config_json))
        return res
          .status(404)
          .json({ error: "Delivery capability unavailable." });
      const originalBody = req.body;
      try {
        req.body = { id: commands[0].id, token: ticket };
        return await deliver(req, res);
      } finally {
        req.body = originalBody;
      }
    } catch {
      // Never log ticket, request/configuration, credential or artifact.
      if (!res.headersSent)
        return res
          .status(503)
          .json({ error: "Installer delivery temporarily unavailable." });
      return undefined;
    }
  };
}
export function registerLaunchV3Routes(app: Express, deliver: DeliveryHandler) {
  app.post(LAUNCH_V3_PATH, createLaunchV3Handler(deliver));
}
