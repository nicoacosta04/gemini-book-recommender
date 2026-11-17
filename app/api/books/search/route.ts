import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export interface SearchBookResult {
  id: string;
  source: "google" | "openlibrary";
  title: string;
  authors: string[];
  category: string | null;
  thumbnail: string | null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  // 1. Intentar primero con Google Books API
  try {
    const apiKeyParam = process.env.GOOGLE_BOOKS_API_KEY
      ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}`
      : "";
    const googleUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      query
    )}&maxResults=6&printType=books${apiKeyParam}`;

    const googleRes = await fetch(googleUrl, { cache: "no-store" });

    if (googleRes.ok) {
      const data = await googleRes.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        const results: SearchBookResult[] = data.items.map(
          (item: {
            id: string;
            volumeInfo?: {
              title?: string;
              authors?: string[];
              categories?: string[];
              imageLinks?: { thumbnail?: string; smallThumbnail?: string };
            };
          }) => {
            const info = item.volumeInfo || {};
            const rawThumb =
              info.imageLinks?.thumbnail ||
              info.imageLinks?.smallThumbnail ||
              null;
            return {
              id: item.id,
              source: "google",
              title: info.title || "Sin título",
              authors: info.authors || ["Autor desconocido"],
              category: info.categories?.[0] || null,
              thumbnail: rawThumb ? rawThumb.replace(/^http:/, "https:") : null,
            };
          }
        );

        return NextResponse.json({ results, provider: "Google Books" });
      }
    }
  } catch {
    // Continúa al respaldo de Open Library
  }

  // 2. Respaldo automático gratuito: Open Library
  try {
    const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(
      query
    )}&limit=6&fields=key,title,author_name,subject,cover_i`;

    const olRes = await fetch(olUrl, {
      headers: {
        "User-Agent": "BookRecommenderApp/1.0 (personal-library)",
      },
      cache: "no-store",
    });

    if (!olRes.ok) {
      return NextResponse.json(
        { error: `Error al consultar catálogos (${olRes.status}).` },
        { status: 502 }
      );
    }

    const olData = await olRes.json();
    const docs = Array.isArray(olData.docs) ? olData.docs : [];

    const results: SearchBookResult[] = docs.map(
      (doc: {
        key?: string;
        title?: string;
        author_name?: string[];
        subject?: string[];
        cover_i?: number;
      }) => ({
        id: doc.key || crypto.randomUUID(),
        source: "openlibrary",
        title: doc.title || "Sin título",
        authors: doc.author_name || ["Autor desconocido"],
        category: doc.subject?.[0] || null,
        thumbnail: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
          : null,
      })
    );

    return NextResponse.json({ results, provider: "Open Library" });
  } catch (error) {
    console.error("Error en búsqueda de libros:", error);
    return NextResponse.json(
      { error: "No se pudo conectar con los servicios de búsqueda de libros." },
      { status: 500 }
    );
  }
}