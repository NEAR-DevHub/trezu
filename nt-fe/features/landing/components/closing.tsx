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
    PRIVACY_POLICY_HREF,
    TERMS_OF_SERVICE_HREF,
} from "@/constants/config";
import { CONTACT_HREF, FAQ_ITEMS } from "../content";
import { EarlyAccessButton } from "./hero";
import { NearBusinessWordmark } from "./landing-icons";

export function WorksWith() {
    return (
        <section className="border-t border-landing-ink/10">
            <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-6 py-16 md:px-12 lg:flex-row lg:pb-12 lg:pt-24 xl:px-32">
                <h2 className="text-[40px] font-light leading-[1.12] lg:shrink-0 lg:text-[60px]">
                    Your treasury <br className="hidden lg:inline" />
                    <span className="font-medium">
                        isn&apos;t the last stop.
                    </span>
                </h2>
                <div className="leading-normal lg:mt-5 lg:flex-1">
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
                </div>
            </div>
        </section>
    );
}

export function Faq() {
    return (
        <section className="mx-auto w-full max-w-[1440px] px-6 py-16 md:px-12 lg:py-32 xl:px-32">
            <h2 className="text-[40px] font-light leading-[1.12] text-landing-ink lg:text-[64px]">
                FAQs about <span className="font-medium">NEAR Business</span>
            </h2>
            <div className="mt-8">
                {FAQ_ITEMS.map(({ question, answer }) => (
                    <Collapsible
                        key={question}
                        className="group border-b border-landing-ink/15"
                    >
                        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left lg:py-8 lg:pl-2">
                            <span className="text-xl font-medium leading-[1.3] lg:text-[30px]">
                                {question}
                            </span>
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-landing-ink transition-transform duration-200 group-data-[state=open]:rotate-45">
                                <Icon
                                    icon={PlusSignIcon}
                                    strokeWidth={1.5}
                                    className="size-5"
                                />
                            </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="max-w-[880px] pb-6 text-base leading-normal text-landing-grey lg:pb-8 lg:pl-2">
                            {answer}
                        </CollapsibleContent>
                    </Collapsible>
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
            <div className="mx-auto w-full max-w-[1457px] p-6 md:p-10 xl:p-[60px]">
                <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
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
                                            >
                                                {label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-10 flex flex-col gap-10 lg:mt-[50px] lg:flex-row lg:justify-between">
                    <div>
                        <EarlyAccessButton className="h-12 w-full max-w-[229px] px-8 text-base sm:w-auto" />
                        <p className="mt-8 text-sm leading-[1.2]">
                            We respond within one business day. No commitment.
                        </p>
                    </div>
                    <div className="flex gap-4 text-xs leading-[1.2] text-landing-paper/50 lg:w-[214px]">
                        <Link
                            href={TERMS_OF_SERVICE_HREF}
                            className="lg:w-[99px] hover:underline"
                        >
                            Terms of Use
                        </Link>
                        <Link
                            href={PRIVACY_POLICY_HREF}
                            className="lg:w-[99px] hover:underline"
                        >
                            Privacy Policy
                        </Link>
                    </div>
                </div>

                <NearBusinessWordmark className="mt-10 h-auto w-full text-landing-grey" />
            </div>
        </footer>
    );
}
