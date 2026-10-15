import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const fixture = vi.hoisted(() => ({
  root: "",
  wrong: false,
  bootstrapPath: "",
  command: "",
}));
vi.mock("./sshClient", () => ({
  RemoteSshError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
  executeFixedCommand: async (_session: any, cmd: string, options: any) => {
    fixture.command = cmd;
    const input = options.input.replaceAll(
      "/root/win11desk-remote",
      fixture.root + "/state"
    );
    const result = spawnSync("/bin/sh", ["-c", cmd], {
      input,
      env: {
        ...process.env,
        PATH: fixture.root + "/bin:/usr/bin:/bin",
        MOCK_WRONG: fixture.wrong ? "1" : "0",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status !== 0)
      throw new Error("Fixture shell failed: " + result.stderr);
    return { stdout: result.stdout, stderr: result.stderr };
  },
}));
import { launchTarget, reconcileTarget } from "./runner";
const id = "11111111-1111-4111-8111-111111111111",
  id2 = "22222222-2222-4222-8222-222222222222";
const expected: any = {
  hostname: "fixture-host",
  disk: "/dev/vda",
  diskBytes: 85899345920,
  diskSerial: "fixture-serial",
  runner: "detached",
};
function executable(name: string, content: string) {
  writeFileSync(
    join(fixture.root, "bin", name),
    "#!/usr/bin/env bash\n" + content,
    { mode: 0o700 }
  );
}
beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), "remote-runner-fixture-"));
  fixture.wrong = false;
  mkdirSync(join(fixture.root, "bin"));
  executable("id", "echo 0\n");
  executable(
    "cat",
    'if [[ "$1" = /proc/1/comm ]]; then echo fixture; else /bin/cat "$@"; fi\n'
  );
  executable(
    "hostname",
    "[[ ${MOCK_WRONG:-0} = 1 ]] && echo wrong || echo fixture-host\n"
  );
  executable("findmnt", "echo /dev/vda1\n");
  executable(
    "lsblk",
    `case "$*" in
 '-dn -o TYPE /dev/vda1') echo part;;
 '-dn -o TYPE /dev/vda') echo disk;;
 '-s -nr -o PATH /dev/vda1') printf '/dev/vda1\\n/dev/vda\\n';;
 '-bdn -o SIZE /dev/vda') echo 85899345920;;
 '-dn -o SERIAL /dev/vda') echo fixture-serial;;
 *) exit 3;; esac\n`
  );
});
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }));
describe("Exact detached runner executable shell", () => {
  it("runs only the supplied harmless bootstrap once and reconciles its receipt", async () => {
    const marker = join(fixture.root, "ran");
    const script = `#!/usr/bin/env bash\nprintf 'fixture-run\\n' >> '${marker}'\n`;
    expect((await launchTarget({} as any, id, script, expected)).state).toBe(
      "launched"
    );
    for (let i = 0; i < 20 && !existsSync(marker); i++)
      await new Promise(r => setTimeout(r, 25));
    expect(readFileSync(marker, "utf8")).toBe("fixture-run\n");
    expect((await launchTarget({} as any, id, script, expected)).state).toBe(
      "launched"
    );
    expect(readFileSync(marker, "utf8")).toBe("fixture-run\n");
    expect((await reconcileTarget({} as any, id)).state).toBe("launched");
    expect(statSync(join(fixture.root, "state", id)).mode & 0o777).toBe(0o700);
    expect(existsSync(join(fixture.root, "state", id, "bootstrap.sh"))).toBe(
      false
    );
  });
  it("never stages or executes the bootstrap on a changed hostname", async () => {
    fixture.wrong = true;
    const marker = join(fixture.root, "ran");
    const result = await launchTarget(
      {} as any,
      id,
      `echo unsafe > '${marker}'`,
      expected
    );
    expect(result).toEqual({ state: "failed", errorCode: "WRONG_HOST" });
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(fixture.root, "state", id, "bootstrap.sh"))).toBe(
      false
    );
  });
  it("blocks a second job or address alias on the same target", async () => {
    await launchTarget({} as any, id, "true", expected);
    expect(await launchTarget({} as any, id2, "true", expected)).toEqual({
      state: "failed",
      errorCode: "TARGET_ALREADY_DISPATCHED",
    });
  });
  it("retains the empty serial slot through the SSH login shell and executes once", async () => {
    const marker = join(fixture.root, "null-serial-ran");
    const inventory = { ...expected, diskSerial: null };
    const script = `printf 'one-run\\n' >> '${marker}'`;
    expect(await launchTarget({} as any, id, script, inventory)).toEqual({
      state: "launched",
    });
    expect(fixture.command).toContain(" '' ");
    for (let i = 0; i < 20 && !existsSync(marker); i++)
      await new Promise(r => setTimeout(r, 25));
    expect(readFileSync(marker, "utf8")).toBe("one-run\n");
    await launchTarget({} as any, id, script, inventory);
    expect(readFileSync(marker, "utf8")).toBe("one-run\n");
    expect(await reconcileTarget({} as any, id)).toEqual({ state: "launched" });
  });
  it("proves absence only before any job dispatch marker exists", async () => {
    expect(await reconcileTarget({} as any, id)).toEqual({ state: "absent" });
    mkdirSync(join(fixture.root, "state", id + ".lock"), { recursive: true });
    expect(await reconcileTarget({} as any, id)).toEqual({ state: "unknown" });
  });
  it("never bypasses the host-wide dispatch marker for a missing receipt", async () => {
    mkdirSync(join(fixture.root, "state", "target-install.lock"), {
      recursive: true,
    });
    expect(await reconcileTarget({} as any, id)).toEqual({ state: "unknown" });
  });
  it("records a failed harmless child instead of treating detach as Windows ready", async () => {
    const receipt = await launchTarget({} as any, id, "exit 9", expected);
    expect(receipt).toEqual({ state: "failed", errorCode: "INSTALLER_EXITED" });
    expect((await reconcileTarget({} as any, id)).state).toBe("failed");
  });
});
