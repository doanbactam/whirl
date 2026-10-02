import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { IconCheck, IconPlus, IconSearch } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type ComposioToolkit } from "~/lib/backend";
import { inputClass } from "~/pages/integrations/auth-config-fields";
import { ExtensionLogo } from "~/pages/extensions/added-extensions";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Live search over Composio's toolkit catalog. An empty search shows the
 * most-used toolkits so the page opens with something worth scrolling, and
 * each card adds its toolkit as a draft in one click.
 */
export function ToolkitCatalog({ addedSlugs }: { addedSlugs: Set<string> }) {
  const searchCatalog = useAction(api.composio.searchCatalog);
  const addToolkit = useAction(api.composio.addToolkit);
  const capture = useCapture();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComposioToolkit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [addError, setAddError] = useState<{
    slug: string;
    message: string;
  } | null>(null);

  // Only the latest request may write state — a slow early response must not
  // stomp the results of a fast later one.
  const requestSeq = useRef(0);

  useEffect(() => {
    const search = query.trim();
    // The very first load skips the debounce so the page doesn't sit blank.
    const delay = results === null ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      if (search) {
        capture(CONSOLE_EVENTS.composioCatalogSearched, { query: search });
      }
      searchCatalog(search ? { search } : {})
        .then((items) => {
          if (seq !== requestSeq.current) return;
          setResults(items);
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          setResults([]);
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't reach Composio's catalog.",
          );
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query drives it
  }, [query]);

  const onAdd = async (toolkit: ComposioToolkit) => {
    if (addingSlug) return;
    setAddingSlug(toolkit.slug);
    setAddError(null);
    try {
      await addToolkit({ slug: toolkit.slug });
      capture(CONSOLE_EVENTS.composioToolkitAdded, {
        slug: toolkit.slug,
        toolCount: toolkit.toolCount,
        managedAuth: toolkit.managedAuth,
      });
    } catch (err) {
      setAddError({
        slug: toolkit.slug,
        message:
          err instanceof Error ? err.message : "Couldn't add that toolkit.",
      });
    } finally {
      setAddingSlug(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <IconSearch
          size={15}
          stroke={2}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Composio's catalog — Gmail, Notion, Linear…"
          className={`${inputClass} pl-9`}
        />
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/[0.08] px-4 py-3 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
          {error}
        </p>
      )}

      {loading || results === null ? (
        <CatalogSkeleton />
      ) : results.length === 0 && !error ? (
        <p className="rounded-2xl border border-black/[0.06] bg-white px-5 py-8 text-center text-[13px] text-neutral-500 dark:border-white/[0.06] dark:bg-[#1B1B1B] dark:text-neutral-400">
          Nothing matched — Composio's catalog is big, but not that big.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {results.map((toolkit) => (
            <ToolkitCard
              key={toolkit.slug}
              toolkit={toolkit}
              added={toolkit.added || addedSlugs.has(toolkit.slug)}
              adding={addingSlug === toolkit.slug}
              addError={
                addError?.slug === toolkit.slug ? addError.message : null
              }
              onAdd={() => void onAdd(toolkit)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolkitCard({
  toolkit,
  added,
  adding,
  addError,
  onAdd,
}: {
  toolkit: ComposioToolkit;
  added: boolean;
  adding: boolean;
  addError: string | null;
  onAdd: () => void;
}) {
  // No tool count here on purpose: Composio's catalog metadata counts every
  // tool that ever existed (deprecated included) and overshoots what their
  // tools endpoint actually serves. Real counts show up once a toolkit is
  // added, sourced from the live tools list.
  const facts = toolkit.categories.slice(0, 3);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div className="flex items-start gap-3">
        <ExtensionLogo
          logoUrl={toolkit.logoUrl}
          name={toolkit.name}
          size="h-10 w-10"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {toolkit.name}
          </span>
          <span className="truncate text-[11.5px] text-neutral-400 dark:text-neutral-500">
            {facts.length > 0 ? facts.join(" · ") : toolkit.slug}
          </span>
        </div>
        {!toolkit.managedAuth && !toolkit.noAuth && (
          <span
            title="Composio doesn't offer managed auth for this toolkit — adding it may require custom OAuth credentials."
            className="ml-auto shrink-0 rounded-full bg-amber-500/[0.12] px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300"
          >
            Custom auth
          </span>
        )}
      </div>
      <p className="line-clamp-2 min-h-[34px] text-[12.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {toolkit.description || "Composio didn't write a description. Bold."}
      </p>
      {addError && (
        <p className="rounded-lg bg-red-500/[0.08] px-2.5 py-1.5 text-[12px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
          {addError}
        </p>
      )}
      <div className="mt-auto">
        {added ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-black/[0.04] px-3 text-[12.5px] font-medium text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
            <IconCheck size={14} stroke={2.5} />
            Added
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12.5px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {adding ? (
              <Spinner size={13} />
            ) : (
              <IconPlus size={14} stroke={2.5} />
            )}
            {adding ? "Adding…" : "Add to store"}
          </button>
        )}
      </div>
    </li>
  );
}

function CatalogSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-[#1B1B1B]"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}
