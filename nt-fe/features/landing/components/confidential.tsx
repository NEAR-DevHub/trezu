import {
    CONFIDENTIAL_TAGS,
    NEAR_BUSINESS_POINTS,
    PUBLIC_CHAIN_POINTS,
} from "../content";
import { CheckCircleIcon, EyeIcon, XCircleIcon } from "./landing-icons";

export function Tag({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex rounded-full border border-landing-ink px-4 py-1 font-landing-mono text-xs uppercase leading-normal tracking-[0.72px] whitespace-nowrap">
            {children}
        </span>
    );
}

function StateTag({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <EyeIcon className="size-4 shrink-0" />
            <span className="font-landing-mono text-xs uppercase leading-normal tracking-[0.96px]">
                {children}
            </span>
        </div>
    );
}

export function Confidential() {
    return (
        <section
            id="product"
            className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-16 px-6 py-16 md:px-12 lg:gap-20 lg:py-20"
        >
            <div className="flex w-full flex-col items-center gap-6">
                <h2 className="text-center text-[40px] font-medium leading-[1.04] tracking-[-1px] md:text-[56px] md:tracking-[-1.4px] xl:text-[72px] xl:tracking-[-1.8px]">
                    <span className="font-light">Private from the market</span>
                    <br />
                    Legible to your auditors
                </h2>
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {CONFIDENTIAL_TAGS.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                    ))}
                </div>
            </div>

            <div className="flex w-full flex-col items-center gap-6 lg:flex-row lg:justify-center lg:gap-0">
                <div className="flex w-full max-w-[592px] flex-col gap-8 rounded-2xl border border-landing-ink p-8 lg:-mr-[130px] lg:h-[419px] lg:w-[592px] lg:gap-10 lg:rounded-r-none lg:pb-[13px] lg:pl-[70px] lg:pr-10 lg:pt-[60px]">
                    <h3 className="text-[28px] font-medium leading-[1.12] lg:text-[30px]">
                        <span className="font-light">A wallet</span>
                        <br />
                        on a public chain
                    </h3>
                    <StateTag>Anyone watching your address</StateTag>
                    <ul className="flex flex-col gap-4">
                        {PUBLIC_CHAIN_POINTS.map((point) => (
                            <li
                                key={point}
                                className="flex items-center gap-2 text-[15px] leading-[1.55]"
                            >
                                <XCircleIcon className="size-4 shrink-0" />
                                {point}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="relative w-full max-w-[491px] rounded-3xl bg-landing-mist p-8 lg:h-[507px] lg:w-[491px] lg:pl-[88px] lg:pt-[101px]">
                    <h3 className="text-[32px] font-medium leading-[1.12] lg:text-[36px]">
                        <span className="font-light">The same treasury</span>
                        <br />
                        on NEAR Business
                    </h3>
                    <div className="mt-7">
                        <StateTag>Your signers, board and auditors</StateTag>
                    </div>
                    <ul className="mt-10 flex max-w-[342px] flex-col gap-4">
                        {NEAR_BUSINESS_POINTS.map((point) => (
                            <li
                                key={point}
                                className="flex items-center gap-2 text-[15px] leading-[1.55]"
                            >
                                <CheckCircleIcon className="size-6 shrink-0" />
                                {point}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="flex flex-col gap-10 leading-normal md:flex-row md:gap-20">
                <div className="flex flex-col gap-0.5 md:w-[372px]">
                    <p className="text-base font-medium">
                        Every wallet on a public chain is readable by anyone.
                    </p>
                    <p className="text-[13px]">
                        Your balances, your payroll and your counterparties sit
                        in the open, visible to competitors, markets and anyone
                        watching your address.
                    </p>
                </div>
                <div className="flex flex-col gap-0.5 md:w-[372px]">
                    <p className="text-base font-medium">
                        NEAR Business treasuries are confidential
                    </p>
                    <p className="text-[13px]">
                        from the moment they are created, with selective
                        disclosures for the people accountable for it: your
                        members, your board, and your auditors.
                    </p>
                </div>
            </div>

            <div className="flex flex-col items-center text-center">
                <p className="max-w-[760px] text-[28px] leading-[1.1] lg:text-[36px]">
                    Confidentiality is about controlling who can watch your
                    operations, not about hiding them.
                </p>
                <p className="mt-8 max-w-[900px] text-base leading-normal lg:mt-12">
                    Run payroll without exposing who you pay, how much, or when.
                    Send assets to dozens of recipients in a single batch. Every
                    payment generates a confidential receipt for your records,
                    visible only to your team and never to a block explorer.
                </p>
            </div>
        </section>
    );
}
