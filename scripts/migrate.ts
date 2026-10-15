import "dotenv/config";
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [lock]: any = await db.query(
      "SELECT GET_LOCK('win11desk_schema',30) acquired"
    );
    if (lock[0].acquired !== 1) throw Error("Lock unavailable");
    await db.query(
      "CREATE TABLE IF NOT EXISTS wc_migrations(name VARCHAR(255) PRIMARY KEY,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8")
    );
    const files = [
      ...journal.entries.map((e: any) => ["drizzle/" + e.tag + ".sql", e.tag]),
      ["server/control/schema.sql", "control-auth-v1"],
      ["server/control/admin-schema.sql", "control-admin-v1"],
      ["server/control/extra-schema.sql", "control-extra-v1"],
      ["server/control/profiles-schema.sql", "control-profiles-v1"],
      ["server/control/display-labels-schema.sql", "control-display-labels-v1"],
      ["server/control/post-install-schema.sql", "control-post-install-v1"],
      ["server/control/remoteInstall-schema.sql", "control-remote-install-v1"],
    ];
    for (const [file, name] of files) {
      const [known]: any = await db.execute(
        "SELECT name FROM wc_migrations WHERE name=?",
        [name]
      );
      if (known.length) continue;
      for (const stmt of (await readFile(file, "utf8"))
        .split(/--> statement-breakpoint|;\s*(?:\r?\n|$)/)
        .map(x => x.trim())
        .filter(Boolean))
        await db.query(stmt);
      await db.execute("INSERT INTO wc_migrations(name) VALUES(?)", [name]);
      console.log("Applied", name);
    }
    await db.query("SELECT RELEASE_LOCK('win11desk_schema')");
    console.log("Schema ready; existing records preserved.");
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error("Migration failed; check schema/privileges before retry.");
  process.exit(1);
});
