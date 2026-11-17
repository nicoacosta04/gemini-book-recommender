"use client";

import { useEffect, useState } from "react";

export type BookStatus =
  | "read"
  | "reading"
  | "to_read"
  | "wishlist"
  | "abandoned";

export type PurchasePriority = "high" | "medium" | "low";

export interface Book {
  id: number;
  title: string;
  author: string;
  genre: string | null;
  status: BookStatus;
  rating: number | null;
  notes: string | null;
  google_books_id: string | null;
  cover_url: string | null;
  priority: PurchasePriority;
  estimated_price: number | null;
}

interface SearchBookResult {
  id: string;
  source: "google" | "openlibrary";
  title: string;
  authors: string[];
  category: string | null;
  thumbnail: string | null;
}

interface GeminiRecommendation {
  title: string;
  author: string;
  genre: string;
  reason: string;
  connectionToLibrary: string;
}

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  approved: boolean;
  role: string;
  createdAt: string;
}

const STATUS_LABELS: Record<BookStatus, string> = {
  read: "Leído",
  reading: "Leyendo",
  to_read: "Por leer (En casa)",
  wishlist: "Por comprar",
  abandoned: "Abandonado",
};

const PRIORITY_LABELS: Record<PurchasePriority, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const PRIORITY_RANK: Record<PurchasePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const RATING_LABELS: Record<number, string> = {
  1: "No me gustó",
  2: "Regular",
  3: "Bueno",
  4: "Muy bueno",
  5: "Obra maestra",
};

const STOP_WORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "del",
  "y",
  "en",
  "the",
  "of",
  "a",
  "and",
]);

function formatCOP(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "";
  return `$${Math.round(value).toLocaleString("es-CO")}`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function StarRatingInput({
  value,
  onChange,
  disabled = false,
  allowClear = false,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const active = value ?? 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => onChange(star)}
            className={`text-xl leading-none transition ${
              disabled
                ? "text-zinc-800 cursor-not-allowed"
                : star <= active
                ? "text-amber-400 hover:scale-110"
                : "text-zinc-700 hover:text-zinc-500"
            }`}
            aria-label={`${star} estrellas`}
          >
            ★
          </button>
        ))}
      </div>
      {!disabled && active > 0 && (
        <span className="text-xs text-zinc-400">
          {RATING_LABELS[active] || ""}
        </span>
      )}
      {!disabled && allowClear && active > 0 && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2 ml-1"
        >
          Quitar
        </button>
      )}
    </div>
  );
}

function GeminiRecommenderPanel({
  books,
  onBookAdded,
}: {
  books: Book[];
  onBookAdded: (book: Book) => void;
}) {
  const [mode, setMode] = useState<
    "discover" | "to_read" | "purchase_optimize"
  >("discover");
  const [count, setCount] = useState<3 | 5>(3);
  const [mood, setMood] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileSummary, setProfileSummary] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<
    GeminiRecommendation[]
  >([]);
  const [savingTitle, setSavingTitle] = useState<string | null>(null);
  const [savedTitles, setSavedTitles] = useState<Set<string>>(new Set());

  const toReadCount = books.filter((b) => b.status === "to_read").length;
  const wishlistCount = books.filter((b) => b.status === "wishlist").length;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          count,
          mood,
          budget: budget ? Number(budget) : null,
        }),
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

  const handleSaveRecommendation = async (
    rec: GeminiRecommendation,
    targetStatus: "wishlist" | "to_read"
  ) => {
    setSavingTitle(rec.title);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rec.title,
          author: rec.author,
          genre: rec.genre,
          status: targetStatus,
          rating: null,
          priority: "medium",
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

  const isAlreadySaved = (title: string) => {
    const norm = title.trim().toLowerCase();
    return (
      savedTitles.has(norm) ||
      books.some((b) => b.title.trim().toLowerCase() === norm)
    );
  };

  return (
    <div className="space-y-6">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            Recomendaciones y compras con Gemini
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Analiza tus {books.length} libros registrados, calificaciones,
            prioridades y presupuesto.
          </p>
        </div>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <p className="text-sm font-medium">Descubrir nuevos</p>
              <p
                className={`text-xs mt-0.5 ${
                  mode === "discover" ? "text-zinc-700" : "text-zinc-500"
                }`}
              >
                Excluye los que ya tienes y tu lista de compras.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("to_read");
                setError(null);
              }}
              className={`p-3.5 text-left rounded-xl border transition ${
                mode === "to_read"
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <p className="text-sm font-medium">
                ¿Qué leo de mi casa? ({toReadCount})
              </p>
              <p
                className={`text-xs mt-0.5 ${
                  mode === "to_read" ? "text-zinc-700" : "text-zinc-500"
                }`}
              >
                Prioriza libros que ya compraste y tienes sin leer.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("purchase_optimize");
                setError(null);
              }}
              className={`p-3.5 text-left rounded-xl border transition ${
                mode === "purchase_optimize"
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <p className="text-sm font-medium">
                Optimizar compra ({wishlistCount})
              </p>
              <p
                className={`text-xs mt-0.5 ${
                  mode === "purchase_optimize"
                    ? "text-zinc-700"
                    : "text-zinc-500"
                }`}
              >
                Ordena tu lista &ldquo;Por comprar&rdquo; según prioridad y
                precio.
              </p>
            </button>
          </div>

          <div
            className={`grid grid-cols-1 ${
              mode === "purchase_optimize"
                ? "md:grid-cols-6"
                : "md:grid-cols-4"
            } gap-3`}
          >
            <div className="md:col-span-3">
              <label className="block text-xs text-zinc-400 mb-1">
                ¿Qué te provoca leer o comprar ahora? (Opcional)
              </label>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="Ej. Algo breve y psicológico, ensayo histórico, edición de colección..."
                className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>

            {mode === "purchase_optimize" && (
              <div className="md:col-span-2">
                <label className="block text-xs text-zinc-400 mb-1">
                  Presupuesto máx. COP (Opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="Ej. 150000"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Cantidad
              </label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value) as 3 | 5)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value={3}>3 libros</option>
                <option value={5}>5 libros</option>
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
              : mode === "purchase_optimize"
              ? "Optimizar mi próxima compra"
              : "Generar recomendaciones"}
          </button>
        </form>

        {error && (
          <div className="p-3 text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg">
            {error}
          </div>
        )}
      </section>

      {profileSummary && (
        <section className="p-5 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-1.5">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">
            {mode === "purchase_optimize"
              ? "Estrategia de compra sugerida"
              : "Lectura de tu perfil literario"}
          </span>
          <p className="text-sm text-zinc-200 leading-relaxed">
            {profileSummary}
          </p>
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="space-y-4">
          {recommendations.map((rec, idx) => {
            const saved = isAlreadySaved(rec.title);
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
                    <div className="flex flex-wrap gap-2">
                      {saved ? (
                        <span className="px-3 py-1.5 text-xs rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-300">
                          ✓ Registrado en tu biblioteca
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={savingTitle === rec.title}
                            onClick={() =>
                              handleSaveRecommendation(rec, "wishlist")
                            }
                            className="px-3 py-1.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-medium rounded-lg transition disabled:opacity-50"
                          >
                            {savingTitle === rec.title
                              ? "Guardando..."
                              : "+ Por comprar"}
                          </button>
                          <button
                            type="button"
                            disabled={savingTitle === rec.title}
                            onClick={() =>
                              handleSaveRecommendation(rec, "to_read")
                            }
                            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition disabled:opacity-50"
                          >
                            + Ya lo tengo
                          </button>
                        </>
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

function AdminApprovalsPanel({
  onPendingCountChange,
}: {
  onPendingCountChange: (count: number) => void;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        const list: ManagedUser[] = data.users || [];
        setUsers(list);
        onPendingCountChange(list.filter((u) => !u.approved).length);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleApproval = async (
    target: ManagedUser,
    approved: boolean
  ) => {
    setBusyId(target.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.id, approved }),
      });
      if (res.ok) {
        const updated = users.map((u) =>
          u.id === target.id ? { ...u, approved } : u
        );
        setUsers(updated);
        onPendingCountChange(updated.filter((u) => !u.approved).length);
        setFeedback(
          approved
            ? `Acceso aprobado para ${target.email}.`
            : `Acceso revocado para ${target.email}.`
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectUser = async (target: ManagedUser) => {
    setBusyId(target.id);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/admin/users?userId=${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const updated = users.filter((u) => u.id !== target.id);
        setUsers(updated);
        onPendingCountChange(updated.filter((u) => !u.approved).length);
        setFeedback(`Solicitud de ${target.email} eliminada.`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const pendingUsers = users.filter((u) => !u.approved);
  const approvedUsers = users.filter((u) => u.approved);

  return (
    <div className="space-y-6">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Control de acceso y solicitudes
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Aprueba o revoca quién puede entrar a la aplicación. Cada usuario
              aprobado tiene su propia biblioteca independiente.
            </p>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg"
          >
            Actualizar
          </button>
        </div>

        {feedback && (
          <div className="p-3 text-sm rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300">
            {feedback}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-400">Cargando usuarios...</p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-amber-300">
                Solicitudes pendientes ({pendingUsers.length})
              </h3>
              {pendingUsers.length === 0 ? (
                <p className="p-4 text-sm text-zinc-400 bg-zinc-950 border border-zinc-800 rounded-xl">
                  No hay solicitudes pendientes en este momento.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {pendingUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4 bg-zinc-950 border border-amber-800/50 rounded-xl"
                    >
                      <div>
                        <p className="text-sm font-medium text-zinc-100">
                          {u.name}
                        </p>
                        <p className="text-xs text-zinc-400">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => handleToggleApproval(u, true)}
                          className="px-3.5 py-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold rounded-lg disabled:opacity-50"
                        >
                          ✓ Aprobar acceso
                        </button>
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => handleRejectUser(u)}
                          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-red-950/70 text-zinc-300 hover:text-red-300 border border-zinc-700 rounded-lg disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-4 border-t border-zinc-800">
              <h3 className="text-xs uppercase tracking-wider text-zinc-400">
                Usuarios activos ({approvedUsers.length})
              </h3>
              <div className="space-y-2">
                {approvedUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-100">
                          {u.name}
                        </p>
                        {u.role === "admin" && (
                          <span className="px-2 py-0.5 text-[10px] uppercase rounded bg-zinc-800 text-zinc-300">
                            Admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">{u.email}</p>
                    </div>
                    {u.role !== "admin" && (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => handleToggleApproval(u, false)}
                        className="px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-red-300 border border-zinc-800 rounded-lg disabled:opacity-50"
                      >
                        Revocar acceso
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function LibraryManager({
  initialBooks,
  isAdmin = false,
  initialPendingCount = 0,
}: {
  initialBooks: Book[];
  isAdmin?: boolean;
  initialPendingCount?: number;
}) {
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [section, setSection] = useState<
    "library" | "purchase" | "gemini" | "admin"
  >("library");
  const [activeTab, setActiveTab] = useState<"google" | "manual" | "csv">(
    "google"
  );
  const [filter, setFilter] = useState<"all" | BookStatus>("all");
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  // Catálogo externo
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchBookResult[]>([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<SearchBookResult | null>(null);
  const [candidateGenre, setCandidateGenre] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<BookStatus>("read");
  const [candidateRating, setCandidateRating] = useState<number | null>(5);
  const [candidatePriority, setCandidatePriority] =
    useState<PurchasePriority>("medium");
  const [candidatePrice, setCandidatePrice] = useState("");
  const [candidateNotes, setCandidateNotes] = useState("");
  const [savingCandidate, setSavingCandidate] = useState(false);

  // Carga manual
  const [manualTitle, setManualTitle] = useState("");
  const [manualAuthor, setManualAuthor] = useState("");
  const [manualGenre, setManualGenre] = useState("");
  const [manualStatus, setManualStatus] = useState<BookStatus>("read");
  const [manualRating, setManualRating] = useState<number | null>(5);
  const [manualPriority, setManualPriority] =
    useState<PurchasePriority>("medium");
  const [manualPrice, setManualPrice] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Importación CSV
  const [csvPreview, setCsvPreview] = useState<
    Array<{
      title: string;
      author: string;
      genre: string | null;
      status: BookStatus;
      rating: number | null;
      notes: string | null;
    }>
  >([]);
  const [importingCsv, setImportingCsv] = useState(false);

  // Modal de edición
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editStatus, setEditStatus] = useState<BookStatus>("read");
  const [editRating, setEditRating] = useState<number | null>(null);
  const [editPriority, setEditPriority] = useState<PurchasePriority>("medium");
  const [editPrice, setEditPrice] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Verificador de compra
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [purchaseSearching, setPurchaseSearching] = useState(false);
  const [purchaseCatalogResults, setPurchaseCatalogResults] = useState<
    SearchBookResult[]
  >([]);
  const [purchaseFeedback, setPurchaseFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const refreshBooks = async () => {
    const res = await fetch("/api/books");
    if (res.ok) {
      const data = await res.json();
      setBooks(data.books);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setFeedback(null);
    setSelectedCandidate(null);
    try {
      const res = await fetch(
        `/api/books/search?q=${encodeURIComponent(query.trim())}`
      );
      const data = await res.json();
      if (!res.ok) {
        setSearchResults([]);
        setFeedback({
          type: "err",
          text: data.error || "Error al consultar el catálogo de libros.",
        });
        return;
      }
      const items: SearchBookResult[] = data.results || [];
      setSearchResults(items);
      if (items.length === 0) {
        setFeedback({
          type: "err",
          text: "No se encontraron resultados para esa búsqueda.",
        });
      }
    } catch {
      setFeedback({
        type: "err",
        text: "Error de red al consultar el buscador de libros.",
      });
    } finally {
      setSearching(false);
    }
  };

  const handleSaveCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCandidate) return;

    setSavingCandidate(true);
    setFeedback(null);

    const isUnrated =
      candidateStatus === "wishlist" || candidateStatus === "to_read";

    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedCandidate.title,
        author: selectedCandidate.authors.join(", "),
        genre: candidateGenre || null,
        status: candidateStatus,
        rating: isUnrated ? null : candidateRating,
        priority:
          candidateStatus === "wishlist" ? candidatePriority : "medium",
        estimated_price:
          candidateStatus === "wishlist" && candidatePrice
            ? Number(candidatePrice)
            : null,
        notes: candidateNotes || null,
        google_books_id:
          selectedCandidate.source === "google" ? selectedCandidate.id : null,
        cover_url: selectedCandidate.thumbnail,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setSelectedCandidate(null);
      setFeedback({
        type: "ok",
        text: `"${data.book.title}" agregado a tu biblioteca.`,
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setFeedback({
        type: "err",
        text: err.error || "No se pudo guardar el libro.",
      });
    }
    setSavingCandidate(false);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingManual(true);
    setFeedback(null);

    const isUnrated =
      manualStatus === "wishlist" || manualStatus === "to_read";

    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: manualTitle,
        author: manualAuthor,
        genre: manualGenre,
        status: manualStatus,
        rating: isUnrated ? null : manualRating,
        priority: manualStatus === "wishlist" ? manualPriority : "medium",
        estimated_price:
          manualStatus === "wishlist" && manualPrice
            ? Number(manualPrice)
            : null,
        notes: manualNotes,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setManualTitle("");
      setManualAuthor("");
      setManualGenre("");
      setManualPrice("");
      setManualNotes("");
      setFeedback({
        type: "ok",
        text: `"${data.book.title}" guardado correctamente.`,
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setFeedback({
        type: "err",
        text: err.error || "Error al guardar el libro.",
      });
    }
    setSavingManual(false);
  };

  const handleCsvFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);

    const text = await file.text();
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      setFeedback({
        type: "err",
        text: "El archivo CSV debe contener encabezados y al menos una fila.",
      });
      return;
    }

    const delimiter = lines[0].includes(";") ? ";" : ",";
    const headers = parseCsvLine(lines[0], delimiter).map((h) =>
      h
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    );

    const idxTitle = headers.findIndex((h) =>
      ["title", "titulo", "libro"].includes(h)
    );
    const idxAuthor = headers.findIndex((h) =>
      ["author", "autor"].includes(h)
    );
    const idxGenre = headers.findIndex((h) =>
      ["genre", "genero", "categoria"].includes(h)
    );
    const idxStatus = headers.findIndex((h) =>
      ["status", "estado"].includes(h)
    );
    const idxRating = headers.findIndex((h) =>
      ["rating", "calificacion", "puntaje", "estrellas"].includes(h)
    );
    const idxNotes = headers.findIndex((h) =>
      ["notes", "notas", "comentario"].includes(h)
    );

    if (idxTitle === -1 || idxAuthor === -1) {
      setFeedback({
        type: "err",
        text: "El CSV debe tener al menos las columnas 'title' (o 'titulo') y 'author' (o 'autor').",
      });
      return;
    }

    const normalizeStatus = (raw?: string): BookStatus => {
      const val = (raw || "").trim().toLowerCase();
      if (["reading", "leyendo", "en curso"].includes(val)) return "reading";
      if (["to_read", "por leer", "en casa", "pendiente"].includes(val))
        return "to_read";
      if (["wishlist", "por comprar", "comprar", "deseos"].includes(val))
        return "wishlist";
      if (["abandoned", "abandonado"].includes(val)) return "abandoned";
      return "read";
    };

    const parsed = lines
      .slice(1)
      .map((line) => {
        const cols = parseCsvLine(line, delimiter);
        const rawRating = idxRating !== -1 ? Number(cols[idxRating]) : NaN;
        return {
          title: cols[idxTitle] || "",
          author: cols[idxAuthor] || "",
          genre: idxGenre !== -1 && cols[idxGenre] ? cols[idxGenre] : null,
          status: normalizeStatus(idxStatus !== -1 ? cols[idxStatus] : ""),
          rating:
            rawRating >= 1 && rawRating <= 5 ? Math.round(rawRating) : null,
          notes: idxNotes !== -1 && cols[idxNotes] ? cols[idxNotes] : null,
        };
      })
      .filter((b) => b.title && b.author);

    setCsvPreview(parsed);
  };

  const handleImportCsv = async () => {
    if (csvPreview.length === 0) return;
    setImportingCsv(true);
    setFeedback(null);

    const res = await fetch("/api/books/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ books: csvPreview }),
    });

    if (res.ok) {
      const data = await res.json();
      await refreshBooks();
      setCsvPreview([]);
      setFeedback({
        type: "ok",
        text: `Se importaron ${data.inserted} libros a tu biblioteca.`,
      });
    } else {
      setFeedback({
        type: "err",
        text: "Ocurrió un error al importar el archivo CSV.",
      });
    }
    setImportingCsv(false);
  };

  const handleStatusChange = async (book: Book, newStatus: BookStatus) => {
    setFeedback(null);
    const isUnrated = newStatus === "wishlist" || newStatus === "to_read";

    const res = await fetch("/api/books", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: book.id,
        title: book.title,
        author: book.author,
        genre: book.genre,
        status: newStatus,
        rating: isUnrated ? null : book.rating,
        priority: book.priority,
        estimated_price: book.estimated_price,
        notes: book.notes,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) =>
        prev.map((b) => (b.id === book.id ? data.book : b))
      );
      if (book.status === "wishlist" && newStatus === "to_read") {
        setFeedback({
          type: "ok",
          text: `¡"${book.title}" pasó de "Por comprar" a "Por leer (En casa)"!`,
        });
      }
    } else {
      const err = await res.json().catch(() => ({}));
      setFeedback({
        type: "err",
        text: err.error || "No se pudo actualizar el estado del libro.",
      });
    }
  };

  const openEditModal = (book: Book) => {
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditGenre(book.genre || "");
    setEditStatus(book.status);
    setEditRating(book.rating);
    setEditPriority(book.priority || "medium");
    setEditPrice(
      book.estimated_price !== null ? String(book.estimated_price) : ""
    );
    setEditNotes(book.notes || "");
    setFeedback(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook) return;

    setSavingEdit(true);
    const isUnrated =
      editStatus === "wishlist" || editStatus === "to_read";

    const res = await fetch("/api/books", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingBook.id,
        title: editTitle,
        author: editAuthor,
        genre: editGenre,
        status: editStatus,
        rating: isUnrated ? null : editRating,
        priority: editPriority,
        estimated_price: editPrice ? Number(editPrice) : null,
        notes: editNotes,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) =>
        prev.map((b) => (b.id === editingBook.id ? data.book : b))
      );
      setEditingBook(null);
      setFeedback({
        type: "ok",
        text: `"${data.book.title}" actualizado correctamente.`,
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setFeedback({
        type: "err",
        text: err.error || "No se pudo actualizar el libro.",
      });
    }
    setSavingEdit(false);
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/books?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setBooks((prev) => prev.filter((b) => b.id !== id));
    }
  };

  // Verificar compra
  const handlePurchaseCatalogSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseQuery.trim()) return;
    setPurchaseSearching(true);
    setPurchaseFeedback(null);
    try {
      const res = await fetch(
        `/api/books/search?q=${encodeURIComponent(purchaseQuery.trim())}`
      );
      const data = await res.json();
      if (res.ok) {
        setPurchaseCatalogResults(data.results || []);
      } else {
        setPurchaseFeedback({
          type: "err",
          text: data.error || "No se pudo consultar el catálogo externo.",
        });
      }
    } catch {
      setPurchaseFeedback({
        type: "err",
        text: "Error de red al consultar el catálogo.",
      });
    } finally {
      setPurchaseSearching(false);
    }
  };

  const handleQuickAddFromPurchase = async (
    item: SearchBookResult,
    targetStatus: "to_read" | "wishlist"
  ) => {
    setPurchaseFeedback(null);
    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        author: item.authors.join(", "),
        genre: item.category,
        status: targetStatus,
        rating: null,
        priority: "medium",
        google_books_id: item.source === "google" ? item.id : null,
        cover_url: item.thumbnail,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setPurchaseFeedback({
        type: "ok",
        text: `"${data.book.title}" agregado como "${STATUS_LABELS[targetStatus]}".`,
      });
    } else {
      setPurchaseFeedback({
        type: "err",
        text: "No se pudo guardar el libro en tu biblioteca.",
      });
    }
  };

  const filteredBooks = (
    filter === "all" ? books : books.filter((b) => b.status === filter)
  ).sort((a, b) => {
    if (filter === "wishlist") {
      return (
        (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)
      );
    }
    return 0;
  });

  const wishlistBooks = books.filter((b) => b.status === "wishlist");
  const wishlistTotalBudget = wishlistBooks.reduce(
    (acc, b) => acc + (b.estimated_price ?? 0),
    0
  );
  const wishlistHighPriorityCount = wishlistBooks.filter(
    (b) => b.priority === "high"
  ).length;

  const findLocalPurchaseMatches = (q: string): Book[] => {
    const normQuery = normalizeText(q);
    if (normQuery.length < 2) return [];
    const tokens = normQuery
      .split(" ")
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    return books.filter((b) => {
      const haystack = normalizeText(`${b.title} ${b.author}`);
      if (haystack.includes(normQuery)) return true;
      if (tokens.length > 0 && tokens.every((t) => haystack.includes(t))) {
        return true;
      }
      return false;
    });
  };

  const findMatchForCatalogItem = (item: SearchBookResult): Book | undefined => {
    const normTitle = normalizeText(item.title);
    if (!normTitle) return undefined;
    return books.find((b) => {
      if (
        item.source === "google" &&
        b.google_books_id &&
        b.google_books_id === item.id
      ) {
        return true;
      }
      const ownedTitle = normalizeText(b.title);
      return (
        ownedTitle === normTitle ||
        (ownedTitle.length >= 5 &&
          normTitle.length >= 5 &&
          (ownedTitle.includes(normTitle) || normTitle.includes(ownedTitle)))
      );
    });
  };

  const localMatches = findLocalPurchaseMatches(purchaseQuery);

  return (
    <div className="space-y-8">
      {/* Navegación principal */}
      <nav
        aria-label="Secciones principales"
        className={`grid ${
          isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
        } gap-2 p-1.5 bg-zinc-900 border border-zinc-800 rounded-xl`}
      >
        <button
          type="button"
          onClick={() => setSection("library")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            section === "library"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          1. Mi Biblioteca ({books.length})
        </button>
        <button
          type="button"
          onClick={() => setSection("purchase")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            section === "purchase"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          2. Verificar Compra
        </button>
        <button
          type="button"
          onClick={() => setSection("gemini")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            section === "gemini"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          3. Recomendaciones IA
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSection("admin")}
            className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition flex items-center justify-center gap-2 ${
              section === "admin"
                ? "bg-zinc-100 text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
            }`}
          >
            <span>4. Solicitudes</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-amber-400 text-zinc-950">
                {pendingCount}
              </span>
            )}
          </button>
        )}
      </nav>

      {/* ==================== SECCIÓN 1: MI BIBLIOTECA ==================== */}
      {section === "library" && (
        <div className="space-y-8">
          {/* Panel de registro */}
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6">
            <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-4 mb-6">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("google");
                  setFeedback(null);
                }}
                className={`px-4 py-2 text-sm rounded-lg font-medium transition ${
                  activeTab === "google"
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Buscar en catálogo
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("manual");
                  setFeedback(null);
                }}
                className={`px-4 py-2 text-sm rounded-lg font-medium transition ${
                  activeTab === "manual"
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Carga manual
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("csv");
                  setFeedback(null);
                }}
                className={`px-4 py-2 text-sm rounded-lg font-medium transition ${
                  activeTab === "csv"
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Importar CSV
              </button>
            </div>

            {feedback && (
              <div
                className={`mb-5 p-3 text-sm rounded-lg border ${
                  feedback.type === "ok"
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-red-950/40 border-red-900 text-red-400"
                }`}
              >
                {feedback.text}
              </div>
            )}

            {/* Tab 1: Catálogo */}
            {activeTab === "google" && (
              <div className="space-y-5">
                <form onSubmit={handleSearch} className="flex gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Busca por título, autor o ISBN (ej. Stefan Zweig, El extranjero...)"
                    className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="px-4 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {searching ? "Buscando..." : "Buscar"}
                  </button>
                </form>

                {selectedCandidate && (
                  <form
                    onSubmit={handleSaveCandidate}
                    className="p-5 bg-zinc-950 border border-zinc-700 rounded-xl space-y-4"
                  >
                    <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
                      <div className="flex gap-3.5 min-w-0">
                        {selectedCandidate.thumbnail ? (
                          <img
                            src={selectedCandidate.thumbnail}
                            alt={selectedCandidate.title}
                            className="w-12 h-18 object-cover rounded shrink-0 bg-zinc-900"
                          />
                        ) : (
                          <div className="w-12 h-18 bg-zinc-900 rounded shrink-0 flex items-center justify-center text-[10px] text-zinc-500 text-center p-1">
                            Sin tapa
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                            Libro seleccionado
                          </span>
                          <h3 className="text-base font-medium text-zinc-100">
                            {selectedCandidate.title}
                          </h3>
                          <p className="text-xs text-zinc-400">
                            {selectedCandidate.authors.join(", ")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCandidate(null)}
                        className="text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        ✕ Cancelar
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-2">
                        Estado en tu biblioteca
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            "read",
                            "reading",
                            "to_read",
                            "wishlist",
                            "abandoned",
                          ] as const
                        ).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setCandidateStatus(st)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                              candidateStatus === st
                                ? "bg-zinc-100 text-zinc-950 border-zinc-100 font-medium"
                                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                            }`}
                          >
                            {STATUS_LABELS[st]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {candidateStatus === "wishlist" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1.5">
                            Prioridad de compra
                          </label>
                          <div className="flex gap-2">
                            {(["high", "medium", "low"] as const).map(
                              (prio) => (
                                <button
                                  key={prio}
                                  type="button"
                                  onClick={() => setCandidatePriority(prio)}
                                  className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                                    candidatePriority === prio
                                      ? "bg-amber-400 text-zinc-950 border-amber-400 font-medium"
                                      : "bg-zinc-950 text-zinc-300 border-zinc-800"
                                  }`}
                                >
                                  {PRIORITY_LABELS[prio]}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">
                            Precio estimado COP (Opcional)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={candidatePrice}
                            onChange={(e) => setCandidatePrice(e.target.value)}
                            placeholder="Ej. 65000"
                            className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">
                          Calificación{" "}
                          {(candidateStatus === "wishlist" ||
                            candidateStatus === "to_read") &&
                            "(aplica al leerlo)"}
                        </label>
                        <StarRatingInput
                          value={candidateRating}
                          onChange={setCandidateRating}
                          disabled={
                            candidateStatus === "wishlist" ||
                            candidateStatus === "to_read"
                          }
                          allowClear
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1">
                          Género / Tema
                        </label>
                        <input
                          type="text"
                          value={candidateGenre}
                          onChange={(e) => setCandidateGenre(e.target.value)}
                          placeholder="Ej. Filosofía, Novela histórica..."
                          className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">
                        Comentario o notas personales
                      </label>
                      <textarea
                        rows={2}
                        value={candidateNotes}
                        onChange={(e) => setCandidateNotes(e.target.value)}
                        placeholder="Ej. Edición Penguin Classics, o por qué quieres leerlo/comprarlo."
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={savingCandidate}
                        className="px-4 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
                      >
                        {savingCandidate
                          ? "Guardando..."
                          : "Guardar en mi biblioteca"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCandidate(null)}
                        className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                      >
                        Elegir otro
                      </button>
                    </div>
                  </form>
                )}

                {searchResults.length > 0 && !selectedCandidate && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {searchResults.map((item) => (
                      <div
                        key={`${item.source}-${item.id}`}
                        className="flex items-start justify-between gap-3 p-3 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl transition"
                      >
                        <div className="flex gap-3 min-w-0">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-11 h-16 object-cover rounded shrink-0 bg-zinc-900"
                            />
                          ) : (
                            <div className="w-11 h-16 bg-zinc-900 rounded shrink-0 flex items-center justify-center text-[10px] text-zinc-500">
                              Sin tapa
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-zinc-400 truncate">
                              {item.authors.join(", ")}
                            </p>
                            {item.category && (
                              <p className="text-[11px] text-zinc-500 mt-1 truncate">
                                {item.category}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCandidate(item);
                            setCandidateGenre(item.category || "");
                            setCandidateStatus("read");
                            setCandidateRating(5);
                            setCandidatePriority("medium");
                            setCandidatePrice("");
                            setCandidateNotes("");
                            setFeedback(null);
                          }}
                          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg shrink-0"
                        >
                          Seleccionar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Carga manual */}
            {activeTab === "manual" && (
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Título *
                    </label>
                    <input
                      type="text"
                      required
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder="Ej. Memorias del subsuelo"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Autor *
                    </label>
                    <input
                      type="text"
                      required
                      value={manualAuthor}
                      onChange={(e) => setManualAuthor(e.target.value)}
                      placeholder="Ej. Fiódor Dostoyevski"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Género / Tema
                    </label>
                    <input
                      type="text"
                      value={manualGenre}
                      onChange={(e) => setManualGenre(e.target.value)}
                      placeholder="Ej. Filosofía, Clásico..."
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Estado
                    </label>
                    <select
                      value={manualStatus}
                      onChange={(e) =>
                        setManualStatus(e.target.value as BookStatus)
                      }
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    >
                      <option value="read">Leído</option>
                      <option value="reading">Leyendo</option>
                      <option value="to_read">Por leer (En casa)</option>
                      <option value="wishlist">Por comprar</option>
                      <option value="abandoned">Abandonado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">
                      Calificación
                    </label>
                    <StarRatingInput
                      value={manualRating}
                      onChange={setManualRating}
                      disabled={
                        manualStatus === "wishlist" ||
                        manualStatus === "to_read"
                      }
                      allowClear
                    />
                  </div>
                </div>

                {manualStatus === "wishlist" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">
                        Prioridad de compra
                      </label>
                      <div className="flex gap-2">
                        {(["high", "medium", "low"] as const).map((prio) => (
                          <button
                            key={prio}
                            type="button"
                            onClick={() => setManualPriority(prio)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                              manualPriority === prio
                                ? "bg-amber-400 text-zinc-950 border-amber-400 font-medium"
                                : "bg-zinc-900 text-zinc-300 border-zinc-800"
                            }`}
                          >
                            {PRIORITY_LABELS[prio]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">
                        Precio estimado COP (Opcional)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={manualPrice}
                        onChange={(e) => setManualPrice(e.target.value)}
                        placeholder="Ej. 65000"
                        className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Notas personales
                  </label>
                  <input
                    type="text"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    placeholder="Ej. Edición Penguin, librería donde lo viste, o impresiones de lectura."
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingManual}
                  className="px-5 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
                >
                  {savingManual ? "Guardando..." : "Guardar en mi biblioteca"}
                </button>
              </form>
            )}

            {/* Tab 3: CSV */}
            {activeTab === "csv" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                  <p>
                    Columnas aceptadas:{" "}
                    <code className="text-zinc-200">
                      titulo, autor, genero, estado, calificacion, notas
                    </code>{" "}
                    (estados:{" "}
                    <code className="text-zinc-300">
                      read, reading, to_read, wishlist, abandoned
                    </code>
                    )
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const sample =
                        '\uFEFFtitulo,autor,genero,estado,calificacion,notas\n"El mundo de ayer","Stefan Zweig","Memorias","read",5,"Imprescindible sobre Europa"\n"Rojo y negro","Stendhal","Clásico","reading",,"Edición Penguin"\n"Ana Karenina","Lev Tolstói","Novela psicológica","to_read",,"Ya lo tengo en casa"\n"Los hermanos Karamázov","Fiódor Dostoyevski","Filosofía","wishlist",,"Comprar en edición Alba"';
                      const blob = new Blob([sample], {
                        type: "text/csv;charset=utf-8;",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "plantilla_libros.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="text-zinc-200 underline underline-offset-4 hover:text-white"
                  >
                    Descargar plantilla CSV
                  </button>
                </div>

                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileChange}
                  className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-800 file:text-zinc-100 hover:file:bg-zinc-700"
                />

                {csvPreview.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs text-zinc-300">
                      Vista previa: <strong>{csvPreview.length}</strong>{" "}
                      libros listos para importar.
                    </p>
                    <div className="max-h-48 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800 text-xs">
                      {csvPreview.map((b, i) => (
                        <div
                          key={i}
                          className="p-2.5 bg-zinc-950 flex justify-between gap-4"
                        >
                          <span className="truncate">
                            <strong>{b.title}</strong> — {b.author}
                          </span>
                          <span className="text-zinc-400 shrink-0">
                            {STATUS_LABELS[b.status]}{" "}
                            {b.rating ? `(${b.rating}★)` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={importingCsv}
                      onClick={handleImportCsv}
                      className="px-4 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
                    >
                      {importingCsv
                        ? "Importando..."
                        : `Importar ${csvPreview.length} libros`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Listado de biblioteca */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Mi biblioteca ({filteredBooks.length}
                {filter !== "all" ? ` de ${books.length}` : ""})
              </h2>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(
                  [
                    { key: "all", label: "Todos" },
                    { key: "to_read", label: "Por leer (En casa)" },
                    { key: "wishlist", label: "Por comprar" },
                    { key: "reading", label: "Leyendo" },
                    { key: "read", label: "Leídos" },
                    { key: "abandoned", label: "Abandonados" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-lg border transition ${
                      filter === tab.key
                        ? "bg-zinc-800 border-zinc-600 text-zinc-100"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Resumen de presupuesto cuando se filtra "Por comprar" */}
            {filter === "wishlist" && wishlistBooks.length > 0 && (
              <div className="grid grid-cols-3 gap-3 p-4 bg-zinc-900/70 border border-zinc-800 rounded-xl">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                    Por comprar
                  </p>
                  <p className="text-lg font-semibold text-zinc-100 mt-0.5">
                    {wishlistBooks.length}{" "}
                    {wishlistBooks.length === 1 ? "libro" : "libros"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                    Prioridad alta
                  </p>
                  <p className="text-lg font-semibold text-amber-300 mt-0.5">
                    {wishlistHighPriorityCount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                    Presupuesto est.
                  </p>
                  <p className="text-lg font-semibold text-emerald-300 mt-0.5">
                    {wishlistTotalBudget > 0
                      ? formatCOP(wishlistTotalBudget)
                      : "Sin precios"}
                  </p>
                </div>
              </div>
            )}

            {filteredBooks.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400 bg-zinc-900/40 border border-zinc-800 rounded-xl">
                No hay libros en esta vista todavía.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredBooks.map((book) => (
                  <article
                    key={book.id}
                    className="flex gap-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl"
                  >
                    {book.cover_url ? (
                      <img
                        src={book.cover_url}
                        alt={book.title}
                        className="w-14 h-20 object-cover rounded shrink-0 bg-zinc-950"
                      />
                    ) : (
                      <div className="w-14 h-20 bg-zinc-950 border border-zinc-800 rounded shrink-0 flex items-center justify-center text-[10px] text-zinc-500 text-center p-1">
                        Sin portada
                      </div>
                    )}

                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium text-zinc-100 truncate">
                            {book.title}
                          </h3>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditModal(book)}
                              title="Editar libro"
                              className="text-xs text-zinc-400 hover:text-zinc-100"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(book.id)}
                              title="Eliminar libro"
                              className="text-xs text-zinc-500 hover:text-red-400"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-zinc-400 truncate">
                          {book.author}
                          {book.genre ? ` · ${book.genre}` : ""}
                        </p>

                        {book.status === "wishlist" && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span
                              className={`px-2 py-0.5 text-[11px] rounded border ${
                                book.priority === "high"
                                  ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                                  : book.priority === "low"
                                  ? "bg-zinc-900 border-zinc-800 text-zinc-500"
                                  : "bg-zinc-800/80 border-zinc-700 text-zinc-300"
                              }`}
                            >
                              Prioridad {PRIORITY_LABELS[book.priority]}
                            </span>
                            {book.estimated_price !== null && (
                              <span className="px-2 py-0.5 text-[11px] rounded bg-emerald-950/40 border border-emerald-800/60 text-emerald-300">
                                {formatCOP(book.estimated_price)}
                              </span>
                            )}
                          </div>
                        )}

                        {book.notes && (
                          <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2 italic">
                            “{book.notes}”
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-zinc-800/80">
                        <select
                          value={book.status}
                          onChange={(e) =>
                            handleStatusChange(
                              book,
                              e.target.value as BookStatus
                            )
                          }
                          className="text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300"
                        >
                          <option value="read">Leído</option>
                          <option value="reading">Leyendo</option>
                          <option value="to_read">Por leer (En casa)</option>
                          <option value="wishlist">Por comprar</option>
                          <option value="abandoned">Abandonado</option>
                        </select>

                        {book.status === "wishlist" ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(book, "to_read")
                            }
                            className="px-2.5 py-1 text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-700/60 rounded transition"
                          >
                            ✓ ¡Ya lo compré!
                          </button>
                        ) : book.rating ? (
                          <span className="text-xs text-amber-400">
                            {"★".repeat(book.rating)}
                            <span className="text-zinc-700">
                              {"★".repeat(5 - book.rating)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-600">
                            Sin calificar
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== SECCIÓN 2: VERIFICAR COMPRA ==================== */}
      {section === "purchase" && (
        <div className="space-y-6">
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                Verificar libro antes de comprar
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Comprueba al instante si ya compraste este libro o si ya lo
                tienes anotado en tu lista &ldquo;Por comprar&rdquo;.
              </p>
            </div>

            <form
              onSubmit={handlePurchaseCatalogSearch}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={purchaseQuery}
                onChange={(e) => setPurchaseQuery(e.target.value)}
                placeholder="Ej. Los hermanos Karamázov, Stefan Zweig, Drácula..."
                className="flex-1 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              />
              <button
                type="submit"
                disabled={purchaseSearching || !purchaseQuery.trim()}
                className="px-4 py-2.5 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 shrink-0"
              >
                {purchaseSearching
                  ? "Consultando..."
                  : "Buscar también en catálogo"}
              </button>
            </form>

            {purchaseFeedback && (
              <div
                className={`p-3 text-sm rounded-lg border ${
                  purchaseFeedback.type === "ok"
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-red-950/40 border-red-900 text-red-400"
                }`}
              >
                {purchaseFeedback.text}
              </div>
            )}

            {purchaseQuery.trim().length >= 2 && (
              <div className="space-y-3">
                {localMatches.length > 0 ? (
                  <div className="p-4 bg-amber-950/35 border border-amber-700/70 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                      <span>⚠️</span>
                      <span>
                        Encontramos{" "}
                        {localMatches.length === 1
                          ? "1 coincidencia"
                          : `${localMatches.length} coincidencias`}{" "}
                        en tus registros:
                      </span>
                    </div>
                    <div className="space-y-2">
                      {localMatches.map((match) => (
                        <div
                          key={match.id}
                          className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-950/90 border border-amber-900/50 rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {match.title}
                            </p>
                            <p className="text-xs text-zinc-400 truncate">
                              {match.author}
                              {match.estimated_price !== null
                                ? ` · Est. ${formatCOP(match.estimated_price)}`
                                : ""}
                              {match.notes ? ` · “${match.notes}”` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2.5 py-1 text-xs rounded-md border ${
                                match.status === "wishlist"
                                  ? "bg-sky-500/20 text-sky-200 border-sky-500/30"
                                  : "bg-amber-500/20 text-amber-200 border-amber-500/30"
                              }`}
                            >
                              {match.status === "wishlist"
                                ? "🛒 En lista Por comprar"
                                : `✓ Ya comprado (${STATUS_LABELS[match.status]})`}
                            </span>
                            {match.status === "wishlist" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(match, "to_read")
                                }
                                className="px-2.5 py-1 text-xs bg-emerald-500 text-zinc-950 font-medium rounded-md hover:bg-emerald-400"
                              >
                                Marcar comprado
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-950/25 border border-emerald-800/50 rounded-xl flex items-center gap-2.5 text-sm text-emerald-300">
                    <span>✓</span>
                    <span>
                      No tienes ningún libro que coincida con{" "}
                      <strong>“{purchaseQuery.trim()}”</strong> en tu
                      biblioteca ni en tu lista de compras.
                    </span>
                  </div>
                )}
              </div>
            )}

            {purchaseCatalogResults.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <h3 className="text-xs uppercase tracking-wider text-zinc-400">
                  Ediciones encontradas en catálogo
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {purchaseCatalogResults.map((item) => {
                    const existing = findMatchForCatalogItem(item);
                    return (
                      <div
                        key={`${item.source}-${item.id}`}
                        className={`flex items-start justify-between gap-3 p-3 rounded-xl border ${
                          existing
                            ? "bg-amber-950/20 border-amber-800/60"
                            : "bg-zinc-950 border-zinc-800"
                        }`}
                      >
                        <div className="flex gap-3 min-w-0">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-11 h-16 object-cover rounded shrink-0 bg-zinc-900"
                            />
                          ) : (
                            <div className="w-11 h-16 bg-zinc-900 rounded shrink-0 flex items-center justify-center text-[10px] text-zinc-500">
                              Sin tapa
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-zinc-400 truncate">
                              {item.authors.join(", ")}
                            </p>
                            {existing ? (
                              <span className="inline-block mt-1.5 px-2 py-0.5 text-[11px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                {existing.status === "wishlist"
                                  ? "🛒 Ya en Por comprar"
                                  : `⚠️ Ya lo tienes (${STATUS_LABELS[existing.status]})`}
                              </span>
                            ) : (
                              <span className="inline-block mt-1.5 text-[11px] text-emerald-400">
                                ✓ Nuevo para ti
                              </span>
                            )}
                          </div>
                        </div>

                        {!existing && (
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickAddFromPurchase(item, "to_read")
                              }
                              className="px-2.5 py-1 text-[11px] bg-zinc-100 text-zinc-950 font-medium rounded-md hover:bg-zinc-200"
                            >
                              + Comprado
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickAddFromPurchase(item, "wishlist")
                              }
                              className="px-2.5 py-1 text-[11px] bg-zinc-800 text-zinc-200 rounded-md hover:bg-zinc-700"
                            >
                              + Por comprar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== SECCIÓN 3: RECOMENDACIONES GEMINI ==================== */}
      {section === "gemini" && (
        <GeminiRecommenderPanel
          books={books}
          onBookAdded={(newBook) => setBooks((prev) => [newBook, ...prev])}
        />
      )}

      {/* ==================== SECCIÓN 4: SOLICITUDES (ADMIN) ==================== */}
      {section === "admin" && isAdmin && (
        <AdminApprovalsPanel onPendingCountChange={setPendingCount} />
      )}

      {/* ==================== MODAL DE EDICIÓN ==================== */}
      {editingBook && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setEditingBook(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-semibold text-zinc-100">
                Editar libro
              </h3>
              <button
                type="button"
                onClick={() => setEditingBook(null)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Título *
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Autor *
                </label>
                <input
                  type="text"
                  required
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-2">
                Estado en tu biblioteca
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "read",
                    "reading",
                    "to_read",
                    "wishlist",
                    "abandoned",
                  ] as const
                ).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setEditStatus(st)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                      editStatus === st
                        ? "bg-zinc-100 text-zinc-950 border-zinc-100 font-medium"
                        : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    {STATUS_LABELS[st]}
                  </button>
                ))}
              </div>
            </div>

            {editStatus === "wishlist" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    Prioridad de compra
                  </label>
                  <div className="flex gap-2">
                    {(["high", "medium", "low"] as const).map((prio) => (
                      <button
                        key={prio}
                        type="button"
                        onClick={() => setEditPriority(prio)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                          editPriority === prio
                            ? "bg-amber-400 text-zinc-950 border-amber-400 font-medium"
                            : "bg-zinc-900 text-zinc-300 border-zinc-800"
                        }`}
                      >
                        {PRIORITY_LABELS[prio]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Precio estimado COP
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="Ej. 65000"
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Calificación
                </label>
                <StarRatingInput
                  value={editRating}
                  onChange={setEditRating}
                  disabled={
                    editStatus === "wishlist" || editStatus === "to_read"
                  }
                  allowClear
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Género / Tema
                </label>
                <input
                  type="text"
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Notas o comentario personal
              </label>
              <textarea
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Tus impresiones sobre este libro..."
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setEditingBook(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
              >
                {savingEdit ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}