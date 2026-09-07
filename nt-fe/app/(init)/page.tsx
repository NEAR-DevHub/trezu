import { NearInitializer } from "@/components/near-initializer";
import { LandingPage } from "@/features/landing/components/landing-page";
import { LandingRedirect } from "@/features/landing/components/landing-redirect";

export default function Page() {
    return (
        <>
            <NearInitializer />
            <LandingRedirect />
            <LandingPage />
        </>
    );
}
