import { cookies } from "next/headers";
import { NearInitializer } from "@/components/near-initializer";
import { LandingGate } from "@/features/landing/components/landing-gate";
import { LandingPage } from "@/features/landing/components/landing-page";
import { SESSION_HINT_COOKIE } from "@/lib/session-hint";
import { WELCOME_QUERY, isWelcomeEntry } from "@/lib/welcome-entry";

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
                <LandingPage />
            </LandingGate>
        </>
    );
}
