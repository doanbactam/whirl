import { IconCircleCheckFilled, IconPlugConnected } from "@tabler/icons-react";

import { VISUAL_CARD_CLASS as CARD_CLASS } from "~/components/about/visual-card";

/**
 * Illustrations for the /about developers page, mirroring the real console's
 * flows: registering an MCP server and watching submissions move through
 * review. Hand-built like the feature visuals, no screenshots.
 */

const SCANNED_TOOLS = ["create_task", "list_projects", "get_invoice"] as const;

/** The registration moment: an MCP URL plus the tools Whirl found behind it. */
export function McpVisual() {
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
        MCP server URL
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/[0.03] px-3.5 py-2.5 dark:bg-white/[0.04]">
        <IconPlugConnected size={15} className="shrink-0 text-[#0C82F2]" />
        <span className="truncate font-mono text-[12.5px] text-neutral-700 dark:text-neutral-300">
          https://mcp.yourapp.com/mcp
        </span>
      </div>
      <div className="mt-4 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
        3 tools found
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {SCANNED_TOOLS.map((tool) => (
          <div
            key={tool}
            className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-3.5 py-2 dark:bg-white/[0.04]"
          >
            <IconCircleCheckFilled size={14} className="shrink-0 text-[#0C82F2]" />
            <span className="font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
              {tool}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CONSOLE_ROWS = [
  { name: "Acme CRM", kind: "Integration", status: "Live" },
  { name: "Daily Standup", kind: "Skill", status: "Live" },
  { name: "Acme Invoices", kind: "Integration", status: "In review" },
] as const;

/** A slice of the console's table: submissions with their review status. */
export function ConsoleVisual() {
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
          Your submissions
        </span>
        <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
          console.whirl.chat
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {CONSOLE_ROWS.map(({ name, kind, status }) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-xl bg-black/[0.03] px-3.5 py-2.5 dark:bg-white/[0.04]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
                {name}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {kind}
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                status === "Live"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
