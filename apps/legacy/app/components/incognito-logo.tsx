import { motion } from "motion/react";

/**
 * The incognito mascot for the new-thread screen — the ghost from
 * /incognito.svg, painted with a theme token (via CSS mask) so it reads in both
 * light and dark, and bobbing gently so the page feels alive while you're hidden.
 */
export function IncognitoLogo({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const dim = `${size}px`;
  return (
    <motion.span
      aria-hidden
      style={{
        width: dim,
        height: dim,
        WebkitMaskImage: "url(/incognito.svg)",
        maskImage: "url(/incognito.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
      className={`block shrink-0 bg-neutral-800 dark:bg-neutral-100 ${className}`}
      initial={{ y: 0 }}
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
