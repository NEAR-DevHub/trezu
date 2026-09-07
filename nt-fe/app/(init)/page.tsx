import { cookies } from "next/headers";
import { NearInitializer } from "@/components/near-initializer";
import { LandingGate } from "@/features/landing/components/landing-gate";
import { LandingPage } from "@/features/landing/components/landing-page";
import { SESSION_HINT_COOKIE } from "@/lib/session-hint";

export default async function Page() {
    const hasSessionHint =
        (await cookies()).get(SESSION_HINT_COOKIE)?.value === "1";

    return (
        <>
            <NearInitializer />
            <LandingGate hasSessionHint={hasSessionHint}>
                <LandingPage />
            </LandingGate>
        </>
    );
}
