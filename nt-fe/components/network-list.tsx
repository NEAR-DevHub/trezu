"use client";

import type { ComponentProps } from "react";
import { NetworkBadge } from "@/components/network-badge";
import { Tooltip } from "@/components/tooltip";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getNetworkDisplayName } from "@/lib/intents-network";
import { cn } from "@/lib/utils";

type NetworkBadgeProps = ComponentProps<typeof NetworkBadge>;

function HiddenNetworks({ chains }: { chains: NetworkListItem[] }) {
    return (
        <div className="flex flex-col gap-1.5 py-0.5">
            {chains.map((chain) => (
                <span key={chain.key} className="flex items-center gap-1.5">
                    {chain.icon ? (
                        <img
                            src={chain.icon}
                            alt=""
                            className="size-3.5 rounded-full"
                        />
                    ) : null}
                    <span>{getNetworkDisplayName(chain.name)}</span>
                </span>
            ))}
        </div>
    );
}

export interface NetworkListItem {
    key: string;
    name: string;
    icon: string;
}

interface NetworkListProps {
    chains: NetworkListItem[];
    maxVisible?: number;
    className?: string;
    badgeVariant?: NetworkBadgeProps["variant"];
    badgeSize?: NetworkBadgeProps["size"];
    badgeIconOnly?: boolean;
    /** Popover keeps the click list. Tooltip shows the hidden networks on hover. */
    overflow?: "popover" | "tooltip";
    popoverAlign?: "start" | "center" | "end";
    popoverContentClassName?: string;
}

export function NetworkList({
    chains,
    maxVisible = 3,
    className,
    badgeVariant,
    badgeSize = "sm",
    badgeIconOnly = false,
    overflow = "popover",
    popoverAlign = "end",
    popoverContentClassName,
}: NetworkListProps) {
    if (chains.length === 0) {
        return null;
    }

    const visibleChains = chains.slice(0, maxVisible);
    const hiddenChains = chains.slice(maxVisible);
    // Icon chips are a 1rem glyph plus p-1.5. The count chip uses that same box.
    const overflowBadgeClassName = badgeIconOnly
        ? "size-7 justify-center p-0! text-xs leading-none"
        : undefined;

    return (
        <div className={cn("flex flex-wrap items-center gap-1", className)}>
            {visibleChains.map((chain) => (
                <NetworkBadge
                    key={chain.key}
                    name={chain.name}
                    variant={badgeVariant}
                    iconOnly={badgeIconOnly}
                    size={badgeSize}
                    icon={chain.icon}
                />
            ))}

            {hiddenChains.length > 0 &&
                (overflow === "tooltip" ? (
                    <Tooltip
                        content={<HiddenNetworks chains={hiddenChains} />}
                        contentProps={{ className: "max-w-56" }}
                    >
                        <span className="inline-flex">
                            <NetworkBadge
                                name={`+${hiddenChains.length}`}
                                variant={badgeVariant}
                                size={badgeSize}
                                className={overflowBadgeClassName}
                            />
                        </span>
                    </Tooltip>
                ) : (
                    <Popover>
                        <PopoverTrigger
                            onClick={(event) => event.stopPropagation()}
                        >
                            <NetworkBadge
                                name={`+${hiddenChains.length}`}
                                variant={badgeVariant}
                                size={badgeSize}
                                className={cn(
                                    "cursor-pointer",
                                    overflowBadgeClassName,
                                )}
                            />
                        </PopoverTrigger>
                        <PopoverContent
                            align={popoverAlign}
                            className={cn(
                                "h-50 w-auto max-w-56 p-2",
                                popoverContentClassName,
                            )}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <ScrollArea className="h-full">
                                <div className="flex flex-col gap-1">
                                    {hiddenChains.map((chain) => (
                                        <NetworkBadge
                                            key={chain.key}
                                            name={chain.name}
                                            variant={"secondary"}
                                            size={"sm"}
                                            icon={chain.icon}
                                            className="w-full justify-start"
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                ))}
        </div>
    );
}
