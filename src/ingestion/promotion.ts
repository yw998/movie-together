import type { ScheduleData } from "../types/schedule";
import { compileWeeklyCandidate } from "./candidate-compiler";
import { compiledScheduleReviewBundle } from "./compiled-review";
import type { ManualOverrideFile } from "./manual-overrides";
import type { ReviewApproval } from "./review-approval";
import { digestReviewBundle } from "./review-digest";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";

export async function prepareApprovedSchedule(
  source: WeeklyIngestionBundle,
  approval: ReviewApproval,
  overrides?: ManualOverrideFile,
): Promise<ScheduleData> {
  if (!["approved", "auto_approved"].includes(approval.decision)) {
    throw new Error("Approval decision is not approved.");
  }
  if (approval.reportGeneratedAt !== source.generatedAt) {
    throw new Error("Approval and candidate generation timestamps do not match.");
  }
  const compiled = compileWeeklyCandidate(source, overrides, { requireCleanSources: true });
  const reviewBundle = compiledScheduleReviewBundle(source, compiled.schedule, compiled.resolvedWarnings);
  const digest = await digestReviewBundle(reviewBundle);
  if (digest !== approval.candidateDigest) {
    throw new Error("Approval digest does not match the compiled candidate facts.");
  }
  return compiled.schedule;
}
