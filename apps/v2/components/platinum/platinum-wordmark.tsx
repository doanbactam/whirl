import { cn } from "@/lib/utils";

/* The badge art is a silver gradient drawn for a dark ground — dropped onto
   the white surface as a plain <img> it all but disappears, and the flattened
   monochrome treatment PlanBadge uses throws the metal away entirely. So the
   art becomes a MASK and the metal becomes a background gradient behind it:
   one asset, both themes, and the sheen survives. Sizing rides on the aspect
   ratio, so callers only ever set a height. */
const WORDMARK_ASPECT = 416 / 111;

const MASK_URL = "url(/plan-badges/platinum.svg)";

export function PlatinumWordmark({
  height = 28,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Platinum"
      className={cn("block shrink-0", className)}
      style={{
        height,
        width: height * WORDMARK_ASPECT,
        backgroundImage:
          "linear-gradient(175deg, var(--platinum-metal-from), var(--platinum-metal-to))",
        WebkitMaskImage: MASK_URL,
        maskImage: MASK_URL,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
