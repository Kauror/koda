#!/bin/sh
set -e

echo "[entrypoint] Running database migrations…"
npx prisma migrate deploy

echo "[entrypoint] Starting Next.js…"
exec npx next start -p "${PORT:-3000}"
