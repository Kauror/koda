/**
 * PrismaClient factory for the CLI scripts.
 *
 * Production / normal use: a plain `new PrismaClient()` over the native query
 * engine and `DATABASE_URL`.
 *
 * Local verification use (`KODA_DB_DRIVER=pglite`): a driver-adapter client
 * backed by PGlite (PostgreSQL compiled to WASM). This runs on any CPU
 * architecture without Docker, a Postgres server, or the native engine — it is
 * the only way to exercise the import on a Windows-on-ARM dev box, where Prisma
 * ships no native query engine. The PGlite data lives in KODA_PGLITE_DIR so
 * separate script runs share state (needed for the idempotency test).
 */
import { PrismaClient } from "@prisma/client";
import { resolve } from "path";

export type ClientHandle = { prisma: PrismaClient; close: () => Promise<void> };

export const PGLITE_DIR = resolve(process.cwd(), process.env.KODA_PGLITE_DIR || ".pglite");

export function usingPglite(): boolean {
  return process.env.KODA_DB_DRIVER === "pglite";
}

export async function makePrismaClient(): Promise<ClientHandle> {
  if (usingPglite()) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PrismaPGlite } = await import("pglite-prisma-adapter");
    const client = new PGlite(PGLITE_DIR);
    await client.waitReady;
    const adapter = new PrismaPGlite(client);
    // pglite-prisma-adapter@0.6.x is built against @prisma/driver-adapter-utils
    // 6.10 while the client embeds 6.19 types; the factory shape is identical at
    // runtime (the adapter declares support for @prisma/client >= 6.10), so we
    // bridge the nominal type-version mismatch here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = new PrismaClient({ adapter: adapter as any });
    return {
      prisma,
      close: async () => {
        await prisma.$disconnect().catch(() => {});
        await client.close().catch(() => {});
      },
    };
  }

  // Real PostgreSQL via the pg driver adapter.
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  return { prisma, close: () => prisma.$disconnect().catch(() => {}) };
}
