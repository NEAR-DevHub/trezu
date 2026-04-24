"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { SelectModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import { Button } from "@/components/button";
import { InputBlock } from "@/components/input-block";
import { getNetworkDisplayName } from "@/components/token-display";
import type { Token } from "@/components/token-input";
import { NEAR_COM_ICON } from "@/constants/token";
import { useBridgeTokens } from "@/hooks/use-bridge-tokens";
import { isValidAddress } from "@/lib/address-validation";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { isValidNearAddressFormat } from "@/lib/near-validation";
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
     * Recipient address entered by the user. Drives compatibility split in
     * the picker — networks whose address format doesn't match are surfaced
     * in a separate "Incompatible" section and disabled.
     */
    recipient: string;
    /**
     * Chain keys attached to the selected address-book contact. When present
     * and non-empty, compatible options are split into "Available" (keys
     * matching the contact) and "Other Available" (remaining compatible).
     */
    contactNetworks?: string[];
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

function isAddressCompatibleWithNetwork(
    address: string,
    networkName: string,
): boolean {
    if (!address) return true;
    const blockchain = getBlockchainType(networkName);
    if (blockchain === "near") {
        // NEAR full check is async; sync format check is enough for sectioning.
        return isValidNearAddressFormat(address);
    }
    return isValidAddress(address, blockchain);
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
                className={cn(
                    "size-8",
                    option.name.toLowerCase() === "near" && "p-1",
                )}
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
    recipient,
    contactNetworks,
    onNetworkChange,
    comingSoonFilter,
}: RecipientNetworkSelectProps) {
    const t = useTranslations("recipientNetworkSelect");
    const { theme } = useThemeStore();
    const [open, setOpen] = useState(false);

    // Need bridge networks before the modal opens so we can split available
    // vs. incompatible based on the entered recipient address.
    const { data: bridgeAssets = [] } = useBridgeTokens(true);

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

    const { compatibleOptions, incompatibleOptions } = useMemo(() => {
        const compatible: RecipientNetworkOption[] = [];
        const incompatible: RecipientNetworkOption[] = [];
        for (const o of availableOptions) {
            if (isAddressCompatibleWithNetwork(recipient, o.networkName)) {
                compatible.push(o);
            } else {
                incompatible.push(o);
            }
        }
        return {
            compatibleOptions: compatible,
            incompatibleOptions: incompatible,
        };
    }, [availableOptions, recipient]);

    const sections = useMemo(() => {
        const out: {
            title: string;
            options: {
                id: string;
                name: string;
                icon: string;
                disabled?: boolean;
                _option: RecipientNetworkOption;
                _disabled?: boolean;
            }[];
        }[] = [];

        const compatible = compatibleOptions;
        const incompatible = incompatibleOptions;

        const hasContactSplit = !!contactNetworks && contactNetworks.length > 0;
        const contactSet = new Set(contactNetworks ?? []);
        const inContact = (o: RecipientNetworkOption) =>
            contactSet.has(o.networkName);

        const mapOption = (o: RecipientNetworkOption) => ({
            id: o.id,
            name: o.name,
            icon: "",
            _option: o,
        });

        if (hasContactSplit) {
            const primary = compatible.filter(inContact);
            const other = compatible.filter((o) => !inContact(o));
            if (primary.length > 0) {
                out.push({
                    title: t("fromAddressBook"),
                    options: primary.map(mapOption),
                });
            }
            if (other.length > 0) {
                out.push({
                    title: t("otherAvailable"),
                    options: other.map(mapOption),
                });
            }
        } else if (compatible.length > 0) {
            out.push({
                title: t("available"),
                options: compatible.map(mapOption),
            });
        }
        if (incompatible.length > 0) {
            out.push({
                title: t("incompatible"),
                options: incompatible.map((o) => ({
                    id: o.id,
                    name: o.name,
                    icon: "",
                    disabled: true,
                    _option: o,
                    _disabled: true,
                })),
            });
        }
        if (comingSoonOptions.length > 0) {
            out.push({
                title: t("comingSoon"),
                options: comingSoonOptions.map((o) => ({
                    id: o.id,
                    name: o.name,
                    icon: "",
                    disabled: true,
                    _option: o,
                    _disabled: true,
                })),
            });
        }
        return out;
    }, [
        compatibleOptions,
        incompatibleOptions,
        comingSoonOptions,
        contactNetworks,
        t,
    ]);

    const hasCompatibleNetwork = compatibleOptions.length > 0;
    const isDisabled = !recipient || !hasCompatibleNetwork;

    // Clear the selection when the address no longer matches it (e.g. user
    // edited the address into a different chain's format).
    useEffect(() => {
        if (!value) return;
        if (availableOptions.length === 0) return;
        if (compatibleOptions.some((o) => o.id === value)) return;
        onChange("");
    }, [value, availableOptions, compatibleOptions, onChange]);

    // Auto-pick when there's exactly one compatible network and nothing's
    // selected (or the selection no longer matches). Skips when the user
    // already chose a still-compatible network.
    useEffect(() => {
        if (compatibleOptions.length !== 1) return;
        const only = compatibleOptions[0];
        if (value === only.id) return;
        if (value && compatibleOptions.some((o) => o.id === value)) return;
        onChange(only.id);
        onNetworkChange?.(only);
    }, [compatibleOptions, value, onChange, onNetworkChange]);
    const placeholderText = !recipient
        ? t("enterAddressFirst")
        : !hasCompatibleNetwork
          ? t("noCompatibleNetwork")
          : t("placeholder");

    return (
        <>
            <InputBlock
                title={t("label")}
                interactive={!isDisabled}
                disabled={isDisabled}
                invalid={false}
            >
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(true)}
                    disabled={isDisabled}
                    className="w-full h-12 justify-between px-0! hover:bg-transparent disabled:opacity-100"
                >
                    {selectedOption && !isDisabled ? (
                        <NetworkRow option={selectedOption} />
                    ) : (
                        <span className="text-xl! font-normal text-muted-foreground">
                            {placeholderText}
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
