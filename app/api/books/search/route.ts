import { NextResponse } from "next/server";
import { getGuardedSession } from "@/lib/session-guard";

interface SearchBookResult {
  id: string;
  source: "google" | "openlibrary";
  title: string;
  authors: string[];
  category: string | null;
  thumbnail: string | null;
}

interface GoogleVolumeItem {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    categories?: string[];
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
}

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  subject?: string[];
  cover_i?: number;
}

async function searchGoogleBooks(query: string): Promise<SearchBookResult[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
    query
  )}&maxResults=10&printType=books`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Google Books HTTP ${res.status}`);
  }

  const data = (await res.json()) as { items?: GoogleVolumeItem[] };
  const items = Array.isArray(data.items) ? data.items : [];

  return items
    .map((item): SearchBookResult | null => {
      const info = item.volumeInfo;
      const title = info?.title?.trim();
      if (!item.id || !title) return null;

      const rawThumb =
        info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail || null;
      const thumbnail = rawThumb
        ? rawThumb.replace(/^http:\/\//i, "https://")
        : null;

      return {
        id: item.id,
        source: "google",
        title,
        authors:
          Array.isArray(info?.authors) && info.authors.length > 0
            ? info.authors
            : ["Autor desconocido"],
        category:
          Array.isArray(info?.categories) && info.categories.length > 0
            ? info.categories[0]
            : null,
        thumbnail,
      };
    })
    .filter((item): item is SearchBookResult => item !== null);
}

async function searchOpenLibrary(query: string): Promise<SearchBookResult[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
    query
  )}&limit=10`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Open Library HTTP ${res.status}`);
  }

  const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs
    .map((doc): SearchBookResult | null => {
      const title = doc.title?.trim();
      const key = doc.key?.trim();
      if (!title || !key) return null;

      return {
        id: key.replace(/^\/works\//, ""),
        source: "openlibrary",
        title,
        authors:
          Array.isArray(doc.author_name) && doc.author_name.length > 0
            ? doc.author_name
            : ["Autor desconocido"],
        category:
          Array.isArray(doc.subject) && doc.subject.length > 0
            ? doc.subject[0]
            : null,
        thumbnail: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
          : null,
      };
    })
    .filter((item): item is SearchBookResult => item !== null);
}

export async function GET(request: Request) {
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
  const query = String(searchParams.get("q") || "").trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const googleResults = await searchGoogleBooks(query);
    if (googleResults.length > 0) {
      return NextResponse.json({ results: googleResults });
    }
  } catch (err) {
    console.warn("Google Books falló, usando respaldo Open Library:", err);
  }

  try {
    const fallbackResults = await searchOpenLibrary(query);
    return NextResponse.json({ results: fallbackResults });
  } catch (err) {
    console.error("Error consultando catálogos de libros:", err);
    return NextResponse.json(
      { error: "No se pudo consultar el catálogo en este momento." },
      { status: 502 }
    );
  }
}