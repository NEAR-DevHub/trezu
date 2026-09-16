"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Address } from "@/components/address";
import { ProfileAvatarChip } from "@/components/profile-avatar-chip";
import { ScrollContainer } from "@/components/scroll-container";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveUserDisplayName, TooltipUser, User } from "@/components/user";
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
 * One row of the overflow panel: the 28px chip beside the member's name and
 * wallet, the same pairing the address tooltip shows.
 */
function OverflowMemberRow({ accountId }: { accountId: string }) {
    const { data: profile } = useProfile(accountId);
    const name = resolveUserDisplayName({
        accountId,
        profileName: profile?.name,
    });
    // Without a profile name the heading would repeat the wallet verbatim, so
    // the address moves up into it rather than being printed twice.
    const nameIsAddress = name === accountId;

    return (
        <div className="flex items-center gap-3">
            <ProfileAvatarChip
                imageUrl={resolveProfileImageUrl(profile?.image)}
                name={name}
            />
            <div className="flex min-w-0 flex-col">
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
                            className="text-xs leading-4 tracking-[0.18px] text-general-secondary-foreground"
                        />
                    </>
                )}
            </div>
        </div>
    );
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

    // All members list for mobile sheet (all members with scroll)
    const AllMembersList = () => (
        <ScrollArea className="h-full max-h-[70vh]">
            <div className="space-y-2 p-1">
                {sortedMembers.map((member) => (
                    <div
                        key={member}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors"
                    >
                        <User
                            accountId={member}
                            size="md"
                            withLink={true}
                            withHoverCard={false}
                        />
                    </div>
                ))}
            </div>
        </ScrollArea>
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
                                            <OverflowMemberRow
                                                key={member}
                                                accountId={member}
                                            />
                                        ))}
                                    </div>
                                </ScrollContainer>
                            </PopoverContent>
                        </Popover>
                    )}

                    {/* Mobile: Click to open bottom sheet - shows all members */}
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
                            <DialogContent
                                className="p-0 gap-0 max-w-full w-full rounded-t-xl rounded-b-none fixed top-auto bottom-0 left-0 right-0 translate-x-0 translate-y-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom bg-background"
                                showCloseButton={false}
                            >
                                <DialogHeader className="p-3 pb-2 border-b bg-background">
                                    <DialogTitle className="flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                            {t("membersWhoCanVote")}
                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs">
                                                {totalCount}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setDialogOpen(false)}
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            ✕
                                        </button>
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="p-3 pt-0 bg-background">
                                    <AllMembersList />
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                </>
            )}
        </div>
    );
}
