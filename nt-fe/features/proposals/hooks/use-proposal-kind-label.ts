"use client";

import { useTranslations } from "next-intl";
import type { ProposalUIKind } from "../types/index";

export function useProposalKindLabel() {
    const t = useTranslations("proposalKinds");
    return (kind: ProposalUIKind): string => t(kind);
}
