/* Shared between the client shell (lib/view.tsx) and the server route
   (app/(shell)/settings/[[...section]]/page.tsx) — no "use client" here,
   or the server page couldn't read the list. */

export const SETTINGS_SECTIONS = [
  "general",
  "personalization",
  "memory",
  "models",
  "integrations",
  "account",
  "billing",
  "usage",
  "extra-usage",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/* Tab titles: served initially by the settings route's metadata, kept in
   sync on client navigations by the shell (navigation is pushState-based,
   so the server never gets a chance to swap them). */
export const SECTION_TITLES: Record<SettingsSection, string> = {
  general: "Settings",
  personalization: "Personalization settings",
  memory: "Memory settings",
  models: "Model settings",
  integrations: "Integration settings",
  account: "Account settings",
  billing: "Billing settings",
  usage: "Usage",
  "extra-usage": "Extra usage",
};

/** General lives at the bare /settings; the rest get their own segment. */
export function settingsPath(section: SettingsSection): string {
  return section === "general" ? "/settings" : `/settings/${section}`;
}
