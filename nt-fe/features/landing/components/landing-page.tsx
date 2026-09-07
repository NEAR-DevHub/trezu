import { geistMono } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { Faq, Footer, WorksWith } from "./closing";
import { Confidential } from "./confidential";
import {
    Capabilities,
    ControlSplit,
    CustodyTruth,
    Multichain,
    MultichainHeader,
    TreasuryStatement,
} from "./control";
import { Hero, LandingNav, ProofGrid } from "./hero";
import { Comparison, Pricing } from "./pricing";

/**
 * business.near.com marketing page. Laid out for the 1440px Figma frame and
 * fluid below it.
 */
export function LandingPage() {
    return (
        <div
            className={cn(
                geistMono.variable,
                "overflow-x-clip bg-landing-paper font-landing text-landing-ink antialiased",
            )}
        >
            <LandingNav />
            <main>
                <Hero />
                <ProofGrid />
                <Confidential />
                <ControlSplit />
                <Capabilities />
                <MultichainHeader />
                <Multichain />
                <TreasuryStatement />
                <CustodyTruth />
                <Comparison />
                <Pricing />
                <WorksWith />
                <Faq />
            </main>
            <Footer />
        </div>
    );
}
