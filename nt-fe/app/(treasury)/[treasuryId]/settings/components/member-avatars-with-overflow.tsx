"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Address } from "@/components/address";
import { CopyButton } from "@/components/copy-button";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/modal";
import { NumberBadge } from "@/components/number-badge";
import { ProfileAvatarChip } from "@/components/profile-avatar-chip";
import { ScrollContainer } from "@/components/scroll-container";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { resolveUserDisplayName, TooltipUser } from "@/components/user";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProfile } from "@/hooks/use-treasury-queries";
import { getExplorerAddressUrl } from "@/lib/blockchain-utils";
import { resolveProfileImageUrl } from "@/lib/profile-image";
import { cn } from "@/lib/utils";

/** Avatar geometry the stack is measured against: 36px tiles overlapping by 9px. */
const AVATAR_SIZE = 36;
const AVATAR_OVERLAP = 9;
const AVATAR_STRIDE = AVATAR_SIZE - AVATAR_OVERLAP;

/** The stack tops out at five faces; everyone past that rolls into the "+N" tile. */
const MAX_VISIBLE_AVATARS = 5;

/**
 * One member of the role, as the design's 36px squircle. `User` would render
 * the round avatar, so the chip is composed here and re-wrapped in the same
 * tooltip and explorer link the round avatar carried.
 */
function MemberAvatar({ accountId }: { accountId: string }) {
    const { data: profile } = useProfile(accountId);
    const explorerUrl = getExplorerAddressUrl(NEAR_NETWORK_ID, accountId);
    const chip = (
        <ProfileAvatarChip
            variant="large"
            imageUrl={resolveProfileImageUrl(profile?.image)}
            name={profile?.name ?? accountId}
            className="rounded-lg border border-card"
        />
    );

    return (
        <TooltipUser accountId={accountId} triggerProps={{ asChild: false }}>
            {explorerUrl ? (
                <Link href={explorerUrl} target="_blank" className="flex">
                    {chip}
                </Link>
            ) : (
                chip
            )}
        </TooltipUser>
    );
}

/**
 * One member row: the chip beside the member's name and wallet, the same
 * pairing the address tooltip shows.
 *
 * `panel` is the desktop hover card — a 28px chip and the tooltip's small
 * address. `sheet` is the mobile bottom sheet, where the design gives the row
 * room for a 36px chip, a full-size address and a copy control.
 */
function MemberRow({
    accountId,
    variant,
}: {
    accountId: string;
    variant: "panel" | "sheet";
}) {
    const t = useTranslations("memberAvatars");
    const { data: profile } = useProfile(accountId);
    const name = resolveUserDisplayName({
        accountId,
        profileName: profile?.name,
    });
    // Without a profile name the heading would repeat the wallet verbatim, so
    // the address moves up into it rather than being printed twice.
    const nameIsAddress = name === accountId;
    const isSheet = variant === "sheet";

    return (
        <div
            className={cn(
                "flex items-center",
                isSheet ? "gap-2 py-3" : "gap-3",
            )}
        >
            <ProfileAvatarChip
                variant={isSheet ? "large" : "medium"}
                imageUrl={resolveProfileImageUrl(profile?.image)}
                name={name}
                className={isSheet ? "rounded-lg" : undefined}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                {nameIsAddress ? (
                    <Address
                        address={accountId}
                        className="text-sm font-semibold leading-[1.5]"
                    />
                ) : (
                    <>
                        <span className="truncate text-sm font-semibold leading-[1.5]">
                            {name}
                        </span>
                        <Address
                            address={accountId}
                            className={cn(
                                "text-general-secondary-foreground",
                                isSheet
                                    ? "text-sm font-medium leading-[1.5]"
                                    : "text-xs leading-4 tracking-[0.18px]",
                            )}
                        />
                    </>
                )}
            </div>
            {isSheet && (
                <CopyButton
                    text={accountId}
                    variant="ghost"
                    size="icon"
                    aria-label={t("copyAddress")}
                    className="size-10 shrink-0 rounded-lg text-general-secondary-foreground"
                    iconClassName="size-4"
                />
            )}
        </div>
    );
}

/**
 * How tall the mobile sheet may grow: everything below the page header, so the
 * list fills the screen up to the "Settings" heading and scrolls from there.
 * Measured rather than hard-coded — the header stacks differently per
 * breakpoint and can carry warning banners.
 */
function useSheetMaxHeight(
    anchor: RefObject<HTMLElement | null>,
    open: boolean,
) {
    const [maxHeight, setMaxHeight] = useState<string>();

    useEffect(() => {
        if (!open) return;

        const measure = () => {
            const layout = anchor.current?.closest("main")?.parentElement;
            const header = layout?.querySelector(":scope > header");
            const bottom =
                header instanceof HTMLElement
                    ? header.getBoundingClientRect().bottom
                    : 0;
            setMaxHeight(`calc(100dvh - ${Math.max(0, Math.round(bottom))}px)`);
        };

        measure();
        window.addEventListener("resize", measure);
        return () => {
            window.removeEventListener("resize", measure);
        };
    }, [anchor, open]);

    return maxHeight;
}

interface MemberAvatarsWithOverflowProps {
    members: string[];
    totalCount: number;
    className?: string;
}

export function MemberAvatarsWithOverflow({
    members,
    totalCount,
    className,
}: MemberAvatarsWithOverflowProps) {
    const t = useTranslations("memberAvatars");
    const [open, setOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(MAX_VISIBLE_AVATARS);
    const containerRef = useRef<HTMLDivElement>(null);
    const isMobile = useMediaQuery("(max-width: 640px)");
    const sheetMaxHeight = useSheetMaxHeight(containerRef, dialogOpen);

    useEffect(() => {
        const calculateVisibleCount = () => {
            if (!containerRef.current) return;

            // The overflow indicator is one more tile in the stack, so it costs
            // exactly as much room as the avatar it replaces.
            const availableWidth =
                containerRef.current.offsetWidth - AVATAR_STRIDE;
            const calculatedCount =
                Math.floor((availableWidth - AVATAR_SIZE) / AVATAR_STRIDE) + 1;

            // Never fewer than one face, never more than the stack's cap or
            // the role itself holds.
            setVisibleCount(
                Math.max(
                    1,
                    Math.min(
                        calculatedCount,
                        MAX_VISIBLE_AVATARS,
                        members.length,
                    ),
                ),
            );
        };

        calculateVisibleCount();

        // Recalculate on window resize
        const resizeObserver = new ResizeObserver(calculateVisibleCount);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [members.length]);

    // Sorting a copy: `members` belongs to the caller's policy data.
    const sortedMembers = useMemo(
        () => [...members].sort((a, b) => a.localeCompare(b)),
        [members],
    );
    const visibleMembers = sortedMembers.slice(0, visibleCount);
    const hiddenMembers = sortedMembers.slice(visibleCount);
    const remainingCount = totalCount - visibleCount;
    const hasMore = remainingCount > 0;

    /** The design's "+N" tile, closing the stack in place of the last avatars. */
    const overflowTile = (
        <span className="-ml-[9px] flex size-9 shrink-0 items-center justify-center rounded-lg border border-card bg-general-bg-secondary text-base font-medium leading-[1.2] text-general-foreground">
            +{remainingCount}
        </span>
    );

    return (
        <div
            ref={containerRef}
            className={cn("flex items-center w-full", className)}
        >
            {/* Visible member avatars */}
            {visibleMembers.map((member) => (
                <div key={member} className="-ml-[9px] flex first:ml-0">
                    <MemberAvatar accountId={member} />
                </div>
            ))}

            {/* Overflow indicator */}
            {hasMore && (
                <>
                    {/* Desktop: hover panel listing the members the stack dropped */}
                    {!isMobile && (
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={t("moreMembers", {
                                        count: remainingCount,
                                    })}
                                    className="flex focus:outline-none"
                                    onMouseEnter={() => setOpen(true)}
                                    onMouseLeave={() => setOpen(false)}
                                >
                                    {overflowTile}
                                </button>
                            </PopoverTrigger>
                            {/* Portalled, so `dark` rides along to keep the
                                panel the design's #262626 in both themes. */}
                            <PopoverContent
                                className="dark w-[190px] rounded-2xl border-transparent bg-general-bg-secondary p-3 text-general-foreground"
                                align="start"
                                sideOffset={8}
                                onMouseEnter={() => setOpen(true)}
                                onMouseLeave={() => setOpen(false)}
                            >
                                <ScrollContainer className="max-h-[264px]">
                                    <div className="flex flex-col gap-2">
                                        {hiddenMembers.map((member) => (
                                            <MemberRow
                                                key={member}
                                                accountId={member}
                                                variant="panel"
                                            />
                                        ))}
                                    </div>
                                </ScrollContainer>
                            </PopoverContent>
                        </Popover>
                    )}

                    {/* Mobile: tapping the tile opens the sheet with every member */}
                    {isMobile && (
                        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                            <DialogTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={t("moreMembers", {
                                        count: remainingCount,
                                    })}
                                    className="flex focus:outline-none"
                                >
                                    {overflowTile}
                                </button>
                            </DialogTrigger>
                            {/* The sheet owns no scroll of its own: the header
                                stays put and the list below it scrolls. */}
                            <DialogContent
                                className="overflow-hidden pb-0"
                                style={{ maxHeight: sheetMaxHeight }}
                            >
                                <SheetHandle />
                                <DialogTitle className="flex items-center gap-2 text-left text-sm font-semibold text-general-secondary-foreground">
                                    {t("membersWhoCanVote")}
                                    <NumberBadge
                                        number={totalCount}
                                        variant="outline"
                                        ariaLabel={t("membersWhoCanVote")}
                                    />
                                </DialogTitle>
                                <ScrollContainer className="-mx-4 min-h-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                                    {sortedMembers.map((member) => (
                                        <MemberRow
                                            key={member}
                                            accountId={member}
                                            variant="sheet"
                                        />
                                    ))}
                                </ScrollContainer>
                            </DialogContent>
                        </Dialog>
                    )}
                </>
            )}
        </div>
    );
}
