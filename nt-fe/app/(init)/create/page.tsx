import { cookies } from "next/headers";
import { AuthProvider } from "@/components/auth-provider";
import { NearInitializer } from "@/components/near-initializer";
import { RequireAuth } from "@/components/require-auth";
import { TreasuryOnboardingPage } from "@/features/onboarding/components/create-treasury-entry";
import { InviteRequired } from "@/features/onboarding/components/invite-required";
import {
    INVITE_COOKIE_NAME,
    inviteCodeAccepted,
    readInviteGateConfig,
} from "@/lib/invite-gate";

export default async function CreatePage() {
    const gate = readInviteGateConfig();
    // The proxy validated `?ref=` and moved an accepted code into this cookie.
    const inviteCode = gate.enabled
        ? (await cookies()).get(INVITE_COOKIE_NAME)?.value
        : undefined;

    if (!inviteCodeAccepted(gate, inviteCode)) {
        return (
            <>
                <NearInitializer />
                <AuthProvider>
                    <InviteRequired landingUrl={gate.earlyAccessUrl} />
                </AuthProvider>
            </>
        );
    }

    return (
        <>
            <NearInitializer />
            <AuthProvider>
                <RequireAuth>
                    <TreasuryOnboardingPage
                        initialScreen="create"
                        inviteCode={inviteCode}
                        earlyAccessUrl={gate.earlyAccessUrl}
                    />
                </RequireAuth>
            </AuthProvider>
        </>
    );
}
