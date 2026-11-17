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

function normalizeBookRow(row: Record<string, unknown>) {
  return {
    ...row,
    estimated_price:
      row.estimated_price !== null && row.estimated_price !== undefined
        ? Number(row.estimated_price)
        : null,
    priority: VALID_PRIORITIES.includes(
      row.priority as (typeof VALID_PRIORITIES)[number]
    )
      ? row.priority
      : "medium",
  };
}

export async function GET() {
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

  const result = await pool.query(
    `SELECT id, title, author, genre, status, rating, notes, google_books_id, cover_url, priority, estimated_price
     FROM books
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [user.id]
  );

  return NextResponse.json({
    books: result.rows.map(normalizeBookRow),
  });
}

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
    const title = String(body.title || "").trim();
    const author = String(body.author || "").trim();

    if (!title || !author) {
      return NextResponse.json(
        { error: "El título y el autor son obligatorios." },
        { status: 400 }
      );
    }

    const genre = body.genre ? String(body.genre).trim().slice(0, 100) : null;
    const status = VALID_STATUSES.includes(body.status) ? body.status : "read";
    const parsedRating = Number(body.rating);
    const rating =
      parsedRating >= 1 && parsedRating <= 5 ? Math.round(parsedRating) : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    const googleBooksId = body.google_books_id
      ? String(body.google_books_id).trim()
      : null;
    const coverUrl = body.cover_url ? String(body.cover_url).trim() : null;
    const priority = VALID_PRIORITIES.includes(body.priority)
      ? body.priority
      : "medium";

    const rawPrice = body.estimated_price;
    const parsedPrice =
      rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== ""
        ? Number(rawPrice)
        : null;
    const estimatedPrice =
      parsedPrice !== null && !Number.isNaN(parsedPrice) && parsedPrice >= 0
        ? parsedPrice
        : null;

    const result = await pool.query(
      `INSERT INTO books (user_id, title, author, genre, status, rating, notes, google_books_id, cover_url, priority, estimated_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, title, author, genre, status, rating, notes, google_books_id, cover_url, priority, estimated_price`,
      [
        user.id,
        title.slice(0, 255),
        author.slice(0, 255),
        genre,
        status,
        rating,
        notes,
        googleBooksId,
        coverUrl,
        priority,
        estimatedPrice,
      ]
    );

    return NextResponse.json(
      { book: normalizeBookRow(result.rows[0]) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error al guardar libro:", error);
    return NextResponse.json(
      { error: "Error interno al guardar el libro." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
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
    const id = Number(body.id);
    if (!id) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const title = String(body.title || "").trim();
    const author = String(body.author || "").trim();
    if (!title || !author) {
      return NextResponse.json(
        { error: "El título y el autor son obligatorios." },
        { status: 400 }
      );
    }

    const genre = body.genre ? String(body.genre).trim().slice(0, 100) : null;
    const status = VALID_STATUSES.includes(body.status) ? body.status : "read";
    const parsedRating = Number(body.rating);
    const rating =
      parsedRating >= 1 && parsedRating <= 5 ? Math.round(parsedRating) : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    const priority = VALID_PRIORITIES.includes(body.priority)
      ? body.priority
      : "medium";

    const rawPrice = body.estimated_price;
    const parsedPrice =
      rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== ""
        ? Number(rawPrice)
        : null;
    const estimatedPrice =
      parsedPrice !== null && !Number.isNaN(parsedPrice) && parsedPrice >= 0
        ? parsedPrice
        : null;

    const result = await pool.query(
      `UPDATE books
       SET title = $1, author = $2, genre = $3, status = $4, rating = $5, notes = $6, priority = $7, estimated_price = $8
       WHERE id = $9 AND user_id = $10
       RETURNING id, title, author, genre, status, rating, notes, google_books_id, cover_url, priority, estimated_price`,
      [
        title.slice(0, 255),
        author.slice(0, 255),
        genre,
        status,
        rating,
        notes,
        priority,
        estimatedPrice,
        id,
        user.id,
      ]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Libro no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ book: normalizeBookRow(result.rows[0]) });
  } catch (error) {
    console.error("Error al actualizar libro:", error);
    return NextResponse.json(
      { error: "Error al actualizar el libro." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  await pool.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [
    id,
    user.id,
  ]);

  return NextResponse.json({ deleted: true });
}