import "dotenv/config";
import { config } from "../control/config.js";
import { pool } from "../control/db.js";
import { runRemoteWorker } from "./worker.js";

if (process.env.REMOTE_INSTALL_ENABLED !== "1") {
  console.error("Remote install worker disabled");
  process.exitCode = 0;
} else {
  config();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  runRemoteWorker({ signal: controller.signal }).catch(() => {
    console.error("Remote install worker stopped unexpectedly");
    process.exitCode = 1;
  }).finally(() => {
    void pool().end();
  });
}
