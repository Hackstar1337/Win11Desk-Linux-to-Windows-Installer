import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../control/config", () => ({
  config: () => ({ publicUrl: "https://fixture.example.com" }),
}));
vi.mock("../control/crypto", () => ({ decrypt: (value: string) => value }));
vi.mock("../control/admin", () => ({ issueRemoteCommand: vi.fn() }));
import { RemoteWorker } from "./worker";
const expected = {
  hostname: "fixture",
  disk: "/dev/vda",
  diskBytes: 85899345920,
  diskSerial: "fixture",
  architecture: "x86_64",
  root: true,
  runner: "systemd",
  httpsReachable: true,
};
const settings = {
  profileId: "fixture-profile",
  profileRevision: 3,
  password: "synthetic-windows",
  username: "Administrator",
  remotePort: 22,
  retries: 10,
};
let queue: any, session: any, connect: any, issue: any, active: any;
const row: any = {
  id: "fixture-job",
  owner_id: "fixture-owner",
  target_json: { host: "8.8.4.4", port: 22, username: "root" },
  target_host: "8.8.4.4",
  target_port: 22,
  expected_inventory_json: expected,
  settings_secret_id: "settings",
  ssh_secret_id: "ssh",
  settings_ciphertext: JSON.stringify(settings),
  ssh_ciphertext: "synthetic-ssh-password",
  fingerprint: "SHA256:fixture",
  state: "connecting",
  command_id: null,
  group_id: null,
  dispatch_intent_at: null,
};
beforeEach(() => {
  session = {
    preflight: vi.fn(async () => ({ ...expected })),
    launch: vi.fn(async () => ({ state: "launched" })),
    close: vi.fn(),
  };
  queue = {
    recoverStale: vi.fn(async () => 0),
    claim: vi.fn(async () => ({ ...row })),
    raw: vi.fn(async () => ({ ...row })),
    heartbeat: vi.fn(async () => true),
    setState: vi.fn(async () => true),
    clearSecrets: vi.fn(async () => {}),
    saveIssuance: vi.fn(async () => true),
  };
  connect = vi.fn(async () => session);
  issue = vi.fn(async () => ({
    commandId: "fixture-command",
    groupId: "fixture-group",
    bootstrap: "echo synthetic",
  }));
  active = vi.fn(async () => true);
});
function worker() {
  return new RemoteWorker({
    queue,
    connect,
    issue,
    isActorActive: active,
    recordHeartbeat: async () => {},
    workerId: "fixture-worker",
  });
}
function states() {
  return queue.setState.mock.calls.map((x: any[]) => x[1]);
}
describe("Durable worker fail-closed dispatch", () => {
  it("hands off the approved settings once and clears transient credentials", async () => {
    await worker().tick();
    expect(connect.mock.calls[0][1]).toBe("synthetic-ssh-password");
    expect(issue.mock.calls[0][1]).toEqual(settings);
    expect(session.preflight).toHaveBeenCalledWith(
      "https://fixture.example.com"
    );
    expect(session.launch).toHaveBeenCalledTimes(1);
    expect(states()).toEqual([
      "checking",
      "sending",
      "launching",
      "handed_off",
    ]);
    expect(queue.clearSecrets).toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });
  it.each(["hostname", "disk", "diskSerial", "diskBytes"])(
    "does not issue or launch after %s changes",
    async key => {
      session.preflight.mockResolvedValue({ ...expected, [key]: "changed" });
      await worker().tick();
      expect(issue).not.toHaveBeenCalled();
      expect(session.launch).not.toHaveBeenCalled();
      expect(states().at(-1)).toBe("blocked");
      expect(queue.clearSecrets).toHaveBeenCalled();
    }
  );
  it("does not connect after the initiating actor loses installation permission", async () => {
    active.mockResolvedValue(false);
    await worker().tick();
    expect(connect).not.toHaveBeenCalled();
    expect(states()).toEqual(["blocked"]);
  });
  it("never retries after an unacknowledged dispatch", async () => {
    session.launch.mockResolvedValue({ state: "unknown" });
    await worker().tick();
    expect(session.launch).toHaveBeenCalledTimes(1);
    expect(states().at(-1)).toBe("launch_uncertain");
    expect(queue.clearSecrets).toHaveBeenCalled();
  });
  it("reboot disconnect after dispatch is uncertain, not Windows success", async () => {
    session.launch.mockRejectedValue(new Error("synthetic disconnect"));
    await worker().tick();
    expect(session.launch).toHaveBeenCalledTimes(1);
    expect(states().at(-1)).toBe("launch_uncertain");
  });
  it("failed authentication clears decryptable credentials before dispatch", async () => {
    connect.mockRejectedValue({ code: "AUTH_FAILED" });
    await worker().tick();
    expect(session.launch).not.toHaveBeenCalled();
    expect(states().at(-1)).toBe("connection_failed");
    expect(queue.clearSecrets).toHaveBeenCalled();
  });
  it.each([
    "CONNECTION_REFUSED",
    "CONNECTION_RESET",
    "CONNECTION_UNREACHABLE",
    "SSH_HANDSHAKE_TIMEOUT",
    "TIMEOUT",
  ])(
    "records %s as a pre-install connection failure without dispatch or automatic retry",
    async code => {
      connect.mockRejectedValue({ code });
      await worker().tick();
      expect(states()).toEqual(["connection_failed"]);
      expect(issue).not.toHaveBeenCalled();
      expect(session.launch).not.toHaveBeenCalled();
      expect(queue.clearSecrets).toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(1);
    }
  );
  it.each([
    ["WRONG_DISK", "blocked"],
    ["WRONG_HOST", "blocked"],
    ["INSTALLER_EXITED", "launch_uncertain"],
    ["TARGET_ALREADY_DISPATCHED", "launch_uncertain"],
  ])(
    "distinguishes a %s receipt from connection failure without retry",
    async (errorCode, expectedState) => {
      session.launch.mockResolvedValue({ state: "failed", errorCode });
      await worker().tick();
      expect(states().at(-1)).toBe(expectedState);
      expect(session.launch).toHaveBeenCalledTimes(1);
      expect(queue.clearSecrets).toHaveBeenCalled();
    }
  );
  it("lease loss blocks the next destructive step", async () => {
    queue.setState.mockResolvedValue(false);
    await worker().tick();
    expect(issue).not.toHaveBeenCalled();
    expect(session.launch).not.toHaveBeenCalled();
  });
  it("does not manufacture a new command after saved issuance changes", async () => {
    queue.raw.mockResolvedValue({
      ...row,
      command_id: "prior-command",
      group_id: "prior-group",
    });
    await worker().tick();
    expect(session.launch).not.toHaveBeenCalled();
    expect(states().at(-1)).toBe("launch_uncertain");
  });
  it("idle maintenance does not connect to any target", async () => {
    queue.claim.mockResolvedValue(null);
    expect(await worker().tick()).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});
