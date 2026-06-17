# Site Texts v1

This app has a small editable text system for major homepage copy. It is not a CMS: values are plain text, rendered by React as escaped text, and edited from the existing protected admin area.

## Editable Texts

The first editable keys are:

| Key | Where it appears |
| --- | --- |
| `homepage.hero.eyebrow` | Homepage hero eyebrow |
| `homepage.hero.title` | Homepage hero title |
| `homepage.hero.lead` | Homepage hero lead paragraph |
| `homepage.hero.note` | Homepage hero note |
| `homepage.search.examplesTitle` | Label before example searches |
| `homepage.topics.title` | Topic-browse section title |
| `homepage.topics.description` | Topic-browse section description |
| `homepage.explainer.title` | Koda.ee direct-links section title |
| `homepage.explainer.body` | Koda.ee direct-links section description |
| `homepage.footerNote` | Homepage lower note |

The example search links, Koda.ee direct links, stats, search labels, result-page text, and detail-page text remain hardcoded for now.

## Defaults

Defaults live in `src/lib/site-text-defaults.ts`. The homepage reads DB rows from `SiteText` and falls back to these defaults for any missing row. If the text lookup fails, the homepage still uses defaults.

## Data Model

`SiteText` has:

- `key` unique string
- `valueEt` plain Estonian text
- `description`
- `group`
- timestamps

Do not store HTML in `valueEt`. The app displays it as text, not raw HTML.

## Seed Missing Rows

After applying migrations, create missing editable rows:

```bash
npm run site-texts:seed
```

This creates only missing keys and does not overwrite edited values.

There is an explicit reset mode:

```bash
npm run site-texts:seed -- --overwrite
```

Use that only when you intentionally want default values to replace edited DB values for the known keys.

## Admin Editing

Edit texts at:

```text
/admin/site-texts
```

The page is inside the existing password-protected admin dashboard. It lists keys by group, shows descriptions, and saves only `valueEt`; key names are not part of the normal edit workflow. Unknown DB keys are preserved and can have their values edited.

Empty text requires checking "Luba tühi tekst" on that row. Long text is edited in a textarea.

## Deployment Steps

When deploying this change:

1. Pull the new code.
2. Apply Prisma migrations, normally via the existing container startup or `npm run prisma:deploy`.
3. Run `npm run site-texts:seed` once to create missing editable rows.
4. Sign in to `/admin/site-texts` and edit copy as needed.

When adding a new homepage text key later, add it to `src/lib/site-text-defaults.ts`, use it in the relevant component, deploy the migration/code if needed, and run `npm run site-texts:seed` so the new key appears in admin.
