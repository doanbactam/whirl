import { IconBrandGithubFilled } from "@tabler/icons-react";

import { SITE_LINKS } from "@/lib/site";
import { ROUND_ICON_BUTTON } from "./theme-switcher";

/** The source on GitHub, as a round icon beside the theme switcher. */
export function MarketingGithubButton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <a
      href={SITE_LINKS.repo}
      target="_blank"
      rel="noreferrer"
      aria-label="Whirl on GitHub"
      title="Whirl on GitHub"
      className={`${ROUND_ICON_BUTTON} ${className}`}
    >
      <IconBrandGithubFilled size={15} />
    </a>
  );
}
