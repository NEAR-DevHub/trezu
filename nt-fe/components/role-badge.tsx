"use client";

import { Tooltip } from "@/components/tooltip";
import { useRoleDescription } from "@/lib/use-role-description";
import { useFormatRoleName } from "@/components/role-name";
import { cva } from "class-variance-authority";

interface RoleBadgeProps {
    role: string;
    variant?: "pill" | "rounded";
    style?: "default" | "secondary";
    showTooltip?: boolean;
}

const styles = cva("px-3 py-1 text-sm font-medium capitalize", {
    variants: {
        variant: {
            pill: "rounded-full",
            rounded: "rounded-md",
        },
        style: {
            default: "bg-muted text-foreground",
            secondary: "bg-card text-card-foreground",
        },
    },
    defaultVariants: {
        variant: "pill",
        style: "default",
    },
});

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
