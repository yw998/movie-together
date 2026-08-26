import { describe, expect, it } from "vitest";
import { countMarkedShowings, watchMarkRpcIdentity } from "./useWatchMarks";

describe("showing watch mark identity", () => {
  it("sends the exported database window instead of deriving one from the local date", () => {
    expect(watchMarkRpcIdentity({
      id: "ifc-center-577078",
      storageWindowStart: "2026-08-26",
    })).toEqual({
      target_window_start: "2026-08-26",
      target_showing_id: "ifc-center-577078",
    });
  });

  it("counts only marks whose showings are inside the displayed rolling window", () => {
    const showings = [
      { id: "visible-sunday", localDate: "2026-08-16" },
      { id: "visible-monday", localDate: "2026-08-17" },
    ];
    const markKeys = [
      "before-window",
      "visible-sunday",
      "visible-monday",
      "after-window",
      "visible-monday",
    ];

    expect(countMarkedShowings(markKeys, showings)).toBe(2);
  });
});
