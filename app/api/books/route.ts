import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

const VALID_STATUSES = ["read", "reading", "wishlist", "abandoned"] as const;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const result = await pool.query(
    `SELECT id, title, author, genre, status, rating, notes, google_books_id, cover_url
     FROM books
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [session.user.id]
  );

  return NextResponse.json({ books: result.rows });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

    const result = await pool.query(
      `INSERT INTO books (user_id, title, author, genre, status, rating, notes, google_books_id, cover_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, author, genre, status, rating, notes, google_books_id, cover_url`,
      [
        session.user.id,
        title.slice(0, 255),
        author.slice(0, 255),
        genre,
        status,
        rating,
        notes,
        googleBooksId,
        coverUrl,
      ]
    );

    return NextResponse.json({ book: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Error al guardar libro:", error);
    return NextResponse.json(
      { error: "Error interno al guardar el libro." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

    const result = await pool.query(
      `UPDATE books
       SET title = $1, author = $2, genre = $3, status = $4, rating = $5, notes = $6
       WHERE id = $7 AND user_id = $8
       RETURNING id, title, author, genre, status, rating, notes, google_books_id, cover_url`,
      [
        title.slice(0, 255),
        author.slice(0, 255),
        genre,
        status,
        rating,
        notes,
        id,
        session.user.id,
      ]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Libro no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ book: result.rows[0] });
  } catch (error) {
    console.error("Error al actualizar libro:", error);
    return NextResponse.json(
      { error: "Error al actualizar el libro." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  await pool.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [
    id,
    session.user.id,
  ]);

  return NextResponse.json({ deleted: true });
}