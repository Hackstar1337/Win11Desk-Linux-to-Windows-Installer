import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETUP_V3_SHA256,
  SETUP_V3_TEXT,
  SETUP_V3_VERSION,
  buildCleanSetupCommand,
  registerSetupV3Routes,
} from "../server/control/launcherV3";

const TICKET = "a".repeat(64);
const HASH = "b".repeat(64);

function runBash(
  script: string,
  input = "",
  env: NodeJS.ProcessEnv = process.env,
  args: string[] = []
): string {
  const command = process.getuid?.() === 0 ? "bash" : "sudo";
  const commandArgs =
    process.getuid?.() === 0
      ? ["-c", script, "setup", ...args]
      : [
          "-n",
          "env",
          `PATH=${env.PATH}`,
          "bash",
          "-c",
          script,
          "setup",
          ...args,
        ];
  return execFileSync(command, commandArgs, {
    input,
    env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function rootNames(): string[] {
  if (process.getuid?.() === 0) return readdirSync("/root");
  return execFileSync(
    "sudo",
    ["-n", "find", "/root", "-maxdepth", "1", "-type", "f", "-printf", "%f\\n"],
    { encoding: "utf8" }
  )
    .trim()
    .split("\\n")
    .filter(Boolean);
}

function fixture(
  options: {
    downloader?: "curl" | "wget" | "both";
    setup?: string;
    artifact?: string;
    failures?: number;
    response?: "empty" | "html";
    oversize?: boolean;
  } = {}
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "win11desk-v3-"));
  chmodSync(root, 0o777);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const marker = path.join(root, "installed");
  const handoff = path.join(root, "handoff");
  const attempts = path.join(root, "attempts");
  const argv = path.join(root, "argv");
  const artifact =
    options.artifact ??
    `#!/usr/bin/env bash
cat > ${JSON.stringify(handoff)}
printf sentinel > ${JSON.stringify(marker)}; chmod 644 ${JSON.stringify(marker)} ${JSON.stringify(handoff)}
`;
  const setupFile = path.join(root, "setup.sh");
  const artifactFile = path.join(root, "artifact.sh");
  writeFileSync(setupFile, options.setup ?? SETUP_V3_TEXT);
  writeFileSync(artifactFile, artifact);
  writeFileSync(attempts, "0");
  writeFileSync(argv, "");
  const mock = `#!/usr/bin/env bash
set -euo pipefail
out=''; post=''; url="\${!#}"
printf '%s\\n' "$@" > ${JSON.stringify(argv)}
while (($#)); do
  case "$1" in
    -o|-O) out="$2"; shift 2 ;;
    --data-binary) [[ "\${2:-}" == '@-' ]] && post=STDIN; shift 2 ;;
    --post-file=*) post="\${1#--post-file=}"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == */api/installer/launch/v3 ]]; then
  n=$(cat ${JSON.stringify(attempts)}); n=$((n+1)); printf '%s' "$n" > ${JSON.stringify(attempts)}
  if ((n <= ${options.failures ?? 0})); then printf stale > "$out"; exit 22; fi
  if [[ "$post" == STDIN ]]; then cat > ${JSON.stringify(root + "/body")}; else cat "$post" > ${JSON.stringify(root + "/body")}; fi; chmod 644 ${JSON.stringify(root + "/body")}
  if ${options.oversize ? "true" : "false"}; then head -c 6291456 /dev/zero > "$out"; exit 0; fi
  case ${JSON.stringify(options.response ?? "")} in
    empty) : > "$out" ;;
    html) printf '<!doctype html><html>error</html>' > "$out" ;;
    *) cat ${JSON.stringify(artifactFile)} > "$out" ;;
  esac
elif [[ "$url" == */setup/${SETUP_V3_VERSION}.sh ]]; then
  cat ${JSON.stringify(setupFile)} > "$out"
else
  exit 22
fi
`;
  const install = (name: string, body: string) => {
    const file = path.join(bin, name);
    writeFileSync(file, body);
    chmodSync(file, 0o700);
  };
  const unavailable = "#!/usr/bin/env bash\nexit 127\n";
  const downloader = options.downloader ?? "curl";
  if (downloader !== "wget") install("curl", mock);
  else install("curl", unavailable);
  if (downloader !== "curl") install("wget", mock);
  else install("wget", unavailable);
  return {
    root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    marker,
    handoff,
    attempts,
    argv,
    artifactHash: createHash("sha256").update(artifact).digest("hex"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function rooted(command: string, root: string): string {
  return command.replaceAll(
    "/root/win11desk-bootstrap-v3.",
    `${root}/bootstrap-`
  );
}

function setupIn(root: string): string {
  return SETUP_V3_TEXT.replaceAll(
    "/root/win11desk-launcher-v3.",
    `${root}/launcher-`
  ).replaceAll("/root/win11desk-installer-v3.", `${root}/diagnostic-`);
}

describe("setup launcher v3", () => {
  it("freezes valid Bash bytes, serves only generic transport, and stays compact", () => {
    expect(createHash("sha256").update(SETUP_V3_TEXT).digest("hex")).toBe(
      SETUP_V3_SHA256
    );
    expect(SETUP_V3_TEXT).toContain("/api/installer/launch/v3");
    expect(SETUP_V3_TEXT).toContain("unset -v ticket artifact_hash");
    expect(SETUP_V3_TEXT).not.toContain("?ticket=");
    execFileSync("bash", ["-n"], { input: SETUP_V3_TEXT });
    const command = buildCleanSetupCommand(
      "https://dashboard.example.com",
      TICKET.toUpperCase(),
      HASH.toUpperCase()
    );
    expect(command.length).toBeLessThanOrEqual(1400);
    expect(command).toContain("--origin 'https://dashboard.example.com'");
    expect(command).not.toContain("?ticket=");
    expect(command).not.toContain("process.env");
    execFileSync("bash", ["-n"], { input: command });
  });

  it("registers the immutable generic GET endpoint", () => {
    const routes: Record<string, Function> = {};
    registerSetupV3Routes({
      get: (url: string, handler: Function) => (routes[url] = handler),
    } as any);
    const headers: Record<string, string> = {};
    const res: any = {
      set(values: Record<string, string>) {
        Object.assign(headers, values);
        return this;
      },
      type(value: string) {
        headers["content-type"] = value;
        return this;
      },
      send(value: string) {
        expect(value).toBe(SETUP_V3_TEXT);
        return this;
      },
    };
    expect(routes["/setup/v3.sh"]).toBeTypeOf("function");
    routes["/setup/v3.sh"]({}, res);
    expect(headers["Cache-Control"]).toContain("immutable");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers.ETag).toBe(`"${SETUP_V3_SHA256}"`);
  });

  it("downloads with curl stdin POST, clears grants before installer execution, and emits safe non-TTY status", () => {
    const f = fixture();
    try {
      const command = rooted(
        buildCleanSetupCommand(
          "http://localhost:43123",
          TICKET,
          f.artifactHash
        ),
        f.root
      );
      const output = runBash(command, "", f.env);
      expect(readFileSync(f.marker, "utf8")).toBe("sentinel");
      expect(readFileSync(f.handoff, "utf8")).toBe("");
      expect(readFileSync(path.join(f.root, "body"), "utf8")).toBe(
        `{"ticket":"${TICKET}"}`
      );
      expect(readFileSync(f.argv, "utf8")).not.toContain(TICKET);
      expect(output).toContain(
        "Handoff prepared / VPS will reboot; follow dashboard."
      );
      expect(output).not.toMatch(/[\r\x1b]/);
    } finally {
      f.cleanup();
    }
  });

  it("uses wget fallback with fresh partial retries and does not execute stale output", () => {
    const f = fixture({ downloader: "wget", failures: 2 });
    try {
      runBash(setupIn(f.root), `${TICKET}\n${f.artifactHash}\n`, f.env, [
        "--origin",
        "http://localhost:43123",
        "-y",
      ]);
      expect(readFileSync(f.marker, "utf8")).toBe("sentinel");
      expect(readFileSync(f.attempts, "utf8")).toBe("3");
    } finally {
      f.cleanup();
    }
  });

  it("rejects setup tampering, bad artifact bytes, HTML, empty responses, and malformed inputs", () => {
    const tampered = fixture({ setup: `${SETUP_V3_TEXT}\n# tampered\n` });
    try {
      expect(() =>
        runBash(
          rooted(
            buildCleanSetupCommand(
              "https://dashboard.example.com",
              TICKET,
              HASH
            ),
            tampered.root
          ),
          "",
          tampered.env
        )
      ).toThrow();
    } finally {
      tampered.cleanup();
    }
    for (const response of ["empty", "html"] as const) {
      const f = fixture({ response });
      try {
        expect(() =>
          runBash(setupIn(f.root), `${TICKET}\n${HASH}\n`, f.env, [
            "--origin",
            "http://localhost:43123",
            "-y",
          ])
        ).toThrow();
        expect(existsSync(f.marker)).toBe(false);
      } finally {
        f.cleanup();
      }
    }
    const badHash = fixture();
    try {
      expect(() =>
        runBash(setupIn(badHash.root), `${TICKET}\n${HASH}\n`, badHash.env, [
          "--origin",
          "http://localhost:43123",
          "-y",
        ])
      ).toThrow();
      expect(existsSync(badHash.marker)).toBe(false);
    } finally {
      badHash.cleanup();
    }
    for (const origin of [
      "http://remote.example",
      "https://dashboard.example.com/path",
      "https://dashboard.example.com:443",
      "https://user@example.com",
    ]) {
      expect(() => buildCleanSetupCommand(origin, TICKET, HASH)).toThrow();
    }
    expect(() =>
      buildCleanSetupCommand("https://dashboard.example.com:8443", TICKET, HASH)
    ).not.toThrow();
    expect(() =>
      buildCleanSetupCommand("https://dashboard.example.com", "short", HASH)
    ).toThrow();
    const f = fixture();
    try {
      expect(() =>
        runBash(
          setupIn(f.root),
          `${TICKET}\n${f.artifactHash}\nextra\n`,
          f.env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).toThrow();
      expect(existsSync(f.marker)).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  it("enforces download size bounds and propagates artifact failure into a bounded private diagnostic", () => {
    const oversized = fixture({ oversize: true });
    try {
      expect(() =>
        runBash(
          setupIn(oversized.root),
          `${TICKET}\n${HASH}\n`,
          oversized.env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).toThrow();
      expect(existsSync(oversized.marker)).toBe(false);
    } finally {
      oversized.cleanup();
    }

    const secret = "TOP_SECRET_TICKET_SHOULD_NOT_REACH_CONSOLE";
    const failed = fixture({
      artifact: `#!/usr/bin/env bash
printf '%*s%s\\n' 300000 x ${JSON.stringify(secret)}
exit 37
`,
    });
    const before = new Set(
      readdirSync(failed.root).filter(name => name.startsWith("diagnostic-"))
    );
    try {
      let error = "";
      try {
        runBash(
          setupIn(failed.root),
          `${TICKET}\n${failed.artifactHash}\n`,
          failed.env,
          ["--origin", "http://localhost:43123", "-y"]
        );
      } catch (e: any) {
        error = `${e.stderr ?? ""}${e.stdout ?? ""}`;
      }
      expect(error).toContain("exit 37");
      expect(error).toContain("Private diagnostics:");
      expect(error).not.toContain(secret);
      const created = readdirSync(failed.root).filter(
        name => name.startsWith("diagnostic-") && !before.has(name)
      );
      expect(created.length).toBeGreaterThan(0);
      const log =
        process.getuid?.() === 0
          ? readFileSync(path.join(failed.root, created.at(-1)!), "utf8")
          : execFileSync(
              "sudo",
              ["-n", "cat", path.join(failed.root, created.at(-1)!)],
              { encoding: "utf8" }
            );
      expect(log.length).toBeLessThanOrEqual(262144);
      for (const name of created)
        rmSync(path.join(failed.root, name), { force: true });
    } finally {
      failed.cleanup();
    }
  });
});

describe("v3 terminal and failed-transfer ownership", () => {
  it("shows rotating actual TTY frames and does not show installer internals", () => {
    const f = fixture({
      artifact: `#!/usr/bin/env bash\nsleep 0.8\nprintf 'SENSITIVE_SETUP_INTERNALS'\nexit 0\n`,
    });
    try {
      const script = rooted(
        buildCleanSetupCommand(
          "http://localhost:43123",
          TICKET,
          f.artifactHash
        ),
        f.root
      );
      const python = `import os,pty,select,sys,base64\npid,fd=pty.fork()\nif pid==0:\n os.execvp('sudo',['sudo','-n','env','PATH='+sys.argv[2],'bash','-c',base64.b64decode(sys.argv[1]).decode()])\nout=b''\nwhile True:\n try:\n  data=os.read(fd,4096)\n  if not data:break\n  out+=data\n except OSError:break\n_,status=os.waitpid(pid,0)\nprint(out.decode(),end='')\nsys.exit(os.waitstatus_to_exitcode(status))\n`;
      const out = execFileSync(
        "python3",
        ["-c", python, Buffer.from(script).toString("base64"), f.env.PATH!],
        { encoding: "utf8", timeout: 15000 }
      );
      expect(out).toContain("Preparing first stage |");
      expect(out).toContain("Preparing first stage /");
      expect(out).not.toContain("[i++%4]");
      expect(out).not.toContain("SENSITIVE_SETUP_INTERNALS");
      expect(out).toContain(
        "Handoff prepared / VPS will reboot; follow dashboard."
      );
    } finally {
      f.cleanup();
    }
  });
  it("never runs a setup returned by failed download even when its bytes have the correct checksum", () => {
    const f = fixture();
    try {
      const mock = `#!/usr/bin/env bash\nout='';while (($#));do case "$1" in -o|-O)out="$2";shift 2;;*)shift;;esac;done\ncat ${JSON.stringify(path.join(f.root, "setup.sh"))} > "$out";exit 22\n`;
      for (const tool of ["curl", "wget"]) {
        writeFileSync(path.join(f.root, "bin", tool), mock);
        chmodSync(path.join(f.root, "bin", tool), 0o700);
      }
      expect(() =>
        runBash(
          rooted(
            buildCleanSetupCommand(
              "http://localhost:43123",
              TICKET,
              f.artifactHash
            ),
            f.root
          ),
          "",
          f.env
        )
      ).toThrow();
      expect(existsSync(f.marker)).toBe(false);
      expect(readFileSync(f.attempts, "utf8")).toBe("0");
    } finally {
      f.cleanup();
    }
  });
});
