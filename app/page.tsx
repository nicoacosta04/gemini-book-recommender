import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { SignOutButton } from "@/components/SignOutButton";
import { LibraryManager, Book } from "@/components/LibraryManager";

export default async function HomePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const result = await pool.query<Book>(
    `SELECT id, title, author, genre, status, rating, notes, google_books_id, cover_url
     FROM books
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [session.user.id]
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-semibold">
              Biblioteca de {session.user.name}
            </h1>
            <p className="text-sm text-zinc-400">
              Sesión activa ({session.user.email})
            </p>
          </div>
          <SignOutButton />
        </header>

        <LibraryManager initialBooks={result.rows} />
      </div>
    </main>
  );
}