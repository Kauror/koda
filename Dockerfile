# Single-stage image on purpose: the same container can run the web app,
# Prisma migrations and the crawler/seed scripts (npm run crawl / npm run seed).
FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Generate Prisma client and build the Next.js app.
# DATABASE_URL is not needed at build time (pages are dynamic).
RUN npx prisma generate && npx next build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
