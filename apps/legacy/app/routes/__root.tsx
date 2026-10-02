import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ClerkProvider,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/tanstack-react-start";
import { ConvexReactClient, useConvex } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { AutumnProvider, useCustomer } from "autumn-js/react";
import { api } from "@whirl/backend/convex/_generated/api";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
  useNavigate,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Agentation } from "agentation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCreditCard,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconLogin2,
  IconLogout,
  IconMessageCircle,
  IconMoon,
  IconPlugConnected,
  IconPlus,
  IconReload,
  IconSearch,
  IconSettings,
  IconShield,
  IconX,
} from "@tabler/icons-react";

import appCss from "../app.css?url";
import { seo, SITE_NAME, SITE_URL, DEFAULT_DESCRIPTION } from "~/lib/seo";
import { AuthGateProvider, useAuthGate } from "~/lib/auth-gate";
import { AuthErrorBoundary } from "~/components/auth-error-boundary";
import { ComposerLayout } from "~/components/composer-layout";
import { DepthButton } from "~/components/depth-button";
import { DocumentSidebar } from "~/components/document-sidebar";
import { HtmlSidebar } from "~/components/html-sidebar";
import { DocumentSidebarProvider } from "~/lib/document-sidebar";
import { SharedArtifactsProvider } from "~/lib/shared-artifacts";
import { ComposerIngestProvider } from "~/lib/composer-ingest";
import { IncognitoProvider, useIncognito } from "~/lib/incognito";
import {
  DropdownShell,
  dropdownItemCompactClass,
  dropdownShellSubtleOpenClass,
} from "~/components/dropdown-menu";
import { FeedbackModal } from "~/components/feedback-modal";
import {
  HoverPillOverlay,
  HoverPillProvider,
  useHoverPill,
} from "~/components/hover-pill";
import { SettingsModal } from "~/components/settings-modal";
import { Skeleton } from "~/components/skeleton";
import { UpgradeProvider } from "~/components/upgrade-modal";
import { RainbowLoader } from "~/components/rainbow-loader";
import { WhirlLogo } from "~/components/whirl-logo";
import { RAINBOW_LAYER, WhirlRings } from "~/components/whirl-rings";
import { Spinner } from "~/components/spinner";
import { MobileNav } from "~/components/mobile-nav";
import { MobileTopBar } from "~/components/mobile-top-bar";
import { SearchModal } from "~/components/search-modal";
import { FolderSection } from "~/components/folder-section";
import { ThreadRow } from "~/components/thread-row";
import { ResetNoticeModal } from "~/components/reset-notice-modal";
import { Toaster } from "~/components/toaster";
import { UsageMultiplierBadge } from "~/components/usage-multiplier-badge";
import { UsageMultiplierBanner } from "~/components/usage-multiplier-banner";
import { useFolders } from "~/data/folders";
import {
  groupThreads,
  partitionThreadsByFolder,
  useThreadActions,
  useThreads,
  useThreadsError,
  useThreadsLoading,
} from "~/data/threads";
import { getThreadDrag } from "~/lib/folders";
import {
  ANALYTICS_EVENTS,
  AnalyticsProvider,
  useCapture,
  useIdentifyUser,
} from "~/lib/posthog";
import { findActivePlanProduct, readFreeMessages } from "~/lib/messages";
import { readExtraUsage } from "~/lib/extra-usage";
import { formatUsd } from "~/lib/money";
import {
  closeSettings,
  openSettings,
  useSettingsState,
} from "~/data/settings-controller";
import {
  readSidebarCollapsed,
  clampSidebarWidth,
  readSidebarWidth,
  setSidebarCollapsed as persistSidebarCollapsed,
  setSidebarWidth as persistSidebarWidth,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  snapSidebarWidth,
} from "~/lib/sidebar";
import { readThemePref, resolveDark, setThemePref, type ThemePref } from "~/lib/theme";
import { useMinMd } from "~/lib/use-media";
import { useActiveMultiplier } from "~/lib/admin";
import { useReportUserContext } from "~/lib/user-context";
import { useVersionWatcher } from "~/lib/version-check";

export const Route = createRootRoute({
  // Site-wide SEO baseline. Individual routes override the title/description via
  // their own `head()` (see ~/lib/seo). This replaces the old waitlist landing
  // metadata, which is what search + social used to show for whirl.chat.
  head: () => {
    const base = seo();
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        ...base.meta,
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: SITE_URL,
            description: DEFAULT_DESCRIPTION,
          },
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", href: "/whirltransp.png" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
        },
        ...base.links,
      ],
    };
  },
  component: App,
  errorComponent: RootErrorBoundary,
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {/* Literal tags (not via head()) so the light/dark pair survives —
            TanStack dedupes meta by name and would otherwise drop one. */}
        <meta
          name="theme-color"
          content="#F4F4F6"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#141415"
          media="(prefers-color-scheme: dark)"
        />
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='dark'||((t==='system'||!t)&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && <Agentation />}
        <Scripts />
      </body>
    </html>
  );
}

function AutumnBridge({ children }: { children: React.ReactNode }) {
  const convex = useConvex();

  return (
    <AutumnProvider convex={convex} convexApi={api.autumn}>
      <UpgradeProvider>{children}</UpgradeProvider>
    </AutumnProvider>
  );
}

function App() {
  const [convex] = useState(() => {
    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    if (!convexUrl) {
      throw new Error("Missing VITE_CONVEX_URL in your .env file");
    }
    return new ConvexReactClient(convexUrl);
  });

  return (
    <Layout>
      <AnalyticsProvider>
        <ClerkProvider>
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            <AutumnBridge>
              <AuthGateProvider>
                <DocumentSidebarProvider>
                  <ComposerIngestProvider>
                    <IncognitoProvider>
                      <AuthErrorBoundary>
                        <ShellRouter />
                      </AuthErrorBoundary>
                    </IncognitoProvider>
                  </ComposerIngestProvider>
                </DocumentSidebarProvider>
              </AuthGateProvider>
            </AutumnBridge>
          </ConvexProviderWithClerk>
        </ClerkProvider>
      </AnalyticsProvider>
    </Layout>
  );
}

const COMPOSER_BYPASS_PATHS = new Set([
  "/pricing",
  "/threads",
  "/settings",
  "/admin",
  "/integrations",
]);

function ShellRouter() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [searchOpen, setSearchOpen] = useState(false);
  const { isLoaded } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const minMd = useMinMd();
  const capture = useCapture();
  const incognito = useIncognito();
  useVersionWatcher();
  useReportUserContext();
  useIdentifyUser();

  const openSearch = useCallback(
    (via: "button" | "shortcut") => {
      capture(ANALYTICS_EVENTS.searchOpened, { via });
      setSearchOpen(true);
    },
    [capture],
  );
  // Signed-out visitors can browse the whole shell — inference is gated at the
  // point of use (see AuthGateProvider / ComposerLayout), not by hiding the app.
  const bypassComposer = COMPOSER_BYPASS_PATHS.has(location.pathname);
  // A public shared thread renders the read-only conversation in the content
  // pane (no composer) while keeping the normal sidebar + shell around it.
  const sharePath = location.pathname.startsWith("/share/");
  const shareId = sharePath
    ? location.pathname.slice("/share/".length)
    : null;
  const showMobileNav =
    !incognito.enabled &&
    !["/pricing", "/sso-callback", "/debug"].includes(location.pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((v) => {
          if (!v) capture(ANALYTICS_EVENTS.searchOpened, { via: "shortcut" });
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      resolveDark(readThemePref()),
    );
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePref() === "system") {
        document.documentElement.classList.toggle("dark", mq.matches);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (
    location.pathname === "/sso-callback" ||
    location.pathname === "/debug" ||
    // The /about marketing mini-site brings its own shell (see routes/about.tsx)
    // and must stay fully server-rendered for SEO — bailing out here keeps it
    // clear of the Clerk `isLoaded` gate below, which would otherwise replace
    // the SSR'd markup with a loading screen.
    location.pathname === "/about" ||
    location.pathname.startsWith("/about/") ||
    // A standalone single-artifact page renders outside the chat shell. Shared
    // threads, by contrast, render inside the full shell (sidebar + content
    // pane) so they look exactly like a normal thread — see below.
    location.pathname.startsWith("/visual/")
  ) {
    return <Outlet />;
  }

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  return (
    <>
      <div className="flex h-dvh w-full max-w-[100dvw] flex-col overflow-hidden overflow-x-hidden bg-[#F4F4F6] text-[13px] dark:bg-[#141415]">
        <UsageMultiplierBanner />
        <div className="flex min-h-0 w-full flex-1 overflow-hidden overflow-x-hidden">
        {minMd && (
          <Sidebar
            open={sidebarOpen}
            hidden={incognito.enabled}
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            onWidthPreview={setSidebarWidth}
            onWidthCommit={(next) => {
              const snapped = snapSidebarWidth(next);
              setSidebarWidth(snapped);
              persistSidebarWidth(snapped);
            }}
            onClose={() => setSidebarOpen(false)}
            onToggleCollapsed={() => {
              setSidebarCollapsed((prev) => {
                const next = !prev;
                persistSidebarCollapsed(next);
                capture(ANALYTICS_EVENTS.sidebarToggled, { collapsed: next });
                return next;
              });
            }}
            onOpenSearch={() => openSearch("button")}
          />
        )}
        <SearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelect={(thread) => {
            setSearchOpen(false);
            void navigate({ to: `/thread/${thread.id}` });
          }}
        />
        {/* Content region (everything right of the main sidebar). Positioned so
            the document panel can morph into a fullscreen overlay that covers
            the (static) chat without reflowing it. Wrapped in the shared-artifact
            store so a public shared thread's docked panels resolve from it too;
            it's a passthrough on every other path. */}
        <SharedArtifactsProvider shareId={shareId}>
        <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="relative z-0 flex w-full min-w-0 flex-1 flex-col py-2 pl-2 pr-2 max-md:max-w-full max-md:pt-0 max-md:pb-[84px] md:pl-0">
          <div id="content-pane" className="relative min-h-0 flex-1">
            <main className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-[#F4F4F6] shadow-[inset_0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-[#F4F4F6] dark:bg-[#141415] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] dark:ring-[#141415]">
              {showMobileNav && <MobileTopBar />}
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {sharePath ? (
                  // The share route owns its own scroll area + floating fork
                  // composer, mirroring the live thread layout.
                  <Outlet />
                ) : bypassComposer ? (
                  <div className="h-full overflow-y-auto">
                    <Outlet />
                  </div>
                ) : (
                  <ComposerLayout />
                )}
              </div>
            </main>
          </div>
        </div>
        <DocumentSidebar />
        <HtmlSidebar />
        </div>
        </SharedArtifactsProvider>
        </div>
      </div>
      {showMobileNav && <MobileNav />}
      <Toaster />
      <ResetNoticeModal />
    </>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F4F4F6] dark:bg-[#141415]">
      <RainbowLoader size={40} />
    </div>
  );
}

const threadsStagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

const threadGroupItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] },
  },
};

function Sidebar({
  open,
  hidden = false,
  collapsed,
  width,
  onWidthPreview,
  onWidthCommit,
  onClose,
  onToggleCollapsed,
  onOpenSearch,
}: {
  open: boolean;
  /** Tuck the whole rail away (incognito) — collapses its width to 0 and fades. */
  hidden?: boolean;
  collapsed: boolean;
  width: number;
  onWidthPreview: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onOpenSearch: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const threads = useThreads();
  const threadsLoading = useThreadsLoading();
  const threadsError = useThreadsError();
  const folders = useFolders();
  // Threads living in a folder render inside it; the rest keep the date groups.
  const { byFolder, loose } = partitionThreadsByFolder(
    threads,
    new Set(folders.map((folder) => folder.id)),
  );
  const groupedThreads = groupThreads(loose);
  // No folders => no block at all; the first one is created from a thread's
  // ⋯ menu ("Move to folder" → "New folder…").
  const showFolders = folders.length > 0;
  const openThread = useCallback(
    (thread: { id: string }) => {
      void navigate({ to: `/thread/${thread.id}` });
      onClose();
    },
    [navigate, onClose],
  );
  const navRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [isResizing, setIsResizing] = useState(false);
  const minMd = useMinMd();
  // One shared hover pill for the thread list (same treatment as the
  // about-site nav), hopping between folder headers and thread rows. The
  // integrations row sits outside the list's scroll clip, so it carries its
  // own single-row pill — same machinery, so the feel is identical.
  const pill = useHoverPill();
  const integrationsPill = useHoverPill();

  // Dragging a filed thread over the list (outside any folder — folders stop
  // the drag events from bubbling this far) offers to unfile it.
  const { setFolder } = useThreadActions();
  const [unfileActive, setUnfileActive] = useState(false);
  const unfileDepthRef = useRef(0);
  const unfileDragInFlight = () => {
    const drag = getThreadDrag();
    return drag != null && drag.folderId != null;
  };

  // Cancelled drags (Escape) don't always fire a final dragleave, so clear the
  // highlight whenever the drag ends anywhere.
  useEffect(() => {
    if (!unfileActive) return;
    const clear = () => {
      unfileDepthRef.current = 0;
      setUnfileActive(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [unfileActive]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const overflow = el.scrollHeight > el.clientHeight + 1;
      setEdges({
        top: overflow && el.scrollTop > 4,
        bottom:
          overflow && el.scrollTop + el.clientHeight < el.scrollHeight - 4,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      update();
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const iconOnly = collapsed;
  const SidebarToggleGlyph = collapsed
    ? IconLayoutSidebarRight
    : IconLayoutSidebar;
  const hideThreads = collapsed && minMd;
  const asideWidth = hidden
    ? 0
    : minMd
      ? collapsed
        ? SIDEBAR_COLLAPSED_WIDTH
        : width
      : SIDEBAR_DEFAULT_WIDTH;

  const shellTransition = isResizing
    ? { duration: 0 }
    : { type: "tween" as const, duration: 0.24, ease: [0.32, 0.72, 0, 1] as const };

  // shared css easing so inner content rides the exact same curve as the
  // motion-driven shell width — keeps the whole collapse feeling like one piece
  const contentTransition = isResizing
    ? "transition-none"
    : "transition-[opacity,width,transform] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]";

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || !minMd || hidden) return;
      e.preventDefault();
      resizeStartRef.current = { x: e.clientX, width };
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        onWidthPreview(
          clampSidebarWidth(start.width + (ev.clientX - start.x)),
        );
      };

      const onEnd = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        resizeStartRef.current = null;
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        if (start) {
          onWidthCommit(
            clampSidebarWidth(start.width + (ev.clientX - start.x)),
          );
        }
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [collapsed, minMd, hidden, onWidthCommit, onWidthPreview, width],
  );

  const onResizeDoubleClick = useCallback(() => {
    if (collapsed || !minMd) return;
    onWidthCommit(SIDEBAR_DEFAULT_WIDTH);
  }, [collapsed, minMd, onWidthCommit]);

  return (
    <div className={minMd ? "contents" : "w-0 shrink-0 overflow-visible"}>
    <motion.aside
      initial={false}
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      animate={{
        width: asideWidth,
        x: minMd ? 0 : open ? 0 : -asideWidth,
        opacity: hidden ? 0 : 1,
        // Horizontal padding floors the border-box width, so width:0 alone
        // still leaves a 16px slab — lopsided against the content pane's 8px
        // right gutter. Collapse the left padding with it so the tucked rail
        // settles at exactly 8px (its right padding), matching the other side.
        paddingLeft: hidden ? 0 : 8,
      }}
      transition={{
        width: shellTransition,
        x: shellTransition,
        opacity: shellTransition,
        paddingLeft: shellTransition,
      }}
      className={`fixed inset-y-0 left-0 z-50 flex h-dvh flex-col overflow-hidden bg-[#F4F4F6] py-2 pr-2 text-neutral-900 will-change-[width] dark:bg-[#141415] dark:text-neutral-100 md:static md:relative md:z-50 md:h-auto md:shrink-0 md:translate-x-0 md:bg-transparent md:will-change-auto md:dark:bg-transparent ${
        hidden ? "pointer-events-none" : ""
      }`}
    >
      <div
        className={`flex shrink-0 items-center ${iconOnly ? "md:flex-col md:gap-1" : "justify-between"}`}
      >
        <div
          className={`group flex h-10 shrink-0 cursor-pointer items-center rounded-xl ${contentTransition} hover:bg-[#E0E0E0] dark:hover:bg-[#1E1E1E] ${
            iconOnly ? "w-fit self-start px-3 md:w-9 md:justify-center md:self-center md:px-0" : "w-fit self-start px-3"
          }`}
        >
          <div className="relative h-5 w-5">
            <div
              className={`transition-opacity duration-300 ${threadsLoading ? "opacity-0" : "opacity-100"}`}
            >
              <WhirlLogo size={20} />
            </div>
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${threadsLoading ? "opacity-100" : "opacity-0"}`}
            >
              <WhirlRings spin={threadsLoading} layers={[RAINBOW_LAYER]} />
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:bg-[#E0E0E0] dark:text-neutral-400 dark:hover:bg-[#1E1E1E] md:hidden"
        >
          <IconX size={16} stroke={2} />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:bg-[#E0E0E0] dark:text-neutral-400 dark:hover:bg-[#1E1E1E] md:flex ${
            iconOnly ? "md:mt-0" : ""
          }`}
        >
          <SidebarToggleGlyph size={16} stroke={2} />
        </button>
      </div>

      <DepthButton
        variant="blue"
        type="button"
        title={iconOnly ? "New chat" : undefined}
        onClick={() => {
          void navigate({ to: "/" });
          onClose();
        }}
        className={`mt-2 flex h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-xl text-[13px] font-medium tracking-tight text-white ${
          iconOnly ? "px-3 md:w-9 md:justify-center md:gap-0 md:px-0" : "px-3"
        }`}
      >
        <IconPlus size={15} stroke={2.5} className="shrink-0" />
        <span
          className={`truncate ${contentTransition} ${
            iconOnly ? "md:w-0 md:opacity-0" : "w-auto opacity-100"
          }`}
        >
          New
        </span>
      </DepthButton>

      <DepthButton
        type="button"
        title={iconOnly ? "Search" : undefined}
        onClick={() => {
          onOpenSearch();
          onClose();
        }}
        className={`mt-2 flex h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-xl text-[13px] text-neutral-500 dark:text-neutral-400 ${
          iconOnly ? "px-3 md:w-9 md:justify-center md:gap-0 md:px-0" : "px-3"
        }`}
      >
        <IconSearch size={15} stroke={2} className="shrink-0" />
        <span
          className={`truncate ${contentTransition} ${
            iconOnly ? "md:w-0 md:opacity-0" : "w-auto opacity-100"
          }`}
        >
          Search
        </span>
      </DepthButton>

      <button
        type="button"
        title={iconOnly ? "Integrations" : undefined}
        onClick={() => {
          void navigate({ to: "/integrations" });
          onClose();
        }}
        onMouseEnter={(e) =>
          integrationsPill.onHover("integrations", e.currentTarget)
        }
        onMouseLeave={() => integrationsPill.onLeave("integrations")}
        className={`group relative mt-2 flex h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-xl text-[13px] transition-colors ${
          location.pathname === "/integrations"
            ? "text-neutral-900 dark:text-neutral-100"
            : "text-neutral-500 dark:text-neutral-400"
        } ${
          iconOnly ? "px-3 md:w-9 md:justify-center md:gap-0 md:px-0" : "px-3"
        }`}
      >
        {/* On the integrations page the row stays filled, and still squishes
            on press — same layer trick as the active thread row. */}
        {location.pathname === "/integrations" && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-[#E0E0E0] transition-[scale] duration-150 ease-out group-active:scale-[0.97] dark:bg-[#1E1E1E]"
          />
        )}
        <HoverPillOverlay
          pill={integrationsPill}
          fillClassName="bg-[#E0E0E0] dark:bg-[#1E1E1E]"
          radius={12}
          pressScale={0.97}
        />
        <IconPlugConnected size={15} stroke={2} className="relative shrink-0" />
        <span
          className={`relative truncate ${contentTransition} ${
            iconOnly ? "md:w-0 md:opacity-0" : "w-auto opacity-100"
          }`}
        >
          Integrations
        </span>
      </button>

      <HoverPillProvider pill={pill}>
      <motion.div
        initial={false}
        animate={{
          gridTemplateRows: hideThreads ? "0fr" : "1fr",
          opacity: hideThreads ? 0 : 1,
          marginTop: hideThreads ? 0 : 20,
        }}
        transition={shellTransition}
        className="grid min-h-0 flex-1"
        style={{ pointerEvents: hideThreads ? "none" : undefined }}
        aria-hidden={hideThreads}
      >
        {/* Pinned to the expanded width so collapse/expand clips the list like
            a curtain — letting it squish with the shell re-truncates every
            thread title on every animation frame, which is where the jank was. */}
        <div
          className="relative min-h-0 overflow-hidden"
          style={{ width: minMd ? width - 16 : undefined }}
        >
        <nav
          ref={navRef}
          onDragEnter={(e) => {
            if (!unfileDragInFlight()) return;
            e.preventDefault();
            unfileDepthRef.current += 1;
            setUnfileActive(true);
          }}
          onDragOver={(e) => {
            if (!unfileDragInFlight()) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragLeave={() => {
            if (!unfileDragInFlight()) return;
            unfileDepthRef.current = Math.max(0, unfileDepthRef.current - 1);
            if (unfileDepthRef.current === 0) setUnfileActive(false);
          }}
          onDrop={(e) => {
            unfileDepthRef.current = 0;
            setUnfileActive(false);
            const drag = getThreadDrag();
            if (!drag || drag.folderId == null) return;
            e.preventDefault();
            void setFolder(drag.threadId, null, "drag");
          }}
          className={`absolute inset-0 flex flex-col gap-5 overflow-y-auto rounded-xl transition-[background-color,box-shadow] ${
            unfileActive
              ? "bg-[#0c82f2]/[0.05] ring-1 ring-inset ring-[#0c82f2]/25 dark:bg-[#3b9bff]/[0.06] dark:ring-[#3b9bff]/25"
              : ""
          }`}
        >
        <HoverPillOverlay
          pill={pill}
          fillClassName="bg-[#E0E0E0] dark:bg-[#1E1E1E]"
          radius={12}
          pressScale={0.97}
        />
        <AnimatePresence mode="wait" initial={false}>
          {threadsLoading ? (
            <motion.div
              key="threads-spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
              className="flex items-center justify-center py-4 text-neutral-400 dark:text-neutral-500"
            >
              <Spinner size={16} className="text-blue-500" />
            </motion.div>
          ) : threadsError ? (
            <motion.div
              key="threads-error"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
              className="mx-1 flex flex-col items-start gap-2 rounded-xl bg-red-500/[0.06] p-3 dark:bg-red-500/[0.12]"
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-red-700 dark:text-red-300">
                <IconAlertTriangle size={13} stroke={2.5} />
                Couldn't load chats
              </span>
              <p className="text-[11.5px] leading-4 text-red-700/80 dark:text-red-300/80">
                {threadsError.message || "Check your connection and try again."}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex h-7 items-center gap-1 rounded-full bg-red-500/10 px-2.5 text-[11.5px] font-medium text-red-700 transition-colors hover:bg-red-500/15 dark:bg-red-500/20 dark:text-red-200 dark:hover:bg-red-500/25"
              >
                <IconReload size={12} stroke={2.5} />
                Try again
              </button>
            </motion.div>
          ) : !showFolders && groupedThreads.length === 0 ? null : (
            <motion.div
              key="threads-list"
              variants={threadsStagger}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              className="flex flex-col gap-5"
            >
              {showFolders && (
                <motion.div variants={threadGroupItem} key="folders">
                  <FolderSection
                    folders={folders}
                    threadsByFolder={byFolder}
                    onOpenThread={openThread}
                  />
                </motion.div>
              )}
              {groupedThreads.map(([group, items]) => (
                <motion.div
                  variants={threadGroupItem}
                  key={group}
                  className="flex flex-col gap-0.5"
                >
                  <span className="flex h-6 items-center px-3 text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-500">
                    {group}
                  </span>
                  {items.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      onOpen={() => openThread(thread)}
                    />
                  ))}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        </nav>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#F4F4F6] to-transparent transition-opacity duration-150 dark:from-[#141415]"
          style={{ opacity: edges.top ? 1 : 0 }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#F4F4F6] to-transparent transition-opacity duration-150 dark:from-[#141415]"
          style={{ opacity: edges.bottom ? 1 : 0 }}
        />
        </div>
      </motion.div>
      </HoverPillProvider>

      <div className={`relative z-50 shrink-0 ${iconOnly ? "md:mt-auto" : ""}`}>
        <UserRow collapsed={iconOnly} />
      </div>

      {!collapsed && minMd && !hidden && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          title="Drag to resize. Double-click for default width."
          onPointerDown={onResizePointerDown}
          onDoubleClick={onResizeDoubleClick}
          className={`absolute top-0 right-0 z-50 hidden h-full w-2 translate-x-1/2 cursor-col-resize touch-none md:block ${
            isResizing
              ? "bg-[#0c82f2]/25"
              : "bg-transparent hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
          }`}
        />
      )}
    </motion.aside>
    </div>
  );
}

const PLAN_BADGE_BY_PRODUCT: Record<string, "mini" | "turbo" | "mega"> = {
  mini: "mini",
  turbo: "turbo",
  mega: "mega",
};

function UserRow({ collapsed = false }: { collapsed?: boolean }) {
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();
  const { requireAuth } = useAuthGate();
  const { customer, isLoading: customerLoading } = useCustomer();
  const navigate = useNavigate();
  const capture = useCapture();
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const settingsState = useSettingsState();
  const [themePref, setThemePrefState] = useState<ThemePref>("system");
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const isAdmin = user?.publicMetadata?.role === "admin";
  const activeProduct = findActivePlanProduct(customer?.products);
  const planBadge = activeProduct ? PLAN_BADGE_BY_PRODUCT[activeProduct.id] : undefined;
  const planLabel = activeProduct?.name ?? "Free";

  useEffect(() => {
    setThemePrefState(readThemePref());
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<ThemePref>;
      setThemePrefState(ce.detail);
    };
    window.addEventListener("theme-change", onChange);
    return () => window.removeEventListener("theme-change", onChange);
  }, []);

  const updateMenuAnchor = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mdCollapsed =
      collapsed && window.matchMedia("(min-width: 768px)").matches;
    setMenuAnchor({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
      width: mdCollapsed ? 224 : rect.width,
    });
  }, [collapsed]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuAnchor(null);
      return;
    }
    updateMenuAnchor();
    window.addEventListener("resize", updateMenuAnchor);
    return () => window.removeEventListener("resize", updateMenuAnchor);
  }, [open, updateMenuAnchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !menuRef.current?.contains(t) &&
        !subRef.current?.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isLoaded) {
    return (
      <div className="relative mt-2">
        <div
          aria-hidden
          className={`flex h-12 w-full items-center gap-2.5 rounded-xl px-2 ${
            collapsed ? "md:mx-auto md:h-9 md:w-9 md:justify-center md:px-0" : ""
          }`}
        >
          <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
          {!collapsed && (
            <div className="h-3 w-24 animate-pulse rounded bg-black/[0.08] dark:bg-white/[0.08]" />
          )}
        </div>
      </div>
    );
  }

  // Signed out: offer a way in instead of a dead account row.
  if (!user) {
    return (
      <div className={`relative mt-2 ${collapsed ? "md:flex md:justify-center" : ""}`}>
        <button
          type="button"
          onClick={() => requireAuth()}
          title={collapsed ? "Sign in" : undefined}
          className={`flex h-12 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-[#E0E0E0] dark:hover:bg-[#1E1E1E] ${
            collapsed ? "md:h-9 md:w-9 md:justify-center md:px-0" : ""
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
            <IconLogin2 size={15} stroke={2} />
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                Sign in
              </span>
              <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                to start chatting
              </span>
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative mt-2 ${collapsed ? "md:flex md:justify-center" : ""} ${open ? "z-50" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? displayName : undefined}
        className={`flex h-12 w-full items-center gap-2.5 rounded-xl px-2 text-left ${
          collapsed ? "md:h-9 md:w-9 md:justify-center md:rounded-full md:px-0" : ""
        } ${
          open
            ? "bg-[#E0E0E0] dark:bg-[#1E1E1E]"
            : "hover:bg-[#E0E0E0] dark:hover:bg-[#1E1E1E]"
        }`}
      >
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={displayName}
            className={`h-8 w-8 shrink-0 rounded-full object-cover ${collapsed ? "md:h-7 md:w-7" : ""}`}
          />
        ) : (
          <div
            className={`h-8 w-8 shrink-0 rounded-full border border-neutral-400 dark:border-neutral-600 ${
              collapsed ? "md:h-7 md:w-7" : ""
            }`}
          />
        )}
        <span className={`flex min-w-0 flex-1 flex-col ${collapsed ? "md:hidden" : ""}`}>
          <span className="truncate text-[13px] font-medium">{displayName}</span>
          {customerLoading && !customer ? (
            <Skeleton className="mt-1 h-2.5 w-12" />
          ) : planBadge ? (
            <img
              src={`/plan-badges/${planBadge}.svg`}
              alt={planLabel}
              className="mt-0.5 h-2.5 w-auto self-start brightness-0 opacity-50 dark:opacity-60 dark:invert"
            />
          ) : (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {planLabel}
            </span>
          )}
        </span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={`text-neutral-500 transition-transform duration-150 ${open ? "rotate-180" : ""} ${collapsed ? "md:hidden" : ""}`}
        />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && menuAnchor && (
              <motion.div
                key="user-menu"
                ref={menuRef}
                role="menu"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
                style={
                  {
                    position: "fixed",
                    left: menuAnchor.left,
                    bottom: menuAnchor.bottom,
                    width: menuAnchor.width,
                    zIndex: 60,
                  } satisfies CSSProperties
                }
                className={dropdownShellSubtleOpenClass}
              >
                <UsageBlock />
                <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
                <ThemeMenuItem
                  value={themePref}
                  onChange={setThemePref}
                  subRef={subRef}
                />
                {isAdmin && (
                  <MenuItem
                    icon={<IconShield size={14} stroke={2} />}
                    onClick={() => {
                      setOpen(false);
                      void navigate({ to: "/admin" });
                    }}
                  >
                    Admin
                  </MenuItem>
                )}
                <MenuItem
                  icon={<IconSettings size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    openSettings();
                  }}
                >
                  Settings
                </MenuItem>
                <MenuItem
                  icon={<IconMessageCircle size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    capture(ANALYTICS_EVENTS.feedbackOpened);
                    setFeedbackOpen(true);
                  }}
                >
                  Feedback
                </MenuItem>
                <MenuItem
                  icon={<IconCreditCard size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    void navigate({ to: "/pricing" });
                  }}
                >
                  Plans & billing
                </MenuItem>
                <MenuItem
                  icon={<IconLogout size={14} stroke={2} />}
                  onClick={() => {
                    setOpen(false);
                    void signOut({ redirectUrl: "/" });
                  }}
                >
                  Log out
                </MenuItem>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      <SettingsModal
        open={settingsState.open}
        initialSection={settingsState.section}
        onClose={closeSettings}
      />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  );
}

function formatResetIn(ms: number) {
  if (ms <= 0) return "now";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function UsageBlockSkeleton({
  barCount,
  barWidth,
}: {
  barCount: number;
  barWidth: number;
}) {
  return (
    <div className="px-2.5 pb-2 pt-1.5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3.5 w-16" />
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-2 w-9" />
        </div>
      </div>
      <div className="mt-2 flex h-5 w-full items-center justify-between">
        {Array.from({ length: barCount }).map((_, i) => (
          <Skeleton key={i} style={{ width: barWidth }} className="h-full rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-2 h-7 w-full rounded-lg" />
    </div>
  );
}

function UsageBlock() {
  const { customer, isLoading } = useCustomer();
  const navigate = useNavigate();
  const BAR_WIDTH = 3;
  const BAR_GAP = 3;
  const barsRef = useRef<HTMLDivElement>(null);
  const [totalBars, setTotalBars] = useState(24);
  const [now, setNow] = useState(() => Date.now());

  const free = readFreeMessages(customer);
  const extra = readExtraUsage(customer);
  const extraUsedPct =
    extra.included > 0
      ? Math.min(100, Math.max(0, (extra.used / extra.included) * 100))
      : 0;

  // While a usage-multiplier event runs, playfully inflate the remaining %
  // display to match — a 0.5 multiplier ("2× usage") doubles what you see.
  const multiplierEvent = useActiveMultiplier();
  const usageBoost =
    multiplierEvent && multiplierEvent.multiplier > 0
      ? 1 / multiplierEvent.multiplier
      : 1;
  const usage = customer?.features?.usage;
  const balance = typeof usage?.balance === "number" ? usage.balance : 0;
  const included =
    typeof usage?.included_usage === "number" ? usage.included_usage : 0;
  const unlimited = usage?.unlimited === true;
  // Not clamped to 100: during a "2× usage" event a full balance proudly reads
  // as 200%. The bar fill itself is clamped separately (see filledBars).
  const percent = unlimited
    ? 100
    : included > 0
      ? Math.max(0, (balance / included) * 100 * usageBoost)
      : 0;
  const activeProduct = findActivePlanProduct(customer?.products);
  const planLabel = activeProduct?.name ?? "Free";
  const resetAt =
    typeof usage?.next_reset_at === "number" ? usage.next_reset_at : null;
  const resetIn = resetAt != null ? resetAt - now : null;

  useEffect(() => {
    if (resetAt == null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [resetAt]);

  useEffect(() => {
    const el = barsRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const n = Math.max(1, Math.floor((w + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
      setTotalBars(n);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Until Autumn reports the customer, we can't tell free from paid — show a
  // skeleton rather than flashing the free-tier card at everyone on every load.
  if (isLoading && !customer) {
    return <UsageBlockSkeleton barCount={totalBars} barWidth={BAR_WIDTH} />;
  }

  const filledBars = unlimited
    ? totalBars
    : Math.max(
        0,
        Math.min(totalBars, Math.round((percent / 100) * totalBars)),
      );
  const displayPercent = Math.round(percent);
  const fillColor =
    percent >= 50
      ? "bg-emerald-500"
      : percent >= 25
        ? "bg-amber-400"
        : "bg-orange-500";

  // Free plan: metered by a small message count rather than a usage budget.
  // Show how many messages remain and a persistent nudge to upgrade.
  if (free.isFree) {
    const msgPercent =
      free.included > 0 ? (free.remaining / free.included) * 100 : 0;
    const msgFilled = Math.max(
      0,
      Math.min(totalBars, Math.round((msgPercent / 100) * totalBars)),
    );
    const msgColor =
      free.remaining <= 0
        ? "bg-orange-500"
        : msgPercent >= 50
          ? "bg-emerald-500"
          : "bg-amber-400";
    const out = free.remaining <= 0;
    return (
      <div className="px-2.5 pb-2 pt-1.5">
        <div className="flex items-start justify-between">
          <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
            Messages
          </span>
          <div className="text-right leading-tight">
            <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
              {isLoading && !customer ? "—" : `${free.remaining}/${free.included}`}
            </div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
              {out ? "None left" : "Remaining"}
            </div>
          </div>
        </div>
        <div
          ref={barsRef}
          className="mt-2 flex h-5 w-full items-center justify-between"
        >
          {Array.from({ length: totalBars }).map((_, i) => (
            <div
              key={i}
              style={{ width: BAR_WIDTH }}
              className={`h-full rounded-full ${
                i < msgFilled
                  ? msgColor
                  : "bg-black/[0.06] dark:bg-white/[0.08]"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: "/pricing" })}
          className="mt-2 flex w-full items-center justify-between rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-left transition hover:bg-black/[0.07] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
        >
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            {out ? "Out of free messages" : "Free plan"}
          </span>
          <span className="text-[11px] font-semibold text-[#0c82f2]">
            Upgrade
          </span>
        </button>
        <UsageMultiplierBadge context="free" className="mt-2" />
      </div>
    );
  }

  return (
    <div className="px-2.5 pb-2 pt-1.5">
      <div className="flex items-start justify-between">
        <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
          Usage
        </span>
        <div className="text-right leading-tight">
          <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
            {unlimited ? "∞" : isLoading && !customer ? "—" : `${displayPercent}%`}
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
            {unlimited ? "Unlimited" : "Remaining"}
          </div>
        </div>
      </div>
      <div
        ref={barsRef}
        className="mt-2 flex h-5 w-full items-center justify-between"
      >
        {Array.from({ length: totalBars }).map((_, i) => (
          <div
            key={i}
            style={{ width: BAR_WIDTH }}
            className={`h-full rounded-full ${
              i < filledBars
                ? fillColor
                : "bg-black/[0.06] dark:bg-white/[0.08]"
            }`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        <span>{planLabel}</span>
        {resetIn != null && !unlimited && (
          <span>Resets in {formatResetIn(resetIn)}</span>
        )}
      </div>
      {extra.balance > 0 && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-neutral-600 dark:text-neutral-300">
              Extra usage
            </span>
            <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
              {formatUsd(extra.balance)} left
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[#0c82f2] transition-all duration-300"
              style={{ width: `${extraUsedPct}%` }}
            />
          </div>
        </div>
      )}
      <UsageMultiplierBadge className="mt-2" />
    </div>
  );
}

function ThemeMenuItem({
  value,
  onChange,
  subRef,
}: {
  value: ThemePref;
  onChange: (v: ThemePref) => void;
  subRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setSubOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setSubOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={subOpen}
        className={`${dropdownItemCompactClass} ${
          subOpen
            ? "bg-black/[0.05] dark:bg-white/[0.06]"
            : ""
        }`}
      >
        <IconMoon size={14} stroke={2} />
        <span className="flex-1">Theme</span>
        <IconChevronRight size={14} stroke={2} className="text-neutral-500" />
      </button>
      <AnimatePresence>
      {subOpen && (
        <motion.div
          ref={subRef}
          role="menu"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
          className="absolute bottom-0 left-full z-[70] ml-1 w-32"
        >
          <DropdownShell subtle>
            <ThemeOption value="system" current={value} onChange={onChange}>
              System
            </ThemeOption>
            <ThemeOption value="light" current={value} onChange={onChange}>
              Light
            </ThemeOption>
            <ThemeOption value="dark" current={value} onChange={onChange}>
              Dark
            </ThemeOption>
          </DropdownShell>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={`${dropdownItemCompactClass} ${
        destructive
          ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
          : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ThemeOption({
  value,
  current,
  onChange,
  children,
}: {
  value: ThemePref;
  current: ThemePref;
  onChange: (v: ThemePref) => void;
  children: React.ReactNode;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={() => onChange(value)}
      className={dropdownItemCompactClass}
    >
      <span
        aria-hidden
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
          selected
            ? "border-[#178dfb] bg-[#178dfb]"
            : "border-neutral-400 dark:border-neutral-500"
        }`}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      {children}
    </button>
  );
}

function RootErrorBoundary({ error }: ErrorComponentProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <Layout>
      <main className="pt-16 p-4 container mx-auto">
        <h1>{message}</h1>
        <p>{details}</p>
        {stack && (
          <pre className="w-full p-4 overflow-x-auto">
            <code>{stack}</code>
          </pre>
        )}
      </main>
    </Layout>
  );
}
