"use client";

import { useLocale, useTranslations } from "next-intl";
import {
    formatUserDate,
    formatRelativeTime,
    formatProposalStatusDate,
    cn,
    type FormatUserDateOptions,
    type RelativeTimeLabels,
} from "@/lib/utils";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { Tooltip } from "@/components/tooltip";
import type { Proposal } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import { getProposalStatusDateInfo } from "@/features/proposals/utils/proposal-utils";

type BaseFormattedDateProps = Omit<
    FormatUserDateOptions,
    "timezone" | "timeFormat"
> & {
    /** Override user's timezone preference */
    timezone?: string | null;
    /** Override user's time format preference */
    timeFormat?: "12" | "24";
    /** Additional CSS classes */
    className?: string;
};

type StandardDateProps = BaseFormattedDateProps & {
    /** The date to format */
    date: Date | string | number;
    proposal?: never;
    policy?: never;
    /** Use relative time format (e.g., "2 minutes ago", "Yesterday"). Defaults to false. */
    relative?: boolean;
};

type ProposalStatusDateProps = BaseFormattedDateProps & {
    /**
     * Overrides the status-derived date while keeping the status label,
     * e.g. the resolved on-chain vote timestamp for "Executed 2 days ago".
     */
    date?: Date;
    /** Proposal to derive the status-based date from */
    proposal: Proposal;
    /** Policy required for expiration calculation */
    policy: Policy;
    /** Use status-based relative time (e.g. "Expires in 2 hours"). Defaults to false. */
    relative?: boolean;
};

type FormattedDateProps = StandardDateProps | ProposalStatusDateProps;

/**
 * Component that displays a formatted date according to user preferences.
 * Automatically uses user's timezone and time format settings from preferences.
 *
 * When `proposal` + `policy` are provided, displays the status-relevant date:
 * - Pending → "Expires in X" (expiry date)
 * - Executed/Rejected/Failed/Expired/Removed → "Status X ago" (resolved date,
 *   or the `date` override when the caller has resolved the vote transaction)
 * - Beyond 6 months either way → "Status on Mar 1, 2026"
 * Full timestamp shown in tooltip on hover.
 */
export function FormattedDate(props: FormattedDateProps) {
    const preferences = useUserPreferences();
    const tDate = useTranslations("statusDate");
    const tRel = useTranslations("relativeTime");
    const locale = useLocale();
    const relativeLabels: RelativeTimeLabels = {
        justNow: tRel("justNow"),
        locale,
    };

    const timezone =
        props.timezone !== undefined
            ? props.timezone
            : preferences.timezone?.name || null;
    const timeFormat = props.timeFormat || preferences.timeFormat;

    let displayText: string;
    let tooltipText: string | undefined;

    let urgentExpiry = false;

    if (props.proposal && props.policy) {
        const statusDate = getProposalStatusDateInfo(
            props.proposal,
            props.policy,
        );
        const { isFuture, labelKey } = statusDate;
        const date = props.date ?? statusDate.date;
        const label = labelKey ? tDate(labelKey) : "";
        tooltipText = formatUserDate(date, { timezone, timeFormat });
        if (isFuture && date.getTime() - Date.now() < 6 * 60 * 60 * 1000) {
            urgentExpiry = true;
        }
        if (props.relative) {
            const { text, isAbsolute } = formatProposalStatusDate(
                date,
                isFuture,
                relativeLabels,
            );
            if (!label) {
                displayText = text;
            } else if (isAbsolute) {
                displayText = tDate("absolute", { label, date: text });
            } else {
                displayText = `${label} ${text}`;
            }
        } else {
            displayText = tooltipText;
            tooltipText = undefined;
        }
    } else {
        const {
            date,
            relative = false,
            timezone: _tz,
            timeFormat: _tf,
            policy: _p,
            proposal: _pr,
            ...options
        } = props as StandardDateProps;
        tooltipText = formatUserDate(date, {
            timezone,
            timeFormat,
            ...options,
        });
        if (relative) {
            displayText = formatRelativeTime(date, relativeLabels);
        } else {
            displayText = tooltipText;
            tooltipText = undefined;
        }
    }

    const content = (
        <span
            className={cn(
                urgentExpiry && "text-general-warning-foreground",
                props.className,
            )}
        >
            {displayText}
        </span>
    );

    return tooltipText ? (
        <Tooltip
            content={tooltipText}
            triggerProps={{ asChild: false, className: "py-px flex" }}
        >
            {content}
        </Tooltip>
    ) : (
        content
    );
}

/**
 * Hook that returns a formatting function with user preferences applied.
 * Useful when you need to format dates in non-render contexts.
 */
export function useFormatDate() {
    const preferences = useUserPreferences();

    return (
        date: Date | string | number,
        options: FormatUserDateOptions = {},
    ) => {
        return formatUserDate(date, {
            timezone: preferences.timezone?.name || null,
            timeFormat: preferences.timeFormat,
            ...options,
        });
    };
}
