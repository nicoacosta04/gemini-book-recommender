import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

interface DbBookRow {
  title: string;
  author: string;
  genre: string | null;
  status: "read" | "reading" | "wishlist" | "abandoned";
  rating: number | null;
  notes: string | null;
}

// Modelos activos confirmados en tu cuenta, ordenados de mayor velocidad a mayor capacidad
const ACTIVE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
] as const;

async function callModelFast(
  ai: GoogleGenAI,
  model: string,
  contents: string,
  config: Record<string, unknown>
) {
  try {
    return await ai.models.generateContent({
      model,
      contents,
      config: {
        ...config,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: unknown }).status)
        : 0;

    // Si el modelo rechaza thinkingBudget: 0 (400), reintenta sin ese parámetro
    if (status === 400) {
      return await ai.models.generateContent({
        model,
        contents,
        config,
      });
    }
    throw err;
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta configurar GEMINI_API_KEY en el archivo .env.local del proyecto.",
      },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const mood = String(body.mood || "").trim().slice(0, 300);
    const mode: "discover" | "wishlist" =
      body.mode === "wishlist" ? "wishlist" : "discover";
    const count = body.count === 5 ? 5 : 3;

    // 1. Leer únicamente metadatos literarios del usuario (sin datos personales)
    const result = await pool.query<DbBookRow>(
      `SELECT title, author, genre, status, rating, notes
       FROM books
       WHERE user_id = $1
       ORDER BY rating DESC NULLS LAST, created_at DESC`,
      [session.user.id]
    );

    const books = result.rows;

    if (books.length === 0) {
      return NextResponse.json(
        {
          error:
            "Tu biblioteca está vacía. Agrega al menos un par de libros para analizar tus gustos.",
        },
        { status: 400 }
      );
    }

    const wishlistBooks = books.filter((b) => b.status === "wishlist");
    if (mode === "wishlist" && wishlistBooks.length === 0) {
      return NextResponse.json(
        {
          error:
            "No tienes libros marcados como 'Por leer' en tu biblioteca todavía.",
        },
        { status: 400 }
      );
    }

    // 2. Contexto compacto y anonimizado
    const formatBook = (b: DbBookRow) => {
      const parts = [`"${b.title}" (${b.author})`];
      if (b.genre) parts.push(`[${b.genre}]`);
      if (b.rating) parts.push(`[${b.rating}/5★]`);
      if (b.notes) parts.push(`Nota: "${b.notes}"`);
      return `- ${parts.join(" ")}`;
    };

    const favorites = books.filter(
      (b) => (b.status === "read" || b.status === "reading") && (b.rating ?? 0) >= 4
    );
    const otherRead = books.filter(
      (b) =>
        (b.status === "read" || b.status === "reading") &&
        (b.rating === null || b.rating === 3)
    );
    const avoided = books.filter(
      (b) => b.status === "abandoned" || (b.rating !== null && b.rating <= 2)
    );

    const ownedTitles = books.map((b) => `"${b.title}"`).join(", ");

    const promptSections = [
      favorites.length > 0
        ? `FAVORITOS:\n${favorites.map(formatBook).join("\n")}`
        : "",
      otherRead.length > 0
        ? `OTROS LEÍDOS:\n${otherRead.map(formatBook).join("\n")}`
        : "",
      avoided.length > 0
        ? `EVITAR ESTILOS SIMILARES A:\n${avoided.map(formatBook).join("\n")}`
        : "",
      mood ? `PETICIÓN DEL LECTOR: "${mood}"` : "",
      mode === "discover"
        ? `Recomienda ${count} libros en español que NO estén entre estos títulos ya poseídos: ${ownedTitles}.`
        : `Elige y ordena hasta ${Math.min(
            count,
            wishlistBooks.length
          )} libros ÚNICAMENTE de esta lista 'Por leer':\n${wishlistBooks
            .map(formatBook)
            .join("\n")}`,
    ].filter(Boolean);

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 15000 },
    });

    const baseConfig = {
      systemInstruction:
        "Eres un curador literario conciso y preciso. Responde en español directo, conectando cada libro con las calificaciones y notas del lector.",
      maxOutputTokens: 900,
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          readerProfileSummary: {
            type: Type.STRING,
            description: "Resumen de 1 a 2 oraciones del perfil lector.",
          },
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                author: { type: Type.STRING },
                genre: { type: Type.STRING },
                reason: {
                  type: Type.STRING,
                  description: "Por qué encaja con el lector (1-2 oraciones).",
                },
                connectionToLibrary: {
                  type: Type.STRING,
                  description: "Vínculo breve con libros o notas de su biblioteca.",
                },
              },
              required: [
                "title",
                "author",
                "genre",
                "reason",
                "connectionToLibrary",
              ],
            },
          },
        },
        required: ["readerProfileSummary", "recommendations"],
      },
    };

    let lastError: unknown;
    for (const model of ACTIVE_MODELS) {
      const start = Date.now();
      try {
        console.log(`[Gemini] Consultando ${model}...`);
        const response = await callModelFast(
          ai,
          model,
          promptSections.join("\n\n"),
          baseConfig
        );
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[Gemini] Listo con ${model} en ${elapsed}s`);

        const parsed = JSON.parse(response.text || "{}");
        return NextResponse.json({
          readerProfileSummary: parsed.readerProfileSummary || "",
          recommendations: Array.isArray(parsed.recommendations)
            ? parsed.recommendations
            : [],
        });
      } catch (err: unknown) {
        lastError = err;
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const status =
          typeof err === "object" && err !== null && "status" in err
            ? Number((err as { status?: unknown }).status)
            : 0;
        console.warn(
          `[Gemini] Fallo en ${model} tras ${elapsed}s (status: ${status || "timeout"})`
        );
      }
    }

    throw lastError;
  } catch (error: unknown) {
    console.error("Error generando recomendaciones con Gemini:", error);

    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 500;

    if ([429, 503, 504].includes(status)) {
      return NextResponse.json(
        {
          error:
            "Gemini está con alta demanda en este instante. Espera unos segundos y vuelve a pulsar el botón.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error:
          "No se pudieron generar recomendaciones en este momento. Verifica tu GEMINI_API_KEY e inténtalo de nuevo.",
      },
      { status: 500 }
    );
  }
}