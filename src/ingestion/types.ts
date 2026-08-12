import type { Film, Showing } from "../types/schedule";

export type SourceSnapshot = {
  cinemaId: string;
  fetchedAt: string;
  sourceUrl: string;
  contentHash: string;
  parserVersion: string;
  result: "success" | "partial" | "failed";
  error: string | null;
};

export type AdapterResult = {
  cinemaId: string;
  films: Film[];
  showings: Showing[];
  snapshot: SourceSnapshot;
  warnings: string[];
};
