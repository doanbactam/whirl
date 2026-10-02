import {
  IconCircleCheckFilled,
  IconCode,
  IconPlugConnected,
} from "@tabler/icons-react";

import { displayHost, SITE_LINKS } from "@/lib/site";

const card =
  "rounded-3xl bg-white p-5 ring-1 ring-black/7 sm:p-6 dark:bg-[#161615] dark:ring-white/8";

export function McpVisual() {
  return (
    <div aria-hidden className={card}>
      <div className="flex items-center gap-2 text-xs font-medium">
        <IconPlugConnected size={16} className="text-[#0c82f2]" />
        MCP server
      </div>
      <div className="mt-4 rounded-2xl bg-neutral-950 p-4 font-mono text-[12px] text-neutral-300">
        <p className="text-neutral-500">tools/list</p>
        {["search_customers", "create_invoice", "update_deal"].map((tool) => (
          <div key={tool} className="mt-2 flex items-center gap-2">
            <IconCode size={13} className="text-sky-400" />
            {tool}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConsoleVisual() {
  const rows = [
    ["Acme CRM", "Integration", "Live"],
    ["Daily Standup", "Skill", "Live"],
    ["Acme Invoices", "Integration", "In review"],
  ];
  return (
    <div aria-hidden className={card}>
      <div className="flex items-center justify-between text-xs font-medium">
        Your submissions
        <span className="rounded-full bg-black/4 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-white/6">
          {displayHost(SITE_LINKS.console)}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {rows.map(([name, kind, status]) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-xl bg-black/3 px-3.5 py-2.5 dark:bg-white/4"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{name}</div>
              <div className="text-[11px] text-neutral-500">{kind}</div>
            </div>
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                status === "Live"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              {status === "Live" && <IconCircleCheckFilled size={10} />}
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
