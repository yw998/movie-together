import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const panelPath = new URL("./ChannelPanel.tsx", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);
const appPath = new URL("../App.tsx", import.meta.url);

describe("viewing-group rail", () => {
  it("places the create button immediately after the group list instead of at the rail bottom", async () => {
    const [panel, styles] = await Promise.all([
      readFile(panelPath, "utf8"),
      readFile(stylesPath, "utf8"),
    ]);
    const listStart = panel.indexOf('<div className="channel-rail-list">');
    const createButton = panel.indexOf('className="channel-rail-create"', listStart);
    const listEnd = panel.indexOf("</div>", listStart);

    expect(listStart).toBeGreaterThan(-1);
    expect(createButton).toBeGreaterThan(listStart);
    expect(createButton).toBeLessThan(listEnd);
    expect(styles).not.toMatch(/\.channel-rail-nav \.channel-rail-create[^}]*margin-top:\s*auto/);
  });

  it("toggles the group drawer from its primary entry and exposes a visible close button", async () => {
    const [panel, styles] = await Promise.all([
      readFile(panelPath, "utf8"),
      readFile(stylesPath, "utf8"),
    ]);

    expect(panel).toContain("setMobileOpen((current) => !current)");
    expect(panel).toContain('mobileOpen && <button aria-label="关闭观影小组" className="channel-mobile-close"');
    expect(styles).toContain(".channel-mobile-close { color:");
    expect(styles).not.toContain(".channel-mobile-toggle, .channel-mobile-close, .channel-backdrop { display: none; }");
  });

  it("highlights the open drawer without removing the underlying schedule highlight", async () => {
    const [panel, app] = await Promise.all([
      readFile(panelPath, "utf8"),
      readFile(appPath, "utf8"),
    ]);

    expect(panel).toContain("onPanelOpenChange?.(mobileOpen)");
    expect(app).toContain("onPanelOpenChange={setGroupPanelOpen}");
    expect(app).toContain('className={activeChannelId || groupPanelOpen ? "active" : ""}');
    expect(app).toContain('className={!activeChannelId && !notificationsOpen ? "active" : ""}');
    expect(app).not.toContain("!activeChannelId && !notificationsOpen && !groupPanelOpen");
  });

  it("uses the neutral drawer state for a useful group overview instead of a duplicate personal home", async () => {
    const panel = await readFile(panelPath, "utf8");

    expect(panel).toContain("YOUR GROUPS");
    expect(panel).toContain("个观影小组");
    expect(panel).toContain('className="channel-overview-list"');
    expect(panel).toContain('channel.owner_user_id === user.id ? "组长" : "成员"');
    expect(panel).toContain('aria-label="返回排片"');
    expect(panel).not.toContain("个人主页");
  });
});
