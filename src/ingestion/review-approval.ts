import type { ReviewReport } from "./review-report";

export type ReviewApproval = {
  reportGeneratedAt: string;
  candidateDigest: string;
  approvedAt: string;
  approvedBy: string;
  decision: "approved" | "auto_approved";
  reviewedSummary: ReviewReport["summary"];
};

export function approveReviewReport(
  report: ReviewReport,
  approvedBy: string,
  approvedAt = new Date().toISOString(),
): ReviewApproval {
  const reviewer = approvedBy.trim();
  if (!/^[a-f0-9]{64}$/.test(report.candidateDigest)) throw new Error("Report candidate digest is invalid.");
  if (!report.approvalRequired) throw new Error("Report does not declare an approval requirement.");
  if (!report.publishable || report.summary.concerns > 0) {
    throw new Error("A report with review concerns cannot be approved.");
  }
  if (!reviewer) throw new Error("A reviewer name is required.");
  if (Number.isNaN(new Date(approvedAt).getTime())) throw new Error("Approval timestamp is invalid.");
  return {
    reportGeneratedAt: report.generatedAt,
    candidateDigest: report.candidateDigest,
    approvedAt,
    approvedBy: reviewer,
    decision: "approved",
    reviewedSummary: report.summary,
  };
}

export function automaticallyApproveCleanReport(
  report: ReviewReport,
  approvedAt = new Date().toISOString(),
): ReviewApproval {
  const approval = approveReviewReport(report, "weekly-automation", approvedAt);
  return { ...approval, decision: "auto_approved" };
}
