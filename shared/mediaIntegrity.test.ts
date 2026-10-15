import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mediaVerifyShell } from "./installerMediaGuard";
import { bashQuote } from "./installer";
describe("complete ISO integrity before partitioning", () => {
  it.each(["match", "corrupt", "truncated"])(
    "%s handled before destructive continuation",
    kind => {
      const dir = mkdtempSync(path.join(tmpdir(), "integrity-"));
      try {
        const data = Buffer.alloc(70000, 42);
        writeFileSync(dir + "/input", data);
        const digest = createHash("sha256").update(data).digest("hex");
        writeFileSync(
          dir + "/curl",
          `#!/bin/sh\ncat ${bashQuote(dir + "/input")}\n${kind === "truncated" ? "exit 23" : "exit 0"}\n`,
          { mode: 0o700 }
        );
        const run = spawnSync(
          "/bin/busybox",
          [
            "ash",
            "-c",
            `${mediaVerifyShell()}\nwin11desk_media_verify https://example.com/x.iso ${kind === "corrupt" ? "a".repeat(64) : digest} && echo WOULD_CONTINUE\n`,
          ],
          {
            env: { ...process.env, PATH: dir + ":" + process.env.PATH },
            encoding: "utf8",
          }
        );
        expect(run.status).toBe(kind === "match" ? 0 : 1);
        expect(run.stdout.includes("WOULD_CONTINUE")).toBe(kind === "match");
        if (kind === "corrupt")
          expect(run.stderr).toContain("ISO_SHA256_MISMATCH");
        if (kind === "truncated")
          expect(run.stderr).toContain("MEDIA_TRANSFER_FAILED");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it("reports measured streamed bytes with the final CRLF response total and resets a failed retry", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "integrity-progress-"));
    try {
      const data = Buffer.alloc(70000, 42);
      const digest = createHash("sha256").update(data).digest("hex");
      writeFileSync(path.join(dir, "input"), data);
      writeFileSync(
        path.join(dir, "curl"),
        `#!/bin/sh
count=$(cat ${bashQuote(path.join(dir, "count"))} 2>/dev/null || echo 0)
count=$((count + 1)); printf '%s' "$count" > ${bashQuote(path.join(dir, "count"))}
while [ "$#" -gt 0 ]; do
  if [ "$1" = --dump-header ]; then shift; headers="$1"; fi
  shift
done
printf 'HTTP/1.1 302 Found\\r\\nLocation: https://cdn.example.test/x.iso\\r\\n\\r\\nHTTP/1.1 206 Partial Content\\r\\nCONTENT-RANGE: bytes 0-69999/70000\\r\\nCONTENT-LENGTH: 70000\\r\\n\\r\\n' > "$headers"
cat ${bashQuote(path.join(dir, "input"))}
[ "$count" -gt 1 ]
`,
        { mode: 0o700 }
      );
      const log = path.join(dir, "progress.log");
      const run = spawnSync(
        "/bin/busybox",
        [
          "ash",
          "-c",
          `set -eu
${mediaVerifyShell()}
track_progress(){ printf '%s:%s:%s\\n' "$1" "$2" "$3" >> ${bashQuote(log)}; }
WIN11DESK_PROGRESS_INTERVAL=1 win11desk_media_verify https://example.com/x.iso ${digest}
cat ${bashQuote(log)}
test ! -e ${bashQuote(path.join(dir, "work"))}
`,
        ],
        {
          env: { ...process.env, PATH: dir + ":" + process.env.PATH },
          encoding: "utf8",
          timeout: 5000,
        }
      );
      expect(run.status).toBe(0);
      const progress = readFileSync(log, "utf8").trim().split("\n");
      expect(progress).toContain("0:0:integrity");
      expect(progress).toContain("70000:70000:integrity");
      expect(progress.filter(line => line === "0:0:integrity").length).toBeGreaterThanOrEqual(2);
      expect(run.stderr).not.toContain("MEDIA_TRANSFER_FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
