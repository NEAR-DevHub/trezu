"use client";

import { formatUserDate, formatRelativeTime, type FormatUserDateOptions } from "@/lib/utils";
import { useUserPreferences } from "@/hooks/use-user-preferences";

interface FormattedDateProps extends Omit<FormatUserDateOptions, "timezone" | "timeFormat"> {
  /** The date to format */
  date: Date | string | number;
  /** Override user's timezone preference */
  timezone?: string | null;
  /** Override user's time format preference */
  timeFormat?: "12" | "24";
  /** Additional CSS classes */
  className?: string;
  /** Use relative time format (e.g., "2 minutes ago", "Yesterday"). Defaults to false. */
  relative?: boolean;
}

/**
 * Component that displays a formatted date according to user preferences
 * Automatically uses user's timezone and time format settings from preferences
 */
export function FormattedDate({
  date,
  timezone: overrideTimezone,
  timeFormat: overrideTimeFormat,
  className,
  relative = false,
  ...options
}: FormattedDateProps) {
  const preferences = useUserPreferences();

  // If relative time is requested, use formatRelativeTime
  if (relative) {
    const relativeTime = formatRelativeTime(date);
    return <span className={className}>{relativeTime}</span>;
  }

  // Use override values or fall back to user preferences
  // Note: timezone.name contains the IANA timezone (e.g., "Asia/Kolkata")
  const timezone = overrideTimezone !== undefined
    ? overrideTimezone
    : preferences.timezone?.name || null;

  const timeFormat = overrideTimeFormat || preferences.timeFormat;

  const formattedDate = formatUserDate(date, {
    timezone,
    timeFormat,
    ...options,
  });

  return <span className={className}>{formattedDate}</span>;
}

/**
 * Hook that returns a formatting function with user preferences applied
 * Useful when you need to format dates in non-render contexts
 */
export function useFormatDate() {
  const preferences = useUserPreferences();

  return (date: Date | string | number, options: FormatUserDateOptions = {}) => {
    return formatUserDate(date, {
      timezone: preferences.timezone?.name || null,
      timeFormat: preferences.timeFormat,
      ...options,
    });
  };
}

