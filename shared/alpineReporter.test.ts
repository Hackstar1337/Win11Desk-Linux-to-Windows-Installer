import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { alpineReporter } from "./installerTrackingHooks";
import { bashQuote } from "./installer";
const token = "b".repeat(64),
  origin = "https://example.com",
  run = "11111111-1111-4111-8111-111111111111";
function fixture(code: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "alpine-report-"));
  try {
    const file = path.join(dir, "report.sh");
    writeFileSync(file, alpineReporter(origin, run, token));
    return execFileSync(
      "bash",
      [
        "-c",
        `set -eu\nsource ${bashQuote(file)}\n${code.replaceAll("__DIR__", bashQuote(dir))}`,
      ],
      { encoding: "utf8", timeout: 4000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("Alpine tracking transport", () => {
  it("executes the reporter under real BusyBox ash with expanded JSON and HTTP authorization", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ash-report-"));
    try {
      const file = path.join(dir, "report.sh"),
        body = path.join(dir, "body"),
        args = path.join(dir, "args");
      writeFileSync(file, alpineReporter(origin, run, token));
      execFileSync("busybox", ["ash", "-n", file]);
      const out = execFileSync(
        "busybox",
        [
          "ash",
          "-c",
          `set -e\n. ${bashQuote(file)}\ncurl(){ printf '%s\\n' "$@" > ${bashQuote(args)}; while [ "$#" -gt 0 ];do if [ "$1" = --data ];then printf '%s' "$2" > ${bashQuote(body)};fi;shift;done;printf 204; }\ntrack_report installer_booted\ncat ${bashQuote(body)}`,
        ],
        { encoding: "utf8" }
      );
      expect(JSON.parse(out)).toEqual({ stage: "installer_booted" });
      expect(readFileSync(args, "utf8")).toContain(
        "Authorization: Bearer " + token
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("prepares missing curl/CA package and falls back to available HTTPS wget without curl", () => {
    const out = fixture(
      `command(){ if [[ "$1" == -v && "$2" == curl ]]; then return 1; fi; builtin command "$@"; }\napk(){ printf '%s' "$*" > __DIR__/apk; return 1; }\nsleep(){ :; }\nwget(){ printf '%s\\n' "$@" > __DIR__/wget; return 0; }\ntrack_prepare\ntrack_report installer_booted\ncat __DIR__/apk __DIR__/wget`
    );
    expect(out).toContain("add --no-cache curl ca-certificates");
    expect(out).toContain('--post-data={"stage":"installer_booted"}');
    expect(out).toContain("--header=Authorization: Bearer " + token);
    expect(out).toContain(
      origin + "/api/installer/tracking/runs/" + run + "/events"
    );
    expect(out).not.toContain("--no-check-certificate");
  });
  it("retries transient HTTP failure and heartbeat body does not move stage", () => {
    const out = fixture(
      `sleep(){ :; }\ncurl(){ n=$(cat __DIR__/count 2>/dev/null || echo 0);n=$((n+1));echo "$n" > __DIR__/count;printf '%s\\n' "$@" > __DIR__/args;if [[ "$n" -lt 3 ]];then printf 503;else printf 204;fi; }\ntrack_send "$TRACK_HEARTBEAT_URL" '{}'\ncat __DIR__/count __DIR__/args`
    );
    expect(out).toContain("3\n");
    expect(out).toContain("/heartbeat");
    expect(out).toContain("\n{}\n");
    expect(out).not.toContain("stage");
  });
  it("shows sanitized failure rather than silently discarding missing transport", () => {
    const out = fixture(
      `command(){ if [[ "$1" == -v ]]; then return 1;fi;builtin command "$@"; }\ntrack_report installer_booted 2> __DIR__/error\ncat __DIR__/error`
    );
    expect(out).toContain("no-HTTPS-client");
    expect(out).not.toContain(token);
    expect(out).not.toContain(origin);
  });
  it("stops active heartbeat when handing off without modifying disk or OS", () => {
    const out = fixture(
      `curl(){ printf 204; }\nsleep 30 &\nTRACK_HEARTBEAT_PID=$!\nold=$TRACK_HEARTBEAT_PID\ntrack_report windows_setup\n[[ -z "$TRACK_HEARTBEAT_PID" ]]\nwait "$old" 2>/dev/null || true\necho stopped`
    );
    expect(out).toContain("stopped");
  });
  it("retries a terminal report before stopping the heartbeat", () => {
    const out = fixture(
      `sleep(){ :; }\nTRACK_HEARTBEAT_PID=123\ntrack_send(){ n=$(cat __DIR__/terminal-count 2>/dev/null || echo 0);n=$((n+1));echo "$n" > __DIR__/terminal-count;[ "$TRACK_HEARTBEAT_PID" = 123 ] || return 9; [ "$n" -ge 2 ]; }\ntrack_stop(){ TRACK_HEARTBEAT_PID='';echo stopped; }\ntrack_report windows_setup\ncat __DIR__/terminal-count`
    );
    expect(out).toContain("stopped\n2");
  });
});
