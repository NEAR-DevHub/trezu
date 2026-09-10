import Image from "next/image";
import { geistMono } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { Footer } from "./closing";
import { GUTTER, LandingNav } from "./hero";

type LegalPageProps = {
    /**
     * The design sets the first word in medium and the remainder in light,
     * e.g. ["Privacy", "Policy"].
     */
    title: readonly [accent: string, rest: string];
};

/**
 * Chrome for the legal pages: the landing nav and footer wrapped around a
 * full-bleed portrait band carrying nothing but the page title. The body copy
 * is still being written, so the band is the whole page for now.
 */
export function LegalPage({ title: [accent, rest] }: LegalPageProps) {
    return (
        <div
            className={cn(
                geistMono.variable,
                "overflow-x-clip bg-landing-paper font-landing text-landing-ink antialiased",
            )}
        >
            {/* The portrait runs behind the nav as well as the title, so it
                spans both rather than living inside the heading section. */}
            <div className="relative">
                <div aria-hidden className="absolute inset-0 overflow-hidden">
                    <Image
                        src="/landing/control-bg.jpg"
                        alt=""
                        fill
                        priority
                        sizes="100vw"
                        className="object-cover object-top"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-b from-landing-paper/0 to-landing-paper" />
                </div>

                {/* Positioned so it paints above the backdrop rather than
                    behind it. */}
                <div className="relative">
                    <LandingNav />
                </div>

                {/* Height tracks the 1440x756 band from the design once the
                    nav is accounted for, and floors out on small screens so
                    the title never crowds the nav. */}
                <main
                    className={cn(
                        "relative flex h-[380px] items-end pb-12 sm:h-[480px] lg:h-[46vw] lg:max-h-[660px] lg:pb-24",
                        GUTTER,
                    )}
                >
                    <h1 className="mx-auto w-full max-w-[1440px] text-center text-[40px] leading-[1.08] tracking-[-1px] sm:text-[56px] md:text-[72px] lg:text-[clamp(72px,8.33vw,120px)] lg:tracking-[-2.5px]">
                        <span className="font-medium">{accent}</span>{" "}
                        <span className="font-light">{rest}</span>
                    </h1>
                </main>
            </div>

            <Footer />
        </div>
    );
}
