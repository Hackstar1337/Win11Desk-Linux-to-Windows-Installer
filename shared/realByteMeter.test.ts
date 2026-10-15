import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { mediaVerifyShell } from "./installerMediaGuard";
describe("real streamed byte-meter", () => {
  it("reports measured bytes from actual pv while preserving the final digest", () => {
    if (
      spawnSync("sh", ["-c", "command -v pv"], { encoding: "utf8" }).status !==
      0
    )
      throw Error("Install pv for this byte-counter regression");
    const dir = mkdtempSync(tmpdir() + "/wc-byte-meter-");
    try {
      const script = `set -eu\nexport WIN11DESK_PROGRESS_INTERVAL=0.1\n${mediaVerifyShell()}\ntrack_progress(){ printf 'MEASURED:%s:%s:%s\\n' "$1" "$2" "$3"; }\ncurl(){ headers=''; while [ "$#" -gt 0 ]; do if [ "$1" = --dump-header ]; then headers="$2"; shift; fi; shift; done; printf 'HTTP/2 200\\r\\nCONTENT-LENGTH: 4096\\r\\n\\r\\n' > "$headers"; python3 -c 'import sys,time; [(sys.stdout.buffer.write(b"a"*512),sys.stdout.flush(),time.sleep(0.12)) for _ in range(8)]'; }\ndigest=$(python3 -c 'import hashlib;print(hashlib.sha256(b"a"*4096).hexdigest())')\nwin11desk_media_verify 'https://example.test/fixture.iso' "$digest"\n`;
      const output = execFileSync("busybox", ["ash", "-c", script], {
        encoding: "utf8",
        cwd: dir,
        timeout: 10000,
      });
      const measurements = [
        ...output.matchAll(/MEASURED:(\d+):(\d+):integrity/g),
      ].map(m => [Number(m[1]), Number(m[2])]);
      expect(
        measurements.some(
          ([bytes, total]) => bytes > 0 && bytes < 4096 && total === 4096
        )
      ).toBe(true);
      expect(measurements.at(-1)).toEqual([4096, 4096]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
