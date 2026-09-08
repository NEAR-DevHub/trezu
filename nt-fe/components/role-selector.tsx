"use client";

import { CheckIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Icon } from "@/components/icon";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { ScrollContainer } from "@/components/scroll-container";
import {
    EmptySelectorIcon,
    selectorTriggerClassName,
} from "@/components/selector-field";
import { SelectorOptionRow } from "@/components/selector-option-row";
import { cn } from "@/lib/utils";
import { shouldPreventMobileDialogAutoFocus } from "@/lib/wallet-address-input-props";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

type Role = {
    id: string;
    title: string;
    description?: string;
};

export const ROLES: readonly Role[] = [
    {
        id: "governance",
        title: "Governance",
        description:
            "Governance can create and vote on team-related treasury settings, including members, permissions, and treasury appearance.",
    },
    {
        id: "requestor",
        title: "Requestor",
        description:
            "Requestor can create payment-related transaction requests, without voting or approval rights.",
    },
    {
        id: "financial",
        title: "Financial",
        description:
            "Financial can vote on payment-related transaction requests but cannot create them.",
    },
] as const;

const CANONICAL_ROLE_IDS = new Set(["governance", "requestor", "financial"]);

function normalizeRoleId(roleId: string): string {
    const normalized = roleId.trim().toLowerCase();

    if (normalized === "admin" || normalized === "manage members") {
        return "governance";
    }
    if (normalized === "approver" || normalized === "vote") {
        return "financial";
    }
    if (normalized === "create requests") {
        return "requestor";
    }

    return normalized;
}

function useTranslatedRoles(availableRoles: readonly Role[]): Role[] {
    const t = useTranslations("roleSelector.roles");
    return availableRoles.map((role) => {
        const canonical = normalizeRoleId(role.id);
        if (!CANONICAL_ROLE_IDS.has(canonical)) {
            return { ...role };
        }
        return {
            ...role,
            title: t(`${canonical}.title`),
            description: t(`${canonical}.description`),
        };
    });
}

export function formatSelectedRoleTitles(
    selectedRoles: string[],
    translatedRoles: readonly Role[],
): string {
    return selectedRoles
        .map((id) => translatedRoles.find((r) => r.id === id)?.title)
        .filter(Boolean)
        .join(", ");
}

interface RoleSelectorProps {
    selectedRoles?: string[];
    onRolesChange?: (roles: string[]) => void;
    className?: string;
    availableRoles?: readonly Role[];
    disabledRoles?: { roleId: string; reason: string }[];
    /** Payment-form field vs compact trigger used in lists. */
    triggerVariant?: "field" | "compact";
    /** Matches payment selector error: red border + faded fill. */
    invalid?: boolean;
}

export function RoleSelector({
    selectedRoles = [],
    onRolesChange,
    className,
    availableRoles = ROLES,
    disabledRoles = [],
    triggerVariant = "compact",
    invalid = false,
}: RoleSelectorProps) {
    const t = useTranslations("roleSelector");
    const tCommon = useTranslations("common");
    const tInput = useTranslations("memberInput");
    const translatedRoles = useTranslatedRoles(availableRoles);
    const [open, setOpen] = React.useState(false);
    const [draftRoles, setDraftRoles] = React.useState<string[]>(selectedRoles);

    const selectedLabel = formatSelectedRoleTitles(
        selectedRoles,
        translatedRoles,
    );

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setDraftRoles(selectedRoles);
        }
        setOpen(nextOpen);
    };

    const handleRoleToggle = (roleId: string) => {
        const isDisabled = disabledRoles.some((d) => d.roleId === roleId);
        if (isDisabled) return;

        setDraftRoles((current) =>
            current.includes(roleId)
                ? current.filter((id) => id !== roleId)
                : [...current, roleId],
        );
    };

    const handleDone = () => {
        if (draftRoles.length === 0) return;
        onRolesChange?.(draftRoles);
        setOpen(false);
    };

    const triggerLabel =
        selectedRoles.length === 0
            ? triggerVariant === "field"
                ? tInput("selectRole")
                : t("setRole")
            : selectedLabel;

    return (
        <>
            {triggerVariant === "field" ? (
                <button
                    type="button"
                    onClick={() => handleOpenChange(true)}
                    className={cn(
                        selectorTriggerClassName,
                        invalid && "border-destructive bg-destructive/5",
                        className,
                    )}
                >
                    <EmptySelectorIcon />
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate text-base leading-[1.2]",
                            selectedRoles.length === 0
                                ? "font-medium text-muted-foreground"
                                : "font-semibold text-general-foreground",
                        )}
                    >
                        {triggerLabel}
                    </span>
                </button>
            ) : (
                <Button
                    type="button"
                    variant="outline"
                    className={cn(
                        "flex items-center gap-2 rounded-full bg-card",
                        className,
                    )}
                    onClick={() => handleOpenChange(true)}
                >
                    {triggerLabel}
                </Button>
            )}

            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent
                    className="h-auto max-sm:h-auto max-sm:gap-4"
                    onOpenAutoFocus={(event) => {
                        if (
                            shouldPreventMobileDialogAutoFocus(
                                window.innerWidth,
                            )
                        ) {
                            event.preventDefault();
                        }
                    }}
                >
                    <DialogHeader
                        centerTitle={false}
                        className="sticky top-0 border-0 pb-0 text-left"
                    >
                        <DialogTitle className="pr-8 text-left text-lg font-semibold">
                            {t("title")}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col">
                        <ScrollContainer className="touch-pan-y overscroll-contain pr-1">
                            {translatedRoles.map((role) => {
                                const disabledInfo = disabledRoles.find(
                                    (d) => d.roleId === role.id,
                                );
                                const isDisabled = !!disabledInfo;
                                const isChecked = draftRoles.includes(role.id);

                                const content = (
                                    <SelectorOptionRow
                                        key={role.id}
                                        aria-disabled={isDisabled}
                                        onClick={() =>
                                            handleRoleToggle(role.id)
                                        }
                                        primary={role.title}
                                        secondary={role.description}
                                        primaryClassName="text-sm font-semibold leading-[1.5] text-general-secondary-foreground"
                                        secondaryClassName="text-sm font-normal leading-[1.5] tracking-[0.00438rem] text-general-muted-foreground"
                                        trailing={
                                            isChecked ? (
                                                <Icon
                                                    icon={CheckIcon}
                                                    className="size-5 shrink-0 self-center text-primary"
                                                />
                                            ) : (
                                                <span
                                                    aria-hidden
                                                    className="size-5 shrink-0"
                                                />
                                            )
                                        }
                                        className={cn(
                                            "h-auto min-h-14 items-center whitespace-normal py-3",
                                            isDisabled &&
                                                "cursor-not-allowed opacity-50 hover:bg-muted",
                                        )}
                                    />
                                );

                                if (isDisabled && disabledInfo) {
                                    return (
                                        <Tooltip
                                            key={role.id}
                                            content={disabledInfo.reason}
                                            contentProps={{
                                                className: "max-w-[320px]",
                                            }}
                                        >
                                            {content}
                                        </Tooltip>
                                    );
                                }

                                return content;
                            })}
                        </ScrollContainer>
                    </div>
                    <DialogFooter className="border-0">
                        <Button
                            type="button"
                            className="h-11 w-full rounded-2xl"
                            disabled={draftRoles.length === 0}
                            tooltipContent={
                                draftRoles.length === 0
                                    ? tInput("validation.rolesRequired")
                                    : undefined
                            }
                            onClick={handleDone}
                        >
                            {tCommon("done")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
