import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

type DepthButtonProps = HTMLMotionProps<"button"> & {
  variant?: "blue" | "neutral";
};

export const DepthButton = forwardRef<HTMLButtonElement, DepthButtonProps>(
  function DepthButton(
    { variant = "neutral", className = "", disabled, whileTap, ...rest },
    ref,
  ) {
    const depthClass = variant === "blue" ? "depth-blue" : "depth-neutral";
    const tap = whileTap ?? (disabled ? undefined : { scale: 0.98 });
    return (
      <motion.button
        ref={ref}
        disabled={disabled}
        whileTap={tap}
        className={`${depthClass} ${className}`}
        {...rest}
      />
    );
  },
);
