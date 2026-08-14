import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/weekly-schedule.yml", "utf8");

describe("hosted schedule dry run", () => {
  it("defaults manual dispatches to dry-run mode", () => {
    expect(workflow).toMatch(/dry_run:\s+[\s\S]*?default: true\s+[\s\S]*?type: boolean/);
    expect(workflow).toContain(
      "DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run == true }}",
    );
  });

  it("guards every production mutation behind the non-dry-run condition", () => {
    for (const step of [
      "Apply database migrations",
      "Export today plus six days",
      "Verify rolling database round trip",
      "Commit validated rolling public data",
    ]) {
      expect(workflow).toMatch(
        new RegExp(`- name: ${step}\\s+if: \\$\\{\\{ env\\.DRY_RUN != 'true' \\}\\}`),
      );
    }
    expect(workflow).toContain('if [ "$DRY_RUN" != "true" ]; then');
    expect(workflow).toMatch(
      /Create manual-review issue on failure\s+if: \$\{\{ failure\(\) && env\.DRY_RUN != 'true' \}\}/,
    );
  });

  it("assembles a private rolling artifact only in dry-run mode", () => {
    expect(workflow).toMatch(
      /Assemble and verify dry-run rolling candidate\s+if: \$\{\{ env\.DRY_RUN == 'true' \}\}/,
    );
    expect(workflow).toContain("npm run assemble:rolling-dry-run");
  });
});
