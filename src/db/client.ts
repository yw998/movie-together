import postgres from "postgres";

export function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  return postgres(connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    ssl: "require",
    onnotice: () => undefined,
  });
}
