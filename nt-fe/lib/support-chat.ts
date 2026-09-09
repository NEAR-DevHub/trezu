import { APP_CONTACT_US_URL } from "@/constants/config";

/**
 * Support chat provider selection.
 *
 * Both providers are optional and configured via public env vars:
 * - `NEXT_PUBLIC_HELPSCOUT_BEACON_ID` → Help Scout Beacon
 * - `NEXT_PUBLIC_GLEAP_API_KEY` → Gleap
 *
 * Only one provider is active at a time. Help Scout wins when both are set.
 * When neither is configured, "open support" falls back to the contact-us page.
 */
export type SupportChatConfig =
    | { provider: "helpscout"; beaconId: string }
    | { provider: "gleap"; apiKey: string };

function resolveSupportChatConfig(): SupportChatConfig | null {
    const beaconId = process.env.NEXT_PUBLIC_HELPSCOUT_BEACON_ID;
    if (beaconId) return { provider: "helpscout", beaconId };

    const apiKey = process.env.NEXT_PUBLIC_GLEAP_API_KEY;
    if (apiKey) return { provider: "gleap", apiKey };

    return null;
}

export const SUPPORT_CHAT = resolveSupportChatConfig();

export const SUPPORT_CHAT_ENABLED = SUPPORT_CHAT !== null;

/**
 * Open the support chat window of the configured provider.
 * Falls back to opening the contact-us page when no provider is configured.
 */
export async function openSupportChat(): Promise<void> {
    switch (SUPPORT_CHAT?.provider) {
        case "helpscout": {
            window.Beacon?.("open");
            return;
        }
        case "gleap": {
            const { default: Gleap } = await import("gleap");
            Gleap.open();
            return;
        }
        default: {
            window.open(APP_CONTACT_US_URL, "_blank", "noopener,noreferrer");
        }
    }
}
