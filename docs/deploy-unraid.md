# Deploying the Koda app on Docker / Unraid (test environment)

Test environment target:

- **Domain:** `koda.orgusaar.ee`
- **Runtime:** Docker container on Unraid (Linux / x64)
- **App port (internal):** `3000`
- **Database:** PostgreSQL 16 container (this compose) or an external PostgreSQL
  reachable from the app container.

The app and the merge-ready import run in the **same single-stage image**
(`Dockerfile`). The container generates the **native** Prisma query engine for
Linux at build time and uses `@prisma/adapter-pg` to talk to PostgreSQL — no
PGlite, no x64-Node trick (those are local Windows-ARM dev workarounds only,
see [Environment separation](#environment-separation)).

---

## Environment separation

| Environment | Engine / DB driver | Notes |
| --- | --- | --- |
| **A. Local dev on Windows ARM** | PGlite (WASM) + emulated x64 Node | `KODA_DB_DRIVER=pglite`, see [import-merge-ready.md](import-merge-ready.md). Dev-only. |
| **B. Docker / Unraid test** (this doc) | Native Linux engine + `@prisma/adapter-pg` over `DATABASE_URL` | What gets deployed. |
| **C. Future production** | Same as B | Just different domain / secrets. |

The Docker/Unraid deployment **must not** depend on: PGlite, an x64 Node outside
the repo, Windows paths, Excel files committed to git, or Prisma engine binaries
committed to git. None of those are in the image or the repo.

---

## 1. Required mounted folders

| Purpose | Host (Unraid) | Container |
| --- | --- | --- |
| Merge-ready import files + reports | `/mnt/user/appdata/koda/import` | `/app/data/import` |
| PostgreSQL data | Docker named volume `pgdata` (or a host path, see below) | `/var/lib/postgresql/data` |

- Put the three `.xlsx` files plus taxonomy `.txt` directly in
  `/mnt/user/appdata/koda/import/`.
- QA reports are written by the import to
  `/mnt/user/appdata/koda/import/reports/` (same mount).
- **Excel files are never committed to git and never baked into the image** —
  they only exist on the host mount.

Required files in the import folder:

```
koda_web_content_v0_9_4_cleaned.xlsx
koda_opinions_v0_9_1.xlsx
koda_toovoidud_enrichment_v0_9_1.xlsx
koda_taxonomy_rules_v0_9_1.txt
```

---

## 2. Required environment variables (`.env`)

Copy `.env.example` to `.env` next to `docker-compose.yml` and set at least:

```dotenv
APP_URL=https://koda.orgusaar.ee
POSTGRES_USER=koda
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=koda
# DATABASE_URL is assembled by compose from the POSTGRES_* values and host "postgres".
ADMIN_PASSWORD=<strong-admin-password>
AI_ENABLED=false
# Unraid host path bind-mounted to /app/data/import:
KODA_IMPORT_DIR=/mnt/user/appdata/koda/import
```

`DATABASE_URL` inside compose resolves to
`postgresql://<user>:<pass>@postgres:5432/<db>` automatically. For an **external**
PostgreSQL, drop the `postgres` service and set `DATABASE_URL` explicitly in `.env`.

Do not commit real passwords.

---

## 3. Build & start

On the Unraid host, in the repo directory (next to `docker-compose.yml`):

```bash
# 0. Prepare host mount + env (once)
mkdir -p /mnt/user/appdata/koda/import/reports
cp .env.example .env && nano .env          # set passwords + KODA_IMPORT_DIR
#    copy the 4 .xlsx files into /mnt/user/appdata/koda/import/

# 1. Build the image
docker compose build

# 2. Start postgres + app (postgres health-gates the app)
docker compose up -d

# 3. Watch logs (migrations run automatically on app start)
docker compose logs -f app
```

The app entrypoint (`docker-entrypoint.sh`) runs `prisma migrate deploy`
automatically before starting Next.js, so **migrations apply on container
start** from an empty database. The app then listens on `:3000`.

---

## 4. Run the import inside the container

After the app container is up and migrations have applied:

```bash
# Validate the workbooks (no DB writes)
docker compose exec app npm run import:validate

# Import into the Docker PostgreSQL (idempotent; safe to re-run)
docker compose exec app npm run import:merge-ready

# Verify the database invariants
docker compose exec app npm run import:verify-db
```

These run against the compose PostgreSQL via `DATABASE_URL` using the native
engine — **do not** set `KODA_DB_DRIVER=pglite` in the container.

Reports appear on the host at `/mnt/user/appdata/koda/import/reports/`:
`validation-report.json`, `import-report.json`, `import-report.md`.

### Expected counts (verify-db / import-report)

| Metric | Expected |
| --- | --- |
| web rows | 3804 |
| opinion rows | 759 |
| toovoidud rows | 97 |
| **total content** | **4660** |
| web public rows | 1530 |
| opinion public rows | 432 |
| toovoidud public rows | 72 |
| web support-only rows | 1951 |
| staging-only rows | 573 |
| held toovoidud rows | 25 |
| approved public relations | 95 |
| candidate links public | 0 |
| review / numeric-review / support / staging / held rows public | 0 |

---

## 5. Migrations

- **Automatic:** the entrypoint runs `prisma migrate deploy` on every app start
  (idempotent — already-applied migrations are skipped). This is acceptable for
  the test environment.
- **Manual (if you disable the auto step):**
  ```bash
  docker compose exec app npx prisma migrate deploy
  ```

Migrations live in `prisma/migrations/` and are part of the image. The relevant
data-model migrations are `..._merge_ready_data_model` and
`..._admin_override_fields`.

---

## 6. Reverse proxy / domain assumptions

This repo does **not** configure Cloudflare, the router or Unraid routing.
Assumptions only:

- The app listens on **port 3000** inside the container (published as `3000:3000`).
- A reverse proxy / Cloudflare / Unraid routes `koda.orgusaar.ee` → app `:3000`.
- The app uses `APP_URL=https://koda.orgusaar.ee` (drives the secure admin
  cookie and `metadataBase`; no hardcoded localhost URLs in public pages).
- The compose `postgres` service publishes `5432:5432` for convenience — remove
  or firewall that on a public host.

---

## 7. Deployment smoke checklist

After `docker compose up -d` and the import:

- [ ] `docker compose ps` shows `app` and `postgres` healthy/running
- [ ] `docker compose logs app` shows migrations applied, no Prisma engine/driver errors
- [ ] Homepage loads: `curl -I http://<host>:3000/` → `200`
- [ ] `/tulemused` does not crash: `curl -I "http://<host>:3000/tulemused?tegevused=eksport"` → `200`
- [ ] `npm run import:validate` → PASS
- [ ] `npm run import:merge-ready` → import OK
- [ ] `npm run import:verify-db` → 17/17 invariants pass
- [ ] total content = **4660**, toovoidud = **97**, public toovoidud = **72**
- [ ] public opinion count = **432**; review/support/staging/held rows not public
- [ ] `docker compose exec app npm run build` succeeds (already built in image)

---

## 8. Operations

### Reset the test database safely

```bash
docker compose down                 # stop app + postgres (keeps data volume)
docker volume rm koda_pgdata        # DESTROY the database (name may be <project>_pgdata)
docker compose up -d                # recreates empty DB; entrypoint re-applies migrations
docker compose exec app npm run import:merge-ready
docker compose exec app npm run import:verify-db
```

(Confirm the volume name with `docker volume ls`.)

### Check logs

```bash
docker compose logs -f app
docker compose logs -f postgres
```

### Update the deployment after a git pull

```bash
git pull
docker compose build           # rebuild image (re-generates Prisma client + Next build)
docker compose up -d           # recreate containers; entrypoint runs migrate deploy
docker compose exec app npm run import:merge-ready   # replacement import after backup
docker compose exec app npm run import:verify-db
```

### Crawler / seed

Not part of the deploy. The crawler is **not** the primary import path and the
seed is demo-only — neither runs automatically. Do not run `npm run seed` in the
test/production environment.

---

## Notes / risks

- The image intentionally includes devDependencies (`tsx`, `xlsx`, `prisma`) so
  migrations and the merge-ready import can run inside the container. Do not add
  `--omit=dev` to the Dockerfile `npm ci`.
- If using an **external** PostgreSQL, ensure it is reachable from the app
  container and `DATABASE_URL` points to it (and remove the `postgres` service).
- First `docker compose build` downloads base images + npm deps; allow a few
  minutes.
