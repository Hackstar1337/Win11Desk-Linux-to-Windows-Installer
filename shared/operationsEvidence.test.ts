import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  RELEASE_JOURNAL_TAGS,
  matchesReleaseJournal,
  attentionState,
  sourceEvidence,
} from "./operationsEvidence";
describe("Operations evidence never invents health", () => {
  it("matches complete release journal and rejects omissions, duplicates and extras", () => {
    expect(matchesReleaseJournal([...RELEASE_JOURNAL_TAGS])).toBe(true);
    expect(matchesReleaseJournal(RELEASE_JOURNAL_TAGS.slice(1))).toBe(false);
    expect(matchesReleaseJournal([...RELEASE_JOURNAL_TAGS, "extra"])).toBe(
      false
    );
    expect(
      matchesReleaseJournal([
        RELEASE_JOURNAL_TAGS[0],
        RELEASE_JOURNAL_TAGS[0],
        RELEASE_JOURNAL_TAGS[2],
      ])
    ).toBe(false);
    expect(matchesReleaseJournal([])).toBe(false);
  });
  it("separates failed, known active stale and unknown evidence", () => {
    expect(attentionState("failed")).toBe("failed");
    expect(attentionState("downloading")).toBe("stale");
    for (const stage of [null, undefined, "invalid", "windows_ready"])
      expect(attentionState(stage)).toBe("unknown");
  });
  it("inspection failure is unknown, read digest mismatch is error", () => {
    expect(sourceEvidence(null, "expected")).toBe("unknown");
    expect(sourceEvidence("bad", "expected")).toBe("error");
    expect(sourceEvidence("expected", "expected")).toBe("ok");
  });
  it("records failed attempts after successful encrypted archive checks without claiming restore", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-manifest-"));
    try {
      mkdirSync(join(root, "deploy"));
      copyFileSync(
        "deploy/write-backup-status.py",
        join(root, "deploy/write-backup-status.py")
      );
      const archive = join(root, "archive.sql.enc");
      writeFileSync(archive, "synthetic encrypted fixture");
      writeFileSync(
        archive + ".sha256",
        createHash("sha256")
          .update("synthetic encrypted fixture")
          .digest("hex") + "  file\n"
      );
      const run = (arg: string) =>
        spawnSync(
          "python3",
          [join(root, "deploy/write-backup-status.py"), arg],
          { encoding: "utf8" }
        );
      expect(run(archive).status).toBe(0);
      const read = () =>
        JSON.parse(
          readFileSync(join(root, "operations-status/backup.json"), "utf8")
        );
      expect(read().outcome).toBe("success");
      expect(read().lastRestoreVerifiedAt).toBe(null);
      expect(run("--failed").status).toBe(0);
      expect(read().outcome).toBe("failed");
      writeFileSync(archive, "changed");
      expect(run(archive).status).not.toBe(0);
      expect(read().checksumVerified).toBe(false);
      expect(JSON.stringify(read())).not.toContain("archive.sql.enc");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
