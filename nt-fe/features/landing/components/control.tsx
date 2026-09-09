"use client";

import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import {
    BUILT_FOR,
    CAPABILITIES,
    CONTROL_CARDS,
    chainIconUrl,
    MARQUEE_CHAINS,
} from "../content";
import { Tag } from "./confidential";
import { NearMark } from "./landing-icons";

/** "Every movement passes the rules you set" — photo split with floating copy. */
export function ControlSplit() {
    return (
        <section
            id="security"
            className="relative mx-auto w-full max-w-[1440px] overflow-hidden px-6 py-12 md:px-12 lg:p-16"
        >
            {/* The photo scales with the section width at its own aspect
                ratio and fades into the page colour where it ends, so the
                stacked content below lg sits on paper rather than a zoomed
                crop. */}
            <div
                aria-hidden
                className="absolute inset-x-0 top-0 aspect-[1440/1000] overflow-hidden"
            >
                <Image
                    src="/landing/control-bg.jpg"
                    alt=""
                    fill
                    sizes="(min-width: 1440px) 1440px, 100vw"
                    className="object-cover"
                />
                <div className="absolute bottom-0 left-0 h-[25%] w-full bg-gradient-to-b from-landing-paper/0 to-landing-paper backdrop-blur-[2px]" />
            </div>

            {/* The heading keeps to a ~400px column so it breaks over four
                lines like the design and leaves the portrait uncovered. */}
            <div className="relative flex flex-col items-start gap-4 lg:mt-20 lg:w-[400px]">
                <Tag>Control</Tag>
                <h2 className="text-[44px] leading-[1.12] tracking-[-1.1px] md:text-[56px] lg:text-[64px] lg:tracking-[-1.6px]">
                    <span className="font-light">Every movement passes </span>
                    <span className="font-medium">the rules you set.</span>
                </h2>
            </div>

            {/* The cards sit near the foot of the portrait, so from lg the gap
                tracks the photo's height rather than staying fixed. Their copy
                is pushed down by a fixed top padding instead of being bottom
                aligned, so every title sits on the same line whatever the
                length of the body beneath it. */}
            <div className="relative mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-[min(290px,20vw)] lg:grid-cols-4">
                {CONTROL_CARDS.map(({ title, body }) => (
                    <div
                        key={title}
                        className="flex flex-col rounded-2xl bg-white/20 p-4 sm:min-h-[180px] sm:pt-14"
                    >
                        <p className="text-2xl font-medium leading-normal">
                            {title}
                        </p>
                        <p className="mt-2 text-base font-normal leading-normal">
                            {body}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}

/** Numbered capability list; one item open at a time, like the design. */
export function Capabilities() {
    const [openIndex, setOpenIndex] = useState(0);

    return (
        <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-12 px-6 py-16 md:px-12 lg:flex-row lg:gap-20 lg:pl-16 lg:pr-32">
            {/* The render is landscape, so the portrait tile centre-crops it;
                below lg the tile goes full width and shows more of the frame. */}
            <div className="relative h-[280px] w-full shrink-0 overflow-hidden rounded-3xl bg-landing-mist lg:h-[415px] lg:w-[379px]">
                <Image
                    src="/landing/near-glass.jpg"
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 379px, 100vw"
                    className="object-cover"
                />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
                <h2 className="text-[32px] font-medium leading-none lg:text-[40px]">
                    The full operating surface
                    <br />
                    of a treasury desk
                </h2>
                <ol className="flex flex-col">
                    {CAPABILITIES.map(({ title, body }, index) => {
                        const isOpen = index === openIndex;
                        return (
                            <li
                                key={title}
                                className={cn(
                                    index > 0 &&
                                        "border-t border-landing-grey-light",
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={() => setOpenIndex(index)}
                                    aria-expanded={isOpen}
                                    className={cn(
                                        "flex w-full cursor-pointer items-baseline gap-4 py-5 text-left font-medium transition-colors lg:py-6",
                                        isOpen
                                            ? "text-landing-ink"
                                            : "text-landing-grey-light hover:text-landing-grey",
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "text-sm leading-normal",
                                            isOpen && "text-landing-grey",
                                        )}
                                    >
                                        {String(index + 1).padStart(2, "0")}
                                    </span>
                                    <span className="text-2xl leading-[1.3] tracking-[-0.6px] lg:text-[30px] lg:tracking-[-0.75px]">
                                        {title}
                                    </span>
                                </button>
                                {isOpen && (
                                    <p className="-mt-4 pb-5 pl-[30px] text-base leading-normal text-landing-grey lg:-mt-5 lg:pb-6">
                                        {body}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </section>
    );
}

/**
 * "Manage BTC, ETH, SOL, NEAR and 35+ chains" — copy on the left, the
 * laptop/phone render bleeding to the right edge.
 *
 * From lg up the block keeps the design's 1440x609 proportions: the section
 * scales by aspect ratio, the render keeps its share of the width, and the
 * heading scales with the viewport so the copy never runs into the laptop.
 */
export function MultichainHeader() {
    return (
        <section className="relative mx-auto w-full max-w-[1440px] px-6 pb-6 pt-16 md:px-12 lg:aspect-[1440/609] lg:px-16 lg:pb-0 lg:pt-0">
            <div className="flex flex-col justify-between gap-12 lg:h-full lg:w-[46%] lg:gap-0 lg:py-[7.6%]">
                <h2 className="text-[36px] font-normal leading-[1.1] lg:text-[min(48px,3.33vw)]">
                    Manage BTC, ETH, SOL,{" "}
                    <span className="font-medium text-landing-green">NEAR</span>{" "}
                    and 35+ chains from a single dashboard.
                </h2>
                <p className="text-lg font-light leading-[1.24] lg:text-[min(24px,1.67vw)]">
                    Not just EVM networks.
                    <br />
                    No external bridges,
                    <br />
                    no chain-by-chain ops overhead.
                </p>
            </div>
            {/* The render is flush to its own edges, so it is sized to start
                just past the copy column instead of overlapping it. */}
            <div className="mt-2 lg:absolute lg:right-0 lg:top-0 lg:mt-0 lg:w-[50%] xl:w-[53%]">
                <Image
                    src="/landing/devices.png"
                    alt="The NEAR Business dashboard on a laptop and a phone"
                    width={1648}
                    height={1099}
                    sizes="(min-width: 1024px) 53vw, 100vw"
                    className="h-auto w-full"
                />
            </div>
        </section>
    );
}

function MarqueeRow({ reverse = false }: { reverse?: boolean }) {
    // The list is rendered twice so the loop is seamless at -50%.
    const copies = [
        { id: "a", chains: MARQUEE_CHAINS },
        { id: "b", chains: MARQUEE_CHAINS },
    ];
    return (
        <div
            className={cn(
                // The row is fixed at 30px, the tallest mark, so both rows sit
                // on the same baseline pitch without cropping anything.
                "flex h-[30px] w-max items-center",
                reverse
                    ? "animate-landing-marquee-reverse"
                    : "animate-landing-marquee",
            )}
        >
            {copies.map(({ id, chains }) =>
                chains.map((chain) => (
                    // biome-ignore lint/performance/noImgElement: a flat 1:1 mark, nothing for next/image to optimise.
                    <img
                        key={`${id}-${chain.slug}`}
                        src={chainIconUrl(chain)}
                        alt=""
                        aria-hidden
                        width={chain.width}
                        height={chain.height}
                        className="mr-10 shrink-0"
                    />
                )),
            )}
        </div>
    );
}

/** Chain marquee plus the "Built for" audience grid. */
export function Multichain() {
    return (
        <section className="mx-auto w-full max-w-[1440px] overflow-hidden pb-16 lg:pb-24">
            <div className="relative flex flex-col gap-[35px] pt-[13px]">
                <div className="w-full overflow-hidden">
                    <MarqueeRow />
                </div>
                <div className="w-full overflow-hidden">
                    <MarqueeRow reverse />
                </div>
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-[96px] bg-gradient-to-r from-landing-paper to-landing-paper/0 md:w-[255px]"
                />
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-[96px] bg-gradient-to-l from-landing-paper to-landing-paper/0 md:w-[255px]"
                />
            </div>

            <div className="px-6 md:px-12">
                <h2 className="mt-16 text-center text-[32px] leading-none lg:mt-[72px]">
                    Built for treasuries that run on a mandate
                </h2>
                <div className="mx-auto mt-12 grid w-full max-w-[1178px] grid-cols-1 gap-6 md:grid-cols-3 md:gap-8 lg:mt-16 lg:px-4 lg:pt-4">
                    {BUILT_FOR.map(({ title, body }) => (
                        <div
                            key={title}
                            className="min-h-[188px] rounded-[12px] border border-landing-grey bg-landing-paper px-8 py-8 text-landing-ink lg:pt-10"
                        >
                            <p className="text-lg font-medium leading-normal">
                                {title}
                            </p>
                            <p className="mt-3 text-base font-normal leading-normal">
                                {body}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

/**
 * The 675px statement band between the audience grid and the custody band:
 * the NEAR mark, the "Built on NEAR Intents" line and the headline, all
 * top-anchored on the mint gradient that bleeds past the 1440 frame.
 */
export function TreasuryStatement() {
    return (
        <section className="relative overflow-hidden">
            <Image
                src="/landing/statement-bg.png"
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
            />
            <div className="relative mx-auto flex w-full max-w-[1440px] flex-col items-center px-6 pb-24 pt-16 text-center md:px-12 lg:min-h-[675px] lg:pb-0 lg:pt-[70px]">
                <NearMark className="size-12" />
                <p className="mt-6 font-landing-mono text-xs uppercase leading-normal tracking-[0.72px]">
                    Built on NEAR Intents
                </p>
                <h2 className="mt-16 text-[44px] font-medium leading-[0.95] tracking-[-1.1px] md:text-[56px] md:tracking-[-1.4px] lg:mt-[104px] lg:text-[min(104px,7.2vw)] lg:tracking-[-0.025em]">
                    Your treasury should be
                    <br />
                    your business.
                </h2>
            </div>
        </section>
    );
}

export function CustodyTruth() {
    return (
        <section className="bg-landing-ink text-landing-paper">
            <div className="mx-auto flex w-full max-w-[1440px] flex-col px-6 pb-8 pt-8 md:px-12 xl:px-32">
                <p className="font-landing-mono text-xs uppercase leading-normal tracking-[0.72px] text-landing-green">
                    Self-custodial by architecture
                </p>
                <div className="mt-24 lg:mt-[176px]">
                    <p className="text-base font-normal leading-[1.2] text-landing-paper">
                        Funds move only on the signatures your organization
                        defines.
                    </p>
                    <p className="mt-4 text-[28px] leading-[1.1] lg:text-[36px]">
                        NEAR holds{" "}
                        <span className="font-medium text-landing-green lg:text-[40px]">
                            no key, no key share
                        </span>
                        , and maintains{" "}
                        <span className="font-medium text-landing-green lg:text-[40px]">
                            no technical capability
                        </span>{" "}
                        to initiate, alter, or reverse a transaction.
                    </p>
                </div>
                <div className="mt-24 flex min-h-12 flex-wrap items-center justify-between gap-4 border-t border-landing-grey-light py-3 lg:mt-[176px]">
                    <div className="flex items-center gap-2">
                        <Icon
                            icon={SecurityCheckIcon}
                            strokeWidth={1.5}
                            className="size-6 text-landing-green"
                        />
                        <span className="font-landing-mono text-xs font-normal uppercase leading-normal tracking-[0.72px] text-landing-paper">
                            Core contract audited by Valhalla Security.
                        </span>
                    </div>
                    <a
                        href="https://valhallasec.com"
                        target="_blank"
                        rel="noreferrer"
                        className="font-landing-mono text-xs uppercase leading-normal tracking-[0.72px] text-landing-green underline underline-offset-4"
                    >
                        Read the report
                    </a>
                </div>
            </div>
        </section>
    );
}
