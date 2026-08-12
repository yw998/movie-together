import { describe, expect, it } from "vitest";
import { availabilityLabel } from "./showing-labels";

describe("showing availability labels", () => {
  it("keeps sold-out sessions visible with an explicit label", () => {
    expect(availabilityLabel("sold_out")).toBe("已售罄");
    expect(availabilityLabel("available")).toBeNull();
    expect(availabilityLabel("unknown")).toBeNull();
  });
});
