import { describe, expect, it } from "vitest";
import { passwordChangeError } from "./password";

describe("password change validation", () => {
  it("requires the current password and a distinct confirmed password", () => {
    expect(passwordChangeError("", "new-password", "new-password")).toContain("当前密码");
    expect(passwordChangeError("old-password", "old-password", "old-password")).toContain("不能");
    expect(passwordChangeError("old-password", "new-password", "different")).toContain("不一致");
  });

  it("accepts a distinct confirmed password of at least eight characters", () => {
    expect(passwordChangeError("old-password", "new-password", "new-password")).toBeNull();
  });
});
