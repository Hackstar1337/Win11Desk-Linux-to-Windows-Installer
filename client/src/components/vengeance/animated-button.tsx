// Adapted from official Vengeance UI MIT registry; see LICENSE and provenance.json.
// Local adaptations: interaction-only shine, unmasked text, and reduced motion.
"use client";
import React, { useState } from "react";
import { motion, MotionProps, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
type AnimatedButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  MotionProps & { children?: React.ReactNode; as?: any };
const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  children = "Continue",
  className = "",
  as = "button",
  ...rest
}) => {
  const [active, setActive] = useState(false);
  const reduced = useReducedMotion();
  const enabled = active && !reduced && !rest.disabled;
  const Component = (motion as any)[as] || motion.button;
  return (
    <Component
      {...rest}
      onHoverStart={(event: any, info: any) => {
        setActive(true);
        rest.onHoverStart?.(event, info);
      }}
      onHoverEnd={(event: any, info: any) => {
        setActive(false);
        rest.onHoverEnd?.(event, info);
      }}
      onFocus={(event: any) => {
        setActive(true);
        rest.onFocus?.(event);
      }}
      onBlur={(event: any) => {
        setActive(false);
        rest.onBlur?.(event);
      }}
      whileHover={reduced ? undefined : { scale: 1.01 }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.5 }}
      className={cn(
        "group inline-flex items-center justify-center px-6 py-2 rounded-md relative overflow-hidden bg-background border border-border",
        "text-foreground font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "[--shine:rgba(255,255,255,.4)]",
        className
      )}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] p-px"
        style={{
          background:
            "linear-gradient(-75deg, transparent 30%, var(--shine) 50%, transparent 70%)",
          backgroundSize: "200% 100%",
          mask: "linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
        }}
        initial={{ backgroundPosition: "100% 0", opacity: 0 }}
        animate={
          enabled
            ? { backgroundPosition: ["100% 0", "0% 0"], opacity: [0, 1, 0] }
            : { opacity: 0 }
        }
        transition={
          enabled ? { duration: 0.75, ease: "linear" } : { duration: 0.1 }
        }
      />
    </Component>
  );
};
export default AnimatedButton;
