"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { SelectModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import { Button } from "@/components/button";
import { InputBlock } from "@/components/input-block";
import { getNetworkDisplayName } from "@/components/token-display";
import type { Token } from "@/components/token-input";
import { NEAR_COM_ICON } from "@/constants/token";
import { useBridgeTokens } from "@/hooks/use-bridge-tokens";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";

export const NEAR_COM_NETWORK_ID = "near.com";

export interface RecipientNetworkOption {
    id: string;
    name: string;
    description?: string;
    icon: string;
    /** Raw network name from bridge data (or "near" for near.com). Used to derive blockchain type. */
    networkName: string;
}

interface RecipientNetworkSelectProps {
    value: string;
    onChange: (networkId: string) => void;
    isConfidential: boolean;
    token: Token | null;
    /**
     * Fires when the user picks a network. Carries the raw network name so
     * callers can derive blockchain type (for downstream address validation).
     */
    onNetworkChange?: (option: RecipientNetworkOption) => void;
    /**
     * Returns the list of coming-soon networks. Receives the available
     * networks so the consumer can filter its own pool against them.
     * Reserved for future bulk-payment use.
     */
    comingSoonFilter?: (
        available: RecipientNetworkOption[],
    ) => RecipientNetworkOption[];
}

function NetworkRow({
    option,
    disabled,
}: {
    option: RecipientNetworkOption;
    disabled?: boolean;
}) {
    return (
        <div
            className={cn(
                "flex items-center gap-3 w-full",
                disabled && "opacity-50",
            )}
        >
            <img
                src={option.icon}
                alt={`${option.name} network`}
                className="size-8"
            />
            <div className="flex flex-col items-start text-left">
                <span
                    className={cn(
                        "text-base font-semibold",
                        option.name !== "near.com" && "capitalize",
                    )}
                >
                    {option.name}
                </span>
                {option.description && (
                    <span className="text-xs text-muted-foreground font-normal">
                        {option.description}
                    </span>
                )}
            </div>
        </div>
    );
}

export function RecipientNetworkSelect({
    value,
    onChange,
    token,
    onNetworkChange,
    comingSoonFilter,
}: RecipientNetworkSelectProps) {
    const t = useTranslations("recipientNetworkSelect");
    const { theme } = useThemeStore();
    const [open, setOpen] = useState(false);

    const { data: bridgeAssets = [] } = useBridgeTokens(open);

    const nearComOption: RecipientNetworkOption = useMemo(
        () => ({
            id: NEAR_COM_NETWORK_ID,
            name: t("nearComName"),
            description: t("nearComDescription"),
            icon: NEAR_COM_ICON,
            networkName: "near",
        }),
        [t],
    );

    const tokenNetworkOptions = useMemo((): RecipientNetworkOption[] => {
        if (!token) return [];

        const bridgeAsset = bridgeAssets.find(
            (asset) => asset.id.toLowerCase() === token.symbol.toLowerCase(),
        );
        if (!bridgeAsset) return [];

        return bridgeAsset.networks.map((network) => {
            const iconUrl = network.chainIcons
                ? theme === "dark"
                    ? network.chainIcons.dark
                    : network.chainIcons.light
                : "";
            return {
                id: network.id,
                name: getNetworkDisplayName(network.name),
                icon: iconUrl,
                networkName: network.name,
            };
        });
    }, [bridgeAssets, token, theme]);

    const availableOptions = useMemo(
        () => [nearComOption, ...tokenNetworkOptions],
        [nearComOption, tokenNetworkOptions],
    );

    const comingSoonOptions = useMemo(
        () => comingSoonFilter?.(availableOptions) ?? [],
        [availableOptions, comingSoonFilter],
    );

    const selectedOption = useMemo(() => {
        if (!value) return null;
        if (value === NEAR_COM_NETWORK_ID) return nearComOption;
        return availableOptions.find((o) => o.id === value) ?? null;
    }, [availableOptions, nearComOption, value]);

    const sections = useMemo(() => {
        const out: {
            title: string;
            options: {
                id: string;
                name: string;
                icon: string;
                _option: RecipientNetworkOption;
                _disabled?: boolean;
            }[];
        }[] = [
            {
                title: t("available"),
                options: availableOptions.map((o) => ({
                    id: o.id,
                    name: o.name,
                    icon: "",
                    _option: o,
                })),
            },
        ];
        if (comingSoonOptions.length > 0) {
            out.push({
                title: t("comingSoon"),
                options: comingSoonOptions.map((o) => ({
                    id: o.id,
                    name: o.name,
                    icon: "",
                    _option: o,
                    _disabled: true,
                })),
            });
        }
        return out;
    }, [availableOptions, comingSoonOptions, t]);

    return (
        <>
            <InputBlock title={t("label")} interactive invalid={false}>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(true)}
                    className="w-full h-12 justify-between px-0! hover:bg-transparent"
                >
                    {selectedOption ? (
                        <NetworkRow option={selectedOption} />
                    ) : (
                        <span className="text-xl! font-normal text-muted-foreground">
                            {t("placeholder")}
                        </span>
                    )}
                    <ChevronDown className="size-5 text-muted-foreground ml-auto" />
                </Button>
            </InputBlock>

            <SelectModal
                isOpen={open}
                onClose={() => setOpen(false)}
                title={t("title")}
                options={[]}
                sections={sections}
                selectedId={value}
                onSelect={(option) => {
                    const rich = option as unknown as {
                        _option: RecipientNetworkOption;
                        _disabled?: boolean;
                    };
                    if (rich._disabled) return;
                    onChange(rich._option.id);
                    onNetworkChange?.(rich._option);
                    setOpen(false);
                }}
                renderIcon={(option) => {
                    const rich = option as unknown as {
                        _option: RecipientNetworkOption;
                        _disabled?: boolean;
                    };
                    return (
                        <NetworkRow
                            option={rich._option}
                            disabled={rich._disabled}
                        />
                    );
                }}
                renderContent={() => null}
            />
        </>
    );
}
