"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
import { TooltipUser, User } from "@/components/user";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProfile } from "@/hooks/use-treasury-queries";
import { getExplorerAddressUrl } from "@/lib/blockchain-utils";
import { resolveProfileImageUrl } from "@/lib/profile-image";
import { cn } from "@/lib/utils";

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
    const [visibleCount, setVisibleCount] = useState(10); // Default fallback
    const containerRef = useRef<HTMLDivElement>(null);
    const isMobile = useMediaQuery("(max-width: 640px)");

    useEffect(() => {
        const calculateVisibleCount = () => {
            if (!containerRef.current) return;

            const containerWidth = containerRef.current.offsetWidth;
            // Avatar size is 36px (size-9), with -9px overlap
            // So each avatar takes up 27px (36 - 9) of space
            // Reserve ~120px for the "+X members" button
            const avatarWidth = 27;
            const buttonWidth = 120;
            const firstAvatarWidth = 36; // First avatar has no negative margin

            const availableWidth = containerWidth - buttonWidth;
            const calculatedCount =
                Math.floor((availableWidth - firstAvatarWidth) / avatarWidth) +
                1;

            // Ensure we show at least 4 avatars and not more than total
            const finalCount = Math.max(
                4,
                Math.min(calculatedCount, members.length),
            );
            setVisibleCount(finalCount);
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

    const visibleMembers = members
        .sort((a, b) => a.localeCompare(b))
        .slice(0, visibleCount);
    const hiddenMembers = members.slice(visibleCount); // Only members not shown
    const remainingCount = totalCount - visibleCount;
    const hasMore = remainingCount > 0;

    // Hidden members list for the popover (desktop - only remaining members)
    const HiddenMembersList = () => (
        <ScrollContainer className="max-h-[300px]">
            <div className="space-y-2 p-1">
                {hiddenMembers.map((member) => (
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
        </ScrollContainer>
    );

    // All members list for mobile sheet (all members with scroll)
    const AllMembersList = () => (
        <ScrollArea className="h-full max-h-[70vh]">
            <div className="space-y-2 p-1">
                {members.map((member) => (
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
                <div key={member} className="-ml-[9px] first:ml-0">
                    <MemberAvatar accountId={member} />
                </div>
            ))}

            {/* Overflow indicator */}
            {hasMore && (
                <>
                    {/* Desktop: Hover popover - shows only hidden members */}
                    {!isMobile && (
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    className="ml-2 text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                                    onMouseEnter={() => setOpen(true)}
                                    onMouseLeave={() => setOpen(false)}
                                >
                                    {t("moreMembers", {
                                        count: remainingCount,
                                    })}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-80 p-3"
                                align="start"
                                onMouseEnter={() => setOpen(true)}
                                onMouseLeave={() => setOpen(false)}
                            >
                                <HiddenMembersList />
                            </PopoverContent>
                        </Popover>
                    )}

                    {/* Mobile: Click to open bottom sheet - shows all members */}
                    {isMobile && (
                        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                            <DialogTrigger asChild>
                                <button className="ml-2 text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none">
                                    {t("moreMembers", {
                                        count: remainingCount,
                                    })}
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
