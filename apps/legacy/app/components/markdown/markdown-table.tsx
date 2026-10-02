import { useRef, type ReactNode } from "react";
import { CopyButton } from "./copy-button";

/**
 * a clean markdown table: soft-tinted header row, subtle zebra striping,
 * horizontal-only dividers (no boxed grid), and a copy-as-TSV button that
 * floats in on hover. cells are styled via descendant selectors so the
 * markdown renderer can hand us raw <th>/<td> without per-cell overrides.
 */
export function MarkdownTable({
  children,
  inverted,
}: {
  children: ReactNode;
  inverted: boolean;
}) {
  const tableRef = useRef<HTMLTableElement>(null);

  const getText = () => {
    const table = tableRef.current;
    if (!table) return "";
    const rows = table.querySelectorAll("tr");
    return Array.from(rows)
      .map((row) =>
        Array.from(row.querySelectorAll("th, td"))
          .map((cell) => cell.textContent?.trim() ?? "")
          .join("\t"),
      )
      .join("\n");
  };

  const shell = inverted
    ? "border-white/20"
    : "border-black/[0.08] dark:border-white/[0.08]";

  const cells = inverted
    ? [
        "[&_thead_th]:bg-white/[0.1] [&_thead_th]:border-b [&_thead_th]:border-white/15",
        "[&_th]:px-3.5 [&_th]:py-2 [&_th]:font-medium [&_th]:text-white [&_th]:whitespace-nowrap",
        "[&_td]:px-3.5 [&_td]:py-2 [&_td]:text-white/90",
        "[&_tr]:border-b [&_tr]:border-white/15 [&_tr:last-child]:border-0",
        "[&_tbody_tr:nth-child(even)]:bg-white/[0.06]",
      ].join(" ")
    : [
        "[&_thead_th]:bg-black/[0.03] dark:[&_thead_th]:bg-white/[0.04]",
        "[&_thead_th]:border-b [&_thead_th]:border-black/[0.07] dark:[&_thead_th]:border-white/[0.07]",
        "[&_th]:px-3.5 [&_th]:py-2 [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-neutral-900 dark:[&_th]:text-neutral-100",
        "[&_td]:px-3.5 [&_td]:py-2 [&_td]:text-neutral-800 dark:[&_td]:text-neutral-200",
        "[&_tr]:border-b [&_tr]:border-black/[0.06] [&_tr:last-child]:border-0 dark:[&_tr]:border-white/[0.07]",
        "[&_tbody_tr:nth-child(even)]:bg-black/[0.015] dark:[&_tbody_tr:nth-child(even)]:bg-white/[0.02]",
      ].join(" ");

  const chip = inverted
    ? "bg-black/20 backdrop-blur-sm"
    : "bg-bg/80 backdrop-blur-sm dark:bg-bg-dark/80";

  return (
    <div
      className={`group/table relative my-3 overflow-hidden rounded-xl border ${shell}`}
    >
      <div
        className={`absolute right-1.5 top-1.5 z-10 rounded-md opacity-0 transition-opacity duration-150 group-hover/table:opacity-100 focus-within:opacity-100 ${chip}`}
      >
        <CopyButton getText={getText} label={false} />
      </div>
      <div className="table-scroll overflow-x-auto">
        <table
          ref={tableRef}
          className={`w-full border-collapse text-left text-[14px] leading-[1.5] ${cells}`}
        >
          {children}
        </table>
      </div>
    </div>
  );
}
