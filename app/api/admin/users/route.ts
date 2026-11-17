import { NextResponse } from "next/server";
import { getGuardedSession } from "@/lib/session-guard";
import { pool } from "@/lib/db";

export async function GET() {
  const user = await getGuardedSession();
  if (!user || !user.approved || user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const result = await pool.query(
    `SELECT id, name, email, "emailVerified", approved, role, "createdAt"
     FROM "user"
     ORDER BY approved ASC, "createdAt" DESC`
  );

  return NextResponse.json({ users: result.rows });
}

export async function PATCH(request: Request) {
  const user = await getGuardedSession();
  if (!user || !user.approved || user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.userId || "").trim();
  const approved = Boolean(body.approved);

  if (!targetUserId) {
    return NextResponse.json({ error: "Usuario inválido" }, { status: 400 });
  }

  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: "No puedes modificar tu propio estado de administrador." },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `UPDATE "user"
     SET approved = $1
     WHERE id = $2
     RETURNING id, name, email, "emailVerified", approved, role, "createdAt"`,
    [approved, targetUserId]
  );

  if (result.rowCount === 0) {
    return NextResponse.json(
      { error: "Usuario no encontrado" },
      { status: 404 }
    );
  }

  return NextResponse.json({ user: result.rows[0] });
}

export async function DELETE(request: Request) {
  const user = await getGuardedSession();
  if (!user || !user.approved || user.role !== "admin") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const targetUserId = String(searchParams.get("userId") || "").trim();

  if (!targetUserId || targetUserId === user.id) {
    return NextResponse.json({ error: "Operación no permitida" }, { status: 400 });
  }

  await pool.query(`DELETE FROM "user" WHERE id = $1`, [targetUserId]);
  return NextResponse.json({ deleted: true });
}