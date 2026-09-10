/** New-tab attrs for http(s) URLs. Same-origin and mailto stay in this tab. */
export function externalHrefProps(href: string): {
    target?: "_blank";
    rel?: "noopener noreferrer";
} {
    if (/^https?:\/\//.test(href)) {
        return { target: "_blank", rel: "noopener noreferrer" };
    }
    return {};
}
