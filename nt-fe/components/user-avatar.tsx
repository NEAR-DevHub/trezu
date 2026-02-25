"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface UserAvatarProps {
    accountId: string;
    className?: string;
}

// Palette of [colorA, colorB] pairs — pastel two-shade pairs per hue
const COLOR_PAIRS: [string, string][] = [
    ["#A8C4E0", "#C8DCF0"], // soft blue
    ["#A8D5B5", "#C8EAD4"], // soft green
    ["#C4A8D5", "#DCC8EA"], // soft purple
    ["#F0C8A0", "#F5DEC0"], // soft orange
    ["#F0A8A8", "#F5C8C8"], // soft red
    ["#A8D5D5", "#C8EAEA"], // soft teal
    ["#E0D0A8", "#EDE0C0"], // soft gold
    ["#D5A8C4", "#EAC8DC"], // soft pink
];

/** Deterministic 32-bit hash from a string */
function hash(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

/** Simple xorshift32 RNG — same algorithm as the reference code */
function createRandom(seed: number) {
    let s = seed || 1;
    return () => {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        s = s >>> 0;
        return s / 0xffffffff;
    };
}

function randomBool(rng: () => number) {
    return rng() > 0.5;
}

const GRID = 4; // 4×4 cells, matches the reference

/**
 * Truchet-tile avatar fallback for NEAR accounts without a profile image.
 * Each accountId deterministically maps to a unique colour pair and seed,
 * producing a geometric pattern identical to the Scale Explorer generator.
 */
export function UserAvatar({ accountId, className }: UserAvatarProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const h = hash(accountId);
    const [colorA, colorB] = COLOR_PAIRS[h % COLOR_PAIRS.length];
    const seed = h;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const size = canvas.width;
        const cellSize = size / GRID;
        const rng = createRandom(seed);

        for (let row = 0; row < GRID; row++) {
            for (let col = 0; col < GRID; col++) {
                const x = col * cellSize;
                const y = row * cellSize;
                const isBackslash = randomBool(rng);
                const swap = randomBool(rng);
                const c1 = swap ? colorB : colorA;
                const c2 = swap ? colorA : colorB;

                // First triangle
                ctx.fillStyle = c1;
                ctx.beginPath();
                if (isBackslash) {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + cellSize, y);
                    ctx.lineTo(x, y + cellSize);
                } else {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + cellSize, y);
                    ctx.lineTo(x + cellSize, y + cellSize);
                }
                ctx.closePath();
                ctx.fill();

                // Second triangle
                ctx.fillStyle = c2;
                ctx.beginPath();
                if (isBackslash) {
                    ctx.moveTo(x + cellSize, y);
                    ctx.lineTo(x + cellSize, y + cellSize);
                    ctx.lineTo(x, y + cellSize);
                } else {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + cellSize, y + cellSize);
                    ctx.lineTo(x, y + cellSize);
                }
                ctx.closePath();
                ctx.fill();
            }
        }
    }, [seed, colorA, colorB]);

    return (
        <canvas
            ref={canvasRef}
            width={128}
            height={128}
            aria-label={accountId}
            className={cn("rounded-full shrink-0 select-none", className)}
        />
    );
}
