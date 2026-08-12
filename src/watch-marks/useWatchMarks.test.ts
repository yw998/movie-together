import { describe, expect, it } from "vitest";
import { showingMarkKey, showingStorageWindow } from "./useWatchMarks";

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
});
