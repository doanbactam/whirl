import { useState } from "react";
import {
  IconPlugConnected,
  IconRosetteDiscountCheckFilled,
} from "@tabler/icons-react";

import { FadeInImage } from "~/components/fade-in-image";

/**
 * An integration's face: the uploaded logo when there is one, else the
 * developer's monochrome SVG icon (recolored via CSS mask), else a friendly
 * plug. Reused by the store list, the install modal, and the manage tab.
 * The logo shimmers while its bytes load, then fades in.
 */
export function IntegrationLogo({
  name,
  logoUrl,
  iconSvg,
  size = 40,
  className = "",
}: {
  name: string;
  logoUrl: string | null;
  iconSvg?: string;
  size?: number;
  className?: string;
}) {
  // A logo URL that won't load falls through to the icon tile instead of the
  // browser's broken-image glyph.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // Squircle-ish: the corner radius scales with the logo so every size reads
  // the same shape.
  const radius = Math.round(size * 0.3);

  if (logoUrl && failedSrc !== logoUrl) {
    return (
      <FadeInImage
        src={logoUrl}
        onError={() => setFailedSrc(logoUrl)}
        className={`shrink-0 ring-1 ring-black/[0.06] dark:ring-white/[0.08] ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center bg-black/[0.05] text-neutral-600 ring-1 ring-black/[0.06] dark:bg-white/[0.08] dark:text-neutral-300 dark:ring-white/[0.08] ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
      title={name}
    >
      {iconSvg ? (
        <span
          className="bg-current"
          style={{
            width: Math.round(size * 0.5),
            height: Math.round(size * 0.5),
            WebkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
            maskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      ) : (
        <IconPlugConnected size={Math.round(size * 0.5)} stroke={2} />
      )}
    </span>
  );
}

/**
 * The integration's monochrome mark alone — the developer's console-uploaded
 * SVG recolored to currentColor via CSS mask, no tile behind it. For tight
 * spots that want a glyph rather than an app icon (tool chips, status rows).
 */
export function IntegrationIcon({
  iconSvg,
  size = 16,
  className = "",
}: {
  iconSvg: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
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

/** The blue "made by Whirl" checkmark, sized to sit next to a name. */
export function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <span
      title="Verified — made by Whirl"
      className="inline-flex shrink-0 text-[#0c82f2]"
    >
      <IconRosetteDiscountCheckFilled size={size} aria-label="Verified" />
    </span>
  );
}
