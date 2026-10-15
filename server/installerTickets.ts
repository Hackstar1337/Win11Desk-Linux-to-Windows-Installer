import { and, eq, gt, lt, sql } from "drizzle-orm";
import { installerTickets, users } from "../drizzle/schema";
import { getDb } from "./db";
import {
  parseTicket,
  sealInstaller,
  ticketDownloadLimit,
  unsealInstaller,
} from "./installerTicketCrypto";

export async function createInstallerTicket(script: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // Delete only expired delivery ciphertext, never user/job records. Done on requests, not a fake background scheduler.
  await db
    .delete(installerTickets)
    .where(lt(installerTickets.expiresAt, new Date()));
  return db.transaction(async tx => {
    const owner = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!owner.length) throw new Error("Authenticated user required");
    const active = await tx
      .select({ id: installerTickets.id })
      .from(installerTickets)
      .where(
        and(
          eq(installerTickets.userId, userId),
          gt(installerTickets.expiresAt, new Date())
        )
      );
    if (active.length >= 10)
      throw new Error(
        "Too many active commands. Revoke an old command or wait for expiry."
      );
    const ticket = sealInstaller(script, userId);
    await tx.insert(installerTickets).values(ticket.row);
    return ticket;
  });
}
export async function retrieveInstallerTicket(token: string) {
  const parsed = parseTicket(token);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(installerTickets)
      .where(eq(installerTickets.id, parsed.id))
      .limit(1)
      .for("update");
    const row = rows[0];
    if (!row) throw new Error("Ticket unavailable");
    const script = unsealInstaller(row, token);
    await tx
      .update(installerTickets)
      .set({ downloads: sql`${installerTickets.downloads} + 1` })
      .where(
        and(
          eq(installerTickets.id, row.id),
          lt(installerTickets.downloads, ticketDownloadLimit)
        )
      );
    return script;
  });
}
export async function revokeInstallerTicket(id: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .delete(installerTickets)
    .where(
      and(eq(installerTickets.id, id), eq(installerTickets.userId, userId))
    );
}
