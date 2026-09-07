/**
 * Centralized environment configuration.
 *
 * Keep this module free of side effects beyond reading `process.env` so it can
 * be imported anywhere (including tests) without booting the server.
 */

function readEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function readInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const dataDir = readEnv("DATA_DIR", "./data");

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: readInt("PORT", 3000),

  /** Root data directory; everything persistent lives under here. */
  dataDir,
  /** SQLite database file path. */
  dbPath: readEnv("DB_PATH", `${dataDir}/app.db`),
  /** Root directory for stored files (archived PDFs, NFS-e uploads, etc). */
  filesDir: readEnv("FILES_DIR", `${dataDir}/files`),
  /** Scratch directory for atomic writes before moving into FILES_DIR. */
  tmpDir: readEnv("TMP_DIR", `${dataDir}/tmp`),
} as const;

export const isProduction = env.nodeEnv === "production";
export const isDevelopment = !isProduction;
