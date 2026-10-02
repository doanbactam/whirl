import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  AccountPane,
  BillingPane,
  GeneralPane,
  SETTINGS_SECTIONS,
  UsagePane,
  type SettingsSection,
} from "~/components/settings-modal";
import { ExtraUsagePane } from "~/components/extra-usage-pane";
import { McpServersPane } from "~/components/mcp/mcp-servers-pane";

export const Route = createFileRoute("/settings")({
  // Allow deep-linking to a tab, e.g. /settings?section=extra-usage (used by
  // the "out of usage" gate to drop paid users straight onto the top-up).
  validateSearch: (search): { section?: SettingsSection } => {
    const raw = search.section;
    const valid = SETTINGS_SECTIONS.some((s) => s.id === raw);
    return valid ? { section: raw as SettingsSection } : {};
  },
  component: SettingsPage,
  head: () => ({
    meta: [{ title: "Settings · Whirl" }],
  }),
});

function SettingsPage() {
  const navigate = useNavigate();
  const { section: initialSection } = Route.useSearch();
  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? "general",
  );
  const onClose = () => void navigate({ to: "/" });

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06]">
        <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Settings
        </h1>
      </header>
      <div className="flex gap-1 overflow-x-auto border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
        {SETTINGS_SECTIONS.map((s) => {
          const active = s.id === section;
          const Glyph = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
              }`}
            >
              <Glyph size={14} stroke={active ? 2.25 : 2} />
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {section === "general" ? (
          <GeneralPane />
        ) : section === "mcp-servers" ? (
          <McpServersPane />
        ) : section === "account" ? (
          <AccountPane onClose={onClose} />
        ) : section === "usage" ? (
          <UsagePane onClose={onClose} />
        ) : section === "extra-usage" ? (
          <ExtraUsagePane onClose={onClose} />
        ) : (
          <BillingPane onClose={onClose} />
        )}
      </div>
    </div>
  );
}
