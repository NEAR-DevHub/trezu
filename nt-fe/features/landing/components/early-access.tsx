"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import { isAxiosError } from "axios";
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
    useMemo,
    useState,
} from "react";
import { PRIVACY_POLICY_HREF } from "@/constants/config";
import {
    type EarlyAccessAttribution,
    submitEarlyAccessRequest,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    BUSINESS_TYPE_OPTIONS,
    EARLY_ACCESS_HREF,
    OTHER_OPTION,
    REFERRAL_SOURCE_OPTIONS,
} from "../content";
import { NearMark } from "./landing-icons";

/**
 * Where "Request Early Access" leads. Behind the `show_redesigned_modal` flag
 * it opens the in-page form; without it the CTAs are plain links to the
 * Airtable form, exactly as they were before the redesign.
 */
type EarlyAccessCta =
    | { kind: "modal"; open: () => void }
    | { kind: "external"; href: string };

const EarlyAccessContext = createContext<EarlyAccessCta | null>(null);

/**
 * How to request early access from here. Every CTA on the landing — the nav
 * button, the hero button and the pricing footnote — shares one modal
 * instance, so the state lives on the provider rather than on each trigger.
 */
export function useEarlyAccessCta() {
    const cta = useContext(EarlyAccessContext);
    if (!cta) {
        throw new Error(
            "useEarlyAccessCta must be used inside <EarlyAccessProvider>",
        );
    }
    return cta;
}

export function EarlyAccessProvider({
    showRedesignedModal = false,
    children,
}: {
    /** Set from `?show_redesigned_modal=true` on the landing. Off everywhere
     *  else, including the legal pages, which carry the same CTAs. */
    showRedesignedModal?: boolean;
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const [attribution, setAttribution] = useState<EarlyAccessAttribution>({});

    // Read on mount rather than on submit: a visitor who steps out to the
    // privacy policy and back would otherwise arrive with the campaign tags
    // and the original referrer already gone.
    useEffect(() => setAttribution(readAttribution()), []);

    const cta = useMemo<EarlyAccessCta>(
        () =>
            showRedesignedModal
                ? { kind: "modal", open }
                : { kind: "external", href: EARLY_ACCESS_HREF },
        [showRedesignedModal, open],
    );

    return (
        <EarlyAccessContext.Provider value={cta}>
            {children}
            {showRedesignedModal && (
                <EarlyAccessModal
                    open={isOpen}
                    onOpenChange={setIsOpen}
                    attribution={attribution}
                />
            )}
        </EarlyAccessContext.Provider>
    );
}

/** Long enough for any real campaign tag, short enough not to be a payload. */
const MAX_ATTRIBUTION_LENGTH = 256;

/** Long enough to name a vertical or a conference, short enough to read as a
 *  CRM value rather than as a paragraph. */
const MAX_OTHER_LENGTH = 100;

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
export function EarlyAccessButton({ className }: { className?: string }) {
    return (
        <EarlyAccessLink
            className={cn(
                "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-landing-green font-medium leading-none text-landing-ink transition-colors hover:bg-[#00c97f]",
                className,
            )}
        >
            Request Early Access
        </EarlyAccessLink>
    );
}

/**
 * The trigger itself, used bare where the CTA reads as a link inside a
 * sentence. A real anchor while the flag is off, so the Airtable form keeps
 * opening in a new tab on middle-click and on "open in new window" too; a
 * button once the in-page modal is what the CTA actually does.
 */
export function EarlyAccessLink({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    const cta = useEarlyAccessCta();

    if (cta.kind === "external") {
        return (
            <Link
                href={cta.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
            >
                {children}
            </Link>
        );
    }

    return (
        <button type="button" onClick={cta.open} className={className}>
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

/** Underlined fields, per the design: a single hairline under each one, no box
 *  and no inset, so the text of a field starts on the same margin as the copy
 *  above it. Transparent, so the field picks up whichever card background the
 *  breakpoint is using. */
const FIELD = cn(
    FIELD_HEIGHT,
    "w-full rounded-none border-0 border-b border-landing-grey-light bg-transparent text-base leading-none text-landing-ink outline-none transition-colors placeholder:text-landing-grey-light focus:border-landing-ink",
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
    // The card doubles as the boundary the open dropdowns are kept inside of.
    const [card, setCard] = useState<HTMLDivElement | null>(null);
    // Sent, the card is its own confirmation: no photograph, and none of the
    // room the form and its dropdowns needed.
    const [isSent, setIsSent] = useState(false);

    // Reopening is a fresh request, so the flag goes as `open` comes back up.
    // Dropped during the render that raises it rather than from an effect,
    // which would show the new form inside the narrow card for a frame first;
    // and on the way up rather than down, which would put the photograph back
    // behind the confirmation as the modal fades out.
    const [wasOpen, setWasOpen] = useState(open);
    if (wasOpen !== open) {
        setWasOpen(open);
        if (open) setIsSent(false);
    }

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-landing-ink/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
                {/* The portal escapes the landing wrapper, so the palette and
                    the display font have to be re-declared here. */}
                <DialogPrimitive.Content
                    ref={setCard}
                    aria-labelledby={titleId}
                    className={cn(
                        "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
                        // The wide card is the photograph's; the confirmation
                        // keeps the width a phone gives it at every size.
                        !isSent && "lg:max-w-[1320px]",
                        "rounded-2xl bg-white font-landing text-landing-ink antialiased shadow-2xl",
                        // No card padding: the photograph runs to the card's
                        // own rounded edge, which `overflow-y-auto` clips it to.
                        "lg:bg-landing-paper",
                        "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
                    )}
                >
                    {/* The picture's column is the fixed one: it has to stay wide
                        enough for the line over it to break after "should be",
                        so a narrow viewport takes it out of the form instead. */}
                    {/* A floor as well as the card's ceiling: the form is
                        shorter than the room a laptop has for it, and an open
                        dropdown needs somewhere to hang. Without it the card
                        ends just under the last row, and the list — which the
                        card's own `-translate` keeps captive — puts the whole
                        modal on a scrollbar as it opens. It sits on the grid
                        rather than the card so the photograph stretches to it
                        instead of leaving a band under itself. */}
                    <div
                        className={cn(
                            !isSent &&
                                "lg:grid lg:min-h-[min(48rem,calc(100dvh-2rem))] lg:grid-cols-[1fr_minmax(0,680px)] lg:gap-0",
                        )}
                    >
                        <div
                            className={cn(
                                "flex flex-col px-6 sm:px-10",
                                !isSent && "lg:px-16 lg:pr-20",
                                COLUMN_PADDING,
                            )}
                        >
                            <NearMark className="hidden size-6 lg:block" />
                            <DialogPrimitive.Title
                                id={titleId}
                                className={cn(
                                    "text-[28px] font-medium leading-[1.15] tracking-[-0.5px] sm:text-[32px] lg:text-2xl lg:tracking-[-0.25px]",
                                    BLOCK_GAP_LG,
                                )}
                            >
                                NEAR Business Early Access
                            </DialogPrimitive.Title>
                            {/* It says what submitting the form will do, so
                                it belongs with the form and not with the
                                confirmation that the form is gone. */}
                            {!isSent && <PrivacyNotice />}
                            <EarlyAccessForm
                                attribution={attribution}
                                card={card}
                                onSent={() => setIsSent(true)}
                            />
                        </div>
                        {/* The tallest thing in the modal — phones drop it
                            rather than scroll past it, and so does the
                            confirmation, which has nothing left to sell. The
                            photograph is the backdrop for the line, which is
                            set as real text, so the picture itself has nothing
                            to describe. */}
                        {!isSent && (
                            <div className="relative hidden lg:block">
                                <Image
                                    src="/landing/early-access.jpg"
                                    alt=""
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                                <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-[60px] font-normal leading-[1.12] text-[#333333] opacity-50">
                                    Your treasury should be your business.
                                </p>
                            </div>
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/**
 * What used to be a consent tickbox the visitor had to tick. The design turned
 * it into a notice: submitting the form is the act, and this says what the
 * submission will be used for. The remaining tickbox is the marketing opt-in,
 * which is genuinely optional.
 */
function PrivacyNotice() {
    return (
        <div
            className={cn(BLOCK_GAP, "text-xs leading-[1.35] text-landing-ink")}
        >
            <p className="font-medium">Privacy Notice.</p>
            <p>
                Intents Technology Ltd will use the information you provide to
                assess and respond to your early-access request and to
                administer our relationship with you. For more information about
                how we use and protect personal information, see our{" "}
                <Link
                    href={PRIVACY_POLICY_HREF}
                    target="_blank"
                    className="text-landing-link underline underline-offset-2"
                >
                    privacy policy
                </Link>
                .
            </p>
        </div>
    );
}

/**
 * Telegram is the only answer a visitor may skip, and the marketing opt-in is
 * a choice rather than an answer, so every other field is `required`. That
 * makes "is the form complete" exactly the browser's own validity check — one
 * flag off `checkValidity()` rather than a piece of state per input. The
 * dialog unmounts its content on close, which resets the fields, this flag and
 * the submission state together.
 */
function EarlyAccessForm({
    attribution,
    card,
    onSent,
}: {
    attribution: EarlyAccessAttribution;
    card: HTMLElement | null;
    /** Raised once, so the card can shed the photograph it was sized for. */
    onSent: () => void;
}) {
    const optInId = useId();
    const [isComplete, setIsComplete] = useState(false);
    // The selects stay uncontrolled — `FormData` still reads them off the
    // hidden native ones. This only mirrors what is picked, so each row knows
    // whether it has to ask for a free-text answer. `isComplete` survives the
    // extra field for free: Radix raises the select's change event from an
    // effect, so the row has already re-rendered by the time the form below
    // re-reads its own validity.
    const [businessType, setBusinessType] = useState<string | null>(null);
    const [referralSource, setReferralSource] = useState<string | null>(null);
    const [status, setStatus] = useState<
        "idle" | "submitting" | "failed" | "throttled" | "sent"
    >("idle");
    // Clearing remounts the form rather than walking it: the two selects hold
    // their own state for the greyed placeholder, which a native reset of the
    // DOM would leave behind.
    const [generation, setGeneration] = useState(0);

    function clear() {
        setGeneration((generation) => generation + 1);
        setIsComplete(false);
        setStatus("idle");
        setBusinessType(null);
        setReferralSource(null);
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const value = (field: string) => String(fields.get(field) ?? "").trim();
        // "Other" is the prompt, not the answer: what the visitor typed beside
        // it is what the CRM records. Both attributes are free text over there,
        // so the answer goes into the existing one rather than beside it.
        const answer = (field: "businessType" | "referralSource") =>
            value(field) === OTHER_OPTION
                ? value(`${field}Other`)
                : value(field);

        setStatus("submitting");
        try {
            await submitEarlyAccessRequest({
                name: value("name"),
                company: value("company"),
                email: value("email"),
                telegram: value("telegram") || undefined,
                businessType: answer("businessType"),
                referralSource: answer("referralSource"),
                marketingOptIn: fields.has("marketingOptIn"),
                attribution,
            });
            setStatus("sent");
            onSent();
        } catch (error) {
            // A throttled visitor gets the backend's own answer: the generic
            // "try again" reads as an invitation to do so at once, which only
            // confirms the bucket. Anything else is already on its way to
            // Sentry — `submitEarlyAccessRequest` goes through the shared
            // client, whose interceptor reports 5xx and network failures.
            setStatus(
                isAxiosError(error) && error.response?.status === 429
                    ? "throttled"
                    : "failed",
            );
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
            key={generation}
            onSubmit={handleSubmit}
            onReset={clear}
            onChange={(event) =>
                setIsComplete(event.currentTarget.checkValidity())
            }
            className={cn("flex flex-col", BLOCK_GAP, ROW_GAP)}
        >
            <div className={cn("grid sm:grid-cols-2", ROW_GAP)}>
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
            </div>
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
                otherPlaceholder="Other Type of Business"
                options={BUSINESS_TYPE_OPTIONS}
                value={businessType}
                onValueChange={setBusinessType}
                card={card}
            />
            <SelectField
                name="referralSource"
                placeholder="How did you hear about NEAR Business?"
                otherPlaceholder="Other Referral Source"
                options={REFERRAL_SOURCE_OPTIONS}
                value={referralSource}
                onValueChange={setReferralSource}
                card={card}
            />
            <div className="flex items-start gap-3">
                <MarketingOptIn id={optInId} />
                <label
                    htmlFor={optInId}
                    className="text-xs leading-[1.35] text-landing-ink"
                >
                    I would like to receive marketing emails about near.com for
                    Business and related products and services from Intents
                    Technology Ltd or on its behalf. I can unsubscribe at any
                    time.
                </label>
            </div>
            {/* Clear form and the failure notice share the button's row rather
                than taking one each, so neither costs the form its fit. */}
            <div className="mt-1 flex items-center justify-end gap-4">
                <button
                    type="reset"
                    className="mr-auto inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-landing-link hover:underline"
                >
                    <ResetGlyph />
                    Clear form
                </button>
                {(status === "failed" || status === "throttled") && (
                    <p
                        role="alert"
                        className="text-xs leading-[1.35] text-[#c8412f]"
                    >
                        {status === "throttled"
                            ? "Too many requests. Please try again in a minute."
                            : "Something went wrong. Please try again."}
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
 * The design draws its own listbox — a green-outlined trigger with the options
 * attached underneath it — which a native `<select>` cannot do: the open list
 * belongs to the OS. So the visible control is Radix's, while the value still
 * leaves through a real `<select>`: Radix renders a hidden one under the same
 * `name`, carrying `required`, so `FormData` and the form's own
 * `checkValidity()` keep working exactly as they do for the text fields. That
 * hidden control is what a failed native validation points at, hence the
 * `relative` wrapper around the whole field: it is the positioning context the
 * browser measures, so the message lands on this row rather than on the card.
 *
 * Picking `OTHER_OPTION` asks for the answer instead, in a field beside the
 * select rather than under it: the form is already as tall as a laptop can
 * take, so the row splits rather than the column growing by one.
 */
function SelectField({
    name,
    placeholder,
    otherPlaceholder,
    options,
    value,
    onValueChange,
    card,
}: {
    name: string;
    placeholder: string;
    /** What to call the free-text answer `OTHER_OPTION` asks for. */
    otherPlaceholder: string;
    options: readonly string[];
    value: string | null;
    onValueChange: (value: string) => void;
    card: HTMLElement | null;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const isOther = value === OTHER_OPTION;

    return (
        <div className={cn("grid", ROW_GAP, isOther && "sm:grid-cols-2")}>
            <div className="relative">
                <SelectPrimitive.Root
                    name={name}
                    required
                    onValueChange={onValueChange}
                    open={isOpen}
                    onOpenChange={setIsOpen}
                >
                    <SelectPrimitive.Trigger
                        aria-label={placeholder}
                        className={cn(
                            FIELD_HEIGHT,
                            "flex w-full cursor-pointer items-center justify-between gap-2 bg-transparent text-left text-base leading-none text-landing-ink outline-none data-[placeholder]:text-landing-grey-light",
                            // The trigger closes back into the same hairline the
                            // text fields wear; open, it becomes the design's
                            // outlined box, which insets its own text.
                            isOpen
                                ? "rounded border-2 border-landing-green px-4"
                                : "border-0 border-b border-landing-grey-light transition-colors focus-visible:border-landing-ink",
                            // The referral placeholder is longer than a phone's
                            // field, so it drops a size rather than truncating.
                            "max-sm:text-[13px]",
                        )}
                    >
                        <SelectPrimitive.Value
                            placeholder={placeholder}
                            className="min-w-0 truncate"
                        />
                        <SelectPrimitive.Icon asChild>
                            <ChevronGlyph className="shrink-0 text-landing-ink" />
                        </SelectPrimitive.Icon>
                    </SelectPrimitive.Trigger>
                    {/* Not portalled: inside the dialog the list inherits
                        the landing's palette and font instead of restating
                        them. */}
                    <SelectPrimitive.Content
                        position="popper"
                        sideOffset={0}
                        // The card, not the viewport, is what the list has to fit
                        // inside: it is the scroll container, so a list that hangs
                        // past its bottom edge is a scrollbar on the whole modal.
                        // Bounded here, the list flips or shortens itself instead.
                        collisionBoundary={card}
                        collisionPadding={8}
                        // Four rows and half of the next: enough of the list to
                        // read at a glance, short enough to hang inside the card,
                        // and the half row is what says the rest is below. Cut on
                        // a row's midline rather than at its edge, which would
                        // leave a sliver that reads as a rendering fault.
                        className="z-50 max-h-[min(13rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded border border-landing-mist bg-white lg:bg-landing-paper"
                    >
                        <SelectPrimitive.Viewport className="py-1">
                            {options.map((option) => (
                                <SelectPrimitive.Item
                                    key={option}
                                    value={option}
                                    className="flex h-11 cursor-pointer select-none items-center px-4 text-base leading-none text-landing-ink outline-none data-[highlighted]:bg-landing-mist/60 max-sm:text-[13px]"
                                >
                                    <SelectPrimitive.ItemText>
                                        {option}
                                    </SelectPrimitive.ItemText>
                                </SelectPrimitive.Item>
                            ))}
                        </SelectPrimitive.Viewport>
                    </SelectPrimitive.Content>
                </SelectPrimitive.Root>
            </div>
            {isOther && (
                <input
                    name={`${name}Other`}
                    aria-label={otherPlaceholder}
                    placeholder={otherPlaceholder}
                    required
                    // The answer becomes a line of CRM free text, so it is capped
                    // at about what one of those holds rather than left open.
                    maxLength={MAX_OTHER_LENGTH}
                    className={cn(FIELD, "max-sm:text-[13px]")}
                />
            )}
        </div>
    );
}

/** Green hairline square with a tick, per the design — the themed app
 *  checkbox would drag in the dashboard palette. */
function MarketingOptIn({ id }: { id: string }) {
    return (
        <span className="relative mt-px inline-flex shrink-0">
            <input
                id={id}
                type="checkbox"
                name="marketingOptIn"
                // `appearance-none` takes the browser's focus ring with it.
                className="peer size-[18px] cursor-pointer appearance-none rounded-[3px] border border-landing-green bg-transparent checked:bg-landing-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-ink"
            />
            <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className="pointer-events-none absolute inset-0 hidden size-[18px] text-landing-ink peer-checked:block"
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

/** The counter-clockwise arrow the design puts against "Clear form". */
function ResetGlyph() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="size-3.5"
        >
            <path
                d="M3 8a5 5 0 1 1 1.6 3.67"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
            <path
                d="M3 4.5V8h3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
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
