import type { ReactNode } from "react";

/**
 * The shell header shows the treasury on a phone, not the page, so the page
 * names itself above its content.
 */
export function MobilePageHeading({ children }: { children: ReactNode }) {
    return (
        <h1 className="mt-3 mb-5 text-xl font-semibold leading-[1.2] tracking-tight lg:hidden">
            {children}
        </h1>
    );
}
