import { Pool } from "pg";

const globalForPg = globalThis as unknown as {
  pool: Pool | undefined;
};

const rawConnectionString = process.env.DATABASE_URL || "";
const connectionString = rawConnectionString.replace(
  /sslmode=(prefer|require|verify-ca)\b/g,
  "sslmode=verify-full"
);

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pool = pool;
}