import Image from "next/image";
import Link from "next/link";
import { APP_DOCS_URL } from "@/constants/config";
import { cn } from "@/lib/utils";
import { EARLY_ACCESS_HREF, NAV_LINKS, PROOF_STATS } from "../content";
import { NearBusinessWordmark } from "./landing-icons";
import { Reveal } from "./reveal";
import { SectionLink } from "./section-link";

/** Horizontal page gutter: 120px at the 1440 design width, tighter below. */
export const GUTTER = "px-6 md:px-12 xl:px-[120px]";

/**
 * Hero entrance: every element lifts 16px into place on first paint, staggered
 * in reading order via `animationDelay` (headline 120ms through the render at
 * 420ms). Pure CSS, so it costs no client JS and needs no scroll trigger —
 * the whole hero is above the fold. Under reduced-motion only the fade plays.
 */
const REVEAL = "animate-landing-rise motion-reduce:animate-landing-fade";

export function EarlyAccessButton({
    className,
    ...props
}: Omit<React.ComponentProps<typeof Link>, "href">) {
    return (
        <Link
            href={EARLY_ACCESS_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-landing-green font-medium leading-none text-landing-ink transition-colors hover:bg-[#00c97f]",
                className,
            )}
            {...props}
        >
            Request Early Access
        </Link>
    );
}

export function LandingNav() {
    return (
        <header className="pt-6 md:pt-8">
            <div
                className={cn(
                    "mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-3 md:gap-6",
                    GUTTER,
                )}
            >
                <Link href="/" aria-label="NEAR Business home">
                    <NearBusinessWordmark className="h-4 w-[137.6px] md:h-[21.79px] md:w-[187.5px]" />
                </Link>
                <nav className="hidden items-center gap-6 lg:flex">
                    {NAV_LINKS.map(({ label, href }) => (
                        <SectionLink
                            key={label}
                            href={href}
                            className="rounded-lg px-3 py-2 text-base leading-normal hover:bg-landing-ink/5"
                            {...(href === APP_DOCS_URL
                                ? {
                                      target: "_blank",
                                      rel: "noopener noreferrer",
                                  }
                                : {})}
                        >
                            {label}
                        </SectionLink>
                    ))}
                </nav>
                {/* Phones can't fit both next to the wordmark, so they keep
                    Sign in and rely on the hero's Early Access CTA just below. */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/login"
                        className="whitespace-nowrap text-sm leading-normal hover:underline"
                    >
                        Sign in
                    </Link>
                    <EarlyAccessButton className="hidden h-11 shrink-0 px-4 text-sm sm:inline-flex md:h-12 md:px-8 md:text-base" />
                </div>
            </div>
        </header>
    );
}

export function Hero() {
    return (
        <section
            className={cn(
                "relative mx-auto flex w-full max-w-[1440px] flex-col gap-8 pb-16",
                GUTTER,
            )}
        >
            {/* From lg up the copy keeps to the left ~62% so the screenshot
                never overlaps it. */}
            <div className="flex flex-col gap-6 py-10 lg:w-[65%] lg:py-16 xl:min-h-[480px]">
                <h1
                    className={cn(
                        REVEAL,
                        "text-[44px] font-medium leading-[1.04] tracking-[-1.1px] md:text-[56px] md:tracking-[-1.4px] lg:text-[min(72px,5vw)] lg:tracking-[-0.025em]",
                    )}
                    style={{ animationDelay: "120ms" }}
                >
                    Confidential
                    <br />
                    <span className="font-light">treasury management</span>
                    <br />
                    for crypto-native finance teams
                </h1>
                <p
                    className={cn(
                        REVEAL,
                        "max-w-[650px] text-lg leading-[1.55]",
                    )}
                    style={{ animationDelay: "180ms" }}
                >
                    Unify your team&apos;s finances, run payroll, allocate
                    capital, and swap across 35+ chains from a single dashboard.
                    Multisig approvals, your keys, your terms.
                </p>
                {/* Uncapped on purpose: the design sets this caption on one
                    line and only lets it wrap once the column runs out. */}
                <p
                    className={cn(REVEAL, "text-xs leading-normal")}
                    style={{ animationDelay: "240ms" }}
                >
                    One dashboard for confidential balances, approvals,
                    payments, and swaps across every chain you hold assets on.
                </p>
            </div>
            <div
                className={cn(REVEAL, "xl:pt-4")}
                style={{ animationDelay: "300ms" }}
            >
                <EarlyAccessButton className="h-12 w-full max-w-[229px] px-8 text-base sm:w-auto" />
            </div>
            {/* Sized as a share of the hero (981/1440 wide, starting at
                920/1440) so it scales with the viewport and bleeds off the
                right edge like the design; below lg it drops into the flow.
                The render carries its own dark bezel, so there is no CSS
                frame around it. */}
            <div
                className={cn(
                    REVEAL,
                    "lg:absolute lg:left-[63.9%] lg:top-[111px] lg:w-[68.125%]",
                )}
                style={{ animationDelay: "420ms" }}
            >
                <Image
                    src="/landing/dashboard.png"
                    alt="NEAR Business dashboard showing balances, pending requests and recent transactions"
                    width={3924}
                    height={2452}
                    priority
                    sizes="(min-width: 1440px) 981px, (min-width: 1024px) 68vw, 100vw"
                    className="h-auto w-full"
                />
            </div>
        </section>
    );
}

export function ProofGrid() {
    return (
        <section className="relative z-10 bg-landing-ink">
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-2 gap-y-10 px-6 py-12 text-center md:px-12 lg:grid-cols-4 xl:px-32">
                {PROOF_STATS.map(({ value, label }, index) => {
                    // The trailing "+" holds a flat 40px in the design while
                    // the figure itself scales with the viewport.
                    const figure = value.replace(/\+$/, "");
                    return (
                        <Reveal
                            key={label}
                            delayMs={index * 60}
                            className="flex flex-col items-center gap-2"
                        >
                            <p className="text-[48px] font-medium leading-[1.1] text-landing-paper md:text-[64px] xl:text-[72px]">
                                {figure}
                                {figure !== value && (
                                    <span className="text-[40px]">+</span>
                                )}
                            </p>
                            <p className="font-landing-mono text-xs uppercase leading-normal tracking-[0.72px] text-landing-green">
                                {label}
                            </p>
                        </Reveal>
                    );
                })}
            </div>
        </section>
    );
}
