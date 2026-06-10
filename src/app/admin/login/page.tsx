import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ viga?: string }>;
}) {
  if (await isAdmin()) redirect("/admin");
  const { viga } = await searchParams;

  return (
    <main className="container" style={{ maxWidth: 460 }}>
      <h1>Halduri sisselogimine</h1>
      <form method="post" action="/api/admin/login" className="card form-grid">
        {viga && <p className="form-error" style={{ margin: 0 }}>Vale e-post või parool.</p>}
        <div>
          <label className="field-label" htmlFor="email">
            E-post
          </label>
          <input id="email" name="email" type="email" autoComplete="username" />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Parool
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <div>
          <button type="submit" className="btn">
            Logi sisse
          </button>
        </div>
      </form>
    </main>
  );
}
