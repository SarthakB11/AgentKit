import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load apps/.env.local into process.env without overriding values already set. */
export function loadDotEnvLocal() {
  const p = resolve(__dirname, "..", ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Read a required variable or exit 3 (configuration error) with a readable message. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in the environment or in apps/.env.local.`);
    process.exit(3);
  }
  return v;
}
