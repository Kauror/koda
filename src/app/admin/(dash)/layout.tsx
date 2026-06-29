import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");

  return (
    <main className="container">
      <div className="admin-nav">
        <Link href="/admin">Töölaud</Link>
        <Link href="/admin/content">Sisu</Link>
        <Link href="/admin/topics">Teemagrupid</Link>
        <Link href="/admin/tags">Sildid</Link>
        <Link href="/admin/data-bundle">Andmepakett</Link>
        <Link href="/admin/data-review">Andmeülevaatus</Link>
        <Link href="/admin/audit">Muudatuste logi</Link>
        <Link href="/admin/ingestion">Ingestion</Link>
        <Link href="/admin/laws">Õigusaktid</Link>
        <Link href="/admin/status">Staatus</Link>
        <Link href="/admin/site-texts">Avalehe tekstid</Link>
        <Link href="/" target="_blank">
          Avalik vaade ↗
        </Link>
        <form method="post" action="/api/admin/logout" className="inline-form" style={{ marginLeft: "auto" }}>
          <button type="submit" className="btn btn-secondary btn-small">
            Logi välja
          </button>
        </form>
      </div>
      {children}
    </main>
  );
}
