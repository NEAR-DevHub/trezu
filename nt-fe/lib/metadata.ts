import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

const SITE_URL = "https://business.near.com";

/** Suffixes the title of every segment nested under a root layout. */
const TITLE_TEMPLATE = "%s | Near Business";

/**
 * The metadata for every page: canonical base, title, description and the link
 * preview card.
 *
 * Each route group declares its own `<html>`, so there is no single root layout
 * to hang this on — every root layout re-exports this instead. Segments below a
 * root layout inherit it as long as they don't set the same fields themselves.
 */
export async function generateMetadata() {
    const t = await getTranslations("metadata");
    const title = t("title");
    const description = t("description");
    const images = [
        { url: "/og-image.png", width: 1200, height: 630, alt: title },
    ];

    return {
        metadataBase: new URL(SITE_URL),
        title: { default: title, template: TITLE_TEMPLATE },
        description,
        openGraph: { title, description, images },
        twitter: { card: "summary_large_image", title, description, images },
    } satisfies Metadata;
}
