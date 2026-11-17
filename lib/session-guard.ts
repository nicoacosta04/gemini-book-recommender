import { headers } from "next/headers";
import { auth } from "./auth";
import { pool } from "./db";

export interface GuardedUser {
  id: string;
  name: string;
  email: string;
  approved: boolean;
  role: "admin" | "user";
}

export async function getGuardedSession(): Promise<GuardedUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return null;
  }

  const res = await pool.query<{
    approved: boolean;
    role: string;
  }>(`SELECT approved, role FROM "user" WHERE id = $1`, [session.user.id]);

  const dbUser = res.rows[0];
  if (!dbUser) {
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    approved: Boolean(dbUser.approved),
    role: dbUser.role === "admin" ? "admin" : "user",
  };
}