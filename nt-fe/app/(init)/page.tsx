import { cookies } from "next/headers";
import { NearInitializer } from "@/components/near-initializer";
import { LandingGate } from "@/features/landing/components/landing-gate";
import { LandingPage } from "@/features/landing/components/landing-page";
import {
    REDESIGNED_MODAL_QUERY,
    showsRedesignedModal,
} from "@/features/landing/redesigned-modal";
import { SESSION_HINT_COOKIE } from "@/lib/session-hint";
import { isWelcomeEntry, WELCOME_QUERY } from "@/lib/welcome-entry";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const hasSessionHint =
        (await cookies()).get(SESSION_HINT_COOKIE)?.value === "1";

    return (
        <>
            <NearInitializer />
            <LandingGate
                hasSessionHint={hasSessionHint}
                stayOnLanding={isWelcomeEntry(params[WELCOME_QUERY])}
            >
                <LandingPage
                    showRedesignedModal={showsRedesignedModal(
                        params[REDESIGNED_MODAL_QUERY],
                    )}
                />
            </LandingGate>
        </>
    );
}
