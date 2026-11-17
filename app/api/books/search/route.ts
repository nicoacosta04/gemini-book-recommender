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

interface GoogleVolumeItem {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    categories?: string[];
    language?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
}

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  cover_i?: number;
  language?: string[];
}

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  subject?: string[];
  cover_i?: number;
  editions?: {
    docs?: OpenLibraryEdition[];
  };
}

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNonLatinScript(text: string): boolean {
  // Detecta cirílico, árabe, chino, japonés, coreano, griego, etc.
  return /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0370-\u03FF]/.test(
    text
  );
}

function scoreResult(
  item: SearchBookResult & { language?: string },
  query: string,
  queryIsLatin: boolean
): number {
  let score = 0;
  const normQuery = normalizeText(query);
  const normTitle = normalizeText(item.title);
  const normFull = normalizeText(`${item.title} ${item.authors.join(" ")}`);

  if (queryIsLatin && hasNonLatinScript(item.title)) {
    score -= 100;
  }

  if (normTitle === normQuery) {
    score += 60;
  } else if (normQuery.length >= 3 && normTitle.includes(normQuery)) {
    score += 40;
  }

  const tokens = normQuery.split(" ").filter((t) => t.length > 1);
  if (tokens.length > 0 && tokens.every((t) => normFull.includes(t))) {
    score += 25;
  }

  if (item.language === "es" || item.language === "spa") {
    score += 15;
  }

  if (item.thumbnail) {
    score += 8;
  }

  return score;
}

async function fetchGoogleBooks(
  query: string,
  langRestrict?: string,
  maxResults = 12
): Promise<(SearchBookResult & { language?: string })[]> {
  const apiKeyParam = process.env.GOOGLE_BOOKS_API_KEY
    ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}`
    : "";
  const langParam = langRestrict ? `&langRestrict=${langRestrict}` : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
    query
  )}&maxResults=${maxResults}&printType=books${langParam}${apiKeyParam}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BookRecommender/1.0)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return [];

  const data = await res.json();
  if (!Array.isArray(data.items)) return [];

  return data.items.map((item: GoogleVolumeItem) => {
    const info = item.volumeInfo || {};
    const rawThumb =
      info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
    return {
      id: item.id,
      source: "google" as const,
      title: info.title || "Sin título",
      authors: info.authors || ["Autor desconocido"],
      category: info.categories?.[0] || null,
      thumbnail: rawThumb ? rawThumb.replace(/^http:/, "https:") : null,
      language: info.language,
    };
  });
}

async function fetchOpenLibrary(
  query: string
): Promise<(SearchBookResult & { language?: string })[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
    query
  )}&lang=es&limit=12&fields=key,title,author_name,subject,cover_i,editions,editions.key,editions.title,editions.cover_i,editions.language`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "BookRecommenderApp/1.0 (personal-library)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return [];

  const data = await res.json();
  const docs: OpenLibraryDoc[] = Array.isArray(data.docs) ? data.docs : [];
  const results: (SearchBookResult & { language?: string })[] = [];

  for (const doc of docs) {
    const authors = doc.author_name || ["Autor desconocido"];
    const category = doc.subject?.[0] || null;
    const subEditions = doc.editions?.docs || [];

    // Extraer ediciones en español o con título latino si existen
    const matchingEditions = subEditions.filter(
      (ed) =>
        ed.title &&
        (!hasNonLatinScript(ed.title) || ed.language?.includes("spa"))
    );

    if (matchingEditions.length > 0) {
      for (const ed of matchingEditions.slice(0, 3)) {
        const coverId = ed.cover_i || doc.cover_i;
        results.push({
          id: ed.key || doc.key || crypto.randomUUID(),
          source: "openlibrary",
          title: ed.title!,
          authors,
          category,
          thumbnail: coverId
            ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
            : null,
          language: ed.language?.[0] || "spa",
        });
      }
    } else if (doc.title) {
      results.push({
        id: doc.key || crypto.randomUUID(),
        source: "openlibrary",
        title: doc.title,
        authors,
        category,
        thumbnail: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
          : null,
      });
    }
  }

  return results;
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

  const queryIsLatin = !hasNonLatinScript(query);

  try {
    // Consultar Google Books (priorizando español + general) y Open Library en paralelo
    const [googleEs, googleAny, openLib] = await Promise.all([
      fetchGoogleBooks(query, "es", 12),
      fetchGoogleBooks(query, undefined, 8),
      fetchOpenLibrary(query),
    ]);

    const combined = [...googleEs, ...googleAny, ...openLib];

    // Filtrar títulos en alfabetos no latinos si la búsqueda fue en español/latino y hay alternativas válidas
    const latinFiltered = queryIsLatin
      ? combined.filter((item) => !hasNonLatinScript(item.title))
      : combined;

    const poolToRank = latinFiltered.length > 0 ? latinFiltered : combined;

    // Ordenar por relevancia, idioma español y disponibilidad de portada
    const ranked = poolToRank.sort(
      (a, b) =>
        scoreResult(b, query, queryIsLatin) -
        scoreResult(a, query, queryIsLatin)
    );

    // Deduplicar ediciones idénticas (mismo título + autor + portada)
    const seen = new Set<string>();
    const uniqueResults: SearchBookResult[] = [];

    for (const item of ranked) {
      const key = `${normalizeText(item.title)}|${normalizeText(
        item.authors[0] || ""
      )}|${item.thumbnail || "no-cover"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      uniqueResults.push({
        id: item.id,
        source: item.source,
        title: item.title,
        authors: item.authors,
        category: item.category,
        thumbnail: item.thumbnail,
      });

      if (uniqueResults.length >= 12) break;
    }

    return NextResponse.json({ results: uniqueResults });
  } catch (error) {
    console.error("Error en búsqueda de libros:", error);
    return NextResponse.json(
      { error: "No se pudo consultar el catálogo de libros." },
      { status: 500 }
    );
  }
}