import type { Express } from "express";
import path from "node:path";
import { z } from "zod";
import { deploymentSchema } from "../shared/deployment";
import {
  installerIssues,
  installerVersion,
  installTargetSchema,
  linuxInstaller,
} from "../shared/installer";
import { sdk } from "./_core/sdk";
import {
  createInstallerTicket,
  retrieveInstallerTicket,
  revokeInstallerTicket,
} from "./installerTickets";
import { oneCommand } from "./installerTicketCrypto";
import { registerReusableInstallerRoutes } from "./reusableInstallerRoutes";
import { testedMedia } from "../shared/reusableInstaller";
import { registerPageInstallerRoutes } from "./pageInstallerDelivery";

const requestSchema = z.object({
  config: deploymentSchema,
  target: installTargetSchema,
  origin: z.string().url(),
});
export function registerInstallerRoutes(app: Express) {
  registerReusableInstallerRoutes(app);
  registerPageInstallerRoutes(app);
  app.get("/api/installer/status", (_req, res) =>
    res.set("Cache-Control", "no-store").json({
      ...installerVersion,
      testEvidence: testedMedia.evidence,
      reusablePasswordPrompt: true,
      pagePasswordDelivery:
        "stateless encrypted POST; 30-minute delivery window",
      windowsBootAndRdpVerified: true,
      exactWebsiteGeneratedCommandVerified: true,
      verificationScope:
        "Historical approved disposable VPS tests; each current run must report Windows proof separately.",
      ordinaryDesktopAndLiveEditionVerified: false,
      mode: "copy-and-run-linux-vps-installer",
      os: "Windows 11 Pro",
      targetConnected: false,
      execution: "user copies command into root SSH",
      credentialsStored:
        "expiring encrypted installer ciphertext; key not stored",
      required: [
        "Default direct d3m0nbox.online ISO or valid HTTPS replacement link",
        "Compatible VPS; automatic target and media integrity checks",
        "Disposable target/backup and provider recovery console; pasting a new automatic command authorizes erasure/reboot",
      ],
    })
  );
  app.post("/api/installer/commands", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.get("X-Win11Desk-Request") !== "1") {
      res
        .status(403)
        .json({ error: "Same-origin dashboard request required." });
      return;
    }
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res
        .status(401)
        .json({ error: "Sign in to generate a private installation command." });
      return;
    }
    try {
      const input = requestSchema.parse(req.body);
      const origin = new URL(input.origin);
      if (
        origin.protocol !== "https:" ||
        origin.origin !== input.origin ||
        req.get("Origin") !== input.origin
      ) {
        res
          .status(400)
          .json({ error: "The browser's public HTTPS origin is required." });
        return;
      }
      const issues = installerIssues(input.config, input.target);
      if (issues.length) {
        res.status(400).json({ error: issues.join(" ") });
        return;
      }
      if (input.config.password.length < 8) {
        res.status(400).json({
          error:
            "Set a 8–128 character Windows password before generating your command.",
        });
        return;
      }
      const script = linuxInstaller(input.config, input.target, true);
      const ticket = await createInstallerTicket(script, user.id);
      const command = oneCommand(
        input.origin,
        ticket.token,
        ticket.row.scriptHash
      );
      res.json({
        id: ticket.row.id,
        command,
        expiresAt: ticket.row.expiresAt.toISOString(),
        scriptHash: ticket.row.scriptHash,
      });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? "Invalid installer configuration."
            : "Unable to generate command. Check database readiness or active-command limit.",
      });
    }
  });
  app.delete("/api/installer/commands/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.get("X-Win11Desk-Request") !== "1") {
      res.sendStatus(403);
      return;
    }
    try {
      const user = await sdk.authenticateRequest(req);
      await revokeInstallerTicket(
        z.string().uuid().parse(req.params.id),
        user.id
      );
      res.json({ revoked: true });
    } catch {
      res.status(401).json({ error: "Sign in to revoke your command." });
    }
  });
  app.get("/api/installer/run", async (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    const header = req.get("Authorization") || "";
    if (!header.startsWith("Bearer ")) {
      res
        .status(401)
        .type("text/plain")
        .send("Private installer ticket required.\n");
      return;
    }
    try {
      const script = await retrieveInstallerTicket(header.slice(7));
      res.type("text/plain").send(script);
    } catch {
      res
        .status(410)
        .type("text/plain")
        .send(
          "Ticket expired, revoked, exhausted or invalid. Generate a new command.\n"
        );
    }
  });
  app.get("/api/installer/source", (_req, res) =>
    res.sendFile(path.resolve("vendor/reinstall/reinstall.sh"))
  );
  app.get("/api/installer/license", (_req, res) =>
    res.sendFile(path.resolve("vendor/reinstall/LICENSE"))
  );
}
