"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Icon } from "@/components/icon";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    APP_DOCS_URL,
    DATA_PROCESSING_HREF,
    PRIVACY_POLICY_HREF,
    TERMS_OF_SERVICE_HREF,
} from "@/constants/config";
import { CONTACT_HREF, FAQ_ITEMS } from "../content";
import { EarlyAccessButton } from "./hero";
import { NearBusinessWordmark } from "./landing-icons";
import { Reveal } from "./reveal";

export function WorksWith() {
    return (
        <section className="border-t border-landing-ink/10">
            {/* From lg the copy sits beside the title with their last lines
                on one baseline, centred in the band, as in the design. */}
            <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-6 py-16 md:px-12 lg:flex-row lg:items-baseline-last lg:py-18 xl:px-32">
                <Reveal className="lg:shrink-0">
                    <h2 className="text-[40px] font-light leading-[1.12] lg:text-[60px]">
                        Your treasury <br className="hidden lg:inline" />
                        <span className="font-medium">
                            isn&apos;t the last stop.
                        </span>
                    </h2>
                </Reveal>
                <Reveal delayMs={80} className="leading-normal lg:flex-1">
                    <p className="text-2xl font-medium">
                        Audit-ready exports fit the reporting stack you already
                        run.
                    </p>
                    <p className="mt-0.5 text-base font-normal">
                        Your accountants, your auditors, your board pack — fed
                        from one record. And your auditors don&apos;t have to
                        trust our logs: the chain is the audit log, verifiable
                        by construction.
                    </p>
                </Reveal>
            </div>
        </section>
    );
}

export function Faq() {
    return (
        <section className="mx-auto w-full max-w-[1440px] px-6 py-16 md:px-12 lg:py-32 xl:px-32">
            <Reveal>
                <h2 className="text-[40px] font-light leading-[1.12] text-landing-ink lg:text-[64px]">
                    FAQs about{" "}
                    <span className="font-medium">NEAR Business</span>
                </h2>
            </Reveal>
            <div className="mt-8">
                {FAQ_ITEMS.map(({ question, answer }, index) => (
                    <Reveal key={question} delayMs={index * 60}>
                        {/* On desktop the answer opens beside the question: the
                            trigger spans the whole row as a subgrid and the
                            content overlays its middle column. */}
                        <Collapsible className="group border-b border-landing-ink/15 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,580px)_auto] lg:gap-x-6">
                            <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left lg:col-span-full lg:row-start-1 lg:grid lg:grid-cols-subgrid lg:items-start lg:px-2 lg:py-8">
                                <span className="text-xl font-light leading-[1.3] group-data-[state=open]:font-medium lg:col-span-2 lg:text-[30px] lg:group-data-[state=open]:col-span-1">
                                    {question}
                                </span>
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-landing-ink transition-transform duration-200 group-data-[state=open]:rotate-45 lg:col-start-3">
                                    <Icon
                                        icon={PlusSignIcon}
                                        strokeWidth={1.5}
                                        className="size-5"
                                    />
                                </span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="max-w-[880px] pb-6 text-base leading-normal lg:col-start-2 lg:row-start-1 lg:py-8">
                                {answer}
                            </CollapsibleContent>
                        </Collapsible>
                    </Reveal>
                ))}
            </div>
        </section>
    );
}

const FOOTER_COLUMNS = [
    {
        heading: "Product",
        links: [
            { label: "Product", href: "/#product" },
            { label: "Security", href: "/#security" },
            { label: "Docs", href: APP_DOCS_URL },
        ],
    },
    {
        heading: "Company",
        links: [
            { label: "Contact", href: CONTACT_HREF },
            { label: "Sign in", href: "/login" },
        ],
    },
] as const;

export function Footer() {
    return (
        <footer className="bg-landing-ink text-landing-paper">
            <div className="mx-auto w-full max-w-[1457px] p-6 md:p-16">
                <Reveal className="flex flex-col gap-10 lg:flex-row lg:justify-between">
                    <div className="lg:w-[600px]">
                        <h2 className="text-[40px] font-light leading-[1.04] lg:text-[64px]">
                            See it with{" "}
                            <span className="font-medium">your own</span>
                            <br className="hidden lg:inline" /> treasury
                            structure.
                        </h2>
                        <p className="mt-4 text-lg leading-[1.55]">
                            <span className="text-landing-green">
                                A 30-minute walkthrough
                            </span>{" "}
                            with your actual signer setup and chains.
                        </p>
                    </div>
                    <div className="flex gap-10 lg:w-[214px] lg:gap-4">
                        {FOOTER_COLUMNS.map(({ heading, links }) => (
                            <div key={heading} className="lg:w-[99px]">
                                <p className="text-lg font-medium leading-none">
                                    {heading}
                                </p>
                                <ul className="mt-3 flex flex-col text-sm leading-[1.8] text-landing-paper/70">
                                    {links.map(({ label, href }) => (
                                        <li key={label}>
                                            <Link
                                                href={href}
                                                className="transition-colors hover:text-landing-green"
                                                {...(href === APP_DOCS_URL
                                                    ? {
                                                          target: "_blank",
                                                          rel: "noopener noreferrer",
                                                      }
                                                    : {})}
                                            >
                                                {label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </Reveal>

                <Reveal className="mt-10 flex flex-col gap-10 lg:mt-[50px] lg:flex-row lg:justify-between">
                    <div>
                        <EarlyAccessButton className="h-12 w-full max-w-[229px] px-8 text-base sm:w-auto" />
                        <p className="mt-8 text-sm leading-[1.2]">
                            We respond within one business day. No commitment.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs leading-[1.2] text-landing-paper/50">
                        <Link
                            href={TERMS_OF_SERVICE_HREF}
                            className="hover:underline"
                        >
                            Terms of Use
                        </Link>
                        <Link
                            href={PRIVACY_POLICY_HREF}
                            className="hover:underline"
                        >
                            Privacy Policy
                        </Link>
                        <Link
                            href={DATA_PROCESSING_HREF}
                            className="hover:underline"
                        >
                            Data Processing Addendum
                        </Link>
                    </div>
                </Reveal>

                <Reveal>
                    <NearBusinessWordmark className="mt-10 h-auto w-full text-landing-grey" />
                </Reveal>
            </div>
        </footer>
    );
}
