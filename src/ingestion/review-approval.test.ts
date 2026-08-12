import { describe, expect, it } from "vitest";
import { approveReviewReport, automaticallyApproveCleanReport } from "./review-approval";
import type { ReviewReport } from "./review-report";

function report(concerns = 0): ReviewReport {
  return {
    generatedAt: "2026-08-11T22:00:00Z",
    candidateDigest: "c".repeat(64),
    publishable: concerns === 0,
    approvalRequired: true,
    summary: { cinemas: 5, added: 3, removed: 1, changed: 0, concerns },
    cinemas: [],
  };
}

describe("manual review approval", () => {
  it("creates an auditable approval for a clean report", () => {
    expect(approveReviewReport(report(), "Editor", "2026-08-11T23:00:00Z")).toMatchObject({
      decision: "approved", approvedBy: "Editor", reportGeneratedAt: "2026-08-11T22:00:00Z",
      candidateDigest: "c".repeat(64),
    });
  });
  it("rejects reports with concerns or an anonymous reviewer", () => {
    expect(() => approveReviewReport(report(1), "Editor")).toThrow("cannot be approved");
    expect(() => approveReviewReport(report(), " ")).toThrow("reviewer name");
  });
  it("allows automation only for a clean report", () => {
    expect(automaticallyApproveCleanReport(report(), "2026-08-11T23:00:00Z")).toMatchObject({
      decision: "auto_approved", approvedBy: "weekly-automation",
    });
    expect(() => automaticallyApproveCleanReport(report(1))).toThrow("cannot be approved");
  });
});
