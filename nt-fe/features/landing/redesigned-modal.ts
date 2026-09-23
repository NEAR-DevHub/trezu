/**
 * Feature flag for the redesigned in-page early-access form. Until it ships,
 * every CTA keeps sending visitors to the Airtable form; `?show_redesigned_modal=true`
 * on the landing opts into the new modal.
 */
export const REDESIGNED_MODAL_QUERY = "show_redesigned_modal";

/** Strictly `=true`: any other value leaves the Airtable form in place. */
export function showsRedesignedModal(
    value: string | string[] | null | undefined,
): boolean {
    return (Array.isArray(value) ? value[0] : value) === "true";
}
