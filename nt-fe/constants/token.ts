import { Token } from "@/components/token-input";
import { ChainIcons } from "@/lib/api";

export const NEAR_CHAIN_ICONS: ChainIcons = {
    dark: "https://near-intents.org/static/icons/network/near.svg",
    light: "https://near-intents.org/static/icons/network/near_dark.svg",
};

export const NEAR_COM_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAPFBMVEVHcEwA7JcA7JcA7JcA7JcA65YA7JcA75kAyIAA3IwANiIAAAAAvXkAGhAA9p0AdUsAwnwAlF8AaUMAtXS/E4peAAAAB3RSTlMAZsz/ZQfmMR3ddQAAAMdJREFUeAF9k1EShCAIQDUsNBSr7n/Xxc3WZtHeF/iGEQc0gp1AMTlTmBfosswiB06sMQ6GWFPvQ3hQk8nU1Iem0df4krgSRbxdohWbRE9CreUsscc/mQBLvJGWmWhlEIh2Jb0cHQx8UNiUjHJMO58JOGqJXFoOgNiTCFfLXQkYxA4rQywt9yRDOvnbspZbqC+h3SspNSCUlrOSUoslhESkZWYoYKjyObL0m1ikNrLnfGvtnXTWBNuaWBjiXlfzfakF1/sOVsQHNdERKfT2DooAAAAASUVORK5CYII=";

export const default_near_token = (isConfidential: boolean) => {
    return {
        symbol: "NEAR",
        address: isConfidential ? "nep141:wrap.near" : "near",
        network: "near",
        decimals: 24,
        icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
        name: "NEAR",
        chainIcons: NEAR_CHAIN_ICONS,
        residency: isConfidential ? "Intents" : "Near",
    } satisfies Token;
};
