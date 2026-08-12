import type { Film, Showing } from "../types/schedule";

type OverrideEvidence = {
  sourceUrl: string;
  reason: string;
  enteredAt: string;
  resolvesWarnings?: string[];
};

export type RemoveShowingOverride = OverrideEvidence & {
  operation: "remove";
  showingId: string;
};

export type UpsertShowingOverride = OverrideEvidence & {
  operation: "upsert";
  film: Film;
  showing: Showing;
};

export type ManualOverride = RemoveShowingOverride | UpsertShowingOverride;

export type ManualOverrideFile = {
  windowStart: string;
  windowEnd: string;
  entries: ManualOverride[];
};

function validEvidence(entry: ManualOverride): boolean {
  return (
    /^https:\/\//.test(entry.sourceUrl) &&
    entry.reason.trim().length >= 8 &&
    !Number.isNaN(new Date(entry.enteredAt).getTime())
  );
}

export function validateManualOverrideFile(
  file: ManualOverrideFile,
  windowStart: string,
  windowEnd: string,
): string[] {
  const issues: string[] = [];
  if (file.windowStart !== windowStart || file.windowEnd !== windowEnd) {
    issues.push("Manual override window must exactly match the candidate window.");
  }
  if (!Array.isArray(file.entries)) return [...issues, "Manual override entries must be an array."];
  file.entries.forEach((entry, index) => {
    if (!entry || !validEvidence(entry)) {
      issues.push(`entries[${index}] requires an HTTPS source, a specific reason, and a valid enteredAt timestamp.`);
      return;
    }
    if (entry.resolvesWarnings && !entry.resolvesWarnings.every((warning) => warning.trim().length > 0)) {
      issues.push(`entries[${index}] has an empty resolved warning.`);
    }
    if (entry.operation === "remove") {
      if (!entry.showingId.trim()) issues.push(`entries[${index}] has no showingId.`);
      return;
    }
    if (entry.operation !== "upsert") {
      issues.push(`entries[${index}] has an unsupported operation.`);
      return;
    }
    if (entry.film.id !== entry.showing.filmId) {
      issues.push(`entries[${index}] film ID does not match its showing.`);
    }
    if (entry.showing.extractionStatus !== "manual") {
      issues.push(`entries[${index}] upsert must use extractionStatus "manual".`);
    }
    if (entry.showing.sourceUrl !== entry.sourceUrl) {
      issues.push(`entries[${index}] showing sourceUrl must match override evidence.`);
    }
    if (entry.showing.localDate < windowStart || entry.showing.localDate > windowEnd) {
      issues.push(`entries[${index}] showing falls outside the override week.`);
    }
  });
  return issues;
}
