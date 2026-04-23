"use client";

import { useTranslations } from "next-intl";

function normalizeRoleId(roleName: string): string | null {
    const normalized = roleName.toLowerCase();
    if (normalized === "admin") return "governance";
    if (normalized === "approver") return "financial";
    if (normalized === "create requests") return "requestor";
    if (normalized === "manage members") return "governance";
    if (normalized === "vote") return "financial";
    if (["governance", "requestor", "financial"].includes(normalized))
        return normalized;
    return null;
}

export function useRoleDescription() {
    const t = useTranslations("roleSelector.roles");
    return (roleName: string): string | undefined => {
        const id = normalizeRoleId(roleName);
        if (!id) return undefined;
        return t(`${id}.description`);
    };
}
