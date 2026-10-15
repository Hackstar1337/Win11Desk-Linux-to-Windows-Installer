import { describe, it, expect } from "vitest";
import { parsePreflightInventory, buildPreflightProbe } from "./preflight";
const fields = {
  hostname: "fixture-linux",
  root: 0,
  architecture: "x86_64",
  virtualization: "kvm",
  memoryKiB: 4_194_304,
  nominalMemoryKiB: 4_194_304,
  crashReservedBytes: 0,
  cpuCount: 2,
  disk: "/dev/vda",
  diskBytes: 85_899_345_920,
  diskSerial: "fixture",
  bootMode: "uefi",
  runner: "systemd",
  httpsReachable: 1,
};
function output(overrides: Record<string, unknown> = {}) {
  return (
    Object.entries({ ...fields, ...overrides })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}
function code(overrides: Record<string, unknown>, expected: string) {
  expect(() => parsePreflightInventory(output(overrides))).toThrow();
  try {
    parsePreflightInventory(output(overrides));
  } catch (e) {
    expect(e).toMatchObject({ code: expected });
  }
}
describe("Preflight installer parity and safe diagnostics", () => {
  it("accepts inventory and reports usable and nominal memory separately", () => {
    expect(parsePreflightInventory(output())).toMatchObject({
      memoryMiB: 4096,
      nominalMemoryMiB: 4096,
      crashReservedBytes: 0,
      httpsReachable: true,
    });
  });
  it("accepts the exact retained installer memory threshold below the old3900MiB threshold", () => {
    expect(
      parsePreflightInventory(
        output({ memoryKiB: 3_900_000, nominalMemoryKiB: 3_900_000 })
      ).root
    ).toBe(true);
  });
  it("counts Linux crash reservation just like the retained installer", () => {
    const usable = 3_700_000,
      reserved = 268_435_456;
    expect(
      parsePreflightInventory(
        output({
          memoryKiB: usable,
          nominalMemoryKiB: usable + Math.floor(reserved / 1024),
          crashReservedBytes: reserved,
        })
      ).nominalMemoryMiB
    ).toBeGreaterThan(3800);
  });
  it("still rejects inadequate nominal memory with measured evidence", () => {
    code(
      { memoryKiB: 3_899_999, nominalMemoryKiB: 3_899_999 },
      "PREFLIGHT_MEMORY_INSUFFICIENT"
    );
  });
  it("still requires one GB usable even when crash reservation is large", () => {
    code(
      {
        memoryKiB: 999_999,
        nominalMemoryKiB: 999_999 + Math.floor(4_026_531_840 / 1024),
        crashReservedBytes: 4_026_531_840,
      },
      "PREFLIGHT_MEMORY_INSUFFICIENT"
    );
  });
  it.each([
    [{ root: 1 }, "PREFLIGHT_ROOT_REQUIRED"],
    [{ architecture: "aarch64" }, "PREFLIGHT_ARCH_UNSUPPORTED"],
    [{ virtualization: "lxc" }, "PREFLIGHT_VIRTUALIZATION_UNSUPPORTED"],
    [{ cpuCount: 1 }, "PREFLIGHT_CPU_INSUFFICIENT"],
    [{ diskBytes: 63_999_999_999 }, "PREFLIGHT_DISK_TOO_SMALL"],
    [{ disk: "/dev/vda1" }, "PREFLIGHT_DISK_UNSUPPORTED"],
    [{ runner: "none" }, "PREFLIGHT_RUNNER_UNAVAILABLE"],
    [{ httpsReachable: 0 }, "PREFLIGHT_HTTPS_UNREACHABLE"],
  ] as const)("retains safeguard %s", (f, c) => code(f, c));
  it("rejects manipulated nominal memory counters", () =>
    code({ nominalMemoryKiB: 8_388_608 }, "PROTOCOL_ERROR"));
  it("reports only allowlisted missing tool names", () => {
    expect(() =>
      parsePreflightInventory(
        "missing=curl\npreflightError=PREFLIGHT_TOOL_MISSING\n"
      )
    ).toThrow("Required Linux tool is missing: curl");
    try {
      parsePreflightInventory(
        "missing=synthetic-password\npreflightError=PREFLIGHT_TOOL_MISSING\n"
      );
    } catch (e) {
      expect(String(e)).not.toContain("synthetic-password");
    }
  });
  it("never reflects arbitrary remote failure strings", () => {
    expect(() =>
      parsePreflightInventory("preflightError=synthetic-password\n")
    ).toThrow("incomplete inventory");
  });
  it("rejects duplicate fields or unsafe hostname rather than ambiguous evidence", () => {
    expect(() => parsePreflightInventory(output() + "root=0\n")).toThrow(
      "invalid response"
    );
    code({ hostname: "$secret" }, "PREFLIGHT_HOSTNAME_INVALID");
  });
  it("keeps probe read-only and rejects non-HTTPS or injection origins", () => {
    const probe = buildPreflightProbe("https://fixture.example.com");
    expect(probe).not.toMatch(
      /authorized_keys|sshd_config|mkfs|reboot|curl.*\|.*bash/
    );
    for (const origin of [
      "http://fixture.example.com",
      "https://fixture.example.com/path",
      "https://fixture.example.com;echo-secret",
    ])
      expect(() => buildPreflightProbe(origin)).toThrow();
  });
});
