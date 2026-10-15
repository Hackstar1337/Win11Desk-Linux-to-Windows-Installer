import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ rows: vi.fn(), exec: vi.fn(), transaction: vi.fn() }));
import { rows } from "./db";
import { getRunProfile } from "./profiles";
const run = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  id: "00000000-0000-4000-8000-000000000011",
  revision: 2,
  name: "Windows 11 Pro",
  osId: "windows-11-pro",
  isoUrl: "https://example.test/win.iso",
  imageName: "Windows 11 Pro",
  description: "",
  username: "Administrator",
  remotePort: 22,
  retries: 10,
};
const record = {
  id: snapshot.id,
  profile_revision: 2,
  snapshot_json: JSON.stringify(snapshot),
  config_json: JSON.stringify({
    profile: snapshot,
    launcher: { version: "v1" },
  }),
};
describe("issued profile proof isolation", () => {
  beforeEach(() => vi.mocked(rows).mockReset());
  it("uses exact issued snapshot despite edits to the live profile", async () => {
    vi.mocked(rows).mockResolvedValue([record]);
    expect(await getRunProfile(run)).toEqual(snapshot);
  });
  it("preserves genuinely legacy and unlinked proof behavior", async () => {
    vi.mocked(rows).mockResolvedValue([
      {
        id: null,
        profile_revision: null,
        snapshot_json: null,
        config_json: { username: "Administrator" },
      },
    ]);
    expect(await getRunProfile(run)).toBeNull();
    vi.mocked(rows).mockResolvedValue([]);
    expect(await getRunProfile(run)).toBeNull();
  });
  it("fails closed when a modern launcher has lost its profile linkage", async () => {
    vi.mocked(rows).mockResolvedValue([
      { ...record, id: null, profile_revision: null, snapshot_json: null },
    ]);
    await expect(getRunProfile(run)).rejects.toMatchObject({
      code: "PROFILE_SNAPSHOT_UNAVAILABLE",
      status: 422,
    });
  });
  it("also protects first-generation profile commands without the compact launcher marker", async () => {
    vi.mocked(rows).mockResolvedValue([
      {
        ...record,
        id: null,
        snapshot_json: null,
        config_json: { profile: snapshot },
      },
    ]);
    await expect(getRunProfile(run)).rejects.toMatchObject({
      code: "PROFILE_SNAPSHOT_UNAVAILABLE",
    });
  });
  it("rejects a malformed linked snapshot instead of accepting generic Professional proof", async () => {
    vi.mocked(rows).mockResolvedValue([
      { ...record, snapshot_json: { ...snapshot, osId: "unsupported" } },
    ]);
    await expect(getRunProfile(run)).rejects.toMatchObject({
      code: "PROFILE_SNAPSHOT_UNAVAILABLE",
    });
  });
  it("rejects mismatched snapshot identity/revision and invalid runtime defaults", async () => {
    for (const bad of [
      { ...snapshot, revision: 3 },
      { ...snapshot, id: "33333333-3333-4333-8333-333333333333" },
      { ...snapshot, username: "Admin." },
    ]) {
      vi.mocked(rows).mockResolvedValue([{ ...record, snapshot_json: bad }]);
      await expect(getRunProfile(run)).rejects.toMatchObject({
        code: "PROFILE_SNAPSHOT_UNAVAILABLE",
      });
    }
  });
});
