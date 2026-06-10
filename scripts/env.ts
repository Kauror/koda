import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Load .env for CLI scripts (Next.js loads it itself, plain tsx scripts do not).
 * Existing environment variables always win, so Docker env overrides .env.
 */
export function loadEnv() {
  const file = resolve(process.cwd(), ".env");
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Already-set variables are kept by loadEnvFile; other failures are non-fatal.
    }
  }
}
