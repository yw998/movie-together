import { describe, expect, it } from "vitest";
import { countMarkedShowings, showingMarkKey, showingStorageWindow } from "./useWatchMarks";

describe("showing watch mark identity", () => {
  it("keeps different showtimes and calendar weeks distinct", () => {
    expect(showingMarkKey("2026-08-10", "ifc-123")).not.toBe(
      showingMarkKey("2026-08-10", "ifc-456"),
    );
    expect(showingMarkKey("2026-08-10", "ifc-123")).not.toBe(
      showingMarkKey("2026-08-17", "ifc-123"),
    );
  });

  it("keeps rolling-window marks attached to each showing's storage week", () => {
    expect(showingStorageWindow("2026-08-16")).toBe("2026-08-10");
    expect(showingStorageWindow("2026-08-17")).toBe("2026-08-17");
  });

  it("counts only marks whose showings are inside the displayed rolling window", () => {
    const showings = [
      { id: "visible-sunday", localDate: "2026-08-16" },
      { id: "visible-monday", localDate: "2026-08-17" },
    ];
    const markKeys = [
      showingMarkKey("2026-08-10", "before-window"),
      showingMarkKey("2026-08-10", "visible-sunday"),
      showingMarkKey("2026-08-17", "visible-monday"),
      showingMarkKey("2026-08-17", "after-window"),
      showingMarkKey("2026-08-17", "visible-monday"),
    ];

    expect(countMarkedShowings(markKeys, showings)).toBe(2);
  });
});
