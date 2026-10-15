import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETUP_V2_SHA256,
  SETUP_V2_TEXT,
  SETUP_V2_VERSION,
  buildPrivateSetupCommand,
  registerSetupV2Routes,
} from "../server/control/launcherV2";

const TICKET = "a".repeat(64);
const HASH = "b".repeat(64);

function bash(
  script: string,
  input = "",
  env: NodeJS.ProcessEnv = process.env,
  args: string[] = []
) {
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

function readRootFile(file: string): string {
  if (process.getuid?.() === 0) return readFileSync(file, "utf8");
  return execFileSync("sudo", ["-n", "cat", file], { encoding: "utf8" });
}

function fixture(
  options: {
    downloader: "curl" | "wget" | "both";
    setup?: string;
    artifact?: string;
    failures?: number;
    response?: "empty" | "html";
    oversizeStage?: "setup" | "artifact";
  } = { downloader: "curl" }
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "win11desk-launcher-v2-"));
  chmodSync(root, 0o777);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const marker = path.join(root, "installed");
  const body = path.join(root, "body");
  const attempts = path.join(root, "attempts");
  const size = path.join(root, "oversized-bytes");
  const argv = path.join(root, "downloader-argv");
  writeFileSync(size, "0");
  writeFileSync(argv, "");
  writeFileSync(attempts, "0");
  const artifact =
    options.artifact ??
    `#!/usr/bin/env bash\nprintf sentinel > ${JSON.stringify(marker)}\nchmod 644 ${JSON.stringify(marker)}\n`;
  const setup = options.setup ?? SETUP_V2_TEXT;
  const setupFile = path.join(root, "setup.sh");
  const artifactFile = path.join(root, "artifact.sh");
  writeFileSync(setupFile, setup);
  writeFileSync(artifactFile, artifact);
  writeFileSync(body, "");
  const mock = `#!/usr/bin/env bash
set -euo pipefail
out=''; post=''; url="\${!#}"
printf '%s\\n' "$@" > ${JSON.stringify(argv)}
while (($#)); do
  case "$1" in
    -o|-O) out="$2"; shift 2 ;;
    --post-file=*) post="\${1#--post-file=}"; shift ;;
    --data-binary) [[ "\${2:-}" == '@-' ]] && post='STDIN'; shift 2 ;;
    *) shift ;;
  esac
done
if { [[ ${JSON.stringify(options.oversizeStage ?? "")} == artifact && "$url" == */api/installer/launch/v2 ]] || [[ ${JSON.stringify(options.oversizeStage ?? "")} == setup && "$url" == */setup/v2.sh ]]; }; then
  set +e; head -c 6291456 /dev/zero > "$out"; code=$?; set -e
  wc -c < "$out" > ${JSON.stringify(size)}; exit "$code"
fi
if [[ "$url" == */api/installer/launch/v2 ]]; then
  n=$(cat ${JSON.stringify(attempts)}); n=$((n+1)); printf '%s' "$n" > ${JSON.stringify(attempts)}
  if ((n <= ${options.failures ?? 0})); then [[ -n "$out" ]] && printf '%s' stale > "$out"; exit 22; fi
  if [[ "$post" == STDIN ]]; then cat > ${JSON.stringify(body)}; else cat "$post" > ${JSON.stringify(body)}; fi
  [[ -n "$out" ]] && { if [[ ${JSON.stringify(options.response ?? "")} == 'empty' ]]; then : > "$out"; elif [[ ${JSON.stringify(options.response ?? "")} == 'html' ]]; then printf '<!doctype html><html>error</html>' > "$out"; else cat ${JSON.stringify(artifactFile)} > "$out"; fi; }
elif [[ "$url" == */setup/${SETUP_V2_VERSION}.sh ]]; then
  [[ -n "$out" ]] && cat ${JSON.stringify(setupFile)} > "$out"
else
  exit 22
fi
`;
  const install = (name: string, content: string) => {
    const file = path.join(bin, name);
    writeFileSync(file, content);
    chmodSync(file, 0o700);
  };
  const unavailable = "#!/usr/bin/env bash\nexit 127\n";
  if (options.downloader !== "wget") install("curl", mock);
  else install("curl", unavailable);
  if (options.downloader !== "curl") install("wget", mock);
  else install("wget", unavailable);
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
  return {
    root,
    bin,
    env,
    marker,
    body,
    attempts,
    size,
    argv,
    artifactHash: createHash("sha256").update(artifact).digest("hex"),
    setupHash: createHash("sha256").update(setup).digest("hex"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function commandInFixture(command: string, root: string) {
  return command
    .replaceAll("/root/win11desk-bootstrap-v2.", `${root}/bootstrap-`)
    .replaceAll("/root/win11desk-launcher-v2.", `${root}/launcher-`);
}

function setupInFixture(root: string) {
  return SETUP_V2_TEXT.replaceAll(
    "/root/win11desk-launcher-v2.",
    `${root}/launcher-`
  );
}

describe("setup launcher v2", () => {
  it("pins valid Bash bytes and serves immutable text with the v2 contract", async () => {
    expect(createHash("sha256").update(SETUP_V2_TEXT).digest("hex")).toBe(
      SETUP_V2_SHA256
    );
    expect(SETUP_V2_TEXT).toContain("/api/installer/launch/v2");
    expect(SETUP_V2_TEXT).toContain("--data-binary @-");
    expect(SETUP_V2_TEXT).toContain("--post-file=");
    expect(SETUP_V2_TEXT).not.toContain("resolv.conf");
    expect(SETUP_V2_TEXT).not.toContain("--location");
    execFileSync("bash", ["-n"], { input: SETUP_V2_TEXT });

    const routes: Record<string, Function> = {};
    registerSetupV2Routes({
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
        expect(value).toBe(SETUP_V2_TEXT);
        return this;
      },
    };
    routes["/setup/v2.sh"]({}, res);
    expect(headers["Cache-Control"]).toContain("immutable");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers.ETag).toBe(`"${SETUP_V2_SHA256}"`);
  });

  it("runs the complete generated command with curl stdin POST and normalized secrets", () => {
    const f = fixture();
    try {
      const command = buildPrivateSetupCommand(
        "http://localhost:43123",
        TICKET.toUpperCase(),
        f.artifactHash.toUpperCase()
      );
      expect(command).not.toContain("profile");
      expect(command).not.toContain("username");
      expect(command).not.toContain("password");
      expect(command).not.toContain("?ticket=");
      expect(command.trimEnd().split("\n").length).toBeLessThanOrEqual(12);
      execFileSync("bash", ["-n"], { input: command });
      bash(commandInFixture(command, f.root), "", f.env);
      expect(readRootFile(f.marker)).toBe("sentinel");
      expect(readFileSync(f.body, "utf8")).toBe(`{"ticket":"${TICKET}"}`);
      expect(readFileSync(f.argv, "utf8")).not.toContain(TICKET);
    } finally {
      f.cleanup();
    }
  });

  it("uses wget fallback, retries fresh partials, and does not execute stale output", () => {
    const f = fixture({ downloader: "wget", failures: 2 });
    try {
      const setup = setupInFixture(f.root);
      bash(setup, `${TICKET}\n${f.artifactHash}\n`, f.env, [
        "--origin",
        "http://localhost:43123",
        "-y",
      ]);
      expect(readRootFile(f.marker)).toBe("sentinel");
      expect(readFileSync(f.attempts, "utf8")).toBe("3");
    } finally {
      f.cleanup();
    }
    const bad = fixture({ downloader: "curl", response: "empty" });
    try {
      expect(() =>
        bash(setupInFixture(bad.root), `${TICKET}\n${HASH}\n`, bad.env, [
          "--origin",
          "http://localhost:43123",
          "-y",
        ])
      ).toThrow();
      expect(existsSync(bad.marker)).toBe(false);
    } finally {
      bad.cleanup();
    }
  });

  it("rejects tampered setup, wrong artifact digest, HTML, malformed input, and extra arguments", () => {
    const tampered = fixture({
      downloader: "curl",
      setup: `${SETUP_V2_TEXT}\n# tampered\n`,
    });
    try {
      const command = commandInFixture(
        buildPrivateSetupCommand("https://dashboard.example.com", TICKET, HASH),
        tampered.root
      );
      expect(() => bash(command, "", tampered.env)).toThrow();
    } finally {
      tampered.cleanup();
    }
    for (const response of ["html"] as const) {
      const f = fixture({ downloader: "curl", response });
      try {
        expect(() =>
          bash(setupInFixture(f.root), `${TICKET}\n${f.artifactHash}\n`, f.env)
        ).toThrow();
        expect(existsSync(f.marker)).toBe(false);
      } finally {
        f.cleanup();
      }
    }
    expect(() =>
      buildPrivateSetupCommand("http://remote.example", TICKET, HASH)
    ).toThrow();
    expect(() =>
      buildPrivateSetupCommand(
        "https://dashboard.example.com/path",
        TICKET,
        HASH
      )
    ).toThrow();
    expect(() =>
      buildPrivateSetupCommand(
        "https://dashboard.example.com:443",
        TICKET,
        HASH
      )
    ).toThrow();
    expect(() =>
      buildPrivateSetupCommand(
        "https://dashboard.example.com:8443",
        TICKET,
        HASH
      )
    ).not.toThrow();
    expect(() =>
      buildPrivateSetupCommand("https://user@example.com", TICKET, HASH)
    ).toThrow();
    expect(() =>
      buildPrivateSetupCommand("https://dashboard.example.com", "short", HASH)
    ).toThrow();

    const f = fixture();
    try {
      expect(() =>
        bash(
          setupInFixture(f.root) + "\n# ignored",
          `${TICKET}\n${f.artifactHash}\n`,
          f.env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).not.toThrow();
      expect(() =>
        bash(
          setupInFixture(f.root),
          `${TICKET}\n${f.artifactHash}\nextra\n`,
          f.env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).toThrow();
      expect(() =>
        bash(setupInFixture(f.root), `${TICKET}\n${f.artifactHash}\n`, f.env, [
          "--origin",
          "http://localhost:43123",
          "-y",
        ]).toString()
      ).not.toContain(TICKET);
    } finally {
      f.cleanup();
    }
  });

  it("enforces the wget file-size cap during both downloads, not after oversized writes", () => {
    for (const stage of ["setup", "artifact"] as const) {
      const f = fixture({ downloader: "wget", oversizeStage: stage });
      try {
        if (stage === "setup") {
          const command = commandInFixture(
            buildPrivateSetupCommand(
              "https://dashboard.example.com",
              TICKET,
              f.artifactHash
            ),
            f.root
          );
          expect(() => bash(command, "", f.env)).toThrow();
        } else {
          expect(() =>
            bash(
              setupInFixture(f.root),
              `${TICKET}\n${f.artifactHash}\n`,
              f.env,
              ["--origin", "https://dashboard.example.com", "-y"]
            )
          ).toThrow();
        }
        expect(Number(readFileSync(f.size, "utf8"))).toBeGreaterThan(0);
        expect(Number(readFileSync(f.size, "utf8"))).toBeLessThanOrEqual(
          4194304
        );
        expect(existsSync(f.marker)).toBe(false);
        expect(readFileSync(f.argv, "utf8")).not.toContain(TICKET);
      } finally {
        f.cleanup();
      }
    }
  });

  it("reaches artifact digest and HTML rejection with valid arguments and never runs failed partials", () => {
    const html = "<!doctype html><html>error</html>";
    for (const options of [
      { downloader: "curl" as const },
      {
        downloader: "curl" as const,
        response: "html" as const,
        artifact: html,
      },
      { downloader: "wget" as const, failures: 10 },
    ]) {
      const f = fixture(options);
      try {
        const hash = options.response === "html" ? f.artifactHash : HASH;
        expect(() =>
          bash(setupInFixture(f.root), `${TICKET}\n${hash}\n`, f.env, [
            "--origin",
            "https://dashboard.example.com",
            "-y",
          ])
        ).toThrow();
        expect(existsSync(f.marker)).toBe(false);
        if (options.failures)
          expect(readFileSync(f.attempts, "utf8")).toBe("3");
        expect(readFileSync(f.argv, "utf8")).not.toContain(TICKET);
      } finally {
        f.cleanup();
      }
    }
  });

  it("fails closed when no downloader exists and when wget has no bounded timeout", () => {
    const missing = fixture({ downloader: "curl" });
    try {
      const required = path.join(missing.root, "required");
      mkdirSync(required);
      for (const tool of [
        "mktemp",
        "sha256sum",
        "wc",
        "rm",
        "mv",
        "chmod",
        "head",
        "sleep",
        "bash",
      ])
        symlinkSync(`/usr/bin/${tool}`, path.join(required, tool));
      const env = { ...missing.env, PATH: required };
      expect(() =>
        bash(
          setupInFixture(missing.root),
          `${TICKET}\n${missing.artifactHash}\n`,
          env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).toThrow();
    } finally {
      missing.cleanup();
    }
    const unbounded = fixture({ downloader: "wget" });
    try {
      const required = path.join(unbounded.root, "required");
      mkdirSync(required);
      for (const tool of [
        "mktemp",
        "sha256sum",
        "wc",
        "rm",
        "mv",
        "chmod",
        "head",
        "sleep",
        "bash",
        "wget",
      ])
        symlinkSync(
          tool === "wget" ? path.join(unbounded.bin, tool) : `/usr/bin/${tool}`,
          path.join(required, tool)
        );
      const env = { ...unbounded.env, PATH: required };
      expect(() =>
        bash(
          setupInFixture(unbounded.root),
          `${TICKET}\n${unbounded.artifactHash}\n`,
          env,
          ["--origin", "http://localhost:43123", "-y"]
        )
      ).toThrow();
    } finally {
      unbounded.cleanup();
    }
  });
});
