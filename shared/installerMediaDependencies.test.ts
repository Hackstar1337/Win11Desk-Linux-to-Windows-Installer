import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mediaDependenciesShell,
  mediaVerifyShell,
} from "./installerMediaGuard";
import { bashQuote } from "./installer";

describe("Alpine HTTPS dependencies are independent of optional progress", () => {
  it.each([
    "main-only",
    "ready-offline",
    "core-transient",
    "core-unavailable",
    "meter-unavailable",
    "repo-unavailable",
    "all-ready",
  ])("%s safely handled before media/disk work", kind => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-deps-"));
    try {
      for (const name of ["touch", "cat", "chmod"])
        symlinkSync("/bin/busybox", path.join(dir, name));
      const log = path.join(dir, "log"),
        ready = path.join(dir, "ready"),
        repo = path.join(dir, "community"),
        attempt = path.join(dir, "attempt");
      if (
        [
          "main-only",
          "ready-offline",
          "meter-unavailable",
          "repo-unavailable",
          "all-ready",
        ].includes(kind)
      )
        writeFileSync(ready, "ready");
      if (kind === "all-ready")
        writeFileSync(path.join(dir, "pv"), "#!/bin/sh\nexit 0\n", {
          mode: 0o700,
        });
      writeFileSync(
        path.join(dir, "timeout"),
        '#!/bin/sh\n[ "$1" = 90 ] || exit 97\nshift\nexec "$@"\n',
        { mode: 0o700 }
      );
      writeFileSync(
        path.join(dir, "apk"),
        `#!/bin/sh
printf '%s\\n' "$*" >> ${bashQuote(log)}
case "$*" in
 'add --no-cache curl ca-certificates')
  n=$(cat ${bashQuote(attempt)} 2>/dev/null || echo 0);n=$((n+1));echo "$n" > ${bashQuote(attempt)}
  [ '${kind}' != core-unavailable ] || exit 2
  [ '${kind}' != core-transient ] || [ "$n" -ge 2 ] || exit 2
  touch ${bashQuote(ready)};;
 'add --no-cache pv')
  [ '${kind}' != meter-unavailable ] && [ '${kind}' != ready-offline ] || exit 2
  [ -f ${bashQuote(repo)} ] || exit 2
  printf '#!/bin/sh\\nexit 0\\n' > ${bashQuote(path.join(dir, "pv"))};chmod +x ${bashQuote(path.join(dir, "pv"))};;
 *) exit 98;;
esac
`,
        { mode: 0o700 }
      );
      const script = `set -e
${mediaDependenciesShell()}
# Fixture readiness replaces only host CA location; real Alpine integration checks the actual bundle.
win11desk_media_https_ready(){ [ -f ${bashQuote(ready)} ]; }
# The upstream apk wrapper must not be used; timeout executes the real external apk stub.
apk(){ echo BAD_WRAPPER >> ${bashQuote(log)}; return 99; }
add_community_repo(){ echo COMMUNITY >> ${bashQuote(log)}; [ '${kind}' != repo-unavailable ] || return 1; touch ${bashQuote(repo)}; }
sleep(){ :; }
if win11desk_media_prepare; then echo MEDIA_AND_DISK_WOULD_CONTINUE; else exit 42; fi
`;
      const run = spawnSync("/bin/busybox", ["ash", "-c", script], {
        env: { ...process.env, PATH: dir },
        encoding: "utf8",
        timeout: 3000,
      });
      const lines = (() => {
        try {
          return readFileSync(log, "utf8").trim().split("\n");
        } catch {
          return [];
        }
      })();
      expect(lines).not.toContain("BAD_WRAPPER");
      if (kind === "core-unavailable") {
        expect(run.status).toBe(42);
        expect(run.stderr).toContain("MEDIA_HTTPS_CLIENT_UNAVAILABLE");
        expect(run.stdout).not.toContain("WOULD_CONTINUE");
        expect(
          lines.filter(x => x.includes("curl ca-certificates"))
        ).toHaveLength(3);
        expect(lines).not.toContain("COMMUNITY");
      } else {
        expect(run.status, run.stderr).toBe(0);
        expect(run.stdout).toContain("WOULD_CONTINUE");
        expect(run.stderr).not.toContain("MEDIA_HTTPS_CLIENT_UNAVAILABLE");
        if (kind !== "all-ready")
          expect(lines.indexOf("COMMUNITY")).toBeLessThan(
            lines.indexOf("add --no-cache pv")
          );
        if (kind === "core-transient")
          expect(
            lines.filter(x => x.includes("curl ca-certificates"))
          ).toHaveLength(2);
        if (
          ["ready-offline", "meter-unavailable", "repo-unavailable"].includes(
            kind
          )
        )
          expect(run.stderr).toContain("MEDIA_PROGRESS_UNAVAILABLE");
        if (kind === "all-ready") expect(lines).toHaveLength(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("requires HTTPS and trusted certificates without disabling validation", () => {
    const helper = mediaDependenciesShell();
    expect(helper).toContain("/etc/ssl/certs/ca-certificates.crt");
    expect(helper).toContain("curl --version");
    expect(helper).toContain("timeout 90 apk");
    expect(helper).not.toContain("--no-check-certificate");
    expect(helper).not.toContain("--allow-untrusted");
    expect(helper).not.toContain("--insecure");
  });
  it.each([true, false])(
    "no-pv streamed integrity remains enforced: correct digest=%s",
    correct => {
      const dir = mkdtempSync(path.join(tmpdir(), "media-no-pv-"));
      try {
        for (const name of [
          "mktemp",
          "rm",
          "awk",
          "sha256sum",
          "printenv",
          "cat",
          "tr",
        ])
          symlinkSync("/bin/busybox", path.join(dir, name));
        const bytes = Buffer.alloc(4096, 42);
        writeFileSync(path.join(dir, "bytes"), bytes);
        writeFileSync(
          path.join(dir, "curl"),
          `#!/bin/sh\ncat ${bashQuote(path.join(dir, "bytes"))}\n`,
          { mode: 0o700 }
        );
        const digest = correct
          ? createHash("sha256").update(bytes).digest("hex")
          : "a".repeat(64);
        const result = spawnSync(
          "/bin/busybox",
          [
            "ash",
            "-c",
            `set -e\n${mediaVerifyShell()}\ntrack_progress(){ printf '%s:%s:%s\\n' "$1" "$2" "$3"; }\nwin11desk_media_verify https://example.test/media.iso ${digest} && echo WOULD_PARTITION`,
          ],
          {
            env: { ...process.env, PATH: dir },
            encoding: "utf8",
            timeout: 3000,
          }
        );
        expect(result.status).toBe(correct ? 0 : 1);
        expect(result.stdout.includes("WOULD_PARTITION")).toBe(correct);
        expect(result.stdout).toContain("0:0:integrity");
        expect(result.stdout).not.toContain("4096:4096");
        if (!correct) expect(result.stderr).toContain("ISO_SHA256_MISMATCH");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
