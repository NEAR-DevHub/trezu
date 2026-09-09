import { AuthProvider } from "@/components/auth-provider";
import { NearInitializer } from "@/components/near-initializer";
import { RequireAuth } from "@/components/require-auth";
import { TreasuryOnboardingPage } from "@/features/onboarding/components/create-treasury-entry";
import { WELCOME_QUERY, isWelcomeEntry } from "@/lib/welcome-entry";

export default async function CreatePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const stayOnCreate = isWelcomeEntry((await searchParams)[WELCOME_QUERY]);
    const page = <TreasuryOnboardingPage initialScreen="create" />;

    return (
        <>
            <NearInitializer />
            <AuthProvider>
                {stayOnCreate ? page : <RequireAuth>{page}</RequireAuth>}
            </AuthProvider>
        </>
    );
}
