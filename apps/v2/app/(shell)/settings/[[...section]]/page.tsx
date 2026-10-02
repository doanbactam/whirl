import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  isSettingsSection,
  SECTION_TITLES,
  type SettingsSection,
} from "@/lib/settings-sections";

/* The settings face is rendered by the shell layout (always mounted, so
   the page slide can animate); this route claims /settings and
   /settings/<section>, sets the tab title, and canonicalizes junk
   sections back to /settings. */

type Params = Promise<{ section?: string[] }>;

function sectionFrom(segments: string[] | undefined): SettingsSection | null {
  if (!segments || segments.length === 0) return "general";
  const [segment] = segments;
  return segments.length === 1 && isSettingsSection(segment) ? segment : null;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const section = sectionFrom((await params).section);
  return { title: `${SECTION_TITLES[section ?? "general"]} · Whirl` };
}

export default async function SettingsPage({ params }: { params: Params }) {
  const section = sectionFrom((await params).section);
  if (!section) redirect("/settings");
  return null;
}
