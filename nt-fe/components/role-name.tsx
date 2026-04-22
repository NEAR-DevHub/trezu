"use client";

import { useTranslations } from "next-intl";

/**
 * Maps internal role names (raw policy names) to canonical role IDs:
 * governance | financial | requestor. Legacy names get normalized.
 */
function normalizeRoleId(roleName: string): string {
    if (roleName === "Approver") return "financial";
    if (roleName === "Admin") return "governance";
    if (roleName === "Create Requests" || roleName === "Create requests")
        return "requestor";
    if (roleName === "Manage Members") return "governance";
    if (roleName === "Vote") return "financial";
    return roleName;
}

const CANONICAL_IDS = new Set(["governance", "financial", "requestor"]);

/**
 * Returns a translated display name for the role. Uses canonical translation
 * keys when the role maps to a known id; otherwise falls back to the raw name.
 */
export function formatRoleName(
    roleName: string,
    t?: (key: string) => string,
): string {
    const id = normalizeRoleId(roleName);
    if (t && CANONICAL_IDS.has(id)) {
        return t(`${id}.title`);
    }
    // Fallback: capitalize the id for back-compat (used by non-hook callers).
    if (id === "financial") return "Financial";
    if (id === "governance") return "Governance";
    if (id === "requestor") return "Requestor";
    return roleName;
}

export function useFormatRoleName() {
    const t = useTranslations("roleSelector.roles");
    return (roleName: string) => formatRoleName(roleName, t);
}

interface RoleNameProps {
    name: string;
    className?: string;
}

/**
 * Component to display a formatted role name
 */
export function RoleName({ name, className }: RoleNameProps) {
    const fmt = useFormatRoleName();
    return <span className={className}>{fmt(name)}</span>;
}
