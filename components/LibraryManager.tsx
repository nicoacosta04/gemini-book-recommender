"use client";

import { useState } from "react";
import { RecommendationsPanel } from "./RecommendationsPanel";

export interface Book {
  id: number;
  title: string;
  author: string;
  genre: string | null;
  status: "read" | "reading" | "wishlist" | "abandoned";
  rating: number | null;
  notes: string | null;
  google_books_id: string | null;
  cover_url: string | null;
}

interface SearchBookResult {
  id: string;
  source: "google" | "openlibrary";
  title: string;
  authors: string[];
  category: string | null;
  thumbnail: string | null;
}

const STATUS_LABELS: Record<Book["status"], string> = {
  read: "Leído",
  reading: "Leyendo",
  wishlist: "Por leer",
  abandoned: "Abandonado",
};

const RATING_HINTS: Record<number, string> = {
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

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLibraryMatches(query: string, library: Book[]): Book[] {
  const cleanQuery = normalizeText(query);
  if (cleanQuery.length < 2) return [];

  const tokens = cleanQuery
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  return library.filter((book) => {
    const haystack = normalizeText(`${book.title} ${book.author}`);
    if (haystack.includes(cleanQuery)) return true;
    if (tokens.length > 0 && tokens.every((t) => haystack.includes(t))) {
      return true;
    }
    return false;
  });
}

function matchCatalogItemInLibrary(
  item: SearchBookResult,
  library: Book[]
): Book | undefined {
  const normItemTitle = normalizeText(item.title);
  if (!normItemTitle) return undefined;

  return library.find((book) => {
    if (
      item.source === "google" &&
      book.google_books_id &&
      book.google_books_id === item.id
    ) {
      return true;
    }
    const normBookTitle = normalizeText(book.title);
    if (normBookTitle === normItemTitle) return true;
    if (
      normBookTitle.length >= 5 &&
      normItemTitle.length >= 5 &&
      (normBookTitle.includes(normItemTitle) ||
        normItemTitle.includes(normBookTitle))
    ) {
      return true;
    }
    return false;
  });
}

function normalizeStatus(raw: string): Book["status"] {
  const val = raw.trim().toLowerCase();
  if (["reading", "leyendo", "en curso"].includes(val)) return "reading";
  if (["wishlist", "por leer", "pendiente", "deseos"].includes(val))
    return "wishlist";
  if (["abandoned", "abandonado"].includes(val)) return "abandoned";
  return "read";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function StarSelector({
  value,
  onChange,
  disabled = false,
  allowClear = false,
}: {
  value: number | null;
  onChange: (val: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const current = value ?? 0;

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
                : star <= current
                ? "text-amber-400 hover:scale-110"
                : "text-zinc-700 hover:text-zinc-500"
            }`}
            aria-label={`${star} estrellas`}
          >
            ★
          </button>
        ))}
      </div>
      {!disabled && current > 0 && (
        <span className="text-xs text-zinc-400">
          {RATING_HINTS[current] || ""}
        </span>
      )}
      {!disabled && allowClear && current > 0 && (
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

export function LibraryManager({ initialBooks }: { initialBooks: Book[] }) {
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [screen, setScreen] = useState<"library" | "purchase" | "gemini">(
    "library"
  );

  // Sub-pestañas y filtros de Pantalla 1 (Mi Biblioteca)
  const [activeTab, setActiveTab] = useState<"google" | "manual" | "csv">(
    "google"
  );
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  // Estado búsqueda de catálogo y libro seleccionado (Pantalla 1)
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchBookResult[]>([]);
  const [selectedBook, setSelectedBook] = useState<SearchBookResult | null>(
    null
  );
  const [selectedGenre, setSelectedGenre] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<Book["status"]>("read");
  const [selectedRating, setSelectedRating] = useState<number | null>(5);
  const [selectedNotes, setSelectedNotes] = useState("");
  const [savingSelected, setSavingSelected] = useState(false);

  // Estado formulario manual
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [status, setStatus] = useState<Book["status"]>("read");
  const [rating, setRating] = useState<number | null>(5);
  const [notes, setNotes] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Estado importación CSV
  const [csvPreview, setCsvPreview] = useState<
    Omit<Book, "id" | "google_books_id" | "cover_url">[]
  >([]);
  const [importingCsv, setImportingCsv] = useState(false);

  // Estado modal de edición de libro existente
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editStatus, setEditStatus] = useState<Book["status"]>("read");
  const [editRating, setEditRating] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Estado Pantalla 2: Verificar antes de comprar
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [searchingPurchaseCatalog, setSearchingPurchaseCatalog] =
    useState(false);
  const [purchaseCatalogResults, setPurchaseCatalogResults] = useState<
    SearchBookResult[]
  >([]);
  const [purchaseFeedback, setPurchaseFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const reloadBooks = async () => {
    const res = await fetch("/api/books");
    if (res.ok) {
      const data = await res.json();
      setBooks(data.books);
    }
  };

  const handleBookSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setFeedback(null);
    setSelectedBook(null);

    try {
      const res = await fetch(
        `/api/books/search?q=${encodeURIComponent(searchQuery.trim())}`
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

  const handleSelectBook = (item: SearchBookResult) => {
    setSelectedBook(item);
    setSelectedGenre(item.category || "");
    setSelectedStatus("read");
    setSelectedRating(5);
    setSelectedNotes("");
    setFeedback(null);
  };

  const handleSaveSelectedBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBook) return;
    setSavingSelected(true);
    setFeedback(null);

    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedBook.title,
        author: selectedBook.authors.join(", "),
        genre: selectedGenre || null,
        status: selectedStatus,
        rating: selectedStatus === "wishlist" ? null : selectedRating,
        notes: selectedNotes || null,
        google_books_id:
          selectedBook.source === "google" ? selectedBook.id : null,
        cover_url: selectedBook.thumbnail,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setSelectedBook(null);
      setFeedback({
        type: "ok",
        text: `"${data.book.title}" agregado a tu biblioteca.`,
      });
    } else {
      setFeedback({ type: "err", text: "No se pudo guardar el libro." });
    }
    setSavingSelected(false);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingManual(true);
    setFeedback(null);

    const res = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        genre,
        status,
        rating: status === "wishlist" ? null : rating,
        notes,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setTitle("");
      setAuthor("");
      setGenre("");
      setNotes("");
      setFeedback({
        type: "ok",
        text: `"${data.book.title}" guardado correctamente.`,
      });
    } else {
      const err = await res.json();
      setFeedback({
        type: "err",
        text: err.error || "Error al guardar el libro.",
      });
    }
    setSavingManual(false);
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);

    const text = (await file.text()).replace(/^\uFEFF/, "");
    const lines = text
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
    const rawHeaders = parseCsvLine(lines[0], delimiter).map((h) =>
      h
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    );

    const idxTitle = rawHeaders.findIndex((h) =>
      ["title", "titulo", "libro"].includes(h)
    );
    const idxAuthor = rawHeaders.findIndex((h) =>
      ["author", "autor"].includes(h)
    );
    const idxGenre = rawHeaders.findIndex((h) =>
      ["genre", "genero", "categoria"].includes(h)
    );
    const idxStatus = rawHeaders.findIndex((h) =>
      ["status", "estado"].includes(h)
    );
    const idxRating = rawHeaders.findIndex((h) =>
      ["rating", "calificacion", "puntaje", "estrellas"].includes(h)
    );
    const idxNotes = rawHeaders.findIndex((h) =>
      ["notes", "notas", "comentario"].includes(h)
    );

    if (idxTitle === -1 || idxAuthor === -1) {
      setFeedback({
        type: "err",
        text: "El CSV debe tener al menos las columnas 'title' (o 'titulo') y 'author' (o 'autor').",
      });
      return;
    }

    const parsed = lines
      .slice(1)
      .map((line) => {
        const cols = parseCsvLine(line, delimiter);
        const rowRating = idxRating !== -1 ? Number(cols[idxRating]) : NaN;
        return {
          title: cols[idxTitle] || "",
          author: cols[idxAuthor] || "",
          genre: idxGenre !== -1 && cols[idxGenre] ? cols[idxGenre] : null,
          status:
            idxStatus !== -1 && cols[idxStatus]
              ? normalizeStatus(cols[idxStatus])
              : ("read" as const),
          rating:
            rowRating >= 1 && rowRating <= 5 ? Math.round(rowRating) : null,
          notes: idxNotes !== -1 && cols[idxNotes] ? cols[idxNotes] : null,
        };
      })
      .filter((r) => r.title && r.author);

    setCsvPreview(parsed);
  };

  const handleConfirmCsvImport = async () => {
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
      await reloadBooks();
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

  const downloadTemplate = () => {
    const sample =
      "\uFEFFtitulo,autor,genero,estado,calificacion,notas\n" +
      '"El mundo de ayer","Stefan Zweig","Memorias","read",5,"Imprescindible sobre Europa"\n' +
      '"Rojo y negro","Stendhal","Clásico","reading",,"Edición Penguin"\n' +
      '"Ana Karenina","Lev Tolstói","Novela psicológica","wishlist",,';
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_libros.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStatusChange = async (book: Book, newStatus: Book["status"]) => {
    const res = await fetch("/api/books", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...book,
        status: newStatus,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => prev.map((b) => (b.id === book.id ? data.book : b)));
    }
  };

  const openEditModal = (book: Book) => {
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditGenre(book.genre || "");
    setEditStatus(book.status);
    setEditRating(book.rating);
    setEditNotes(book.notes || "");
    setFeedback(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook) return;
    setSavingEdit(true);

    const res = await fetch("/api/books", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingBook.id,
        title: editTitle,
        author: editAuthor,
        genre: editGenre,
        status: editStatus,
        rating: editStatus === "wishlist" ? null : editRating,
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
      const err = await res.json();
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

  // Funciones Pantalla 2: Verificar compra
  const handlePurchaseCatalogSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseQuery.trim()) return;
    setSearchingPurchaseCatalog(true);
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
      setSearchingPurchaseCatalog(false);
    }
  };

  const handleQuickAddFromPurchase = async (
    item: SearchBookResult,
    targetStatus: "wishlist" | "reading"
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
        google_books_id: item.source === "google" ? item.id : null,
        cover_url: item.thumbnail,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setBooks((prev) => [data.book, ...prev]);
      setPurchaseFeedback({
        type: "ok",
        text: `"${data.book.title}" agregado a tu inventario como "${STATUS_LABELS[targetStatus]}".`,
      });
    } else {
      setPurchaseFeedback({
        type: "err",
        text: "No se pudo guardar el libro en tu biblioteca.",
      });
    }
  };

  const filteredBooks =
    filterStatus === "all"
      ? books
      : books.filter((b) => b.status === filterStatus);

  const localPurchaseMatches = findLibraryMatches(purchaseQuery, books);

  return (
    <div className="space-y-8">
      {/* Navegación principal de 3 pantallas */}
      <nav
        aria-label="Secciones principales"
        className="grid grid-cols-3 gap-2 p-1.5 bg-zinc-900 border border-zinc-800 rounded-xl"
      >
        <button
          type="button"
          onClick={() => setScreen("library")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            screen === "library"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          1. Mi Biblioteca ({books.length})
        </button>
        <button
          type="button"
          onClick={() => setScreen("purchase")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            screen === "purchase"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          2. Verificar Compra
        </button>
        <button
          type="button"
          onClick={() => setScreen("gemini")}
          className={`py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition ${
            screen === "gemini"
              ? "bg-zinc-100 text-zinc-950 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          }`}
        >
          3. Recomendaciones IA
        </button>
      </nav>

      {/* ===================================================================== */}
      {/* PANTALLA 1: MI BIBLIOTECA                                             */}
      {/* ===================================================================== */}
      {screen === "library" && (
        <div className="space-y-8">
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

            {/* TAB 1: BUSCADOR DE CATÁLOGO */}
            {activeTab === "google" && (
              <div className="space-y-5">
                <form onSubmit={handleBookSearch} className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
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

                {/* Paso 2 del buscador: Formulario de categorización del libro elegido */}
                {selectedBook && (
                  <form
                    onSubmit={handleSaveSelectedBook}
                    className="p-5 bg-zinc-950 border border-zinc-700 rounded-xl space-y-4"
                  >
                    <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
                      <div className="flex gap-3.5 min-w-0">
                        {selectedBook.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedBook.thumbnail}
                            alt={selectedBook.title}
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
                            {selectedBook.title}
                          </h3>
                          <p className="text-xs text-zinc-400">
                            {selectedBook.authors.join(", ")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedBook(null)}
                        className="text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        ✕ Cancelar
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-2">
                        Estado de lectura
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            "read",
                            "reading",
                            "wishlist",
                            "abandoned",
                          ] as Book["status"][]
                        ).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setSelectedStatus(st)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                              selectedStatus === st
                                ? "bg-zinc-100 text-zinc-950 border-zinc-100 font-medium"
                                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                            }`}
                          >
                            {STATUS_LABELS[st]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">
                          Calificación{" "}
                          {selectedStatus === "wishlist" &&
                            "(no aplica para 'Por leer')"}
                        </label>
                        <StarSelector
                          value={selectedRating}
                          onChange={setSelectedRating}
                          disabled={selectedStatus === "wishlist"}
                          allowClear
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1">
                          Género / Tema
                        </label>
                        <input
                          type="text"
                          value={selectedGenre}
                          onChange={(e) => setSelectedGenre(e.target.value)}
                          placeholder="Ej. Filosofía, Novela histórica..."
                          className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">
                        Comentario o notas personales (Gemini lo usará para
                        afinar tus recomendaciones)
                      </label>
                      <textarea
                        rows={2}
                        value={selectedNotes}
                        onChange={(e) => setSelectedNotes(e.target.value)}
                        placeholder="Ej. Me atrapó la profundidad psicológica de los personajes y el ritmo narrativo."
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={savingSelected}
                        className="px-4 py-2 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50"
                      >
                        {savingSelected
                          ? "Guardando..."
                          : "Guardar en mi biblioteca"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedBook(null)}
                        className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                      >
                        Elegir otro
                      </button>
                    </div>
                  </form>
                )}

                {/* Listado de resultados de búsqueda */}
                {searchResults.length > 0 && !selectedBook && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {searchResults.map((item) => (
                      <div
                        key={`${item.source}-${item.id}`}
                        className="flex items-start justify-between gap-3 p-3 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl transition"
                      >
                        <div className="flex gap-3 min-w-0">
                          {item.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
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
                          onClick={() => handleSelectBook(item)}
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

            {/* TAB 2: CARGA MANUAL */}
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
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
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
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
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
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="Ej. Filosofía, Clásico..."
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Estado
                    </label>
                    <select
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as Book["status"])
                      }
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                    >
                      <option value="read">Leído</option>
                      <option value="reading">Leyendo</option>
                      <option value="wishlist">Por leer</option>
                      <option value="abandoned">Abandonado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">
                      Calificación
                    </label>
                    <StarSelector
                      value={rating}
                      onChange={setRating}
                      disabled={status === "wishlist"}
                      allowClear
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Notas personales (Gemini usará esto para entender qué te
                    gustó o no)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej. Me encantó el análisis psicológico del narrador y el tono existencial."
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

            {/* TAB 3: IMPORTACIÓN CSV */}
            {activeTab === "csv" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                  <p>
                    Sube un CSV con columnas:{" "}
                    <code className="text-zinc-200">
                      titulo, autor, genero, estado, calificacion, notas
                    </code>
                  </p>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="text-zinc-200 underline underline-offset-4 hover:text-white"
                  >
                    Descargar plantilla CSV
                  </button>
                </div>

                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFile}
                  className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-800 file:text-zinc-100 hover:file:bg-zinc-700"
                />

                {csvPreview.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs text-zinc-300">
                      Vista previa: <strong>{csvPreview.length}</strong> libros
                      listos para importar.
                    </p>
                    <div className="max-h-48 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800 text-xs">
                      {csvPreview.map((row, i) => (
                        <div
                          key={i}
                          className="p-2.5 bg-zinc-950 flex justify-between gap-4"
                        >
                          <span className="truncate">
                            <strong>{row.title}</strong> — {row.author}
                          </span>
                          <span className="text-zinc-400 shrink-0">
                            {STATUS_LABELS[row.status]}{" "}
                            {row.rating ? `(${row.rating}★)` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={importingCsv}
                      onClick={handleConfirmCsvImport}
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

          {/* Listado de biblioteca personal */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Mi biblioteca ({filteredBooks.length}
                {filterStatus !== "all" ? ` de ${books.length}` : ""})
              </h2>

              <div className="flex flex-wrap gap-1.5 text-xs">
                {[
                  { key: "all", label: "Todos" },
                  { key: "read", label: "Leídos" },
                  { key: "reading", label: "Leyendo" },
                  { key: "wishlist", label: "Por leer" },
                  { key: "abandoned", label: "Abandonados" },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilterStatus(f.key)}
                    className={`px-3 py-1.5 rounded-lg border transition ${
                      filterStatus === f.key
                        ? "bg-zinc-800 border-zinc-600 text-zinc-100"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredBooks.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400 bg-zinc-900/40 border border-zinc-800 rounded-xl">
                No hay libros en esta vista todavía. Agrega tu primer libro
                arriba.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredBooks.map((book) => (
                  <article
                    key={book.id}
                    className="flex gap-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl"
                  >
                    {book.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
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
                              e.target.value as Book["status"]
                            )
                          }
                          className="text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300"
                        >
                          <option value="read">Leído</option>
                          <option value="reading">Leyendo</option>
                          <option value="wishlist">Por leer</option>
                          <option value="abandoned">Abandonado</option>
                        </select>

                        {book.rating ? (
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

      {/* ===================================================================== */}
      {/* PANTALLA 2: VERIFICAR COMPRA / INVENTARIO ANTI-DUPLICADOS             */}
      {/* ===================================================================== */}
      {screen === "purchase" && (
        <div className="space-y-6">
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                Verificar libro antes de comprar
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Escribe el título o autor del libro que estás viendo para
                comprobar al instante si ya lo tienes registrado en tu
                biblioteca.
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
                disabled={searchingPurchaseCatalog || !purchaseQuery.trim()}
                className="px-4 py-2.5 bg-zinc-100 text-zinc-950 text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 shrink-0"
              >
                {searchingPurchaseCatalog
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

            {/* Resultado inmediato contra tu inventario */}
            {purchaseQuery.trim().length >= 2 && (
              <div className="space-y-3">
                {localPurchaseMatches.length > 0 ? (
                  <div className="p-4 bg-amber-950/35 border border-amber-700/70 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                      <span>⚠️</span>
                      <span>
                        ¡Atención! Encontramos{" "}
                        {localPurchaseMatches.length === 1
                          ? "1 coincidencia"
                          : `${localPurchaseMatches.length} coincidencias`}{" "}
                        en tu biblioteca:
                      </span>
                    </div>

                    <div className="space-y-2">
                      {localPurchaseMatches.map((match) => (
                        <div
                          key={match.id}
                          className="flex items-center justify-between gap-3 p-3 bg-zinc-950/90 border border-amber-900/50 rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {match.title}
                            </p>
                            <p className="text-xs text-zinc-400 truncate">
                              {match.author}
                              {match.notes ? ` · “${match.notes}”` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-2.5 py-1 text-xs rounded-md bg-amber-500/20 text-amber-200 border border-amber-500/30">
                              {STATUS_LABELS[match.status]}
                            </span>
                            {match.rating && (
                              <span className="text-xs text-amber-400">
                                {match.rating}★
                              </span>
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
                      biblioteca.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Resultados del catálogo externo con semáforo de duplicados */}
            {purchaseCatalogResults.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <h3 className="text-xs uppercase tracking-wider text-zinc-400">
                  Ediciones encontradas en catálogo
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {purchaseCatalogResults.map((item) => {
                    const existing = matchCatalogItemInLibrary(item, books);
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
                            // eslint-disable-next-line @next/next/no-img-element
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
                                ⚠️ Ya lo tienes ({STATUS_LABELS[existing.status]}
                                )
                              </span>
                            ) : (
                              <span className="inline-block mt-1.5 text-[11px] text-emerald-400">
                                ✓ No está en tu biblioteca
                              </span>
                            )}
                          </div>
                        </div>

                        {!existing && (
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickAddFromPurchase(item, "reading")
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
                              + Por leer
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

      {/* ===================================================================== */}
      {/* PANTALLA 3: RECOMENDACIONES CON GEMINI (PASO 5)                       */}
      {/* ===================================================================== */}
      {screen === "gemini" && (
        <RecommendationsPanel
          books={books}
          onBookAdded={(newBook) => setBooks((prev) => [newBook, ...prev])}
          />
      )}

      {/* ===================================================================== */}
      {/* MODAL DE EDICIÓN DE LIBRO                                             */}
      {/* ===================================================================== */}
      {editingBook && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setEditingBook(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4 shadow-2xl"
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
                Estado de lectura
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "read",
                    "reading",
                    "wishlist",
                    "abandoned",
                  ] as Book["status"][]
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Calificación
                </label>
                <StarSelector
                  value={editRating}
                  onChange={setEditRating}
                  disabled={editStatus === "wishlist"}
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