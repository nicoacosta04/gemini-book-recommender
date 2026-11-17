import { NextResponse } from "next/server";
import { getGuardedSession } from "@/lib/session-guard";
import { pool } from "@/lib/db";

const VALID_STATUSES = [
  "read",
  "reading",
  "to_read",
  "wishlist",
  "abandoned",
] as const;

const VALID_PRIORITIES = ["high", "medium", "low"] as const;

export async function POST(request: Request) {
  const user = await getGuardedSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!user.approved) {
    return NextResponse.json(
      { error: "Tu cuenta está pendiente de aprobación." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const rawBooks = Array.isArray(body.books) ? body.books : [];

    if (rawBooks.length === 0) {
      return NextResponse.json(
        { error: "No hay libros válidos para importar." },
        { status: 400 }
      );
    }

    let inserted = 0;
    for (const item of rawBooks.slice(0, 300)) {
      const title = String(item.title || "").trim().slice(0, 255);
      const author = String(item.author || "").trim().slice(0, 255);
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
      const priority = VALID_PRIORITIES.includes(item.priority)
        ? item.priority
        : "medium";
      const parsedPrice =
        item.estimated_price !== null &&
        item.estimated_price !== undefined &&
        String(item.estimated_price).trim() !== ""
          ? Number(item.estimated_price)
          : null;
      const estimatedPrice =
        parsedPrice !== null && !Number.isNaN(parsedPrice) && parsedPrice >= 0
          ? parsedPrice
          : null;

      await pool.query(
        `INSERT INTO books (user_id, title, author, genre, status, rating, notes, priority, estimated_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          title,
          author,
          genre,
          status,
          rating,
          notes,
          priority,
          estimatedPrice,
        ]
      );
      inserted++;
    }

    return NextResponse.json({ inserted }, { status: 201 });
  } catch (error) {
    console.error("Error importando CSV:", error);
    return NextResponse.json(
      { error: "Error interno al importar libros." },
      { status: 500 }
    );
  }
}