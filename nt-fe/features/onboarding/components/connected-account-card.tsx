"use client";

import { LogoutSquare01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { ProfileAvatarChip } from "@/components/profile-avatar-chip";
import { useProfile } from "@/hooks/use-treasury-queries";
import { resolveProfileImageUrl } from "@/lib/profile-image";
import { useNear } from "@/stores/near-store";

const ACCOUNT_ID_MAX_DISPLAY_LENGTH = 24;

/** Long account ids collapse to `abcdef...uvwxyz` so they never wrap or truncate mid-word. */
function shortenAccountId(accountId: string) {
    if (accountId.length < ACCOUNT_ID_MAX_DISPLAY_LENGTH) return accountId;

    return `${accountId.slice(0, 6)}...${accountId.slice(-6)}`;
}

/** The connected wallet, pinned to the bottom of the onboarding column. */
export function ConnectedAccountCard({
    accountId,
    onDisconnected,
}: {
    accountId: string;
    /** Runs after the wallet session is cleared. */
    onDisconnected?: () => void;
}) {
    const t = useTranslations("signIn");
    const { data: profile } = useProfile(accountId);
    const { disconnect } = useNear();
    const displayName = profile?.name;
    const shortAccountId = shortenAccountId(accountId);

    return (
        <div className="flex items-center gap-2 rounded-2xl border border-general-border bg-card px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <ProfileAvatarChip
                    imageUrl={resolveProfileImageUrl(profile?.image)}
                    name={displayName ?? shortAccountId}
                />
                <div className="flex min-w-0 flex-col text-sm leading-normal">
                    <span className="truncate font-semibold text-general-foreground">
                        {displayName ?? shortAccountId}
                    </span>
                    {displayName && (
                        <span className="truncate text-general-muted-foreground">
                            {shortAccountId}
                        </span>
                    )}
                </div>
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-md text-general-unofficial-ghost-foreground"
                aria-label={t("disconnect")}
                onClick={async () => {
                    await disconnect();
                    onDisconnected?.();
                }}
            >
                <Icon icon={LogoutSquare01Icon} />
            </Button>
        </div>
    );
}
