"use client";

import { motion, type Variants } from "motion/react";

import {
    getVariants,
    useAnimateIconContext,
    IconWrapper,
    type IconProps,
} from "@/components/animate-ui/icons/icon";

type ContactRoundProps = IconProps<keyof typeof animations>;

const animations = {
    default: {
        rect: {},
        tickLeft: {
            initial: { y: 0 },
            animate: {
                y: [0, -2, 1, 0],
                transition: { duration: 0.5, ease: "easeInOut" },
            },
        },
        tickRight: {
            initial: { y: 0 },
            animate: {
                y: [0, -2, 1, 0],
                transition: { duration: 0.5, ease: "easeInOut", delay: 0.08 },
            },
        },
        circle: {
            initial: { scale: 1 },
            animate: {
                scale: [1, 1.15, 0.95, 1],
                transition: { duration: 0.5, ease: "easeInOut", delay: 0.05 },
            },
        },
        body: {
            initial: { y: 0 },
            animate: {
                y: [0, 2, -1, 0],
                transition: { duration: 0.5, ease: "easeInOut", delay: 0.12 },
            },
        },
    } satisfies Record<string, Variants>,
    appear: {
        rect: {
            initial: { scale: 0.7, opacity: 0 },
            animate: {
                scale: 1,
                opacity: 1,
                transition: { type: "spring", stiffness: 100, damping: 12 },
            },
        },
        tickLeft: {
            initial: { y: -4, opacity: 0 },
            animate: {
                y: 0,
                opacity: 1,
                transition: {
                    type: "spring",
                    stiffness: 120,
                    damping: 10,
                    delay: 0.15,
                },
            },
        },
        tickRight: {
            initial: { y: -4, opacity: 0 },
            animate: {
                y: 0,
                opacity: 1,
                transition: {
                    type: "spring",
                    stiffness: 120,
                    damping: 10,
                    delay: 0.2,
                },
            },
        },
        circle: {
            initial: { scale: 0, opacity: 0 },
            animate: {
                scale: 1,
                opacity: 1,
                transition: {
                    type: "spring",
                    stiffness: 120,
                    damping: 12,
                    delay: 0.1,
                },
            },
        },
        body: {
            initial: { y: 4, opacity: 0 },
            animate: {
                y: 0,
                opacity: 1,
                transition: {
                    type: "spring",
                    stiffness: 100,
                    damping: 12,
                    delay: 0.2,
                },
            },
        },
    } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ContactRoundProps) {
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
            <motion.rect
                x={3}
                y={4}
                width={18}
                height={18}
                rx={2}
                variants={variants.rect}
                initial="initial"
                animate={controls}
            />
            <motion.path
                d="M8 2v2"
                variants={variants.tickLeft}
                initial="initial"
                animate={controls}
            />
            <motion.path
                d="M16 2v2"
                variants={variants.tickRight}
                initial="initial"
                animate={controls}
            />
            <motion.circle
                cx={12}
                cy={12}
                r={4}
                variants={variants.circle}
                initial="initial"
                animate={controls}
            />
            <motion.path
                d="M17.915 22a6 6 0 0 0-12 0"
                variants={variants.body}
                initial="initial"
                animate={controls}
            />
        </motion.svg>
    );
}

function ContactRound(props: ContactRoundProps) {
    return <IconWrapper icon={IconComponent} {...props} />;
}

export {
    animations,
    ContactRound,
    ContactRound as ContactRoundIcon,
    type ContactRoundProps,
    type ContactRoundProps as ContactRoundIconProps,
};
