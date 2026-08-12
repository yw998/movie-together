import { readFile } from "node:fs/promises";

const required = [
  "DATABASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
  "STAGING_SEED_PROJECT_REF",
];

for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is missing from .env.staging.local.`);
}

const projectRef = process.env.SUPABASE_PROJECT_REF.trim();
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be a 20-letter project ref.");
if (process.env.STAGING_SEED_PROJECT_REF.trim() !== projectRef) {
  throw new Error("STAGING_SEED_PROJECT_REF must exactly match SUPABASE_PROJECT_REF.");
}

const apiUrl = new URL(process.env.VITE_SUPABASE_URL.trim());
if (apiUrl.protocol !== "https:" || apiUrl.hostname !== `${projectRef}.supabase.co`) {
  throw new Error("VITE_SUPABASE_URL does not match SUPABASE_PROJECT_REF.");
}

const databaseUrl = new URL(process.env.DATABASE_URL.trim());
const databaseMatchesProject = databaseUrl.hostname === `db.${projectRef}.supabase.co`
  || databaseUrl.username === `postgres.${projectRef}`;
if (!databaseMatchesProject) throw new Error("DATABASE_URL does not match SUPABASE_PROJECT_REF.");

if (!process.env.SUPABASE_ACCESS_TOKEN.trim().startsWith("sbp_")) {
  throw new Error("SUPABASE_ACCESS_TOKEN must be a Supabase personal access token.");
}

try {
  const productionSource = await readFile(".env.local", "utf8");
  const productionRef = productionSource.match(/^SUPABASE_PROJECT_REF=(.+)$/m)?.[1]?.trim();
  if (productionRef && productionRef === projectRef) {
    throw new Error("Staging and .env.local use the same SUPABASE_PROJECT_REF. Refusing to continue.");
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("Refusing to continue")) throw error;
}

console.log(`Staging environment verified for project ${projectRef}.`);
