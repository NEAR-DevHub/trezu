"use client";

import { cva } from "class-variance-authority";
import { useFormatRoleName } from "@/components/role-name";
import { Tooltip } from "@/components/tooltip";
import { useRoleDescription } from "@/lib/use-role-description";

interface RoleBadgeProps {
    role: string;
    variant?: "pill" | "rounded";
    style?: "default" | "secondary";
    showTooltip?: boolean;
}

const styles = cva(
    "inline-flex items-center justify-center px-2 py-1.5 text-center text-xs font-semibold leading-[0.875rem] capitalize text-general-secondary-foreground",
    {
        variants: {
            variant: {
                pill: "rounded-md",
                rounded: "rounded-lg",
            },
            style: {
                default: "border border-general-border bg-general-bg-secondary",
                secondary: "border border-general-border bg-card",
            },
        },
        defaultVariants: {
            variant: "pill",
            style: "default",
        },
    },
);

export function RoleBadge({
    role,
    variant = "pill",
    style = "default",
    showTooltip = true,
}: RoleBadgeProps) {
    const formatRoleName = useFormatRoleName();
    const getRoleDescription = useRoleDescription();
    const description = getRoleDescription(role);
    const displayName = formatRoleName(role);

    const badge = (
        <span className={styles({ variant, style })}>{displayName}</span>
    );

    // If we have description and tooltip is enabled, wrap in tooltip
    if (showTooltip && description) {
        return <Tooltip content={description}>{badge}</Tooltip>;
    }

    // No description or tooltip disabled, just return the badge
    return badge;
}
