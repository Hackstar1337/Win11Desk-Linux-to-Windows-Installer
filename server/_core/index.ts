import { registerOperationsStorageRoutes } from "../control/operationsStorage";
import { registerOperationsMaintenanceRoutes } from "../control/operationsMaintenance";
import { registerRemoteInstallRoutes } from "../control/remoteInstall";
import { registerPostInstallAssetRoutes } from "../control/postInstallAssets";
import { registerPostInstallRoutes } from "../control/postInstallReports";
import { registerLauncherRoutes } from "../control/launcher";
import { registerSetupV3Routes } from "../control/launcherV3";
import { registerLaunchV3Routes } from "../control/launchV3";
import { registerSetupV2Routes } from "../control/launcherV2";
import { registerLaunchV2Routes } from "../control/launchV2";
import { registerProfileRoutes } from "../control/profiles";
import { registerOperationsRoutes } from "../control/operations";
import { registerOperationsDashboardRoutes } from "../control/operationsDashboard";
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { registerAuthRoutes } from "../control/auth";
import { registerAdminRoutes, delivery } from "../control/admin";
import { registerReadinessRoutes } from "../control/readiness";
import { registerTrackingRoutes } from "../installTracking";
import { config } from "../control/config";
import { pool } from "../control/db";
export async function createApp() {
  config();
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  app.get("/api/health", async (_req, res) => {
    try {
      await pool().query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "not-ready" });
    }
  });
  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerProfileRoutes(app);
  registerRemoteInstallRoutes(app);
  registerLauncherRoutes(app);
  registerSetupV2Routes(app);
  registerLaunchV2Routes(app, delivery);
  registerSetupV3Routes(app);
  registerLaunchV3Routes(app, delivery);
  registerOperationsRoutes(app);
  registerOperationsDashboardRoutes(app);
  registerOperationsMaintenanceRoutes(app);
  registerOperationsStorageRoutes(app);
  registerReadinessRoutes(app);
  registerTrackingRoutes(app);
  registerPostInstallRoutes(app);
  registerPostInstallAssetRoutes(app);
  for (const [url, file] of [
    ["source", "reinstall.sh"],
    ["license", "LICENSE"],
  ])
    app.get("/api/installer/" + url, async (_req, res) => {
      try {
        res
          .type("text/plain")
          .send(await readFile(path.resolve("vendor/reinstall", file), "utf8"));
      } catch {
        res.sendStatus(404);
      }
    });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." })
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res
        .status(
          error?.type === "entity.too.large" || error instanceof SyntaxError
            ? 400
            : 500
        )
        .json({ error: "Request could not be completed." });
    }
  );
  return app;
}
async function start() {
  const app = await createApp();
  const server = createServer(app);
  if (process.env.NODE_ENV === "development") {
    const file = "./vite.ts";
    const { setupVite } = await import(file);
    await setupVite(app, server);
  } else {
    const folder = path.resolve(import.meta.dirname, "public");
    app.use(express.static(folder));
    app.get("*", (_req, res) => res.sendFile(path.join(folder, "index.html")));
  }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid port");
  server.listen(port, "0.0.0.0", () =>
    console.log("Win11Desk listening on port " + port)
  );
  server.on("error", () => {
    console.error("Listener failed");
    process.exit(1);
  });
  process.once("SIGTERM", () =>
    server.close(() => {
      pool()
        .end()
        .finally(() => process.exit(0));
    })
  );
}
if (process.env.WIN11DESK_TEST_IMPORT !== "1")
  start().catch(() => {
    console.error(
      "Startup failed: check own-domain configuration/database/vault."
    );
    process.exit(1);
  });
