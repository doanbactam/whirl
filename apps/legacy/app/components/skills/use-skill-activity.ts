import { useMemo } from "react";

import { useInstalledSkills } from "~/data/skillStore";

export type SkillActivity = {
  /** Store branding for the installed skill behind a phase's name. */
  branding: { name: string; logoUrl: string | null; iconSvg?: string } | null;
  /**
   * True while the installed list hasn't loaded yet, so a phase that *might*
   * be branded can hold off instead of flashing the generic school icon first.
   */
  loading: boolean;
};

const NO_ACTIVITY: SkillActivity = { branding: null, loading: false };
const LOADING_ACTIVITY: SkillActivity = { branding: null, loading: true };

/**
 * Resolve a `skill` phase's name to the installed skill's branding, so the
 * chat chip can show the developer's monochrome mark instead of the generic
 * school icon. Null for uninstalled skills — callers keep the default glyph.
 */
export function useSkillActivity(name?: string): SkillActivity {
  const { installed } = useInstalledSkills();
  return useMemo(() => {
    if (!name) return NO_ACTIVITY;
    if (!installed) return LOADING_ACTIVITY;
    const wanted = name.trim().toLowerCase();
    const match = installed.find(
      (skill) => skill.name.trim().toLowerCase() === wanted,
    );
    if (!match) return NO_ACTIVITY;
    return {
      branding: {
        name: match.name,
        logoUrl: match.logoUrl,
        iconSvg: match.iconSvg,
      },
      loading: false,
    };
  }, [installed, name]);
}
