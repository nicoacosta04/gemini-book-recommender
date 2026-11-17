"use client";

import { useState } from "react";
import type { Book } from "./LibraryManager";

interface RecommendationItem {
  title: string;
  author: string;
  genre: string;
  reason: string;
  connectionToLibrary: string;
}

export function RecommendationsPanel({
  books,
  onBookAdded,
}: {
  books: Book[];
  onBookAdded: (book: Book) => void;
}) {
  const [mode, setMode] = useState<"discover" | "wishlist">("discover");
  const [count, setCount] = useState<3 | 5>(3);
  const [mood, setMood] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileSummary, setProfileSummary] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    []
  );
  const [savingTitle, setSavingTitle] = useState<string | null>(null);
  const [savedTitles, setSavedTitles] = useState<Set<string>>(new Set());

  const wishlistCount = books.filter((b) => b.status === "wishlist").length;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, count, mood }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "No se pudieron generar recomendaciones.");
        setLoading(false);
        return;
      }

      setProfileSummary(data.readerProfileSummary || null);
      setRecommendations(data.recommendations || []);
    } catch {
      setError("Error de red al conectar con el motor de recomendaciones.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToWishlist = async (rec: RecommendationItem) => {
    setSavingTitle(rec.title);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rec.title,
          author: rec.author,
          genre: rec.genre,
          status: "wishlist",
          rating: null,
          notes: `Recomendado por Gemini: ${rec.connectionToLibrary}`,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onBookAdded(data.book);
        setSavedTitles((prev) => new Set(prev).add(rec.title.toLowerCase()));
      }
    } finally {
      setSavingTitle(null);
    }
  };

  const isAlreadyInLibrary = (recTitle: string) => {
    const clean = recTitle.trim().toLowerCase();
    if (savedTitles.has(clean)) return true;
    return books.some((b) => b.title.trim().toLowerCase() === clean);
  };

  return (
    <div className="space-y-6">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            Recomendaciones personalizadas con Gemini
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Analiza tus {books.length} libros registrados, tus calificaciones y
            tus notas (sin compartir ningún dato personal).
          </p>
        </div>

        <form onSubmit={handleGenerate} className="space-y-4">
          {/* Selector de modo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setMode("discover");
                setError(null);
              }}
              className={`p-3.5 text-left rounded-xl border transition ${
                mode === "discover"
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <p className="text-sm font-medium">Descubrir libros nuevos</p>
              <p
                className={`text-xs mt-0.5 ${
                  mode === "discover" ? "text-zinc-700" : "text-zinc-500"
                }`}
              >
                Excluye automáticamente todo lo que ya tienes en tu biblioteca.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("wishlist");
                setError(null);
              }}
              className={`p-3.5 text-left rounded-xl border transition ${
                mode === "wishlist"
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <p className="text-sm font-medium">
                Elegir de mi lista “Por leer” ({wishlistCount})
              </p>
              <p
                className={`text-xs mt-0.5 ${
                  mode === "wishlist" ? "text-zinc-700" : "text-zinc-500"
                }`}
              >
                Prioriza cuál de tus libros pendientes deberías leer primero.
              </p>
            </button>
          </div>

          {/* Contexto opcional y cantidad */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3">
              <label className="block text-xs text-zinc-400 mb-1">
                ¿Qué te provoca leer ahora? (Opcional)
              </label>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Ej. Algo breve y psicológico, ensayo histórico, narrativa introspectiva..."
                className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Cantidad
              </label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value) as 3 | 5)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value={3}>3 sugerencias</option>
                <option value={5}>5 sugerencias</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 transition"
          >
            {loading
              ? "Analizando tu biblioteca con Gemini..."
              : "Generar recomendaciones"}
          </button>
        </form>

        {error && (
          <div className="p-3 text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg">
            {error}
          </div>
        )}
      </section>

      {/* Síntesis del perfil lector */}
      {profileSummary && (
        <section className="p-5 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-1.5">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">
            Lectura de tu perfil literario
          </span>
          <p className="text-sm text-zinc-200 leading-relaxed">
            {profileSummary}
          </p>
        </section>
      )}

      {/* Tarjetas de recomendaciones */}
      {recommendations.length > 0 && (
        <section className="space-y-4">
          {recommendations.map((rec, idx) => {
            const alreadyOwned = isAlreadyInLibrary(rec.title);
            return (
              <article
                key={`${rec.title}-${idx}`}
                className="p-5 bg-zinc-900/70 border border-zinc-800 rounded-2xl space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        #{idx + 1}
                      </span>
                      <h3 className="text-base font-semibold text-zinc-100">
                        {rec.title}
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {rec.author} · {rec.genre}
                    </p>
                  </div>

                  {mode === "discover" && (
                    <div>
                      {alreadyOwned ? (
                        <span className="px-3 py-1.5 text-xs rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-300">
                          ✓ En tu lista “Por leer”
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={savingTitle === rec.title}
                          onClick={() => handleSaveToWishlist(rec)}
                          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition disabled:opacity-50"
                        >
                          {savingTitle === rec.title
                            ? "Guardando..."
                            : "+ Guardar en 'Por leer'"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-sm text-zinc-200 leading-relaxed">
                  {rec.reason}
                </p>

                <div className="pt-2 border-t border-zinc-800/80 text-xs text-zinc-400">
                  <strong className="text-zinc-300">
                    Conexión con tu biblioteca:
                  </strong>{" "}
                  {rec.connectionToLibrary}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}