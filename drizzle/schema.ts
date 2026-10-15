import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const installerTickets = mysqlTable("installerTickets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  secretHash: varchar("secretHash", { length: 64 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: varchar("iv", { length: 32 }).notNull(),
  tag: varchar("tag", { length: 32 }).notNull(),
  scriptHash: varchar("scriptHash", { length: 64 }).notNull(),
  downloads: int("downloads").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

const installerTrackingErrorStages = [
  "starting",
  "preflight",
  "staging",
  "rebooting",
  "installer_booted",
  "downloading",
  "media_verified",
  "preparing",
  "windows_setup",
  "windows_booted",
  "windows_ready",
] as const;

/** One private, expiring capability namespace per generated installer command. */
export const installerTrackingGroups = mysqlTable("installerTrackingGroups", {
  id: varchar("id", { length: 36 }).primaryKey(),
  readTokenHash: varchar("readTokenHash", { length: 64 }).notNull(),
  writeTokenHash: varchar("writeTokenHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

/** One execution/report capability under a generation group. */
export const installerTrackingRuns = mysqlTable("installerTrackingRuns", {
  id: varchar("id", { length: 36 }).primaryKey(),
  groupId: varchar("groupId", { length: 36 }).notNull(),
  reportTokenHash: varchar("reportTokenHash", { length: 64 }).notNull(),
  hostname: varchar("hostname", { length: 253 }).notNull(),
  wholeDisk: varchar("wholeDisk", { length: 128 }).notNull(),
  rdpPort: int("rdpPort").notNull(),
  publicIP: varchar("publicIP", { length: 45 }),
  windowsEdition: varchar("windowsEdition", { length: 64 }),
  windowsBuild: int("windowsBuild"),
  rdpListening: boolean("rdpListening"),
  stage: varchar("stage", { length: 32 }).default("starting").notNull(),
  sequence: int("sequence").default(0).notNull(),
  errorStage: mysqlEnum("errorStage", installerTrackingErrorStages),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});
