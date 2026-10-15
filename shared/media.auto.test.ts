import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { defaults } from "./deployment";
import { automaticTarget } from "./media";
import { linuxInstaller, bashQuote } from "./installer";

describe("automatic custom-media fingerprint before staging", () => {
  it.each([true, false])(
    "valid ISO signature %s is evaluated without any boot installation",
    valid => {
      const dir = mkdtempSync(path.join(tmpdir(), "win11-media-fixture-"));
      try {
        const media = Buffer.alloc(65536);
        if (valid) media.write("CD001", 32769);
        else media.write("<html>permission required</html>");
        writeFileSync(path.join(dir, "input.iso"), media);
        const script = linuxInstaller(
          defaults,
          automaticTarget("https://example.com/new.iso")
        );
        const block = script.slice(
          script.indexOf('if [[ "$ISO_SHA256" == auto ]]'),
          script.indexOf('DOWNLOAD="$WORK/reinstall.original.sh"')
        );
        const fixture = `set -euo pipefail\nWORK=${bashQuote(dir)}\nISO_SHA256=auto\nISO_URL=https://example.com/new.iso\nRETRIES=3\nfail(){ echo "$*" >&2;exit 1; }\ncurl(){ cp "$WORK/input.iso" "$WORK/media.verify.iso"; }\n${block}\nprintf '%s' "$ISO_SHA256" > "$WORK/digest"\n`;
        const file = path.join(dir, "verify.sh");
        writeFileSync(file, fixture);
        execFileSync("bash", ["-n", file]);
        const run = spawnSync("bash", [file], { encoding: "utf8" });
        if (valid) {
          expect(run.status).toBe(0);
          expect(readFileSync(path.join(dir, "digest"), "utf8")).toBe(
            createHash("sha256").update(media).digest("hex")
          );
        } else {
          expect(run.status).not.toBe(0);
          expect(run.stderr).toContain("Source did not return an ISO image");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
