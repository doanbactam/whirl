import { Skeleton } from "~/components/skeleton";

// What the store looks like before the shelves arrive: a hero-sized block
// where the featured carousel lands, then ghost rows shaped like real
// listings — so the swap to live content doesn't jump around.

/** Deterministic widths so the rows read organic, not rubber-stamped. */
const NAME_WIDTHS = [96, 120, 80, 112, 88, 128];
const DESC_WIDTHS = [176, 148, 196, 160, 188, 136];

function StoreRowSkeleton({ index }: { index: number }) {
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <Skeleton className="h-11 w-11 shrink-0 rounded-[13px]" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton
          className="h-3.5 max-w-full"
          style={{ width: NAME_WIDTHS[index % NAME_WIDTHS.length] }}
        />
        <Skeleton
          className="h-3 max-w-full"
          style={{ width: DESC_WIDTHS[index % DESC_WIDTHS.length] }}
        />
      </span>
    </li>
  );
}

/** The store's loading pose. Browse/skills tabs keep the hero and two
 * columns; the installed tab drops the hero and stacks one column. */
export function IntegrationStoreSkeleton({
  hero = true,
  columns = 2,
  rows = 8,
}: {
  hero?: boolean;
  columns?: 1 | 2;
  rows?: number;
}) {
  return (
    <div aria-hidden aria-busy="true">
      {hero && (
        <Skeleton className="mb-5 h-[176px] w-full rounded-[24px] md:h-[192px]" />
      )}
      <ul
        className={`grid gap-1 ${columns === 2 ? "md:grid-cols-2" : ""}`.trim()}
      >
        {Array.from({ length: rows }, (_, i) => (
          <StoreRowSkeleton key={i} index={i} />
        ))}
      </ul>
    </div>
  );
}
