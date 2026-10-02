/** Shared entrance motion for inline tool widgets (the weather widget). */
export const WIDGET_ENTRANCE = {
  initial: { opacity: 0, y: 14, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: {
    opacity: { duration: 0.34, ease: [0.22, 0.61, 0.36, 1] as const },
    y: { type: "spring" as const, stiffness: 360, damping: 28 },
    scale: { type: "spring" as const, stiffness: 360, damping: 28 },
  },
};
