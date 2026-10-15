import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
} from "mysql2/promise";
let shared: Pool | undefined;
export function pool() {
  if (!shared) {
    if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const u = new URL(process.env.DATABASE_URL);
    shared = mysql.createPool({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
      connectionLimit: 8,
      timezone: "Z",
      dateStrings: true,
      supportBigNumbers: true,
      ...(process.env.DATABASE_TLS === "1"
        ? { ssl: { rejectUnauthorized: true } }
        : {}),
    });
  }
  return shared;
}
export async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [r] = await pool().query(sql, params);
  return r as T[];
}
export async function exec(
  sql: string,
  params: unknown[] = []
): Promise<ResultSetHeader> {
  const [r] = await pool().execute(sql, params);
  return r as ResultSetHeader;
}
export async function transaction<T>(
  fn: (c: PoolConnection) => Promise<T>
): Promise<T> {
  const c = await pool().getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export type { PoolConnection };
