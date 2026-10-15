import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {
  LAUNCHER_SHA256,
  LAUNCHER_TEXT,
  LAUNCHER_VERSION,
  buildCompactDeliveryCommand,
} from "../server/control/launcher";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const PROFILE_ID = "123e4567-e89b-12d3-a456-426614174001";
const TOKEN = "a".repeat(64);
const ARTIFACT_HASH = "b".repeat(64);

function rootBash(script: string, input: string, env: NodeJS.ProcessEnv) {
  const args = ["bash", "-c", script];
  if (process.getuid?.() !== 0)
    return execFileSync("sudo", ["-n", "env", `PATH=${env.PATH}`, ...args], {
      input,
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  return execFileSync("bash", ["-c", script], {
    input,
    env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function fixture(options: {
  downloader: "curl" | "wget" | "both";
  launcher?: string;
  artifact?: string;
  failCount?: number;
}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "win11desk-launcher-test-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const launcherFile = path.join(root, "launcher.sh");
  const artifactFile = path.join(root, "artifact.sh");
  const bodyFile = path.join(root, "body.json");
  const attemptsFile = path.join(root, "attempts");
  const marker = path.join(root, "marker");
  writeFileSync(launcherFile, options.launcher ?? LAUNCHER_TEXT);
  writeFileSync(
    artifactFile,
    options.artifact ??
      `#!/usr/bin/env bash\nprintf '%s' sentinel > ${marker}\nchmod 644 ${marker}\n`
  );
  writeFileSync(bodyFile, "");
  writeFileSync(attemptsFile, "0");
  const mock = `#!/usr/bin/env bash
set -euo pipefail
out=''; post=''; url="\${!#}"
while (($#)); do
  case "$1" in
    -o|-O) out="$2"; shift 2 ;;
    --post-file=*) post="\${1#--post-file=}"; shift ;;
    --data-binary) shift ;;
    *) shift ;;
  esac
done
if [[ "${options.failCount ?? 0}" -gt 0 ]]; then
  n=$(cat ${JSON.stringify(attemptsFile)}); n=$((n+1)); printf '%s' "$n" > ${JSON.stringify(attemptsFile)}
  if ((n <= ${options.failCount ?? 0})); then [[ -n "$out" ]] && printf '%s' stale > "$out"; exit 22; fi
fi
if [[ -n "${JSON.stringify(bodyFile)}" && "$url" == */api/installer/delivery ]]; then if [[ -n "$post" ]]; then cat "$post" > ${JSON.stringify(bodyFile)}; else cat > ${JSON.stringify(bodyFile)}; fi; fi
[[ -n "$out" ]] || exit 22
if [[ "$url" == */api/installer/launcher/${LAUNCHER_VERSION}.sh ]]; then cat ${JSON.stringify(launcherFile)} > "$out"; else cat ${JSON.stringify(artifactFile)} > "$out"; fi
`;
  const writeMock = (name: string) => {
    writeFileSync(path.join(bin, name), mock);
    chmodSync(path.join(bin, name), 0o700);
  };
  if (options.downloader !== "wget") writeMock("curl");
  else {
    writeFileSync(path.join(bin, "curl"), "#!/usr/bin/env bash\nexit 127\n");
    chmodSync(path.join(bin, "curl"), 0o700);
  }
  if (options.downloader !== "curl") writeMock("wget");
  else {
    writeFileSync(path.join(bin, "wget"), "#!/usr/bin/env bash\nexit 127\n");
    chmodSync(path.join(bin, "wget"), 0o700);
  }
  const artifactHash = createHash("sha256")
    .update(readFileSync(artifactFile))
    .digest("hex");
  return {
    root,
    bin,
    launcherFile,
    artifactFile,
    bodyFile,
    marker,
    attemptsFile,
    artifactHash,
  };
}

function inputFor(artifactHash = ARTIFACT_HASH) {
  return `${"http://localhost:43123"}\n${ID}\n${TOKEN}\n${artifactHash}\n${PROFILE_ID}\n7\n`;
}

function launcherForTest(text = LAUNCHER_TEXT, root: string) {
  return text.replaceAll("/root/win11desk-launcher.", `${root}/launcher-`);
}

function commandForTest(command: string, root: string) {
  return command
    .replaceAll("/root/win11desk-bootstrap.", `${root}/bootstrap-`)
    .replaceAll("/root/win11desk-launcher.", `${root}/launcher-`);
}

describe("first-party launcher", () => {
  it("is pinned, parses as Bash, and generates a strict HTTPS-only compact command", () => {
    expect(createHash("sha256").update(LAUNCHER_TEXT).digest("hex")).toBe(
      LAUNCHER_SHA256
    );
    expect(LAUNCHER_TEXT).toContain("set +x");
    expect(LAUNCHER_TEXT).toContain("--data-binary @-");
    expect(LAUNCHER_TEXT).not.toContain("Bearer");
    expect(LAUNCHER_TEXT).not.toContain("resolv.conf");
    execFileSync("bash", ["-n"], { input: LAUNCHER_TEXT });

    const command = buildCompactDeliveryCommand(
      "https://dashboard.example.com",
      ID,
      TOKEN,
      ARTIFACT_HASH,
      PROFILE_ID,
      7
    );
    expect(command).toContain(`/api/installer/launcher/${LAUNCHER_VERSION}.sh`);
    expect(command).toContain(LAUNCHER_SHA256);
    expect(command).not.toContain("?token=");
    expect(command).not.toContain("password");
    execFileSync("bash", ["-n"], { input: command });
    expect(() =>
      buildCompactDeliveryCommand(
        "http://attacker.example",
        ID,
        TOKEN,
        ARTIFACT_HASH,
        PROFILE_ID,
        7
      )
    ).toThrow();
    expect(() =>
      buildCompactDeliveryCommand(
        "https://dashboard.example.com/path",
        ID,
        TOKEN,
        ARTIFACT_HASH,
        PROFILE_ID,
        7
      )
    ).toThrow();
  });

  it("uses curl stdin transport, validates the artifact, and executes no stale file", () => {
    const f = fixture({ downloader: "curl" });
    try {
      const script = launcherForTest(LAUNCHER_TEXT, f.root);
      const env = {
        ...process.env,
        PATH: `${f.bin}:/usr/bin:/bin`,
      };
      const output = rootBash(script, inputFor(f.artifactHash), env);
      expect(output).toBe("");
      expect(readFileSync(f.marker, "utf8")).toBe("sentinel");
      expect(readFileSync(f.bodyFile, "utf8")).toBe(
        JSON.stringify({
          id: ID,
          token: TOKEN,
          profileId: PROFILE_ID,
          profileRevision: 7,
        })
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("falls back to wget, retries bounded failures, and rejects tampering or empty payloads", () => {
    const f = fixture({ downloader: "wget", failCount: 2 });
    try {
      const env = { ...process.env, PATH: `${f.bin}:/usr/bin:/bin` };
      rootBash(
        launcherForTest(LAUNCHER_TEXT, f.root),
        inputFor(f.artifactHash),
        env
      );
      expect(readFileSync(f.marker, "utf8")).toBe("sentinel");
      expect(readFileSync(f.attemptsFile, "utf8")).toBe("3");
      expect(JSON.parse(readFileSync(f.bodyFile, "utf8")).token).toBe(TOKEN);

      const bad = fixture({ downloader: "curl", artifact: "printf bad\n" });
      try {
        expect(() =>
          rootBash(
            launcherForTest(LAUNCHER_TEXT, bad.root),
            inputFor(ARTIFACT_HASH),
            { ...env, PATH: `${bad.bin}:/usr/bin:/bin` }
          )
        ).toThrow();
        expect(() => readFileSync(bad.marker)).toThrow();
      } finally {
        rmSync(bad.root, { recursive: true, force: true });
      }

      const empty = fixture({ downloader: "curl", artifact: "" });
      try {
        expect(() =>
          rootBash(launcherForTest(LAUNCHER_TEXT, empty.root), inputFor(), {
            ...env,
            PATH: `${empty.bin}:/usr/bin:/bin`,
          })
        ).toThrow();
      } finally {
        rmSync(empty.root, { recursive: true, force: true });
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("transports the pinned launcher before the artifact and blocks a tampered launcher", () => {
    const f = fixture({ downloader: "curl" });
    try {
      const mktemp = path.join(f.bin, "mktemp");
      writeFileSync(
        mktemp,
        `#!/usr/bin/env bash
set -euo pipefail
template="\${2:-\$1}"
name="\${template##*/}"
name="\${name/XXXXXX/\$RANDOM}"
dir=${JSON.stringify(f.root)}
mkdir -p "\$dir/\$name"
printf '%s\\n' "\$dir/\$name"
`
      );
      chmodSync(mktemp, 0o700);
      const env = { ...process.env, PATH: `${f.bin}:/usr/bin:/bin` };
      const command = commandForTest(
        buildCompactDeliveryCommand(
          "http://localhost:43123",
          ID,
          TOKEN,
          f.artifactHash,
          PROFILE_ID,
          7
        ),
        f.root
      );
      rootBash(command, "", env);
      expect(readFileSync(f.marker, "utf8")).toBe("sentinel");

      const tampered = fixture({
        downloader: "curl",
        launcher: `${LAUNCHER_TEXT}# tampered\n`,
      });
      try {
        const tamperedEnv = {
          ...process.env,
          PATH: `${tampered.bin}:/usr/bin:/bin`,
        };
        expect(() =>
          rootBash(commandForTest(command, tampered.root), "", tamperedEnv)
        ).toThrow();
        expect(() => readFileSync(tampered.marker)).toThrow();
      } finally {
        rmSync(tampered.root, { recursive: true, force: true });
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("rejects malformed or extra stdin fields before any downloader runs", () => {
    const f = fixture({ downloader: "curl" });
    try {
      const env = { ...process.env, PATH: `${f.bin}:/usr/bin:/bin` };
      for (const input of [
        inputFor().replace(ID, "not-a-uuid"),
        inputFor() + "extra\n",
        inputFor().replace("\n7\n", "\n0\n"),
        inputFor().replace(TOKEN, "short"),
      ]) {
        expect(() =>
          rootBash(launcherForTest(LAUNCHER_TEXT, f.root), input, env)
        ).toThrow();
      }
      expect(readFileSync(f.bodyFile, "utf8")).toBe("");
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
