import { redirect } from "next/navigation";
import { getGuardedSession } from "@/lib/session-guard";
import { pool } from "@/lib/db";
import { SignOutButton } from "@/components/SignOutButton";
import { LibraryManager, Book } from "@/components/LibraryManager";

export default async function HomePage() {
  const user = await getGuardedSession();

  if (!user) {
    redirect("/login");
  }

  if (!user.approved) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-5 shadow-xl text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 text-xl">
            ⏳
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold text-zinc-100">
              Solicitud pendiente de aprobación
            </h1>
            <p className="text-sm text-zinc-400">
              Hola <strong className="text-zinc-200">{user.name}</strong> (
              {user.email}). Tu cuenta fue creada correctamente, pero el
              administrador debe habilitar tu acceso antes de entrar a la
              biblioteca.
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3">
            <a
              href="/"
              className="px-4 py-2 text-sm bg-zinc-100 text-zinc-950 font-medium rounded-lg hover:bg-zinc-200 transition"
            >
              Comprobar acceso
            </a>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  const result = await pool.query<Book>(
    `SELECT id, title, author, genre, status, rating, notes, google_books_id, cover_url, priority, estimated_price
     FROM books
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [user.id]
  );

  const initialBooks: Book[] = result.rows.map((row) => ({
    ...row,
    estimated_price:
      row.estimated_price !== null && row.estimated_price !== undefined
        ? Number(row.estimated_price)
        : null,
    priority:
      row.priority === "high" || row.priority === "low"
        ? row.priority
        : "medium",
  }));

  let pendingUsersCount = 0;
  if (user.role === "admin") {
    const pendingRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "user" WHERE approved = false`
    );
    pendingUsersCount = Number(pendingRes.rows[0]?.count || 0);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-semibold">
              Biblioteca de {user.name}
            </h1>
            <p className="text-sm text-zinc-400">
              Sesión activa ({user.email})
              {user.role === "admin" ? " · Administrador" : ""}
            </p>
          </div>
          <SignOutButton />
        </header>

        <LibraryManager
          initialBooks={initialBooks}
          isAdmin={user.role === "admin"}
          initialPendingCount={pendingUsersCount}
        />
      </div>
    </main>
  );
}