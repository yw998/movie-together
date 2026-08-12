import type { Showing } from "../types/schedule";
import type { AdapterResult, SourceSnapshot } from "./types";

export type ReviewBundle = { generatedAt: string; adapters: AdapterResult[] };
export type ShowingChange = { id: string; cinemaId: string; changedFields: Array<keyof Showing> };
export type CinemaReview = {
  cinemaId: string;
  status: SourceSnapshot["result"];
  previousCount: number;
  currentCount: number;
  addedIds: string[];
  removedIds: string[];
  changes: ShowingChange[];
  concerns: string[];
};
export type ReviewReport = {
  generatedAt: string;
  candidateDigest: string;
  publishable: boolean;
  approvalRequired: true;
  summary: { cinemas: number; added: number; removed: number; changed: number; concerns: number };
  cinemas: CinemaReview[];
};

const FACT_FIELDS: Array<keyof Showing> = [
  "filmId", "startsAt", "localDate", "localTime", "format", "eventType",
  "eventNote", "detailUrl", "ticketUrl", "availability", "sourceUrl", "extractionStatus",
];

function adapterMap(bundle: ReviewBundle): Map<string, AdapterResult> {
  return new Map(bundle.adapters.map((adapter) => [adapter.cinemaId, adapter]));
}
function byId(showings: Showing[]): Map<string, Showing> {
  return new Map(showings.map((showing) => [showing.id, showing]));
}
function changedFields(previous: Showing, current: Showing): Array<keyof Showing> {
  return FACT_FIELDS.filter((field) => previous[field] !== current[field]);
}
function duplicateIds(showings: Showing[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const showing of showings) {
    if (seen.has(showing.id)) duplicates.add(showing.id);
    seen.add(showing.id);
  }
  return [...duplicates].sort();
}

export function createReviewReport(
  previous: ReviewBundle,
  current: ReviewBundle,
  candidateDigest: string,
): ReviewReport {
  if (!/^[a-f0-9]{64}$/.test(candidateDigest)) throw new Error("Candidate digest must be a SHA-256 value.");
  const previousAdapters = adapterMap(previous);
  const currentAdapters = adapterMap(current);
  const cinemaIds = [...new Set([...previousAdapters.keys(), ...currentAdapters.keys()])].sort();
  const cinemas = cinemaIds.map((cinemaId): CinemaReview => {
    const before = previousAdapters.get(cinemaId);
    const after = currentAdapters.get(cinemaId);
    const previousShowings = before?.showings ?? [];
    const currentShowings = after?.showings ?? [];
    const previousById = byId(previousShowings);
    const currentById = byId(currentShowings);
    const addedIds = [...currentById.keys()].filter((id) => !previousById.has(id)).sort();
    const removedIds = [...previousById.keys()].filter((id) => !currentById.has(id)).sort();
    const changes: ShowingChange[] = [];
    for (const [id, showing] of currentById) {
      const prior = previousById.get(id);
      if (!prior) continue;
      const fields = changedFields(prior, showing);
      if (fields.length > 0) changes.push({ id, cinemaId, changedFields: fields });
    }
    const concerns: string[] = [];
    if (!after) {
      concerns.push("Cinema is missing from the current ingestion bundle.");
    } else {
      if (after.snapshot.result !== "success") {
        concerns.push(`Feed status is ${after.snapshot.result}: ${after.snapshot.error ?? "manual review required"}`);
      }
      concerns.push(...after.warnings.map((warning) => `Parser warning: ${warning}`));
      const duplicates = duplicateIds(currentShowings);
      if (duplicates.length > 0) concerns.push(`Duplicate showing IDs: ${duplicates.join(", ")}`);
      const unverified = currentShowings.filter((showing) => showing.extractionStatus === "needs_review").length;
      if (unverified > 0) concerns.push(`${unverified} current showing(s) still need source review.`);
      if (previousShowings.length > 0 && currentShowings.length < previousShowings.length * 0.75) {
        concerns.push(`Showing count fell by more than 25% (${previousShowings.length} to ${currentShowings.length}).`);
      }
      if (currentShowings.length === 0) concerns.push("Current feed has no publishable showings.");
    }
    return {
      cinemaId,
      status: after?.snapshot.result ?? "failed",
      previousCount: previousShowings.length,
      currentCount: currentShowings.length,
      addedIds,
      removedIds,
      changes: changes.sort((left, right) => left.id.localeCompare(right.id)),
      concerns,
    };
  });
  const summary = {
    cinemas: cinemas.length,
    added: cinemas.reduce((sum, cinema) => sum + cinema.addedIds.length, 0),
    removed: cinemas.reduce((sum, cinema) => sum + cinema.removedIds.length, 0),
    changed: cinemas.reduce((sum, cinema) => sum + cinema.changes.length, 0),
    concerns: cinemas.reduce((sum, cinema) => sum + cinema.concerns.length, 0),
  };
  return {
    generatedAt: current.generatedAt,
    candidateDigest,
    publishable: summary.concerns === 0,
    approvalRequired: true,
    summary,
    cinemas,
  };
}

export function formatReviewReport(report: ReviewReport): string {
  const lines = [
    "# Schedule ingestion review", "", `Generated: ${report.generatedAt}`,
    `Candidate SHA-256: ${report.candidateDigest}`,
    `Publication recommendation: ${report.publishable ? "READY FOR APPROVAL" : "HOLD FOR REVIEW"}`,
    `Summary: ${report.summary.added} added, ${report.summary.removed} removed, ${report.summary.changed} changed, ${report.summary.concerns} concern(s).`,
  ];
  for (const cinema of report.cinemas) {
    lines.push("", `## ${cinema.cinemaId}`, "",
      `Status: ${cinema.status}; showings: ${cinema.previousCount} → ${cinema.currentCount}`,
      `Added: ${cinema.addedIds.length}; removed: ${cinema.removedIds.length}; changed: ${cinema.changes.length}`);
    for (const concern of cinema.concerns) lines.push(`- CONCERN: ${concern}`);
    for (const id of cinema.addedIds) lines.push(`- Added: ${id}`);
    for (const id of cinema.removedIds) lines.push(`- Removed: ${id}`);
    for (const change of cinema.changes) lines.push(`- Changed: ${change.id} (${change.changedFields.join(", ")})`);
  }
  return `${lines.join("\n")}\n`;
}
