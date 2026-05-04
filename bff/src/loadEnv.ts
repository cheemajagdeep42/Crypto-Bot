import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load `.env` before other modules read `process.env`.
 * - `cwd` = `bff/` → `./.env`
 * - `cwd` = repo root → `./bff/.env`
 */
function resolveEnvPath(): string {
    const cwd = process.cwd();
    const inBff = path.join(cwd, ".env");
    if (existsSync(inBff)) return inBff;
    const nested = path.join(cwd, "bff", ".env");
    if (existsSync(nested)) return nested;
    return inBff;
}

config({ path: resolveEnvPath() });
