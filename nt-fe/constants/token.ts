import { Token } from "@/components/token-input";
import { ChainIcons } from "@/lib/api";

export const NEAR_CHAIN_ICONS: ChainIcons = {
    dark: "https://near-intents.org/static/icons/network/near.svg",
    light: "https://near-intents.org/static/icons/network/near_dark.svg",
};

export const NEAR_TOKEN = {
    symbol: "NEAR",
    address: "near",
    network: "near",
    decimals: 24,
    icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
    name: "NEAR",
    chainIcons: NEAR_CHAIN_ICONS,
    residency: "Near",
} satisfies Token;
