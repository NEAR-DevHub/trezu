"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import QRCodeFallback from "react-qr-code";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";

interface QrCodeProps {
    value: string;
    /** Dot color — pick for the surface it sits on (e.g. white on a dark card). */
    color: string;
    /** Accessible label; without one the drawing is decorative. */
    title?: string;
    className?: string;
    /** Centre overlay (a token or network logo). The dots under it are cleared. */
    children?: ReactNode;
}

const DRAWING_SIZE = 1000;
const CENTER_CLEARING_IMAGE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

/**
 * Rounded-dot QR code on a transparent background, drawn with
 * `qr-code-styling` (same renderer and options as near.com's deposit QR).
 * When centre content is given the error-correction level rises so the
 * cleared middle stays scannable. If the renderer chunk fails to load the
 * plain `react-qr-code` drawing (already in the bundle) takes its place.
 */
export function QrCode({
    value,
    color,
    title,
    className,
    children,
}: QrCodeProps) {
    const drawingRef = useRef<HTMLDivElement>(null);
    const [fallback, setFallback] = useState(false);
    const hasCenterContent = children != null;
    const errorCorrectionLevel = hasCenterContent ? "Q" : "M";

    useEffect(() => {
        const drawing = drawingRef.current;
        if (drawing == null || fallback) return;
        let cancelled = false;
        import("qr-code-styling")
            .then(({ default: QRCodeStyling }) => {
                if (cancelled) return;
                new QRCodeStyling({
                    type: "svg",
                    width: DRAWING_SIZE,
                    height: DRAWING_SIZE,
                    margin: 0,
                    data: value,
                    qrOptions: { errorCorrectionLevel },
                    dotsOptions: { type: "dots", color },
                    cornersSquareOptions: { type: "extra-rounded", color },
                    cornersDotOptions: { type: "dot", color },
                    backgroundOptions: { color: "transparent" },
                    ...(hasCenterContent && {
                        image: CENTER_CLEARING_IMAGE,
                        imageOptions: {
                            hideBackgroundDots: true,
                            saveAsBlob: false,
                        },
                    }),
                }).append(drawing);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                reportError(error, "QR renderer failed to load", {
                    code: "FE_QR_RENDERER_LOAD_FAILED",
                });
                setFallback(true);
            });
        return () => {
            cancelled = true;
            drawing.replaceChildren();
        };
    }, [value, color, hasCenterContent, errorCorrectionLevel, fallback]);

    const labelProps =
        title != null
            ? { role: "img", "aria-label": title }
            : { "aria-hidden": true };

    return (
        <div {...labelProps} className={cn("relative", className)}>
            <div
                ref={drawingRef}
                className="size-full [&>svg]:size-full"
                data-testid="qr-code"
            />
            {fallback && (
                <QRCodeFallback
                    value={value}
                    fgColor={color}
                    bgColor="transparent"
                    level={errorCorrectionLevel}
                    className="absolute inset-0 size-full"
                />
            )}
            {hasCenterContent && (
                <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center">
                    {children}
                </div>
            )}
        </div>
    );
}
