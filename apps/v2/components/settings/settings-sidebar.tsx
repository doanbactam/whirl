"use client";

import {
  IconAdjustmentsFilled,
  IconArrowLeft,
  IconChartPieFilled,
  IconCoinFilled,
  IconCreditCardFilled,
  IconPaletteFilled,
  IconPuzzleFilled,
  IconSparklesFilled,
  IconUserFilled,
  type Icon,
} from "@tabler/icons-react";

import { IconBrainFilled } from "@/components/icons/brain-filled";
import { useSettingsSections } from "@/lib/deployment-features";
import { useExpiredIntegrations } from "@/lib/integrations-data";
import { useView, type SettingsSection } from "@/lib/view";
import { SidebarRow } from "../sidebar-row";

const SECTIONS: { key: SettingsSection; label: string; icon: Icon }[] = [
  { key: "general", label: "General", icon: IconAdjustmentsFilled },
  { key: "personalization", label: "Personalization", icon: IconPaletteFilled },
  { key: "memory", label: "Memory", icon: IconBrainFilled },
  { key: "models", label: "Models", icon: IconSparklesFilled },
  { key: "integrations", label: "Integrations", icon: IconPuzzleFilled },
  { key: "account", label: "Account", icon: IconUserFilled },
  { key: "billing", label: "Billing", icon: IconCreditCardFilled },
  { key: "usage", label: "Usage", icon: IconChartPieFilled },
  { key: "extra-usage", label: "Extra usage", icon: IconCoinFilled },
];

/* The sidebar's settings face: same rail, same pitch as the chats face —
   Back sits in the New pill's slot and the section rows tuck under it on
   the shared 2px seams (nav pulled up -mt-1.5 against the page's gap-2,
   hit areas splitting each seam 1px/1px, edge rows bleeding into the page
   gaps). The active section keeps its pill lit. */
export function SettingsSidebar({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const { section, setSection, closeSettings } = useView();
  /* An expired integration is silent everywhere else in the app — the model
     just stops being able to use it — so the nav carries the news. */
  const expired = useExpiredIntegrations();
  const visible = useSettingsSections();
  const sections = SECTIONS.filter(({ key }) => visible.includes(key));

  return (
    <>
      <SidebarRow
        icon={IconArrowLeft}
        label="Back"
        className="before:-top-1 before:-bottom-px"
        onClick={() => {
          closeSettings();
          onNavigate?.();
        }}
      />
      <nav className="-mt-1.5 flex flex-col gap-0.5">
        {sections.map(({ key, label, icon }, index) => (
          <SidebarRow
            key={key}
            icon={icon}
            label={label}
            active={section === key}
            alert={key === "integrations" && expired.length > 0}
            className={
              index === sections.length - 1
                ? "before:-top-px before:-bottom-1"
                : "before:-top-px before:-bottom-px"
            }
            onClick={() => {
              setSection(key);
              onNavigate?.();
            }}
          />
        ))}
      </nav>
    </>
  );
}
