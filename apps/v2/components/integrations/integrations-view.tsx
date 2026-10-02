"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  IconAdjustmentsHorizontal,
  IconArrowUpRight,
  IconSearch,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { AuthModal } from "@/components/auth/auth-modal";
import { preloadImage } from "@/lib/image-cache";
import {
  useIntegrationStore,
  useOAuthResult,
  type StoreIntegration,
} from "@/lib/integrations-data";
import { paneFlip } from "@/lib/motion";
import { useSkillStore, type StoreSkill } from "@/lib/skills-data";
import { SITE_LINKS } from "@/lib/site";
import { groupByCategory } from "@/lib/store-categories";
import { showToast } from "@/lib/toasts";
import { useView } from "@/lib/view";
import { EmptyState } from "./empty-state";
import { IntegrationInstallModal } from "./install-modal";
import { ReauthNotice } from "./reauth-notice";
import { SkillInstallModal } from "./skill-install-modal";
import { StoreGrid, type StoreListing } from "./store-grid";
import { StoreSkeleton } from "./store-skeleton";
import { StoreTabs } from "./store-tabs";

/* The integrations store: the content pane's second away-from-chats face.
   Browse and Skills are plain directories — one headed section per
   category (shelved by a lightweight model server-side), alphabetical
   within. Managing what's installed lives in Settings → Integrations; the
   install journey runs through the modals, and the only window that ever
   opens is the provider's own sign-in. */

type Tab = "browse" | "skills";

/** One headed shelf: a quiet title over the two-column listing grid. */
function StoreSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: StoreListing[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="mb-7 last:mb-0">
      <h2 className="mb-2.5 px-1 text-[13.5px] font-semibold tracking-tight">
        {title}
      </h2>
      <StoreGrid items={items} onOpen={onOpen} />
    </section>
  );
}

export function IntegrationsView() {
  const { user, isLoaded } = useUser();
  const { integrationsOpen, openHome, openSettings } = useView();

  const store = useIntegrationStore();
  const skills = useSkillStore();

  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [openIntegrationId, setOpenIntegrationId] = useState<string | null>(null);
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const signedOut = isLoaded && !user;

  /* Deep links (?i=<integration> / ?s=<skill>, handed out by the modals'
     copy-link buttons) open straight into the listing; the param is then
     stripped so refresh and back stay clean. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integrationId = params.get("i");
    const skillId = params.get("s");
    if (integrationId) {
      setOpenIntegrationId(integrationId);
    } else if (skillId) {
      setTab("skills");
      setOpenSkillId(skillId);
    }
    if (integrationId || skillId) {
      window.history.replaceState(null, "", "/integrations");
    }
  }, []);

  /* Escape backs out to chats — unless a dialog or menu owns the key. */
  useEffect(() => {
    if (!integrationsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector("[data-popup-open], [role='dialog'], [role='menu']")
      )
        return;
      openHome();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [integrationsOpen, openHome]);

  /* The install modal runs its own sign-in flow; a popup opened elsewhere
     (Settings → Integrations) reporting back here just gets a toast. */
  useOAuthResult(({ ok, error }) => {
    if (openIntegrationId) return;
    showToast(
      ok
        ? "Connected."
        : (error ?? "The sign-in didn't finish — try connecting again."),
    );
  });

  /* Warm the image cache as soon as rows arrive: every logo and banner
     decodes off-screen, so grid rows and the modals paint their pictures
     instantly instead of shimmering one by one. */
  useEffect(() => {
    for (const row of store ?? []) {
      preloadImage(row.logoUrl);
      preloadImage(row.bannerUrl);
    }
    for (const row of skills ?? []) {
      preloadImage(row.logoUrl);
      preloadImage(row.bannerUrl);
    }
  }, [store, skills]);

  // Case-insensitive match on the bits a shopper would search by.
  const q = query.trim().toLowerCase();
  const matches = (name: string, description?: string, author?: string) =>
    !q ||
    name.toLowerCase().includes(q) ||
    (description?.toLowerCase().includes(q) ?? false) ||
    (author?.toLowerCase().includes(q) ?? false);

  const shownIntegrations = store?.filter((row) =>
    matches(row.name, row.description, row.author),
  );
  const shownSkills = skills?.filter((row) =>
    matches(row.name, row.description, row.author),
  );

  // The open modals read from the live lists so install state stays fresh.
  const selectedIntegration = openIntegrationId
    ? (store?.find((row) => row.id === openIntegrationId) ?? null)
    : null;
  const selectedSkill = openSkillId
    ? (skills?.find((row) => row.id === openSkillId) ?? null)
    : null;

  const toListing = (row: StoreIntegration): StoreListing => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "An MCP integration for Whirl",
    logoUrl: row.logoUrl,
    iconSvg: row.iconSvg,
    verified: row.verified,
    state: row.installedConnected
      ? "installed"
      : row.installedServerId !== null
        ? "pending"
        : "none",
  });

  const toSkillListing = (row: StoreSkill): StoreListing => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "A skill for Whirl",
    logoUrl: row.logoUrl,
    iconSvg: row.iconSvg,
    verified: row.verified,
    state: row.installed ? "installed" : "none",
  });

  /** The tab's shelves: one section per category, alphabetical within
   *  (the store queries' order). */
  const shelvesOf = <T extends { category: string | null }>(
    rows: T[],
    toItem: (row: T) => StoreListing,
  ): { title: string; items: StoreListing[] }[] =>
    groupByCategory(rows).map((group) => ({
      title: group.title,
      items: group.items.map(toItem),
    }));

  // Cheap enough to rebuild per render — the store caps at 200 listings.
  const browseShelves =
    shownIntegrations && !q ? shelvesOf(shownIntegrations, toListing) : null;
  const skillShelves =
    shownSkills && !q ? shelvesOf(shownSkills, toSkillListing) : null;

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-gutter:stable_both-edges] md:px-6">
      {/* h-fit, or the flex stretch pins this box at pane height and the
          pb-16 lands mid-content — clipping the last shelf's bottom edge. */}
      <div className="mx-auto h-fit w-full max-w-3xl pt-[max(1rem,env(safe-area-inset-top))] pb-10 md:pt-10 md:pb-16">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Integrations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Teach Whirl new tricks — plug in the tools you already use.
            </p>
          </div>
          <label className="flex h-9 w-full max-w-[260px] items-center gap-2 rounded-full bg-well px-3.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--ring)] max-md:max-w-full">
            <IconSearch
              size={15}
              stroke={2}
              className="shrink-0 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={
                tab === "skills" ? "Search skills" : "Search integrations"
              }
              aria-label="Search the store"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </label>
        </header>

        {/* Between the header and the shelves: someone browsing for a new
            integration should find out here that one they already have has
            gone quiet. */}
        {!signedOut && <ReauthNotice className="mt-6" />}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <StoreTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "browse", label: "Browse" },
              { value: "skills", label: "Skills" },
            ]}
          />
          {!signedOut && (
            <button
              type="button"
              onClick={() => openSettings("integrations")}
              className="flex cursor-pointer items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconAdjustmentsHorizontal size={14} stroke={2} />
              Manage installed
            </button>
          )}
        </div>

        <div className="mt-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={tab} {...paneFlip}>
              {tab === "browse" ? (
                !shownIntegrations ? (
                  <StoreSkeleton />
                ) : shownIntegrations.length === 0 ? (
                  q ? (
                    <EmptyState
                      title={`Nothing matching "${query.trim()}"`}
                      body="Try a different name — or clear the search to see everything."
                    />
                  ) : (
                    <EmptyState
                      title="Nothing on the shelves yet"
                      body="The store is warming up — approved integrations will show up here as developers publish them."
                    />
                  )
                ) : browseShelves ? (
                  browseShelves.map((shelf) => (
                    <StoreSection
                      key={shelf.title}
                      title={shelf.title}
                      items={shelf.items}
                      onOpen={setOpenIntegrationId}
                    />
                  ))
                ) : (
                  <StoreGrid
                    items={shownIntegrations.map(toListing)}
                    onOpen={setOpenIntegrationId}
                  />
                )
              ) : !shownSkills ? (
                <StoreSkeleton />
              ) : shownSkills.length === 0 ? (
                q ? (
                  <EmptyState
                    title={`Nothing matching "${query.trim()}"`}
                    body="Try a different name — or clear the search to see everything."
                  />
                ) : (
                  <EmptyState
                    title="No skills on the shelves yet"
                    body="Skills are instruction packs Whirl picks up mid-chat. Approved ones will show up here as developers publish them."
                  />
                )
              ) : skillShelves ? (
                skillShelves.map((shelf) => (
                  <StoreSection
                    key={shelf.title}
                    title={shelf.title}
                    items={shelf.items}
                    onOpen={setOpenSkillId}
                  />
                ))
              ) : (
                <StoreGrid
                  items={shownSkills.map(toSkillListing)}
                  onOpen={setOpenSkillId}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The developer pitch: publish your own via the Whirl Console. */}
        <p className="mt-10 text-center text-[12.5px] text-muted-foreground">
          Built something cool? Publish your own integration from the{" "}
          <a
            href={SITE_LINKS.console}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline"
          >
            Whirl Console
            <IconArrowUpRight size={13} stroke={2.25} />
          </a>
          .
        </p>

        <IntegrationInstallModal
          integration={selectedIntegration}
          onClose={() => setOpenIntegrationId(null)}
          onRequireAuth={signedOut ? () => setAuthOpen(true) : undefined}
        />
        <SkillInstallModal
          skill={selectedSkill}
          onClose={() => setOpenSkillId(null)}
          onRequireAuth={signedOut ? () => setAuthOpen(true) : undefined}
        />
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      </div>
    </div>
  );
}
