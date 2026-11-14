import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/SignOutButton";

export default async function HomePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-semibold">
              Hola, {session.user.name}
            </h1>
            <p className="text-sm text-zinc-400">
              Sesión activa ({session.user.email})
            </p>
          </div>
          <SignOutButton />
        </header>

        <section className="mt-10 p-6 bg-zinc-900/60 border border-zinc-800 rounded-xl">
          <p className="text-zinc-300 text-sm">
            Autenticación configurada correctamente. En el siguiente paso
            construiremos aquí tu biblioteca personal (búsqueda con Google
            Books, carga manual e importación CSV).
          </p>
        </section>
      </div>
    </main>
  );
}