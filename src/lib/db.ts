import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { resolve } from "path";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeAdapter() {
  if (process.env.KODA_DB_DRIVER === "pglite") {
    const dir = resolve(process.cwd(), process.env.KODA_PGLITE_DIR || ".pglite");
    const client = new PGlite(dir);
    return new PrismaPGlite(client);
  }

  // Engine-free client (see generator config in schema.prisma): queries run
  // through the pg driver adapter, removing the native Rust engine dependency.
  return new PrismaPg({ connectionString: process.env.DATABASE_URL });
}

// pglite-prisma-adapter can depend on a slightly different
// @prisma/driver-adapter-utils version than @prisma/client; the runtime shape is
// compatible, so we bridge the nominal type mismatch here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter: makeAdapter() as any });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
