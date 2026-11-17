import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

const VALID_STATUSES = ["read", "reading", "wishlist", "abandoned"] as const;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const rows = Array.isArray(body.books) ? body.books : [];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No se recibieron libros válidos para importar." },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let insertedCount = 0;

      for (const item of rows) {
        const title = String(item.title || "").trim();
        const author = String(item.author || "").trim();
        if (!title || !author) continue;

        const genre = item.genre
          ? String(item.genre).trim().slice(0, 100)
          : null;
        const status = VALID_STATUSES.includes(item.status)
          ? item.status
          : "read";
        const parsedRating = Number(item.rating);
        const rating =
          parsedRating >= 1 && parsedRating <= 5
            ? Math.round(parsedRating)
            : null;
        const notes = item.notes ? String(item.notes).trim() : null;

        await client.query(
          `INSERT INTO books (user_id, title, author, genre, status, rating, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            session.user.id,
            title.slice(0, 255),
            author.slice(0, 255),
            genre,
            status,
            rating,
            notes,
          ]
        );
        insertedCount++;
      }

      await client.query("COMMIT");
      return NextResponse.json({ inserted: insertedCount }, { status: 201 });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error en importación CSV:", error);
    return NextResponse.json(
      { error: "No se pudo completar la importación del archivo." },
      { status: 500 }
    );
  }
}