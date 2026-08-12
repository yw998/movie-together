import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("notification navigation", () => {
  it("restores the previous personal or Channel view when reminders are toggled closed", () => {
    expect(appSource).toContain("previousNotificationChannelRef.current = activeChannelId");
    expect(appSource).toContain("setActiveChannelId(previousNotificationChannelRef.current)");
    expect(appSource).toContain("if (notificationsOpen)");
    expect(appSource).toContain("onOpenNotifications={toggleNotifications}");
  });
});
