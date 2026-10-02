import { expect, test } from "bun:test";

import { resolveMcpLifecycleMetadata } from "../convex/inference/mcpMetadata";

const integrations = [
  {
    name: "Google Sheets",
    tools: [
      {
        name: "GOOGLESHEETS_UPDATE_RANGE",
        description: "Updating spreadsheet cells",
        completed: "Updated spreadsheet cells",
      },
    ],
  },
  {
    name: "Linear",
    tools: [
      {
        name: "issue_update",
        description: "Updating a Linear issue",
        completed: "Updated a Linear issue",
      },
    ],
  },
];

test("preserves Google Sheets action and completion descriptions", () => {
  expect(
    resolveMcpLifecycleMetadata(
      integrations,
      "google-sheets",
      "googlesheets_update_range",
    ),
  ).toEqual({
    action: "Updating spreadsheet cells",
    completed: "Updated spreadsheet cells",
  });
});

test("preserves Linear action and completion descriptions", () => {
  expect(
    resolveMcpLifecycleMetadata(integrations, "Linear", "issue_update"),
  ).toEqual({
    action: "Updating a Linear issue",
    completed: "Updated a Linear issue",
  });
});

test("leaves custom MCP servers without configured metadata on the fallback path", () => {
  expect(
    resolveMcpLifecycleMetadata(
      [{ name: "My custom server" }],
      "My custom server",
      "write",
    ),
  ).toEqual({});
});
