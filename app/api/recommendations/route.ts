import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { getGuardedSession } from "@/lib/session-guard";
import { pool } from "@/lib/db";

interface DbBookRow {
  title: string;
  author: string;
  genre: string | null;
  status: "read" | "reading" | "to_read" | "wishlist" | "abandoned";
  rating: number | null;
  notes: string | null;
  priority: "high" | "medium" | "low";
  estimated_price: number | null;
}

const ACTIVE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
] as const;

const PRIORITY_LABELS: Record<string, string> = {
  high: "Prioridad ALTA",
  medium: "Prioridad MEDIA",
  low: "Prioridad BAJA",
};

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar GEMINI_API_KEY en el servidor." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const mood = String(body.mood || "").trim().slice(0, 300);
    const mode: "discover" | "to_read" | "purchase_optimize" =
      body.mode === "to_read"
        ? "to_read"
        : body.mode === "purchase_optimize"
        ? "purchase_optimize"
        : "discover";
    const count = body.count === 5 ? 5 : 3;
    const rawBudget = Number(body.budget);
    const budget =
      mode === "purchase_optimize" && !Number.isNaN(rawBudget) && rawBudget > 0
        ? rawBudget
        : null;

    const result = await pool.query<DbBookRow>(
      `SELECT title, author, genre, status, rating, notes, priority, estimated_price
       FROM books
       WHERE user_id = $1
       ORDER BY rating DESC NULLS LAST, created_at DESC`,
      [user.id]
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

    const toReadBooks = books.filter((b) => b.status === "to_read");
    const wishlistBooks = books.filter((b) => b.status === "wishlist");

    if (mode === "to_read" && toReadBooks.length === 0) {
      return NextResponse.json(
        {
          error:
            "No tienes libros marcados como 'Por leer (En casa)' todavía.",
        },
        { status: 400 }
      );
    }

    if (mode === "purchase_optimize" && wishlistBooks.length === 0) {
      return NextResponse.json(
        {
          error:
            "No tienes libros en tu lista 'Por comprar' todavía.",
        },
        { status: 400 }
      );
    }

    const formatBook = (b: DbBookRow, includePurchaseMeta = false) => {
      const parts = [`"${b.title}" (${b.author})`];
      if (b.genre) parts.push(`[${b.genre}]`);
      if (b.rating) parts.push(`[${b.rating}/5★]`);
      if (includePurchaseMeta) {
        parts.push(`[${PRIORITY_LABELS[b.priority] || "Prioridad MEDIA"}]`);
        if (b.estimated_price !== null) {
          parts.push(`[Precio est.: $${Number(b.estimated_price).toLocaleString("es-CO")}]`);
        }
      }
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

    const excludedTitles = books.map((b) => `"${b.title}"`).join(", ");

    let taskPrompt = "";
    if (mode === "discover") {
      taskPrompt = `Recomienda ${count} libros nuevos en español que NO estén entre estos títulos ya registrados: ${excludedTitles}.`;
    } else if (mode === "to_read") {
      taskPrompt = `Elige y ordena hasta ${Math.min(
        count,
        toReadBooks.length
      )} libros ÚNICAMENTE de esta lista de libros YA COMPRADOS que el lector tiene en casa esperando lectura:\n${toReadBooks
        .map((b) => formatBook(b, false))
        .join("\n")}`;
    } else {
      const budgetRule = budget
        ? `Presupuesto máximo disponible para esta compra: $${budget.toLocaleString("es-CO")} COP. Procura que la suma de precios estimados conocidos no supere ese presupuesto.`
        : "No hay tope fijo de presupuesto, pero optimiza relación prioridad / afinidad literaria / precio.";
      taskPrompt = `Actúa como asesor de compras literarias. De esta lista 'Por comprar', selecciona y ordena hasta ${Math.min(
        count,
        wishlistBooks.length
      )} libros para comprar primero. ${budgetRule}\nLista 'Por comprar':\n${wishlistBooks
        .map((b) => formatBook(b, true))
        .join("\n")}`;
    }

    const promptSections = [
      favorites.length > 0
        ? `FAVORITOS:\n${favorites.map((b) => formatBook(b)).join("\n")}`
        : "",
      otherRead.length > 0
        ? `OTROS LEÍDOS:\n${otherRead.map((b) => formatBook(b)).join("\n")}`
        : "",
      avoided.length > 0
        ? `EVITAR ESTILOS SIMILARES A:\n${avoided.map((b) => formatBook(b)).join("\n")}`
        : "",
      mood ? `PETICIÓN DEL LECTOR: "${mood}"` : "",
      taskPrompt,
    ].filter(Boolean);

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 15000 },
    });

    const baseConfig = {
      systemInstruction:
        "Eres un curador literario conciso y preciso. Responde en español directo, conectando cada libro con las calificaciones, notas, prioridades y presupuesto del lector.",
      maxOutputTokens: 950,
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          readerProfileSummary: {
            type: Type.STRING,
            description:
              "Resumen de 1 a 2 oraciones del perfil lector o estrategia de compra recomendada.",
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
                  description: "Por qué encaja o por qué priorizarlo ahora (1-2 oraciones).",
                },
                connectionToLibrary: {
                  type: Type.STRING,
                  description:
                    "Vínculo breve con su biblioteca, prioridad o presupuesto.",
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
      try {
        const response = await callModelFast(
          ai,
          model,
          promptSections.join("\n\n"),
          baseConfig
        );

        const parsed = JSON.parse(response.text || "{}");
        return NextResponse.json({
          readerProfileSummary: parsed.readerProfileSummary || "",
          recommendations: Array.isArray(parsed.recommendations)
            ? parsed.recommendations
            : [],
        });
      } catch (err: unknown) {
        lastError = err;
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