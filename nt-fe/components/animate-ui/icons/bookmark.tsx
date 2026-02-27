"use client";

import { motion, type Variants } from "motion/react";

import {
    getVariants,
    useAnimateIconContext,
    IconWrapper,
    type IconProps,
} from "@/components/animate-ui/icons/icon";

type BookmarkProps = IconProps<keyof typeof animations>;

const animations = {
    default: {
        bookmark: {
            initial: { scaleY: 1, originY: "0%" },
            animate: {
                scaleY: [1, 0.85, 1.08, 1],
                transition: { duration: 0.4, ease: "easeInOut" },
            },
        },
        fill: {
            initial: { opacity: 0, scaleY: 0, originY: "0%" },
            animate: {
                opacity: 1,
                scaleY: [0, 1.05, 1],
                transition: {
                    duration: 0.4,
                    ease: "easeOut",
                },
            },
        },
    } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BookmarkProps) {
    const { controls } = useAnimateIconContext();
    const variants = getVariants(animations);

    return (
        <motion.svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            {/* Filled version that appears on animate */}
            <motion.path
                d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
                fill="currentColor"
                stroke="none"
                variants={variants.fill}
                initial="initial"
                animate={controls}
                style={{ transformOrigin: "50% 0%" }}
            />
            {/* Outline bookmark shape */}
            <motion.path
                d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
                variants={variants.bookmark}
                initial="initial"
                animate={controls}
                style={{ transformOrigin: "50% 0%" }}
            />
        </motion.svg>
    );
}

function Bookmark(props: BookmarkProps) {
    return <IconWrapper icon={IconComponent} {...props} />;
}

export {
    animations,
    Bookmark,
    Bookmark as BookmarkIcon,
    type BookmarkProps,
    type BookmarkProps as BookmarkIconProps,
};
