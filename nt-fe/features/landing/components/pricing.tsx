import {
    CoinsSwapIcon,
    Diamond01Icon,
    DropletIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import {
    BOOK_DEMO_HREF,
    COMPARISON_ROWS,
    INCLUDED_FEATURES,
    PRICING_CELLS,
} from "../content";
import { Tag } from "./confidential";
import { GUTTER } from "./hero";
import { CheckCircleIcon } from "./landing-icons";

const PRICING_ICONS = {
    diamond: Diamond01Icon,
    swap: CoinsSwapIcon,
    drop: DropletIcon,
} satisfies Record<
    (typeof PRICING_CELLS)[number]["icon"],
    typeof Diamond01Icon
>;

function MonoLabel({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <p
            className={cn(
                "font-landing-mono text-xs uppercase leading-normal tracking-[0.72px]",
                className,
            )}
        >
            {children}
        </p>
    );
}

export function Comparison() {
    return (
        <section className="mx-auto w-full max-w-[1440px] px-4 py-12 md:p-12 lg:p-16">
            <div className="rounded-3xl bg-landing-paper p-6 md:p-10 lg:p-16">
                <h2 className="text-center text-[40px] font-light leading-[1.1] tracking-[-1px] text-landing-ink md:text-[56px] md:tracking-[-1.4px] xl:text-[72px] xl:tracking-[-1.8px]">
                    <span className="block font-medium">
                        Advanced treasury control
                    </span>
                    without enterprise prices or custody risk.
                </h2>
                {/* Column geometry follows the Figma table: 415 / 400 / 369 of
                    1184, the label cell inset 49px and the other two flush to
                    their column. Only the outer columns carry row rules; the
                    highlighted column is separated by its own fill. */}
                {/* The horizontal scroller computes overflow-y to `auto`, so
                    the highlight fill's 15px overhang is carried as padding
                    here — inside the clip box — instead of being clipped. */}
                <div className="mt-[57px] overflow-x-auto pt-[15px]">
                    <div className="relative min-w-[720px] pb-14">
                        <div
                            aria-hidden
                            className="absolute -top-[15px] bottom-0 left-[32.35%] w-[34.46%] rounded-2xl bg-landing-mist"
                        />
                        <table className="relative w-full table-fixed border-separate border-spacing-0">
                            <colgroup>
                                <col className="w-[35.05%]" />
                                <col className="w-[33.78%]" />
                                <col />
                            </colgroup>
                            <thead>
                                <tr className="h-[72px] align-top">
                                    <th />
                                    <th className="pt-4 pl-6 text-left text-2xl font-normal leading-[1.3] text-landing-ink lg:text-[30px]">
                                        NEAR Business
                                    </th>
                                    <th className="pt-5 text-left text-xl font-normal leading-[1.3] text-landing-grey lg:text-2xl">
                                        Enterprise custody platforms
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_ROWS.map(
                                    ({ label, nearBusiness, enterprise }) => (
                                        <tr key={label} className="h-[58px]">
                                            <td className="border-t border-landing-mist pr-6 align-middle text-landing-grey lg:pl-[49px]">
                                                <MonoLabel>{label}</MonoLabel>
                                            </td>
                                            <td className="pl-6 pr-6 align-middle text-lg leading-[1.55] text-landing-ink">
                                                <span className="flex items-center gap-4">
                                                    <CheckCircleIcon className="size-6 shrink-0" />
                                                    {nearBusiness}
                                                </span>
                                            </td>
                                            <td className="border-t border-landing-mist align-middle text-lg leading-[1.55] text-landing-grey">
                                                {enterprise}
                                            </td>
                                        </tr>
                                    ),
                                )}
                            </tbody>
                        </table>
                        {/* The footnote lives inside the highlighted column, so
                            it shares the column offset and stretches the fill
                            past the last row. */}
                        <p className="relative ml-[32.35%] mt-[88px] w-[34.46%] px-6 text-center text-[13px] leading-[1.55] text-landing-ink">
                            Free includes 1,000 sponsored actions a month.
                            <br />
                            We cover the gas. Swap fee 0.70%.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

export function Pricing() {
    return (
        // The band carries its own gradient — white at the top, sliding into
        // the mint-grey the design ends on — so it bleeds past the 1440 frame.
        <section
            id="pricing"
            className="bg-[linear-gradient(360deg,#A6B9B3_0%,#FFFFFF_99.95%)]"
        >
            <div
                className={cn(
                    "mx-auto w-full max-w-[1440px] py-16 lg:py-24",
                    GUTTER,
                )}
            >
                <h2 className="text-[32px] font-medium leading-none lg:text-[40px]">
                    Transparent fees, always.
                </h2>
                <p className="mt-4 text-base leading-normal">
                    No subscriptions. No hidden charges. Pay only for what you
                    use.
                </p>
                <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3 lg:mt-16 lg:gap-8">
                    {PRICING_CELLS.map(({ label, icon, price, unit, body }) => (
                        <div
                            key={label}
                            className="flex min-h-[255px] flex-col rounded-[12px] bg-landing-paper px-8 pt-10 pb-8"
                        >
                            <div className="flex h-12 items-start justify-between">
                                <MonoLabel className="text-landing-grey">
                                    {label}
                                </MonoLabel>
                                <Icon
                                    icon={PRICING_ICONS[icon]}
                                    strokeWidth={1.25}
                                    className="size-12 text-landing-green"
                                />
                            </div>
                            <p className="mt-[10px] text-[48px] leading-[1.04] lg:text-[64px]">
                                {price}
                                {/* The unit rides at half the figure's size on
                                    its baseline, as in the design. */}
                                {unit && (
                                    <span className="text-[24px] lg:text-[32px]">
                                        {unit}
                                    </span>
                                )}
                            </p>
                            <p className="mt-2 text-sm leading-normal text-landing-grey">
                                {body.map((line) => (
                                    <span key={line} className="block">
                                        {line}
                                    </span>
                                ))}
                            </p>
                        </div>
                    ))}
                </div>
                <div className="mt-12 lg:mt-16">
                    <MonoLabel>Everything included</MonoLabel>
                    <div className="mt-6 flex max-w-[1200px] flex-wrap gap-3">
                        {INCLUDED_FEATURES.map((feature) => (
                            <Tag key={feature}>{feature}</Tag>
                        ))}
                    </div>
                </div>
                <p className="mt-12 text-center text-base leading-normal text-landing-grey lg:mt-16">
                    Enterprise or custom volume?{" "}
                    <Link
                        href={BOOK_DEMO_HREF}
                        className="font-medium text-landing-ink underline underline-offset-4"
                    >
                        Book a demo
                    </Link>
                </p>
            </div>
        </section>
    );
}
