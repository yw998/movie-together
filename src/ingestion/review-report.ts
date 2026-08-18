import type { Film, Showing } from "../types/schedule";
import type { AdapterResult, SourceSnapshot } from "./types";

export type ReviewBundle = {
  generatedAt: string;
  windowStart?: string;
  windowEnd?: string;
  adapters: AdapterResult[];
};
export type ReviewShowing = Pick<
  Showing,
  "id" | "localDate" | "localTime" | "format" | "eventType" | "eventNote" | "detailUrl" | "sourceUrl"
> & { filmTitle: string };
export type ShowingChange = {
  id: string;
  cinemaId: string;
  changedFields: Array<keyof Showing>;
  previous: ReviewShowing;
  current: ReviewShowing;
};
export type CinemaReview = {
  cinemaId: string;
  status: SourceSnapshot["result"];
  fallback: AdapterResult["publicationFallback"] | null;
  previousCount: number;
  currentCount: number;
  addedIds: string[];
  removedIds: string[];
  addedShowings: ReviewShowing[];
  removedShowings: ReviewShowing[];
  changes: ShowingChange[];
  concerns: string[];
  unavailableDates: string[];
};
export type ReviewReport = {
  generatedAt: string;
  candidateDigest: string;
  publishable: boolean;
  approvalRequired: true;
  summary: { cinemas: number; added: number; removed: number; changed: number; concerns: number; unavailableCinemaDates: number };
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

function reviewShowing(showing: Showing, films: readonly Film[]): ReviewShowing {
  const filmTitle = films.find((film) => film.id === showing.filmId)?.displayTitle ?? showing.filmId;
  return {
    id: showing.id,
    filmTitle,
    localDate: showing.localDate,
    localTime: showing.localTime,
    format: showing.format,
    eventType: showing.eventType,
    eventNote: showing.eventNote,
    detailUrl: showing.detailUrl,
    sourceUrl: showing.sourceUrl,
  };
}

function byDateTime(left: ReviewShowing, right: ReviewShowing): number {
  return `${left.localDate}T${left.localTime}-${left.id}`.localeCompare(
    `${right.localDate}T${right.localTime}-${right.id}`,
  );
}

export function createReviewReport(
  previous: ReviewBundle,
  current: ReviewBundle,
  candidateDigest: string,
): ReviewReport {
  if (!/^[a-f0-9]{64}$/.test(candidateDigest)) throw new Error("Candidate digest must be a SHA-256 value.");
  const reviewInstant = new Date(current.generatedAt).getTime();
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
    const addedShowings = addedIds
      .map((id) => reviewShowing(currentById.get(id)!, after?.films ?? []))
      .sort(byDateTime);
    const removedShowings = removedIds
      .map((id) => reviewShowing(previousById.get(id)!, before?.films ?? []))
      .sort(byDateTime);
    const changes: ShowingChange[] = [];
    for (const [id, showing] of currentById) {
      const prior = previousById.get(id);
      if (!prior) continue;
      const fields = changedFields(prior, showing);
      if (fields.length > 0) {
        changes.push({
          id,
          cinemaId,
          changedFields: fields,
          previous: reviewShowing(prior, before?.films ?? []),
          current: reviewShowing(showing, after?.films ?? []),
        });
      }
    }
    const concerns: string[] = [];
    if (!after) {
      concerns.push("Cinema is missing from the current ingestion bundle.");
    } else {
      const hasApprovedFallback = Boolean(after.publicationFallback);
      if (after.snapshot.result !== "success" && !hasApprovedFallback) {
        concerns.push(`Feed status is ${after.snapshot.result}: ${after.snapshot.error ?? "manual review required"}`);
      }
      if (!hasApprovedFallback) {
        concerns.push(...after.warnings.map((warning) => `Parser warning: ${warning}`));
      }
      const duplicates = duplicateIds(currentShowings);
      if (duplicates.length > 0) concerns.push(`Duplicate showing IDs: ${duplicates.join(", ")}`);
      const unverified = currentShowings.filter((showing) => showing.extractionStatus === "needs_review").length;
      if (unverified > 0) concerns.push(`${unverified} current showing(s) still need source review.`);
      const upcoming = (showing: Showing) => {
        const startsAt = new Date(showing.startsAt).getTime();
        return Number.isNaN(reviewInstant) || Number.isNaN(startsAt) || startsAt >= reviewInstant;
      };
      const previousUpcomingCount = previousShowings.filter(upcoming).length;
      const currentUpcomingCount = currentShowings.filter(upcoming).length;
      if (previousUpcomingCount > 0 && currentUpcomingCount < previousUpcomingCount * 0.75) {
        concerns.push(`Upcoming showing count fell by more than 25% (${previousUpcomingCount} to ${currentUpcomingCount}).`);
      }
      if (currentShowings.length === 0 && (after.publicationFallback?.unavailableDates?.length ?? 0) === 0) {
        concerns.push("Current feed has no publishable showings.");
      }
    }
    return {
      cinemaId,
      status: after?.snapshot.result ?? "failed",
      fallback: after?.publicationFallback ?? null,
      previousCount: previousShowings.length,
      currentCount: currentShowings.length,
      addedIds,
      removedIds,
      addedShowings,
      removedShowings,
      changes: changes.sort((left, right) => left.id.localeCompare(right.id)),
      concerns,
      unavailableDates: after?.publicationFallback?.unavailableDates ?? [],
    };
  });
  const summary = {
    cinemas: cinemas.length,
    added: cinemas.reduce((sum, cinema) => sum + cinema.addedIds.length, 0),
    removed: cinemas.reduce((sum, cinema) => sum + cinema.removedIds.length, 0),
    changed: cinemas.reduce((sum, cinema) => sum + cinema.changes.length, 0),
    concerns: cinemas.reduce((sum, cinema) => sum + cinema.concerns.length, 0),
    unavailableCinemaDates: cinemas.reduce((sum, cinema) => sum + cinema.unavailableDates.length, 0),
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
    "# 排片更新人工检查报表", "", `Generated: ${report.generatedAt}`,
    `Candidate SHA-256: ${report.candidateDigest}`,
    `Publication recommendation: ${report.publishable ? "READY FOR APPROVAL" : "HOLD FOR REVIEW"}`,
    `Summary: ${report.summary.added} added, ${report.summary.removed} removed, ${report.summary.changed} changed, ${report.summary.concerns} concern(s).`,
    "",
    "## 快速检查方法",
    "",
    "1. 先看带有 `CONCERN` 的影院和下方变更表，不需要逐场检查未变化的影院。",
    "2. 点击 `detail` 核对影片页面，点击 `source` 核对影院总排片页。",
    "3. 确认删除、时间变化或特殊活动变化是否真实；无法确认时保持暂停发布。",
    "4. 完成后在对应 GitHub Issue 留下结论和依据链接。",
  ];
  for (const cinema of report.cinemas) {
    lines.push("", `## ${cinema.cinemaId}`, "",
      `Status: ${cinema.status}; showings: ${cinema.previousCount} → ${cinema.currentCount}`,
      `Added: ${cinema.addedIds.length}; removed: ${cinema.removedIds.length}; changed: ${cinema.changes.length}`);
    if (cinema.fallback) {
      lines.push(
        cinema.fallback.sourceGeneratedAt
          ? `- FALLBACK: using approved cinema-date facts from ${cinema.fallback.sourceGeneratedAt}; the partial current feed was not published.`
          : "- FALLBACK: the partial current feed was excluded; no earlier approved facts were available.",
      );
    }
    if (cinema.unavailableDates.length > 0) {
      lines.push(`- UNAVAILABLE: no approved facts for ${cinema.unavailableDates.join(", ")}; this cinema-date was omitted.`);
    }
    for (const concern of cinema.concerns) lines.push(`- CONCERN: ${concern}`);
    if (cinema.addedShowings.length > 0) {
      lines.push("", "### 新增场次", "", showingTable(cinema.addedShowings));
    }
    if (cinema.removedShowings.length > 0) {
      lines.push("", "### 删除场次（需核对）", "", showingTable(cinema.removedShowings));
    }
    if (cinema.changes.length > 0) {
      lines.push("", "### 变更场次", "");
      for (const change of cinema.changes) {
        lines.push(
          `- **${escapeMarkdown(change.current.filmTitle)}** — ${change.current.localDate} ${change.current.localTime}; changed: ${change.changedFields.join(", ")}; [official](${change.current.detailUrl}); ID: \`${change.id}\``,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function showingTable(showings: readonly ReviewShowing[]): string {
  const rows = [
    "| 影片 | 日期 | 时间 | 格式 / 活动 | 官方证据 | 场次 ID |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const showing of showings) {
    const details = [
      showing.format,
      showing.eventType === "standard" ? null : showing.eventType,
      showing.eventNote,
    ].filter(Boolean).join("; ") || "—";
    rows.push(
      `| ${escapeMarkdown(showing.filmTitle)} | ${showing.localDate} | ${showing.localTime} | ${escapeMarkdown(details)} | [detail](${showing.detailUrl}) · [source](${showing.sourceUrl}) | \`${showing.id}\` |`,
    );
  }
  return rows.join("\n");
}
