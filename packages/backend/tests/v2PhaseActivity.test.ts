import { expect, test } from "bun:test";

import {
  completedLabel,
  integrationCompletedLabel,
  integrationPhaseAction,
  phaseAction,
} from "../../../apps/v2/lib/phase-activity";

test("uses snapshotted integration lifecycle descriptions", () => {
  const sheets = {
    kind: "mcp",
    server: "Google Sheets",
    tool: "GOOGLESHEETS_UPDATE_RANGE",
    action: "Updating spreadsheet cells",
    completed: "Updated spreadsheet cells",
    ok: true,
  };
  const linear = {
    kind: "mcp",
    server: "Linear",
    tool: "issue_update",
    action: "Updating a Linear issue",
    completed: "Updated a Linear issue",
    ok: true,
  };

  expect(phaseAction(sheets, "streaming", false)).toBe(
    "Updating spreadsheet cells",
  );
  expect(completedLabel(sheets)).toBe("Updated spreadsheet cells");
  expect(phaseAction(linear, "streaming", false)).toBe(
    "Updating a Linear issue",
  );
  expect(completedLabel(linear)).toBe("Updated a Linear issue");
  expect(
    integrationPhaseAction(
      sheets,
      "streaming",
      false,
      "Live listing changed this",
    ),
  ).toBe("Updating spreadsheet cells");
  expect(
    integrationCompletedLabel(sheets, "Live listing changed this"),
  ).toBe("Updated spreadsheet cells");
});

test("uses generic MCP labels only when configured copy is unavailable", () => {
  const custom = {
    kind: "mcp",
    server: "My custom server",
    tool: "write",
    ok: true,
  };

  expect(phaseAction(custom, "streaming", false)).toBe(
    "Using My custom server",
  );
  expect(completedLabel(custom)).toBe("Used My custom server · write");
  expect(
    integrationPhaseAction(custom, "streaming", false, "Writing a record"),
  ).toBe("Writing a record");
  expect(integrationCompletedLabel(custom, "Wrote a record")).toBe(
    "Wrote a record",
  );
});

test("ignores empty configured labels", () => {
  const custom = {
    kind: "mcp",
    server: "My custom server",
    tool: "write",
    action: "   ",
    completed: "\n",
    ok: true,
  };

  expect(integrationPhaseAction(custom, "streaming", false, " ")).toBe(
    "Using My custom server",
  );
  expect(integrationCompletedLabel(custom, "\t")).toBe(
    "Used My custom server · write",
  );
});
