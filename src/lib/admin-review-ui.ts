/**
 * Shared admin data-review UI copy and commands. Kept in one place so the pages,
 * the missing-bundle notice and the tests use exactly the same wording, and so
 * no absolute/server paths are ever interpolated into user-facing text.
 */

/** Command that generates the local data bundle the admin tool reads. */
export const BUNDLE_GENERATE_COMMAND =
  "npm run data:bundle -- --input-dir=data/import --out=data/import/bundles/koda_data_bundle_v1";

/** Command that validates a generated bundle. */
export const BUNDLE_VALIDATE_COMMAND =
  "npm run data:validate-bundle -- --bundle=data/import/bundles/koda_data_bundle_v1";

/**
 * Explicit, prominent reminder that saving a review decision never changes
 * public content or live categories. Shown on the review list and detail pages.
 */
export const DECISIONS_NOT_APPLIED_NOTICE =
  "Ülevaatuse otsused salvestatakse hilisemaks kontrollitud rakendamiseks. Need ei muuda " +
  "avalikku sisu ega kategooriaid automaatselt.";
