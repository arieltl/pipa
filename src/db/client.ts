import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../config/paths.ts";
import * as schema from "./schema.ts";

/**
 * SQLite connection + Drizzle instance.
 *
 * This module opens the database at import time, so it ensures the parent
 * directory exists itself (ES module imports run before the entrypoint's
 * top-level statements). Foreign keys are enabled per-connection and WAL is
 * used for normal app concurrency.
 */
mkdirSync(dirname(paths.dbPath), { recursive: true });

export const sqlite = new Database(paths.dbPath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA busy_timeout = 5000;");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
