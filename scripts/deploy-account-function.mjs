import { spawnSync } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
  throw new Error("SUPABASE_PROJECT_REF is missing or invalid in .env.local.");
}
if (!accessToken?.startsWith("sbp_")) {
  throw new Error("SUPABASE_ACCESS_TOKEN is missing or invalid in .env.local.");
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  executable,
  ["supabase", "functions", "deploy", "account-auth", "--project-ref", projectRef, "--use-api"],
  { env: process.env, stdio: "inherit", shell: process.platform === "win32" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
