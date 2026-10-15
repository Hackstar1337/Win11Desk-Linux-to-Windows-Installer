import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock("./db", () => ({ rows: mocks.rows }));
import { createLaunchV2Handler, parseLaunchTicket } from "./launchV2";
import { SETUP_V2_SHA256 } from "./launcherV2";
const TICKET = "a".repeat(64);
const ID = "123e4567-e89b-12d3-a456-426614174000";
function response() {
  const res: any = { headersSent: false };
  res.set = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}
const saved = {
  id: ID,
  config_json: { launcher: { version: "v2", sha256: SETUP_V2_SHA256 } },
};
beforeEach(() => mocks.rows.mockReset());

describe("ticket-only immutable launch v2", () => {
  it("accepts only a bounded ticket and normalizes case without settings or identities", () => {
    expect(parseLaunchTicket({ ticket: TICKET.toUpperCase() })).toBe(TICKET);
    for (const body of [
      null,
      [],
      {},
      { token: TICKET },
      { ticket: "short" },
      { ticket: "g".repeat(64) },
      { ticket: TICKET, id: ID },
      { ticket: TICKET, isoUrl: "https://private.example/secret.iso" },
      { ticket: TICKET, password: "never echo" },
    ]) {
      expect(parseLaunchTicket(body)).toBeNull();
    }
  });
  it("uses the existing indexed hash and delegates canonical identity to unchanged checks", async () => {
    mocks.rows.mockResolvedValue([saved]);
    const original = { ticket: TICKET.toUpperCase() };
    const req = { body: original, query: {} } as Request;
    const res = response();
    const deliver = vi.fn(async (r: Request) => {
      expect(r.body).toEqual({ id: ID, token: TICKET });
      return "served";
    });
    expect(await createLaunchV2Handler(deliver)(req, res)).toBe("served");
    expect(req.body).toBe(original);
    expect(mocks.rows).toHaveBeenCalledWith(
      expect.stringContaining("WHERE delivery_hash=? LIMIT 2"),
      [createHash("sha256").update(TICKET).digest("hex")]
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ "Cache-Control": "private, no-store" })
    );
  });
  it("rejects query/settings/identity overrides before SQL or delivery", async () => {
    const deliver = vi.fn();
    for (const req of [
      { body: { ticket: TICKET, profileId: ID }, query: {} },
      { body: { ticket: TICKET }, query: { ticket: TICKET } },
    ]) {
      const res = response();
      await createLaunchV2Handler(deliver)(req as any, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(JSON.stringify((res.json as any).mock.calls)).not.toContain(
        TICKET
      );
    }
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  it("fails closed for unknown/ambiguous/corrupt/legacy/tampered versions", async () => {
    const deliver = vi.fn();
    for (const records of [
      [],
      [saved, saved],
      [{ ...saved, config_json: "{" }],
      [
        {
          ...saved,
          config_json: { launcher: { version: "v1", sha256: SETUP_V2_SHA256 } },
        },
      ],
      [
        {
          ...saved,
          config_json: { launcher: { version: "v2", sha256: "b".repeat(64) } },
        },
      ],
    ]) {
      mocks.rows.mockResolvedValue(records);
      const res = response();
      await createLaunchV2Handler(deliver)(
        { body: { ticket: TICKET }, query: {} } as Request,
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(JSON.stringify((res.json as any).mock.calls)).not.toContain(
        TICKET
      );
    }
    expect(deliver).not.toHaveBeenCalled();
  });
  it("database/delivery errors never reflect secrets and restore the original request", async () => {
    mocks.rows.mockRejectedValueOnce(new Error(TICKET));
    const req = { body: { ticket: TICKET }, query: {} } as Request;
    const res = response();
    await createLaunchV2Handler(vi.fn())(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify((res.json as any).mock.calls)).not.toContain(TICKET);
    mocks.rows.mockResolvedValue([saved]);
    const body = req.body;
    const second = response();
    await createLaunchV2Handler(async () => {
      throw Error(TICKET);
    })(req, second);
    expect(req.body).toBe(body);
    expect(second.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify((second.json as any).mock.calls)).not.toContain(
      TICKET
    );
  });
});
