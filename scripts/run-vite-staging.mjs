import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, ["vite", "--mode", "staging"], {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
