"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import Link from "next/link";
import {
    createContext,
    type FormEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useId,
    useState,
} from "react";
import { PRIVACY_POLICY_HREF } from "@/constants/config";
import {
    type EarlyAccessAttribution,
    submitEarlyAccessRequest,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { BUSINESS_TYPE_OPTIONS, REFERRAL_SOURCE_OPTIONS } from "../content";
import { NearMark } from "./landing-icons";

const EarlyAccessContext = createContext<(() => void) | null>(null);

/**
 * Opens the early-access form. Every CTA on the landing — the nav button, the
 * hero button and the pricing footnote — shares one modal instance, so the
 * state lives on the provider rather than on each trigger.
 */
export function useRequestEarlyAccess() {
    const open = useContext(EarlyAccessContext);
    if (!open) {
        throw new Error(
            "useRequestEarlyAccess must be used inside <EarlyAccessProvider>",
        );
    }
    return open;
}

export function EarlyAccessProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const [attribution, setAttribution] = useState<EarlyAccessAttribution>({});

    // Read on mount rather than on submit: a visitor who steps out to the
    // privacy policy and back would otherwise arrive with the campaign tags
    // and the original referrer already gone.
    useEffect(() => setAttribution(readAttribution()), []);

    return (
        <EarlyAccessContext.Provider value={open}>
            {children}
            <EarlyAccessModal
                open={isOpen}
                onOpenChange={setIsOpen}
                attribution={attribution}
            />
        </EarlyAccessContext.Provider>
    );
}

/** Long enough for any real campaign tag, short enough not to be a payload. */
const MAX_ATTRIBUTION_LENGTH = 256;

function capped(value: string | undefined) {
    return value?.slice(0, MAX_ATTRIBUTION_LENGTH) || undefined;
}

/**
 * Only the parts of the URL this page chose. The full href and the raw
 * referrer are deliberately never sent: both routinely carry a querystring or
 * fragment the visitor has no idea they are handing over — an OAuth `code`, a
 * password-reset `token`, a CRM's `utm_email` — and everything here is stored
 * verbatim as CRM free text and passes through our logs and Sentry on the way.
 * The named `utm_*` keys are the only query values we read, and even those are
 * length-capped because they are attacker-supplied strings.
 */
function readAttribution(): EarlyAccessAttribution {
    const params = new URLSearchParams(window.location.search);
    const tag = (key: string) => capped(params.get(key) ?? undefined);

    return {
        utmSource: tag("utm_source"),
        utmMedium: tag("utm_medium"),
        utmCampaign: tag("utm_campaign"),
        utmTerm: tag("utm_term"),
        utmContent: tag("utm_content"),
        referrer: readReferrer(),
        // Path only — no search, and no hash, which is where implicit OAuth
        // flows put their tokens.
        landingPage: capped(window.location.pathname),
    };
}

/** Which site sent them, not which page of it and not with what attached. */
function readReferrer() {
    if (!document.referrer) return undefined;

    try {
        const referrer = new URL(document.referrer);
        // Our own pages say nothing about where the visitor came from.
        if (referrer.origin === window.location.origin) return undefined;
        return capped(referrer.host);
    } catch {
        return undefined;
    }
}

/** The landing's primary CTA, in the nav, the hero and the closing block. */
export function EarlyAccessButton({
    className,
    ...props
}: Omit<React.ComponentProps<"button">, "children" | "onClick" | "type">) {
    const requestEarlyAccess = useRequestEarlyAccess();

    return (
        <button
            type="button"
            onClick={requestEarlyAccess}
            className={cn(
                "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-landing-green font-medium leading-none text-landing-ink transition-colors hover:bg-[#00c97f]",
                className,
            )}
            {...props}
        >
            Request Early Access
        </button>
    );
}

/** The same trigger set inline in a sentence, where the CTA reads as a link. */
export function EarlyAccessLink({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    const requestEarlyAccess = useRequestEarlyAccess();

    return (
        <button
            type="button"
            onClick={requestEarlyAccess}
            className={className}
        >
            {children}
        </button>
    );
}

/**
 * Nine stacked rows make the form the tallest thing in the modal, and a 16:9
 * laptop leaves it around 600px of viewport once browser chrome is out. So the
 * vertical rhythm is measured in `dvh` between a floor and the design's own
 * value: full spacing wherever there is room for it, tightened just enough
 * below that to keep the whole form on screen instead of behind a scrollbar.
 * Horizontal metrics are untouched — only height is ever in short supply.
 */
const FIELD_HEIGHT = "h-[clamp(2.375rem,5.4dvh,3rem)]";
const ROW_GAP = "gap-[clamp(0.75rem,2.4dvh,1.5rem)]";
const BLOCK_GAP = "mt-[clamp(0.875rem,2.6dvh,1.75rem)]";
// Same value, spelled out again: Tailwind reads class names out of the source
// text, so a variant cannot be prefixed onto one at runtime.
const BLOCK_GAP_LG = "lg:mt-[clamp(0.875rem,2.6dvh,1.75rem)]";
const COLUMN_PADDING = "py-[clamp(1.25rem,3.6dvh,2.5rem)]";

/** 420x48 fields from the design: 1px hairline, transparent so the field
 *  picks up whichever card background the breakpoint is using. */
const FIELD = cn(
    FIELD_HEIGHT,
    "w-full rounded-xl border border-landing-grey-light bg-transparent px-5 text-base leading-none text-landing-ink outline-none transition-colors placeholder:text-landing-grey-light focus:border-landing-ink",
);

function EarlyAccessModal({
    open,
    onOpenChange,
    attribution,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    attribution: EarlyAccessAttribution;
}) {
    const titleId = useId();

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-landing-ink/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
                {/* The portal escapes the landing wrapper, so the palette and
                    the display font have to be re-declared here. */}
                <DialogPrimitive.Content
                    aria-labelledby={titleId}
                    className={cn(
                        "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto lg:max-w-[1068px]",
                        "rounded-2xl bg-white font-landing text-landing-ink antialiased shadow-2xl",
                        "lg:bg-landing-paper lg:p-[clamp(0.625rem,1.7dvh,1rem)]",
                        "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
                    )}
                >
                    <div className="lg:grid lg:grid-cols-[1fr_minmax(0,504px)] lg:gap-0">
                        <div
                            className={cn(
                                "relative flex flex-col px-6 sm:px-10 lg:px-12 lg:pr-16",
                                COLUMN_PADDING,
                            )}
                        >
                            <DialogPrimitive.Close
                                aria-label="Close"
                                className="absolute right-5 top-5 rounded-full p-1 text-landing-ink transition-colors hover:bg-landing-ink/5 sm:right-8 sm:top-8 lg:right-8 lg:top-[clamp(1.25rem,3.6dvh,2.5rem)]"
                            >
                                <CloseGlyph />
                            </DialogPrimitive.Close>
                            <NearMark className="hidden size-6 lg:block" />
                            <DialogPrimitive.Title
                                id={titleId}
                                className={cn(
                                    "pr-10 text-[28px] font-medium leading-[1.15] tracking-[-0.5px] sm:text-[32px] lg:text-2xl lg:tracking-[-0.25px]",
                                    BLOCK_GAP_LG,
                                )}
                            >
                                Request Early Access
                            </DialogPrimitive.Title>
                            <EarlyAccessForm attribution={attribution} />
                        </div>
                        {/* Decorative, and the tallest thing in the modal —
                            phones drop it rather than scroll past it. */}
                        <div className="relative hidden lg:block">
                            <Image
                                src="/landing/early-access.jpg"
                                alt=""
                                fill
                                sizes="504px"
                                className="rounded-xl object-cover"
                            />
                        </div>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/**
 * Telegram is the only optional field, so everything else is `required`. That
 * makes "is the form complete" exactly the browser's own validity check — one flag off `checkValidity()` rather than a piece of state per
 * input. The dialog unmounts its content on close, which resets the fields,
 * this flag and the submission state together.
 */
function EarlyAccessForm({
    attribution,
}: {
    attribution: EarlyAccessAttribution;
}) {
    const consentId = useId();
    const [isComplete, setIsComplete] = useState(false);
    const [status, setStatus] = useState<
        "idle" | "submitting" | "failed" | "sent"
    >("idle");

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const value = (field: string) => String(fields.get(field) ?? "").trim();

        setStatus("submitting");
        try {
            await submitEarlyAccessRequest({
                name: value("name"),
                company: value("company"),
                email: value("email"),
                telegram: value("telegram") || undefined,
                businessType: value("businessType"),
                referralSource: value("referralSource"),
                consent: fields.has("consent"),
                attribution,
            });
            setStatus("sent");
        } catch {
            setStatus("failed");
        }
    }

    if (status === "sent") {
        return (
            // The form it replaces held the focus, so a screen reader is left
            // pointing at nothing — announce the confirmation instead.
            <output
                aria-live="polite"
                className={cn(
                    BLOCK_GAP,
                    "block text-base leading-snug text-landing-grey",
                )}
            >
                Thanks — your request is in. We&apos;ll get in touch at the
                email address you gave us.
            </output>
        );
    }

    return (
        // Fields are uncontrolled: `FormData` reads them on submit, and the
        // dialog throws them away on close.
        <form
            onSubmit={handleSubmit}
            onChange={(event) =>
                setIsComplete(event.currentTarget.checkValidity())
            }
            className={cn("flex flex-col", BLOCK_GAP, ROW_GAP)}
        >
            <input
                name="name"
                autoComplete="name"
                placeholder="Name"
                required
                className={FIELD}
            />
            <input
                name="company"
                autoComplete="organization"
                placeholder="Company"
                required
                className={FIELD}
            />
            <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email"
                required
                className={FIELD}
            />
            <input name="telegram" placeholder="Telegram" className={FIELD} />
            <SelectField
                name="businessType"
                placeholder="Vertical / Type of Business"
                options={BUSINESS_TYPE_OPTIONS}
            />
            <SelectField
                name="referralSource"
                placeholder="How did you hear about NEAR Business?"
                options={REFERRAL_SOURCE_OPTIONS}
            />
            <div className="flex items-start gap-3">
                <Consent id={consentId} />
                <label
                    htmlFor={consentId}
                    className="text-xs leading-[1.35] text-landing-grey"
                >
                    I agree to the{" "}
                    <Link
                        href={PRIVACY_POLICY_HREF}
                        target="_blank"
                        className="underline underline-offset-2 hover:text-landing-ink"
                    >
                        Privacy Policy
                    </Link>{" "}
                    and consent to the processing of my personal data in
                    accordance with applicable data protection regulations.
                </label>
            </div>
            {/* The failure notice shares the button's row rather than taking
                one of its own, so a retry never costs the form its fit. */}
            <div className="mt-1 flex items-center justify-end gap-4">
                {status === "failed" && (
                    <p
                        role="alert"
                        className="mr-auto text-xs leading-[1.35] text-[#c8412f]"
                    >
                        Something went wrong. Please try again.
                    </p>
                )}
                <button
                    type="submit"
                    disabled={!isComplete || status === "submitting"}
                    className="shrink-0 cursor-pointer rounded-full bg-landing-green px-4 py-3 text-base font-medium leading-none text-landing-ink transition-colors enabled:hover:bg-[#00c97f] disabled:cursor-not-allowed disabled:bg-landing-mist disabled:text-landing-grey-light"
                >
                    {status === "submitting" ? "Submitting…" : "Submit"}
                </button>
            </div>
        </form>
    );
}

/**
 * Native `<select>` rather than the app's Radix one: the landing carries its
 * own palette, and a portalled listbox would need all of it restated. The
 * placeholder stays in the list as an empty option, which `required` treats as
 * "nothing chosen"; the value is tracked so it can be greyed the way the text
 * fields grey theirs.
 */
function SelectField({
    name,
    placeholder,
    options,
}: {
    name: string;
    placeholder: string;
    options: readonly string[];
}) {
    const [value, setValue] = useState("");

    return (
        <div className="relative">
            <select
                name={name}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label={placeholder}
                required
                className={cn(
                    FIELD,
                    // Native selects clip rather than wrap, so the long
                    // referral placeholder drops a size on narrow phones.
                    "cursor-pointer appearance-none pr-11 max-sm:text-[13px]",
                    !value && "text-landing-grey-light",
                )}
            >
                <option value="">{placeholder}</option>
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
            <ChevronGlyph className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
        </div>
    );
}

/** Green hairline square with a tick, per the design — the themed app
 *  checkbox would drag in the dashboard palette. */
function Consent({ id }: { id: string }) {
    return (
        <span className="relative mt-0.5 inline-flex shrink-0">
            <input
                id={id}
                type="checkbox"
                name="consent"
                required
                // `appearance-none` takes the browser's focus ring with it,
                // and this is the one control a keyboard user must find to
                // enable the submit button.
                className="peer size-4 cursor-pointer appearance-none rounded-[3px] border border-landing-green bg-transparent checked:bg-landing-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-ink"
            />
            <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className="pointer-events-none absolute inset-0 hidden size-4 text-landing-ink peer-checked:block"
            >
                <path
                    d="M4 8.4 6.8 11 12 5.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </span>
    );
}

function ChevronGlyph({ className }: { className?: string }) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className={cn("size-4", className)}
        >
            <path
                d="m3.5 6 4.5 4.5L12.5 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function CloseGlyph() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="size-4"
        >
            <path
                d="m3 3 10 10M13 3 3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}
