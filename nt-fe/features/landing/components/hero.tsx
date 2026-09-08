import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BOOK_DEMO_HREF, NAV_LINKS, PROOF_STATS } from "../content";
import { NearBusinessWordmark } from "./landing-icons";

/** Horizontal page gutter: 120px at the 1440 design width, tighter below. */
export const GUTTER = "px-6 md:px-12 xl:px-[120px]";

export function BookDemoButton({
    className,
    ...props
}: Omit<React.ComponentProps<typeof Link>, "href">) {
    return (
        <Link
            href={BOOK_DEMO_HREF}
            className={cn(
                "inline-flex items-center justify-center rounded-full bg-landing-green font-medium leading-none text-landing-ink transition-colors hover:bg-[#00c97f]",
                className,
            )}
            {...props}
        >
            Book a demo
        </Link>
    );
}

export function LandingNav() {
    return (
        <header className="pt-6 md:pt-8">
            <div
                className={cn(
                    "mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-6",
                    GUTTER,
                )}
            >
                <Link href="/" aria-label="NEAR Business home">
                    <NearBusinessWordmark className="h-[21.79px] w-[187.5px]" />
                </Link>
                <nav className="hidden items-center gap-6 lg:flex">
                    {NAV_LINKS.map(({ label, href }) => (
                        <a
                            key={label}
                            href={href}
                            className="rounded-lg px-3 py-2 text-base leading-normal hover:bg-landing-ink/5"
                        >
                            {label}
                        </a>
                    ))}
                </nav>
                <div className="flex items-center gap-4">
                    <Link
                        href="/login"
                        className="whitespace-nowrap text-sm leading-normal hover:underline"
                    >
                        Sign in
                    </Link>
                    <BookDemoButton className="h-11 shrink-0 px-4 text-sm md:w-[140px] md:px-0" />
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
                <h1 className="text-[44px] font-medium leading-[1.04] tracking-[-1.1px] md:text-[56px] md:tracking-[-1.4px] lg:text-[min(72px,5vw)] lg:tracking-[-0.025em]">
                    Confidential
                    <br />
                    <span className="font-light">treasury management</span>
                    <br />
                    for crypto foundations
                </h1>
                <p className="max-w-[650px] text-lg leading-[1.55]">
                    Unify your foundation&apos;s capital, run payroll and
                    grants, and swap across 35+ chains from a single dashboard.
                    Multisig approvals, your keys, your terms.
                </p>
                <p className="max-w-[325px] text-xs leading-normal">
                    One dashboard for confidential balances, approvals,
                    payments, and swaps across every chain you hold assets on.
                </p>
            </div>
            <div className="xl:pt-4">
                <BookDemoButton className="h-12 w-full max-w-[229px] text-base" />
            </div>
            {/* Sized as a share of the hero (862/1440 wide, starting at
                920/1440) so it scales with the viewport and bleeds off the
                right edge like the design; below lg it drops into the flow. */}
            <div className="relative aspect-[862/613] w-full overflow-hidden rounded-[20px] border-8 border-landing-ink lg:absolute lg:left-[63.9%] lg:top-[79px] lg:w-[59.9%] lg:rounded-[max(12px,1.39vw)] lg:border-[max(5px,0.56vw)]">
                <Image
                    src="/landing/dashboard.png"
                    alt="NEAR Business dashboard showing balances, pending requests and recent transactions"
                    fill
                    priority
                    sizes="(min-width: 1440px) 862px, (min-width: 1024px) 60vw, 100vw"
                    className="object-cover object-left-top"
                />
            </div>
        </section>
    );
}

export function ProofGrid() {
    return (
        <section className="relative z-10 bg-landing-ink">
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-2 gap-y-10 px-6 py-12 text-center md:px-12 lg:grid-cols-4 xl:px-32">
                {PROOF_STATS.map(({ value, label }) => (
                    <div
                        key={label}
                        className="flex flex-col items-center gap-2"
                    >
                        <p className="text-[48px] font-medium leading-[1.1] text-landing-paper md:text-[64px] xl:text-[72px]">
                            {value}
                        </p>
                        <p className="font-landing-mono text-xs uppercase leading-normal tracking-[0.72px] text-landing-green">
                            {label}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}
