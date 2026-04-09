export const NEAR_INTENTS_NETWORK_ICON_BASE_URL =
    "https://near-intents.org/static/icons/network";

export function getNearIntentsNetworkIconSrc(networkId: string): string {
    return `${NEAR_INTENTS_NETWORK_ICON_BASE_URL}/${networkId}.svg`;
}
