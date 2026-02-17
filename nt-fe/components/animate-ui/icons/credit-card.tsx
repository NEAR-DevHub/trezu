"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";

import {
    getVariants,
    useAnimateIconContext,
    IconWrapper,
    type IconProps,
} from "@/components/animate-ui/icons/icon";

type CreditCardProps = IconProps<keyof typeof animations>;

const animations = {
    default: {
        line: {
            initial: { x1: 3, y1: 10, x2: 21, y2: 10 },
            animate: {
                x1: 3,
                y1: 9,
                x2: 21,
                y2: 9,
                transition: { type: "spring", damping: 18, stiffness: 200 },
            },
        },
        chip: {
            initial: { opacity: 0.75 },
            animate: {
                opacity: 1,
                transition: { duration: 0.2 },
            },
        },
    } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: CreditCardProps) {
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
                width={20}
                height={14}
                x={2}
                y={5}
                rx={2}
                ry={2}
                initial="initial"
                animate={controls}
            />
            <motion.line
                x1={3}
                y1={10}
                x2={21}
                y2={10}
                variants={variants.line}
                initial="initial"
                animate={controls}
            />
            <motion.rect
                width={4}
                height={2}
                x={5}
                y={14}
                rx={0.75}
                ry={0.75}
                variants={variants.chip}
                initial="initial"
                animate={controls}
            />
        </motion.svg>
    );
}

function CreditCard(props: CreditCardProps) {
    return <IconWrapper icon={IconComponent} {...props} />;
}

export {
    animations,
    CreditCard,
    CreditCard as CreditCardIcon,
    type CreditCardProps,
    type CreditCardProps as CreditCardIconProps,
};
