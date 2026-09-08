/**
 * Settings actions render their disabled state as a flat grey fill (#D4D4D4 on
 * #A1A1A1) rather than the global 50% fade, so a blocked Save reads as inert
 * instead of as a washed-out primary button.
 */
export const disabledActionClasses =
    "disabled:opacity-100 disabled:bg-gray-300 disabled:text-gray-400";
