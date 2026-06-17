# Single-stage image on purpose: the same container can run the web app,
# Prisma migrations and the crawler/seed scripts (npm run crawl / npm run seed).
FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install ALL dependencies (incl. devDependencies). Production runtime needs
# them for the import/migration tooling: tsx + xlsx (merge-ready import scripts)
# and prisma (migrate deploy). Do NOT add --omit=dev here. The Linux container
# generates the NATIVE Prisma query engine for linux-musl, so the Windows-ARM
# PGlite/x64-Node workaround is never used in the container (it is dev-only).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Generate Prisma client and build the Next.js app.
# DATABASE_URL is not needed at build time (pages are dynamic).
RUN npx prisma generate && npx next build

# Import directory exists even when no volume is mounted, so report writing and
# clear "missing input file" errors work. In deployment this is bind-mounted.
RUN mkdir -p /app/data/import/reports

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
