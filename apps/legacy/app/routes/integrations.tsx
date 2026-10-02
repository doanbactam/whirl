import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArrowUpRight,
  IconChevronDown,
  IconPlugConnected,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

import {
  FeaturedCarousel,
  type FeaturedSlideData,
} from "~/components/integrations/featured-carousel";
import { InstalledIntegrationsList } from "~/components/integrations/installed-integrations-list";
import { IntegrationInstallModal } from "~/components/integrations/integration-install-modal";
import { IntegrationStoreList } from "~/components/integrations/integration-store-list";
import { IntegrationStoreSkeleton } from "~/components/integrations/integration-store-skeleton";
import { useIntegrationInstallGate } from "~/components/integrations/use-install-gate";
import { InstalledSkillsList } from "~/components/skills/installed-skills-list";
import { SkillInstallModal } from "~/components/skills/skill-install-modal";
import { SkillStoreList } from "~/components/skills/skill-store-list";
import {
  useInstalledIntegrations,
  useIntegrationStore,
  type InstalledIntegration,
  type StoreIntegration,
} from "~/data/integrationStore";
import {
  useInstalledSkills,
  useSkillStore,
  type InstalledSkill,
  type StoreSkill,
} from "~/data/skillStore";
import { openAuthPopup, openOAuthPopup } from "~/data/mcpServers";
import { showToast } from "~/data/toasts";
import { userErrorMessage } from "~/lib/errors";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/integrations")({
  // Deep-link to a listing's modal: /integrations?i=<integration id> or
  // /integrations?s=<skill id> — the modals' copy-link buttons hand these out.
  validateSearch: (search): { i?: string; s?: string } => {
    return {
      ...(typeof search.i === "string" && search.i ? { i: search.i } : {}),
      ...(typeof search.s === "string" && search.s ? { s: search.s } : {}),
    };
  },
  component: IntegrationsPage,
  head: () =>
    seo({
      title: "Integrations · Whirl",
      description:
        "Browse and install integrations that give Whirl new tools — connect your favorite apps in a couple of clicks.",
      url: "/integrations",
    }),
});

type Tab = "browse" | "skills" | "installed";

/** Listings shown per "page" of the browse grid; six two-column rows. */
const PAGE_SIZE = 12;

/** Fisher–Yates, on a copy — Array.sort(random) plays favorites. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function IntegrationsPage() {
  const capture = useCapture();
  const beforeInstall = useIntegrationInstallGate();
  const beforeSkillInstall = useIntegrationInstallGate("skills");
  const { integrations, install, startOAuth, startComposioConnect } =
    useIntegrationStore();
  const { installed, setEnabled, uninstall } = useInstalledIntegrations();
  const { skills, install: installSkill } = useSkillStore();
  const {
    installed: installedSkills,
    setEnabled: setSkillEnabled,
    uninstall: uninstallSkill,
  } = useInstalledSkills();

  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // The open modal lives in the URL (?i=<integration id> / ?s=<skill id>) so
  // it's shareable and the back button closes it. Reading from the live query
  // also keeps the listing fresh (e.g. `installedServerId` flips after an
  // install).
  const navigate = useNavigate();
  const { i: openId, s: openSkillId } = Route.useSearch();
  const selected = openId
    ? (integrations?.find((entry) => entry.id === openId) ?? null)
    : null;
  const selectedSkill = openSkillId
    ? (skills?.find((entry) => entry.id === openSkillId) ?? null)
    : null;

  useEffect(() => {
    capture(ANALYTICS_EVENTS.integrationsPageOpened);
    // Once, on mount — the page view, not every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One "opened" event per listing the modal lands on — covers both clicks
  // and shared links that deep-link straight into it.
  const capturedModalId = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) {
      capturedModalId.current = null;
      return;
    }
    if (capturedModalId.current === selected.id) return;
    capturedModalId.current = selected.id;
    capture(ANALYTICS_EVENTS.integrationModalOpened, {
      integration: selected.name,
    });
  }, [selected, capture]);

  // Same, for the skill modal.
  const capturedSkillModalId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSkill) {
      capturedSkillModalId.current = null;
      return;
    }
    if (capturedSkillModalId.current === selectedSkill.id) return;
    capturedSkillModalId.current = selectedSkill.id;
    capture(ANALYTICS_EVENTS.skillModalOpened, {
      skill: selectedSkill.name,
    });
  }, [selectedSkill, capture]);

  // OAuth popups launched from the Installed tab post back here; the install
  // modal handles its own flow, so stay quiet while it's open.
  useEffect(() => {
    if (selected) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; ok?: boolean; error?: string }
        | undefined;
      if (data?.type !== "mcp-oauth") return;
      if (data.ok) {
        showToast({ message: "Connected." });
        capture(ANALYTICS_EVENTS.integrationOAuthConnected);
      } else {
        showToast({
          message: data.error || "Couldn't connect. Try again.",
          tone: "danger",
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selected, capture]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    capture(ANALYTICS_EVENTS.integrationsTabSwitched, { tab: next });
  };

  // A new search means a new result set — back to the first page of it.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const openIntegration = (integration: StoreIntegration) => {
    void navigate({ to: "/integrations", search: { i: integration.id } });
  };

  const openSkill = (skill: StoreSkill) => {
    void navigate({ to: "/integrations", search: { s: skill.id } });
  };

  const closeModal = () => {
    void navigate({ to: "/integrations", search: {} });
  };

  const toggle = async (item: InstalledIntegration, enabled: boolean) => {
    try {
      await setEnabled({ id: item.serverId, enabled });
      capture(ANALYTICS_EVENTS.integrationToggled, {
        integration: item.name,
        enabled,
      });
    } catch {
      showToast({
        message: "Couldn't update that integration. Try again.",
        tone: "danger",
      });
    }
  };

  const remove = async (item: InstalledIntegration) => {
    try {
      await uninstall({ id: item.serverId });
      capture(ANALYTICS_EVENTS.integrationUninstalled, {
        integration: item.name,
      });
      showToast({ message: `${item.name} uninstalled.` });
    } catch {
      showToast({
        message: "Couldn't uninstall that. Try again.",
        tone: "danger",
      });
    }
  };

  const toggleSkill = async (item: InstalledSkill, enabled: boolean) => {
    try {
      await setSkillEnabled({ installId: item.installId, enabled });
      capture(ANALYTICS_EVENTS.skillToggled, { skill: item.name, enabled });
    } catch {
      showToast({
        message: "Couldn't update that skill. Try again.",
        tone: "danger",
      });
    }
  };

  const removeSkill = async (item: InstalledSkill) => {
    try {
      await uninstallSkill({ installId: item.installId });
      capture(ANALYTICS_EVENTS.skillUninstalled, { skill: item.name });
      showToast({ message: `${item.name} uninstalled.` });
    } catch {
      showToast({
        message: "Couldn't uninstall that. Try again.",
        tone: "danger",
      });
    }
  };

  const connect = async (item: InstalledIntegration) => {
    if (!beforeInstall()) return;
    capture(ANALYTICS_EVENTS.integrationOAuthStarted, {
      integration: item.name,
    });
    try {
      // Composio installs reconnect through Composio's hosted link flow;
      // everything else runs the MCP OAuth consent dance.
      if (item.composioConnect) {
        await openAuthPopup(
          async () =>
            (await startComposioConnect({ id: item.serverId })).redirectUrl,
        );
      } else {
        await openOAuthPopup(startOAuth, item.serverId);
      }
    } catch (error) {
      showToast({
        tone: "danger",
        message: userErrorMessage(error, "Couldn't start sign-in. Try again."),
      });
    }
  };

  // The Installed tab covers both kinds; count them together for its label.
  const installedCount =
    installed === undefined && installedSkills === undefined
      ? undefined
      : (installed?.length ?? 0) + (installedSkills?.length ?? 0);

  // Case-insensitive match on the bits a shopper would search by.
  const q = query.trim().toLowerCase();
  const matches = (name: string, description?: string, author?: string) =>
    !q ||
    name.toLowerCase().includes(q) ||
    (description?.toLowerCase().includes(q) ?? false) ||
    (author?.toLowerCase().includes(q) ?? false);
  const shownIntegrations = integrations?.filter((i) =>
    matches(i.name, i.description, i.author),
  );
  const shownSkills = skills?.filter((s) =>
    matches(s.name, s.description, s.author),
  );
  const shownInstalled = installed?.filter((i) =>
    matches(i.name, i.description, i.author),
  );
  const shownInstalledSkills = installedSkills?.filter((s) =>
    matches(s.name, s.description, s.author),
  );

  // The hero picks: up to five random listings per tab, drawn once per visit
  // — the store queries are reactive, and installing something shouldn't
  // reshuffle the carousel under the user. Ids are pinned; the slides
  // themselves come from the live lists so install state stays fresh.
  const featuredIdsRef = useRef<string[] | null>(null);
  if (featuredIdsRef.current === null && integrations?.length) {
    featuredIdsRef.current = shuffle(integrations.map((i) => i.id)).slice(0, 5);
  }
  const featured: FeaturedSlideData[] =
    featuredIdsRef.current?.flatMap((id) => {
      const entry = integrations?.find((i) => i.id === id);
      if (!entry) return [];
      const installed = entry.installedConnected;
      return [
        {
          id: entry.id,
          name: entry.name,
          description: entry.description ?? "An MCP integration for Whirl",
          logoUrl: entry.logoUrl,
          bannerUrl: entry.bannerUrl,
          iconSvg: entry.iconSvg,
          verified: entry.verified,
          installed,
          cta:
            entry.installedServerId !== null && !installed
              ? "Finish setup"
              : "Install",
        },
      ];
    }) ?? [];

  const featuredSkillIdsRef = useRef<string[] | null>(null);
  if (featuredSkillIdsRef.current === null && skills?.length) {
    featuredSkillIdsRef.current = shuffle(skills.map((s) => s.id)).slice(0, 5);
  }
  const featuredSkills: FeaturedSlideData[] =
    featuredSkillIdsRef.current?.flatMap((id) => {
      const entry = skills?.find((s) => s.id === id);
      if (!entry) return [];
      return [
        {
          id: entry.id,
          name: entry.name,
          description: entry.description ?? "A skill for Whirl",
          logoUrl: entry.logoUrl,
          bannerUrl: entry.bannerUrl,
          iconSvg: entry.iconSvg,
          verified: entry.verified,
          installed: entry.installed,
          cta: "Install",
        },
      ];
    }) ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-10 max-md:pt-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Integrations
          </h1>
          <p className="mt-1 text-[13.5px] leading-snug text-neutral-500 dark:text-neutral-400">
            Teach Whirl new tricks — plug in the tools you already use.
          </p>
        </div>
        <label className="flex h-10 w-full max-w-[260px] items-center gap-2 rounded-full border border-black/[0.08] bg-white px-3.5 transition focus-within:border-[#178dfb] focus-within:ring-2 focus-within:ring-[#178dfb]/25 dark:border-white/[0.1] dark:bg-[#222] max-md:max-w-full">
          <IconSearch
            size={15}
            stroke={2}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "skills" ? "Search skills" : "Search integrations"}
            className="w-full bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </label>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex w-fit items-center gap-1 rounded-full bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {(
            [
              { id: "browse" as const, label: "Browse" },
              { id: "skills" as const, label: "Skills" },
              {
                id: "installed" as const,
                label:
                  installedCount !== undefined && installedCount > 0
                    ? `Installed · ${installedCount}`
                    : "Installed",
              },
            ] satisfies { id: Tab; label: string }[]
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                aria-pressed={active}
                className={`relative h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "text-neutral-900 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="integrations-tab-bg"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#2e2e2e]"
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {tab === "browse" ? (
              shownIntegrations === undefined ? (
                <IntegrationStoreSkeleton hero={!q} />
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
              ) : (
                <>
                  {!q && featured.length > 0 && (
                    <div className="mb-5">
                      <FeaturedCarousel
                        label="Featured integrations"
                        slides={featured}
                        onOpen={(id) =>
                          void navigate({
                            to: "/integrations",
                            search: { i: id },
                          })
                        }
                      />
                    </div>
                  )}
                  <IntegrationStoreList
                    integrations={shownIntegrations.slice(0, visibleCount)}
                    onOpen={openIntegration}
                  />
                  {shownIntegrations.length > visibleCount && (
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setVisibleCount((n) => n + PAGE_SIZE);
                          capture(ANALYTICS_EVENTS.integrationsShowMore, {
                            shown: Math.min(
                              visibleCount + PAGE_SIZE,
                              shownIntegrations.length,
                            ),
                            total: shownIntegrations.length,
                          });
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-4 text-[13px] font-medium text-neutral-700 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-200 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
                      >
                        <IconChevronDown size={15} stroke={2} />
                        Show{" "}
                        {Math.min(
                          PAGE_SIZE,
                          shownIntegrations.length - visibleCount,
                        )}{" "}
                        more
                      </button>
                    </div>
                  )}
                </>
              )
            ) : tab === "skills" ? (
              shownSkills === undefined ? (
                <IntegrationStoreSkeleton hero={!q} />
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
              ) : (
                <>
                  {!q && featuredSkills.length > 0 && (
                    <div className="mb-5">
                      <FeaturedCarousel
                        label="Featured skills"
                        slides={featuredSkills}
                        onOpen={(id) =>
                          void navigate({
                            to: "/integrations",
                            search: { s: id },
                          })
                        }
                      />
                    </div>
                  )}
                  <SkillStoreList skills={shownSkills} onOpen={openSkill} />
                </>
              )
            ) : shownInstalled === undefined ||
              shownInstalledSkills === undefined ? (
              <IntegrationStoreSkeleton hero={false} columns={1} rows={4} />
            ) : shownInstalled.length === 0 &&
              shownInstalledSkills.length === 0 ? (
              q ? (
                <EmptyState
                  title={`Nothing matching "${query.trim()}"`}
                  body="Nothing you've installed goes by that name."
                />
              ) : (
                <EmptyState
                  title="Nothing installed yet"
                  body="Browse the store and install an integration or a skill — its powers become Whirl's powers."
                  action={
                    <button
                      type="button"
                      onClick={() => switchTab("browse")}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c82f2] px-3.5 text-[13px] font-medium text-white transition hover:bg-[#0a74d8]"
                    >
                      <IconSparkles size={15} stroke={2} />
                      Browse integrations
                    </button>
                  }
                />
              )
            ) : (
              <>
                {shownInstalled.length > 0 && (
                  <InstalledIntegrationsList
                    installed={shownInstalled}
                    onToggle={(item, enabled) => void toggle(item, enabled)}
                    onConnect={(item) => void connect(item)}
                    onUninstall={(item) => void remove(item)}
                  />
                )}
                {shownInstalledSkills.length > 0 && (
                  <div className={shownInstalled.length > 0 ? "mt-6" : ""}>
                    {shownInstalled.length > 0 && (
                      <h2 className="mb-2 px-3 text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
                        Skills
                      </h2>
                    )}
                    <InstalledSkillsList
                      installed={shownInstalledSkills}
                      onToggle={(item, enabled) =>
                        void toggleSkill(item, enabled)
                      }
                      onUninstall={(item) => void removeSkill(item)}
                    />
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ConsoleCallout />

      <IntegrationInstallModal
        integration={selected}
        onClose={closeModal}
        onBeforeInstall={beforeInstall}
        install={install}
        startOAuth={startOAuth}
        startComposioConnect={startComposioConnect}
      />

      <SkillInstallModal
        skill={selectedSkill}
        onClose={closeModal}
        onBeforeInstall={beforeSkillInstall}
        install={installSkill}
      />
    </div>
  );
}

/** The developer pitch at the bottom: publish your own via the Whirl Console. */
function ConsoleCallout() {
  const capture = useCapture();
  return (
    <p className="mt-10 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400">
      Built something cool? Publish your own integration from the{" "}
      <a
        href="https://console.whirl.chat"
        target="_blank"
        rel="noreferrer"
        onClick={() => capture(ANALYTICS_EVENTS.integrationsConsoleLinkClicked)}
        className="inline-flex items-center gap-0.5 font-medium text-[#0c82f2] transition hover:text-[#0a74d8] hover:underline"
      >
        Whirl Console
        <IconArrowUpRight size={13} stroke={2.25} />
      </a>
      .
    </p>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/[0.1] px-6 py-14 text-center dark:border-white/[0.1]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.05] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
        <IconPlugConnected size={24} stroke={2} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[14.5px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {title}
        </h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {body}
        </p>
      </div>
      {action}
    </div>
  );
}
