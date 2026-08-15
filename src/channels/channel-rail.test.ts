import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const panelPath = new URL("./ChannelPanel.tsx", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);

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
});
