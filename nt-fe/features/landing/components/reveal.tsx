"use client";

import { motion, useReducedMotion } from "motion/react";

/** Matches `--ease-landing` / `--dur-reveal` so scroll reveals and the hero's
 *  CSS entrance animation share one curve and one duration. */
const EASE = [0.625, 0.05, 0, 1] as const;
const DURATION_S = 0.8;

/**
 * Reveals a block the first time it scrolls into view: 16px rise plus a fade,
 * once, never replayed on the way back up. The trigger fires 10% before the
 * block reaches the bottom edge so it is already settled by the time it is
 * properly on screen.
 *
 * Wraps content in a plain `div`, so it is a drop-in for an existing block
 * element — pass that element's classes through `className` rather than adding
 * a new layer, otherwise flex and grid parents will see an extra child.
 *
 * Under reduced motion the rise is dropped and only the fade plays.
 */
export function Reveal({
    children,
    className,
    delayMs = 0,
}: {
    children: React.ReactNode;
    className?: string;
    /** Stagger against siblings revealing in the same group. */
    delayMs?: number;
}) {
    const prefersReducedMotion = useReducedMotion();

    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{
                duration: DURATION_S,
                ease: EASE,
                delay: delayMs / 1000,
            }}
        >
            {children}
        </motion.div>
    );
}
