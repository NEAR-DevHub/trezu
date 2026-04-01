import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, CircleCheck } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import QRCode from "react-qr-code";
import { z } from "zod";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { InputBlock } from "@/components/input-block";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { getNetworkDisplayName } from "@/components/token-display";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useAggregatedTokens, useAssets } from "@/hooks/use-assets";
import { type BridgeNetwork, useBridgeTokens } from "@/hooks/use-bridge-tokens";
import { useTreasury } from "@/hooks/use-treasury";
import Big from "@/lib/big";
import { fetchDepositAddress } from "@/lib/bridge-api";
import { formatBalance, formatSmartAmount } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";
import { SelectModal } from "./select-modal";

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Optional token symbol to prefill (e.g., "USDC", "NEAR") */
    prefillTokenSymbol?: string;
    /** Optional network ID to prefill (e.g., "near:mainnet") */
    prefillNetworkId?: string;
}

interface SelectOption {
    id: string;
    name: string;
    symbol?: string;
    icon: string;
    gradient?: string;
    networks?: BridgeNetwork[];
    chainId?: string;
}

const assetSchema = z.object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    gradient: z.string().optional(),
    networks: z.array(z.any()).optional(),
});

const networkSchema = z.object({
    id: z.string(),
    name: z.string(),
    symbol: z.string().optional(),
    icon: z.string(),
    gradient: z.string().optional(),
    chainId: z.string().optional(),
});

const depositFormSchema = z.object({
    asset: assetSchema.nullable().refine((val) => val !== null, {
        message: "Please select an asset",
    }),
    network: networkSchema.nullable().refine((val) => val !== null, {
        message: "Please select a network",
    }),
});

type Asset = z.infer<typeof assetSchema>;
type Network = z.infer<typeof networkSchema>;

type DepositFormValues = {
    asset: Asset | null;
    network: Network | null;
};

interface NetworkBalanceDisplay {
    amount: string;
    amountUSD: number;
}

export function DepositModal({
    isOpen,
    onClose,
    prefillTokenSymbol,
    prefillNetworkId,
}: DepositModalProps) {
    const { treasuryId } = useTreasury();
    const { theme } = useThemeStore();
    const { data: { tokens: treasuryAssets = [] } = {} } = useAssets(
        treasuryId,
        {
            onlyPositiveBalance: false,
            onlySupportedTokens: true,
        },
    );
    const aggregatedTreasuryTokens = useAggregatedTokens(treasuryAssets);
    // Prevent old async responses from updating state.
    const latestAddressRequestRef = useRef(0);
    const form = useForm<DepositFormValues>({
        resolver: zodResolver(depositFormSchema),
        mode: "onChange",
        defaultValues: {
            asset: null,
            network: null,
        },
    });

    const [modalType, setModalType] = useState<"asset" | "network" | null>(
        null,
    );
    const [allAssets, setAllAssets] = useState<SelectOption[]>([]);
    const [assetSections, setAssetSections] = useState<
        { title: string; options: SelectOption[] }[]
    >([]);
    const [assetBalanceMap, setAssetBalanceMap] = useState<
        Map<string, { balance: string; balanceUSD: number }>
    >(new Map());
    // Per-asset network lists: asset.id → SelectOption[] (each list is specific to that asset)
    const [assetNetworksMap, setAssetNetworksMap] = useState<
        Map<string, SelectOption[]>
    >(new Map());
    const [networkBalancesByAsset, setNetworkBalancesByAsset] = useState<
        Map<string, Map<string, NetworkBalanceDisplay>>
    >(new Map());
    const [selectedNetworkBalances, setSelectedNetworkBalances] = useState<
        Map<string, NetworkBalanceDisplay>
    >(new Map());
    const [filteredNetworks, setFilteredNetworks] = useState<SelectOption[]>(
        [],
    );
    const [depositAddress, setDepositAddress] = useState<string | null>(null);
    const [isLoadingAddress, setIsLoadingAddress] = useState(false);

    const selectedAsset = form.watch("asset");
    const selectedNetwork = form.watch("network");

    const { data: bridgeAssets = [], isLoading: isLoadingAssets } =
        useBridgeTokens(isOpen);

    useEffect(() => {
        if (selectedAsset && selectedNetwork) {
            trackEvent("deposit-asset-and-network-selected", {
                treasury_id: treasuryId ?? "",
                asset_id: selectedAsset.id,
                asset_name: selectedAsset.name,
                network_id: selectedNetwork.id,
                network_name: selectedNetwork.name,
            });
        }
    }, [selectedAsset?.id, selectedNetwork?.id]);

    // Get the selected network's bridge data to access min amounts
    const selectedBridgeNetwork = useMemo(() => {
        if (!selectedAsset || !selectedNetwork) return null;

        const bridgeAsset = bridgeAssets.find(
            (asset) => asset.id === selectedAsset.id,
        );

        if (!bridgeAsset) return null;

        return bridgeAsset.networks.find(
            (network) => network.id === selectedNetwork.id,
        );
    }, [selectedAsset, selectedNetwork, bridgeAssets]);

    const networkSections = useMemo(() => {
        const withAssets = filteredNetworks
            .filter((network) => {
                const balance = selectedNetworkBalances.get(network.id);
                return !!balance && Big(balance.amount).gt(0);
            })
            .sort((a, b) => {
                const aUSD = selectedNetworkBalances.get(a.id)?.amountUSD || 0;
                const bUSD = selectedNetworkBalances.get(b.id)?.amountUSD || 0;
                if (aUSD !== bUSD) return bUSD - aUSD;
                return a.name.localeCompare(b.name);
            });

        const supportedNetworks = filteredNetworks
            .filter((network) => {
                const balance = selectedNetworkBalances.get(network.id);
                return !balance || !Big(balance.amount).gt(0);
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        if (withAssets.length === 0) {
            return [
                {
                    title: "Supported Networks",
                    options: supportedNetworks,
                },
            ];
        }

        return [
            {
                title: "Networks with Assets",
                options: withAssets,
            },
            {
                title: "Supported Networks",
                options: supportedNetworks,
            },
        ];
    }, [filteredNetworks, selectedNetworkBalances]);

    useEffect(() => {
        if (!isOpen || !bridgeAssets.length) return;

        form.clearErrors("asset");
        form.clearErrors("network");

        // Add "Other" asset that deposits directly to treasury
        const otherAsset: SelectOption = {
            id: "other",
            name: "Other",
            icon: "O",
            gradient: "bg-gradient-cyan-blue",
            networks: [
                {
                    id: "other:near",
                    name: "Near",
                    symbol: "Other",
                    chainIcons: null,
                    chainId: "near:mainnet",
                    decimals: 24,
                },
            ],
        };

        // Helper: convert a BridgeNetwork to a SelectOption with theme-aware icon
        const toNetworkOption = (network: BridgeNetwork): SelectOption => {
            const iconUrl = network.chainIcons
                ? theme === "dark"
                    ? network.chainIcons.dark
                    : network.chainIcons.light
                : null;
            return {
                id: network.id,
                name: network.name,
                icon: iconUrl || network.name.charAt(0),
                gradient: "bg-linear-to-br from-green-500 to-teal-500",
                chainId: network.chainId,
            };
        };

        // Build per-asset network lists (each asset gets its own dedicated list)
        const newAssetNetworksMap = new Map<string, SelectOption[]>();
        const networkBalancesByAssetId = new Map<
            string,
            Map<string, NetworkBalanceDisplay>
        >();
        const ownedTreasuryAssetsById = new Map(
            aggregatedTreasuryTokens.map((asset) => [
                asset.id.toLowerCase(),
                asset,
            ]),
        );
        const assetBalancesById = new Map<
            string,
            { balance: string; balanceUSD: number }
        >();

        const yourAssets: SelectOption[] = [];
        const otherAssets: SelectOption[] = [];

        const buildNetworkBalanceMap = (
            assetId: string,
            bridgeNetworks: BridgeNetwork[],
        ): Map<string, NetworkBalanceDisplay> => {
            const balances = new Map<string, NetworkBalanceDisplay>();
            const ownedAsset = ownedTreasuryAssetsById.get(
                assetId.toLowerCase(),
            );

            if (!ownedAsset) return balances;

            const normalizeContractId = (value?: string) =>
                (value || "").replace(/^nep141:/, "");

            // Match each bridge network to treasury-held balances in priority order:
            // 1) exact contract-id match (after normalizing `nep141:` prefix),
            // 2) for NEAR token on NEAR network, aggregate all NEAR residencies,
            // 3) fallback for native chain entries without contractId by chain name.
            // Then sum matched balances into a single display amount per bridge network.
            for (const bridgeNetwork of bridgeNetworks) {
                const normalizedBridgeId = normalizeContractId(
                    bridgeNetwork.id,
                );
                const byContractId = ownedAsset.networks.filter(
                    (network) =>
                        normalizeContractId(network.contractId) ===
                        normalizedBridgeId,
                );

                const bridgeNetworkName = bridgeNetwork.name.toLowerCase();
                const includeAllNearResidencies =
                    assetId.toLowerCase() === "near" &&
                    bridgeNetworkName === "near";

                const chainMatches = ownedAsset.networks.filter(
                    (network) =>
                        network.network.toLowerCase() === bridgeNetworkName,
                );

                const fallbackChainMatches = ownedAsset.networks.filter(
                    (network) =>
                        !network.contractId &&
                        network.network.toLowerCase() === bridgeNetworkName,
                );

                const matches = includeAllNearResidencies
                    ? chainMatches
                    : byContractId.length > 0
                      ? byContractId
                      : fallbackChainMatches;

                if (matches.length === 0) continue;

                const amount = matches
                    .reduce((sum, network) => {
                        return sum.add(
                            Big(network.availableBalanceRaw).div(
                                Big(10).pow(network.decimals),
                            ),
                        );
                    }, Big(0))
                    .toString();
                const amountUSD = matches.reduce(
                    (sum, network) => sum + network.availableBalanceUSD,
                    0,
                );

                if (Big(amount).gt(0)) {
                    balances.set(bridgeNetwork.id, {
                        amount,
                        amountUSD,
                    });
                }
            }

            return balances;
        };

        for (const asset of bridgeAssets) {
            const networks = asset.networks.map(toNetworkOption);
            newAssetNetworksMap.set(asset.id, networks);
            networkBalancesByAssetId.set(
                asset.id,
                buildNetworkBalanceMap(asset.id, asset.networks),
            );

            const normalizedId = asset.id.toLowerCase();
            const ownedAsset = ownedTreasuryAssetsById.get(normalizedId);
            const selectOption: SelectOption = {
                id: asset.id,
                name: asset.name,
                symbol: asset.networks[0]?.symbol,
                icon: asset.icon,
                gradient: "bg-gradient-cyan-blue",
                networks: asset.networks,
            };

            if (ownedAsset) {
                yourAssets.push(selectOption);
                assetBalancesById.set(asset.id, {
                    balance: ownedAsset.availableTotalBalance.toString(),
                    balanceUSD: ownedAsset.availableTotalBalanceUSD,
                });
                continue;
            }

            otherAssets.push(selectOption);
        }

        yourAssets.sort((a, b) => {
            const aUSD = assetBalancesById.get(a.id)?.balanceUSD || 0;
            const bUSD = assetBalancesById.get(b.id)?.balanceUSD || 0;
            return bUSD - aUSD;
        });
        otherAssets.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        const formattedAssets: SelectOption[] = [...yourAssets, ...otherAssets];

        // Add "Other" at the end
        formattedAssets.push(otherAsset);
        newAssetNetworksMap.set(
            "other",
            otherAsset.networks!.map(toNetworkOption),
        );

        setAllAssets(formattedAssets);
        setAssetNetworksMap(newAssetNetworksMap);
        setNetworkBalancesByAsset(networkBalancesByAssetId);
        setAssetBalanceMap(assetBalancesById);
        setAssetSections([
            {
                title: "Your Assets",
                options: yourAssets,
            },
            {
                title: "Other Assets",
                options: [...otherAssets, otherAsset],
            },
        ]);

        // Auto-select asset:
        // 1) explicit prefill token, 2) owned USDC, 3) first token in "Your Assets",
        // 4) any USDC option, 5) first available
        let targetAsset: SelectOption | undefined;
        if (prefillTokenSymbol) {
            const targetId = prefillTokenSymbol.toLowerCase();
            targetAsset = formattedAssets.find(
                (asset) => asset.id?.toLowerCase() === targetId,
            );
        }
        if (!targetAsset) {
            targetAsset =
                yourAssets.find(
                    (asset) => asset.id?.toLowerCase() === "usdc",
                ) ||
                yourAssets[0] ||
                formattedAssets.find(
                    (asset) => asset.id?.toLowerCase() === "usdc",
                ) ||
                formattedAssets[0];
        }

        if (targetAsset) {
            form.setValue("asset", targetAsset);

            const availableNetworks =
                newAssetNetworksMap.get(targetAsset.id) || [];
            setFilteredNetworks(
                availableNetworks.map((n) => ({
                    ...n,
                    name: getNetworkDisplayName(n.name),
                })),
            );
            setSelectedNetworkBalances(
                networkBalancesByAssetId.get(targetAsset.id) || new Map(),
            );

            let networkToSelect: SelectOption | null = null;

            if (prefillNetworkId) {
                const prefillNetwork = availableNetworks.find(
                    (n) =>
                        n.id === prefillNetworkId ||
                        n.chainId === prefillNetworkId ||
                        n.name
                            .toLowerCase()
                            .includes(prefillNetworkId.toLowerCase()),
                );
                if (prefillNetwork) networkToSelect = prefillNetwork;
            }

            if (!networkToSelect && availableNetworks.length === 1) {
                networkToSelect = availableNetworks[0];
            }

            if (networkToSelect) {
                form.setValue("network", networkToSelect);
            } else {
                form.setValue("network", null);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isOpen,
        bridgeAssets,
        aggregatedTreasuryTokens,
        prefillTokenSymbol,
        prefillNetworkId,
        theme,
    ]);

    // Handle asset selection - show all assets but update network list
    const handleAssetSelect = useCallback(
        (asset: SelectOption) => {
            form.setValue("asset", asset);
            form.clearErrors("asset");
            form.clearErrors("network");

            setDepositAddress(null);

            const availableNetworks = assetNetworksMap.get(asset.id) || [];
            setFilteredNetworks(
                availableNetworks.map((n) => ({
                    ...n,
                    name: getNetworkDisplayName(n.name),
                })),
            );
            setSelectedNetworkBalances(
                networkBalancesByAsset.get(asset.id) || new Map(),
            );

            // Auto-select network if only one is available
            if (availableNetworks.length === 1) {
                form.setValue("network", availableNetworks[0]);
            } else if (
                selectedNetwork &&
                !availableNetworks.some((n) => n.id === selectedNetwork.id)
            ) {
                form.setValue("network", null);
            }
        },
        [form, assetNetworksMap, selectedNetwork, networkBalancesByAsset],
    );

    // Handle network selection
    const handleNetworkSelect = useCallback(
        (network: SelectOption) => {
            form.setValue("network", network);
            form.clearErrors("network");
            form.clearErrors("asset");

            setDepositAddress(null);
        },
        [form],
    );

    // Fetch deposit address when both asset and network are selected
    useEffect(() => {
        const fetchAddress = async () => {
            if (!treasuryId || !selectedNetwork || !selectedAsset) {
                setDepositAddress(null);
                return;
            }
            const requestId = ++latestAddressRequestRef.current;

            // All NEAR networks deposit directly to treasury account ID
            const isNearNetwork = (
                selectedNetwork.chainId ?? selectedNetwork.id
            )
                .toLowerCase()
                .includes("near");
            if (isNearNetwork) {
                if (requestId !== latestAddressRequestRef.current) return;
                setDepositAddress(treasuryId);
                return;
            }

            setIsLoadingAddress(true);
            form.clearErrors("network");

            try {
                const result = await fetchDepositAddress(
                    treasuryId,
                    selectedNetwork.chainId ?? selectedNetwork.id,
                );

                if (result && result.address) {
                    if (requestId !== latestAddressRequestRef.current) return;
                    setDepositAddress(result.address);
                    form.clearErrors("network");
                } else {
                    if (requestId !== latestAddressRequestRef.current) return;
                    setDepositAddress(null);
                    form.setError("network", {
                        type: "manual",
                        message:
                            "Could not retrieve deposit address for the selected asset and network.",
                    });
                }
            } catch (err: any) {
                if (requestId !== latestAddressRequestRef.current) return;
                form.setError("network", {
                    type: "manual",
                    message:
                        err.message ||
                        "Failed to fetch deposit address. Please try again.",
                });
                setDepositAddress(null);
            } finally {
                if (requestId !== latestAddressRequestRef.current) return;
                setIsLoadingAddress(false);
            }
        };

        if (selectedAsset && selectedNetwork && treasuryId) {
            fetchAddress();
        } else {
            setDepositAddress(null);
        }
    }, [selectedAsset, selectedNetwork, treasuryId, form]);

    // Reset all state when modal closes
    const handleClose = useCallback(() => {
        latestAddressRequestRef.current += 1;
        form.reset();
        setDepositAddress(null);
        setFilteredNetworks([]);
        setSelectedNetworkBalances(new Map());
        setModalType(null);
        onClose();
    }, [form, onClose]);

    // Helper function to format address with bold first and last 6 characters
    const formatAddress = (address: string) => {
        // Check if it's a NEAR network (treasury address) - don't apply bold formatting
        const isNearNetwork = (
            selectedNetwork?.chainId ??
            selectedNetwork?.id ??
            ""
        )
            .toLowerCase()
            .includes("near");

        if (isNearNetwork) {
            return <span>{address}</span>;
        }

        if (address.length <= 12) {
            return <span className="font-bold">{address}</span>;
        }

        const first6 = address.slice(0, 6);
        const middle = address.slice(6, -6);
        const last6 = address.slice(-6);

        return (
            <>
                <span className="font-bold">{first6}</span>
                <span>{middle}</span>
                <span className="font-bold">{last6}</span>
            </>
        );
    };

    const renderBalance = (amount: number | string, amountUSD: number) => {
        const normalizedAmount = amount.toString();
        if (!Big(normalizedAmount).gt(0)) {
            return null;
        }
        const normalizedUsd = Number.isFinite(amountUSD)
            ? amountUSD.toFixed(2)
            : "0.00";

        return (
            <div className="flex flex-col items-end">
                <span className="font-semibold">
                    {formatSmartAmount(normalizedAmount)}
                </span>
                <span className="text-sm text-muted-foreground">
                    ≈${normalizedUsd}
                </span>
            </div>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Deposit</DialogTitle>
                </DialogHeader>

                <Form {...form}>
                    <div>
                        <p className="font-semibold pb-2">
                            Select asset and network to see deposit address
                        </p>

                        {/* Asset Select */}
                        <FormField
                            control={form.control}
                            name="asset"
                            render={({ fieldState }) => (
                                <FormItem>
                                    <InputBlock
                                        title="Asset"
                                        invalid={!!fieldState.error}
                                        className="rounded-b-none border-b border-general-border border-l-0! border-r-0! border-t-0!"
                                    >
                                        <Button
                                            type="button"
                                            onClick={() =>
                                                setModalType("asset")
                                            }
                                            variant="unstyled"
                                            className="w-full text-left cursor-pointer hover:opacity-80 h-auto justify-start p-0! mt-1"
                                        >
                                            <div className="w-full flex items-center justify-between py-1">
                                                {selectedAsset ? (
                                                    <div className="flex items-center gap-2">
                                                        {selectedAsset.icon?.startsWith(
                                                            "http",
                                                        ) ||
                                                        selectedAsset.icon?.startsWith(
                                                            "data:",
                                                        ) ? (
                                                            <img
                                                                src={
                                                                    selectedAsset.icon
                                                                }
                                                                alt={
                                                                    selectedAsset.name
                                                                }
                                                                className="w-6 h-6 rounded-full object-contain"
                                                            />
                                                        ) : (
                                                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-cyan-blue">
                                                                <span>
                                                                    {
                                                                        selectedAsset.icon
                                                                    }
                                                                </span>
                                                            </div>
                                                        )}
                                                        <span className="text-foreground font-medium capitalize">
                                                            {selectedAsset.name}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground text-lg font-normal">
                                                        Select Asset
                                                    </span>
                                                )}
                                                <ChevronDown className="w-5 h-5" />
                                            </div>
                                        </Button>
                                        <FormMessage />
                                    </InputBlock>
                                </FormItem>
                            )}
                        />

                        {/* Network Select */}
                        <FormField
                            control={form.control}
                            name="network"
                            render={({ fieldState }) => (
                                <FormItem>
                                    <InputBlock
                                        title="Network"
                                        invalid={!!fieldState.error}
                                        className="rounded-t-none border-l-0! border-r-0! border-t-0! border-b-0!"
                                    >
                                        <Button
                                            type="button"
                                            onClick={() =>
                                                setModalType("network")
                                            }
                                            variant="unstyled"
                                            className="w-full text-left cursor-pointer hover:opacity-80 h-auto justify-start p-0! mt-1"
                                        >
                                            <div className="w-full flex flex-col gap-0 py-1">
                                                {selectedNetwork ? (
                                                    <>
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                {selectedNetwork.icon?.startsWith(
                                                                    "http",
                                                                ) ||
                                                                selectedNetwork.icon?.startsWith(
                                                                    "data:",
                                                                ) ? (
                                                                    <div className="w-6 h-6 rounded-full object-cover">
                                                                        <img
                                                                            src={
                                                                                selectedNetwork.icon
                                                                            }
                                                                            alt={
                                                                                selectedNetwork.name
                                                                            }
                                                                            className="w-full h-full"
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <div
                                                                        className={`w-6 h-6 rounded-full ${
                                                                            selectedNetwork.gradient ||
                                                                            "bg-linear-to-br from-green-500 to-teal-500"
                                                                        } flex items-center justify-center text-white text-xs font-bold`}
                                                                    >
                                                                        <span>
                                                                            {
                                                                                selectedNetwork.icon
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                <span className="text-foreground font-medium capitalize">
                                                                    {getNetworkDisplayName(
                                                                        selectedNetwork.name,
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <ChevronDown className="w-5 h-5" />
                                                        </div>
                                                        {/* Info message for "Other" asset */}
                                                        {selectedAsset?.id ===
                                                            "other" && (
                                                            <div className="break-all overflow-wrap-anywhere text-wrap mt-2 text-xs text-general-info-foreground">
                                                                You can deposit
                                                                any token not
                                                                listed in the
                                                                assets, but only
                                                                via the NEAR
                                                                network.
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-muted-foreground text-lg font-normal">
                                                            Select Network
                                                        </span>
                                                        <ChevronDown className="w-5 h-5" />
                                                    </div>
                                                )}
                                            </div>
                                        </Button>
                                        <FormMessage />
                                    </InputBlock>
                                </FormItem>
                            )}
                        />

                        {/* Deposit Address Section */}
                        {isLoadingAddress && (
                            <div className="mt-6 space-y-4 animate-pulse">
                                <div>
                                    <div className="h-6 bg-muted rounded w-48 mb-2" />
                                    <div className="h-4 bg-muted rounded w-72" />
                                </div>

                                <div className="bg-muted rounded-lg p-2">
                                    <div className="flex gap-4">
                                        {/* QR Code Skeleton */}
                                        <div className="shrink-0">
                                            <div className="w-32 h-32 bg-background rounded-lg" />
                                        </div>

                                        {/* Address Skeleton */}
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 bg-background rounded w-20" />
                                            <div className="bg-background rounded-lg p-3"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Warning Skeleton */}
                                <div className="bg-muted rounded-lg p-3 flex gap-3">
                                    <div className="w-5 h-5 bg-background rounded shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 bg-background rounded w-full" />
                                        <div className="h-4 bg-background rounded w-3/4" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {depositAddress && !isLoadingAddress && (
                            <div className="mt-6 space-y-3">
                                <div>
                                    <h3 className="font-semibold mb-1">
                                        Deposit Address
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        Always double-check your deposit
                                        address.
                                    </p>
                                </div>

                                <div className="bg-muted rounded-lg p-2">
                                    <div className="flex gap-3">
                                        {/* QR Code */}
                                        <div className="shrink-0">
                                            <div className="w-24 h-24 sm:w-40 sm:h-40 rounded-lg flex items-center justify-center p-2">
                                                <QRCode
                                                    value={depositAddress}
                                                    size={112}
                                                    style={{
                                                        height: "auto",
                                                        maxWidth: "100%",
                                                        width: "100%",
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Address */}
                                        <div className="flex-1 space-y-2 pt-1">
                                            <label className="text-sm text-muted-foreground">
                                                Address
                                            </label>
                                            <div className="rounded-lg flex justify-between gap-2">
                                                <code className="font-mono break-all text-xs sm:text-sm">
                                                    {formatAddress(
                                                        depositAddress,
                                                    )}
                                                </code>
                                                <CopyButton
                                                    text={depositAddress}
                                                    toastMessage="Address copied to clipboard"
                                                    variant="unstyled"
                                                    size="icon-sm"
                                                    className="shrink-0"
                                                    iconClassName="w-5 h-5 text-muted-foreground"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Warning Messages with CircleCheck Icons */}
                                <div className="space-y-2 mt-4">
                                    <div className="flex gap-2 items-start text-sm text-muted-foreground">
                                        <CircleCheck className="h-4 w-4 shrink-0 mt-0.5" />
                                        <span>
                                            Only deposit{" "}
                                            <span className="text-foreground">
                                                {selectedNetwork?.symbol}
                                            </span>{" "}
                                            from the{" "}
                                            <span className="text-foreground capitalize">
                                                {selectedNetwork &&
                                                    getNetworkDisplayName(
                                                        selectedNetwork.name,
                                                    )}
                                            </span>{" "}
                                            network. We recommend starting with
                                            a small test transaction to ensure
                                            everything works correctly before
                                            sending the full amount.
                                        </span>
                                    </div>

                                    {selectedBridgeNetwork?.minDepositAmount && (
                                        <div className="flex gap-2 items-start text-sm text-muted-foreground">
                                            <CircleCheck className="h-4 w-4 shrink-0 mt-0.5" />
                                            <span>
                                                Minimum deposit is{" "}
                                                <span className="text-foreground font-semibold">
                                                    {formatBalance(
                                                        selectedBridgeNetwork.minDepositAmount,
                                                        selectedBridgeNetwork.decimals,
                                                    )}{" "}
                                                    {selectedNetwork?.symbol}
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <SelectModal
                            isOpen={modalType === "asset"}
                            onClose={() => setModalType(null)}
                            onSelect={(option) => {
                                handleAssetSelect(option);
                                setModalType(null);
                            }}
                            title="Select Asset"
                            options={allAssets}
                            sections={assetSections}
                            searchPlaceholder="Search by name"
                            isLoading={isLoadingAssets}
                            selectedId={selectedAsset?.id}
                            renderRight={(item) => {
                                const balanceData = assetBalanceMap.get(
                                    item.id,
                                );
                                if (!balanceData) return null;
                                return renderBalance(
                                    balanceData.balance,
                                    balanceData.balanceUSD,
                                );
                            }}
                        />

                        <SelectModal
                            isOpen={modalType === "network"}
                            onClose={() => setModalType(null)}
                            onSelect={(option) => {
                                handleNetworkSelect(option);
                                setModalType(null);
                            }}
                            title="Select Network"
                            options={filteredNetworks}
                            sections={networkSections}
                            searchPlaceholder="Search by name"
                            isLoading={isLoadingAssets}
                            fixNear
                            roundIcons={false}
                            renderRight={(item) => {
                                const networkBalance =
                                    selectedNetworkBalances.get(item.id);
                                if (!networkBalance) return null;
                                return renderBalance(
                                    networkBalance.amount,
                                    networkBalance.amountUSD,
                                );
                            }}
                        />
                    </div>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
