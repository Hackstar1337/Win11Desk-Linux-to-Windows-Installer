import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { Server } from "ssh2";
import { createServer } from "node:net";
const redirect = vi.hoisted(() => ({
  port: 0,
  configs: [] as any[],
  commands: [] as string[],
  inputs: [] as string[],
  mode: "ok",
}));
vi.mock("ssh2", async importOriginal => {
  const actual: any = await importOriginal();
  const real = actual.default || actual;
  return {
    ...actual,
    Server: real.Server,
    Client: class extends real.Client {
      connect(c: any) {
        redirect.configs.push(c);
        return super.connect({
          ...c,
          readyTimeout: redirect.mode === "silent" ? 120 : c.readyTimeout,
          host: "127.0.0.1",
          port: redirect.port,
        });
      }
    },
  };
});
import {
  asSafeError,
  assertPublicTarget,
  discoverHost,
  connectTarget,
  executeFixedCommand,
} from "./sshClient";
const pem = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const target = { host: "8.8.4.4", port: 22, username: "root" as const };
const password = "Synthetic ' root $ password ; spaces";
let server: Server,
  auths = 0,
  oldOrigin: string | undefined;
let connections: any[] = [];
beforeEach(async () => {
  oldOrigin = process.env.APP_PUBLIC_URL;
  delete process.env.APP_PUBLIC_URL;
  redirect.configs = [];
  redirect.commands = [];
  redirect.inputs = [];
  redirect.mode = "ok";
  auths = 0;
  server = new Server({ hostKeys: [pem] }, client => {
    connections.push(client);
    client.on("authentication", ctx => {
      auths++;
      if (redirect.mode === "close-login") {
        client.end();
        return;
      }
      if (
        ctx.method === "password" &&
        ctx.username === "root" &&
        ctx.password === password
      )
        ctx.accept();
      else ctx.reject();
    });
    client.on("error", () => {});
    client.on("ready", () =>
      client.on("session", accept =>
        accept().on("exec", (acceptExec, _reject, info) => {
          redirect.commands.push(info.command);
          const stream = acceptExec();
          let input = "";
          stream.on("data", (chunk: Buffer) => (input += chunk.toString()));
          stream.on("end", () => {
            redirect.inputs.push(input);
            if (redirect.mode === "stall") return;
            if (redirect.mode === "huge") stream.write("x".repeat(2048));
            else if (redirect.mode === "preflight")
              stream.write(
                "hostname=fixture-linux\nroot=0\narchitecture=x86_64\nvirtualization=kvm\nmemoryKiB=4194304\nnominalMemoryKiB=4194304\ncrashReservedBytes=0\ncpuCount=2\ndisk=/dev/vda\ndiskBytes=85899345920\ndiskSerial=fixture\nbootMode=uefi\nrunner=systemd\nhttpsReachable=1\n"
              );
            else if (redirect.mode === "receipt")
              stream.write("state=launched\n");
            else stream.write("fixture-ok\n");
            stream.exit(redirect.mode === "exit" ? 3 : 0);
            stream.end();
          });
        })
      )
    );
  });
  server.on("error", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  redirect.port = (server.address() as any).port;
});
afterEach(async () => {
  for (const c of connections) c.end();
  connections = [];
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (oldOrigin === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = oldOrigin;
});
async function session() {
  const key = await discoverHost(target);
  return connectTarget(target, password, key.fingerprint);
}
describe("Password-only pinned SSH over a loopback fixture", () => {
  it("discovers an actual raw SSH fingerprint before sending any authentication", async () => {
    const found = await discoverHost(target);
    expect(found.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(found.keyType).toBe("ssh-rsa");
    expect(auths).toBe(0);
    expect(redirect.configs[0].password).toBeUndefined();
  });
  it("preserves exact password punctuation and does not supply keys or an agent", async () => {
    const s = await session();
    expect(redirect.configs.at(-1).password).toBe(password);
    expect(redirect.configs.at(-1).privateKey).toBeUndefined();
    expect(redirect.configs.at(-1).agent).toBeUndefined();
    expect(await executeFixedCommand(s, "printf fixture")).toEqual({
      stdout: "fixture-ok\n",
      stderr: "",
    });
    s.close();
  });
  it("rejects a changed host key before password authentication", async () => {
    await expect(
      connectTarget(target, password, "SHA256:" + "A".repeat(43))
    ).rejects.toMatchObject({ code: "HOST_KEY_MISMATCH" });
    expect(auths).toBe(0);
  });
  it("reports authentication failure without returning the submitted secret", async () => {
    const key = await discoverHost(target);
    await expect(
      connectTarget(target, "incorrect synthetic secret", key.fingerprint)
    ).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it.each([
    ["ECONNREFUSED", "CONNECTION_REFUSED"],
    ["ECONNRESET", "CONNECTION_RESET"],
    ["EPIPE", "CONNECTION_RESET"],
    ["EHOSTUNREACH", "CONNECTION_UNREACHABLE"],
    ["ENETUNREACH", "CONNECTION_UNREACHABLE"],
    ["ETIMEDOUT", "TIMEOUT"],
  ])(
    "classifies %s without leaking remote text or confusing routing with host keys",
    (code, expected) => {
      const error = asSafeError(
        Object.assign(new Error("connect " + code + " " + password), { code }),
        "CONNECTION_FAILED"
      );
      expect(error.code).toBe(expected);
      expect(error.message).not.toContain(password);
    }
  );
  it("reports a refused real TCP connection during discovery without attempting authentication", async () => {
    const unused = createServer();
    unused.listen(0, "127.0.0.1");
    await once(unused, "listening");
    redirect.port = (unused.address() as any).port;
    await new Promise<void>(resolve => unused.close(() => resolve()));
    await expect(discoverHost(target)).rejects.toMatchObject({
      code: "CONNECTION_REFUSED",
    });
    expect(auths).toBe(0);
    expect(redirect.configs[0].password).toBeUndefined();
  });
  it("rejects a server that closes login promptly instead of leaving connection state pending", async () => {
    const key = await discoverHost(target);
    redirect.mode = "close-login";
    await expect(
      connectTarget(target, password, key.fingerprint)
    ).rejects.toMatchObject({ code: "CONNECTION_RESET" });
  });
  it("explains a real silent/non-SSH port as a handshake timeout without sending a password", async () => {
    const sockets: any[] = [];
    const silent = createServer(socket => sockets.push(socket));
    silent.listen(0, "127.0.0.1");
    await once(silent, "listening");
    redirect.port = (silent.address() as any).port;
    redirect.mode = "silent";
    try {
      await expect(discoverHost(target)).rejects.toMatchObject({
        code: "SSH_HANDSHAKE_TIMEOUT",
      });
      expect(redirect.configs.at(-1).password).toBeUndefined();
      expect(auths).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => silent.close(() => resolve()));
    }
  });
  it("fails on nonzero remote command exit", async () => {
    const s = await session();
    redirect.mode = "exit";
    await expect(executeFixedCommand(s, "fixture")).rejects.toMatchObject({
      code: "CHANNEL_FAILED",
    });
    s.close();
  });
  it("bounds output and closes timed out channels", async () => {
    const s = await session();
    redirect.mode = "huge";
    await expect(
      executeFixedCommand(s, "fixture", { maxOutputBytes: 1024 })
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
    redirect.mode = "stall";
    await expect(
      executeFixedCommand(s, "fixture", { timeoutMs: 100 })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    s.close();
  });
  it("accepts KVM inventory and syntax-checks the exact read-only Bash probe", async () => {
    const s = await session();
    redirect.mode = "preflight";
    const inv = await s.preflight("https://fixture.example.com");
    expect(inv.disk).toBe("/dev/vda");
    expect(inv.virtualization).toBe("kvm");
    expect(redirect.commands.at(-1)).toBe("bash -s");
    const probe = redirect.inputs.at(-1)!;
    expect(spawnSync("bash", ["-n"], { input: probe }).status).toBe(0);
    expect(probe).not.toMatch(/authorized_keys|ssh-copy-id|sshd_config/);
    s.close();
  });
  it("stages private bootstrap through stdin and reconciles a single-encoded job id", async () => {
    const s = await session();
    redirect.mode = "receipt";
    const id = "11111111-1111-4111-8111-111111111111",
      bootstrap = "echo synthetic-private-ticket";
    const inv = {
      hostname: "fixture",
      disk: "/dev/vda",
      diskBytes: 85899345920,
      diskSerial: "fixture",
      runner: "systemd",
    } as any;
    expect((await s.launch(id, bootstrap, inv)).state).toBe("launched");
    const cmd = redirect.commands.at(-1)!;
    expect(cmd).not.toContain(Buffer.from(bootstrap).toString("base64"));
    expect(redirect.inputs.at(-1)).toContain(
      Buffer.from(bootstrap).toString("base64")
    );
    expect(
      spawnSync("bash", ["-n"], { input: redirect.inputs.at(-1) }).status
    ).toBe(0);
    await s.reconcile(id);
    expect(redirect.commands.at(-1)).toBe(
      "bash -s -- " + Buffer.from(id).toString("base64")
    );
    s.close();
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "fc00::1",
  ])("rejects unsafe target %s before creating SSH client", async host => {
    await expect(assertPublicTarget({ ...target, host })).rejects.toBeDefined();
    expect(redirect.configs).toHaveLength(0);
  });
});
