"use client";

/**
 * Anchor to an on-page section.
 *
 * The nav fragments are rooted ("/#pricing") so they also resolve from the
 * legal pages. When the target section happens to be on the current page we
 * take the navigation over and scroll to it, instead of letting the browser
 * snap there in a single frame. Anything else (a missing section, a modified
 * click) falls through to the default behaviour.
 *
 * Focus follows the scroll so keyboard and screen-reader users land on the
 * section too, which means every target needs `tabIndex={-1}`.
 */
export function SectionLink({
    href,
    onClick,
    ...props
}: Omit<React.ComponentProps<"a">, "href"> & { href: string }) {
    return (
        <a
            href={href}
            onClick={(event) => {
                onClick?.(event);

                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                ) {
                    return;
                }

                const id = href.split("#")[1];
                const section = id ? document.getElementById(id) : null;

                if (!section) return;

                event.preventDefault();
                section.scrollIntoView({
                    behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                    ).matches
                        ? "auto"
                        : "smooth",
                });
                // Without preventScroll the focus jump cuts the animation short.
                section.focus({ preventScroll: true });
                window.history.replaceState(null, "", `#${id}`);
            }}
            {...props}
        />
    );
}
