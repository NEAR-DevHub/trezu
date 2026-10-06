import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { Icon } from "@/components/icon";
import {
    Dialog as BaseDialog,
    DialogClose as BaseDialogClose,
    DialogContent as BaseDialogContent,
    DialogFooter as BaseDialogFooter,
    DialogHeader as BaseDialogHeader,
    DialogTitle as BaseDialogTitle,
    DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useHasSidebarRail } from "@/components/app-shell-context";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useUiStore } from "@/stores/ui-store";

// @hot-labs/near-connect mounts its wallet popup on document.body with class
// `.hot-connector-popup`. Radix Dialog in modal mode blocks pointer events on
// body siblings, so clicks on the connector UI don't register. Instead of
// fighting Radix, we temporarily close any open Dialog while the connector
// popup is visible, then reopen it when the popup closes.
//
// "Visible" means `display`, not mere presence: near-connect appends the popup
// root the instant it starts *building* the wallet iframe — fetching the
// executor, waking the device, reading an access key — and only flips
// `display` to `block` once the wallet has something to show. On a hardware
// wallet that gap runs for seconds, so treating the appended-but-hidden root
// as "open" tore our own dialog down long before anything replaced it, which
// read as "nothing happened" and had people voting a second time.
const connectorListeners = new Set<(v: boolean) => void>();
let connectorVisible = false;
let connectorObserverStarted = false;

function isConnectorPopupVisible() {
    const popups = document.querySelectorAll<HTMLElement>(
        ".hot-connector-popup",
    );
    // More than one root can be mounted at a time: near-connect leaves a
    // closing popup in the DOM for its exit transition while the next one is
    // already being built.
    return Array.from(popups).some((popup) => popup.style.display !== "none");
}

function startConnectorObserver() {
    if (connectorObserverStarted || typeof document === "undefined") return;
    connectorObserverStarted = true;

    const publish = () => {
        const visible = isConnectorPopupVisible();
        if (visible === connectorVisible) return;
        connectorVisible = visible;
        connectorListeners.forEach((l) => l(visible));
    };

    // near-connect shows and hides a popup by flipping `display` on a root
    // that's already mounted, which a childList observer never sees — so each
    // root gets its own attribute observer as it appears. Scoping it to the
    // roots (rather than `subtree: true` on the body) keeps this off the path
    // of every other style change in the app.
    const popupObserver = new MutationObserver(publish);
    const observedPopups = new WeakSet<HTMLElement>();
    const syncPopups = () => {
        for (const popup of document.querySelectorAll<HTMLElement>(
            ".hot-connector-popup",
        )) {
            if (observedPopups.has(popup)) continue;
            observedPopups.add(popup);
            popupObserver.observe(popup, {
                attributes: true,
                attributeFilter: ["style"],
            });
        }
        publish();
    };

    syncPopups();
    new MutationObserver(syncPopups).observe(document.body, {
        childList: true,
        subtree: false,
    });
}

function useConnectorPopupVisible() {
    return useSyncExternalStore(
        (cb) => {
            startConnectorObserver();
            connectorListeners.add(cb);
            return () => connectorListeners.delete(cb);
        },
        () => connectorVisible,
        () => false,
    );
}

function Dialog({
    open,
    defaultOpen,
    onOpenChange,
    ...props
}: React.ComponentProps<typeof BaseDialog>) {
    const connectorOpen = useConnectorPopupVisible();
    const isControlled = open !== undefined;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(!!defaultOpen);
    const actualOpen = isControlled ? open : uncontrolledOpen;

    // Remember whether the dialog was open at the moment the connector popup
    // appeared, so we can restore it after the popup closes.
    const suspendedOpenRef = useRef<boolean | null>(null);
    useEffect(() => {
        if (connectorOpen && suspendedOpenRef.current === null) {
            suspendedOpenRef.current = actualOpen;
        } else if (!connectorOpen && suspendedOpenRef.current !== null) {
            const restore = suspendedOpenRef.current;
            suspendedOpenRef.current = null;
            if (restore && !actualOpen) {
                if (isControlled) onOpenChange?.(true);
                else setUncontrolledOpen(true);
            }
        }
    }, [connectorOpen, actualOpen, isControlled, onOpenChange]);

    const effectiveOpen = connectorOpen ? false : actualOpen;
    const handleOpenChange = (next: boolean) => {
        if (connectorOpen) {
            // Connector-driven close: don't propagate; we'll restore later.
            return;
        }
        if (!isControlled) setUncontrolledOpen(next);
        onOpenChange?.(next);
    };

    return (
        <DialogDismissContext.Provider value={() => handleOpenChange(false)}>
            <BaseDialog
                {...props}
                open={effectiveOpen}
                onOpenChange={handleOpenChange}
            />
        </DialogDismissContext.Provider>
    );
}

/**
 * Closes the enclosing dialog the same way Escape or an outside click would,
 * so owners that keep a dialog open (a tour, an unskippable prompt) still get
 * the final say.
 */
const DialogDismissContext = createContext<(() => void) | null>(null);

/** Movement before a press counts as a pull rather than a tap. */
const DRAG_SLOP_PX = 8;
/** A pull past this share of the sheet's height, or this fast, dismisses it. */
const DISMISS_DISTANCE_RATIO = 0.25;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
/** A finger held still this long before lifting isn't flicking anymore. */
const FLICK_MAX_PAUSE_MS = 100;

type SheetPointerHandlers = Pick<
    React.ComponentProps<"div">,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

interface SheetDrag {
    pointerId: number;
    startX: number;
    startY: number;
    offset: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    pulling: boolean;
}

/** Springs a released sheet back to where it rests. */
function settleSheet(sheet: HTMLElement, offset: number) {
    const clear = () => {
        sheet.style.transition = "";
        sheet.style.translate = "";
    };
    // Already in place: there's nothing to animate, so no `transitionend`.
    if (offset === 0) {
        clear();
        return;
    }
    sheet.style.transition = "translate 200ms ease-out";
    sheet.style.translate = "0px";
    sheet.addEventListener("transitionend", clear, { once: true });
}

/**
 * Pull-to-close for a bottom sheet: dragging its handle or title bar (anything
 * marked `data-sheet-drag-area`) down moves the sheet with the finger, and
 * letting go far or fast enough closes it — otherwise it springs back. The sheet keeps its offset as it closes, so
 * the exit animation carries on from where the finger left it.
 *
 * Only active while `mobileQuery` matches, i.e. while the dialog is laid out
 * as a bottom sheet rather than a centered modal or side panel.
 */
function useSheetDragToClose(
    mobileQuery: string,
    // The sheet's own pointer handlers still run, ahead of the gesture.
    handlers: SheetPointerHandlers,
) {
    const dismiss = useContext(DialogDismissContext);
    const drag = useRef<SheetDrag | null>(null);

    function release(sheet: HTMLElement, shouldDismiss: boolean) {
        const current = drag.current;
        drag.current = null;
        if (!current?.pulling) return;
        if (!shouldDismiss || !dismiss) {
            settleSheet(sheet, current.offset);
            return;
        }
        dismiss();
        // A dialog its owner keeps open has to come back into place.
        requestAnimationFrame(() => {
            if (sheet.dataset.state === "open") {
                settleSheet(sheet, current.offset);
            }
        });
    }

    return {
        onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
            handlers.onPointerDown?.(e);
            if (!dismiss || !e.isPrimary || e.button !== 0) return;
            if (!window.matchMedia(mobileQuery).matches) return;
            if (!(e.target instanceof Element)) return;
            // React bubbles events out of portals, so a sheet stacked on top of
            // this one would otherwise drag both.
            const area = e.target.closest("[data-sheet-drag-area]");
            if (area?.closest('[role="dialog"]') !== e.currentTarget) return;
            drag.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                offset: 0,
                lastY: e.clientY,
                lastTime: e.timeStamp,
                velocity: 0,
                pulling: false,
            };
        },
        onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
            handlers.onPointerMove?.(e);
            const current = drag.current;
            if (current?.pointerId !== e.pointerId) return;
            const dy = e.clientY - current.startY;
            const sheet = e.currentTarget;

            if (!current.pulling) {
                const sideways =
                    Math.abs(e.clientX - current.startX) > DRAG_SLOP_PX;
                if (sideways || dy < -DRAG_SLOP_PX) {
                    drag.current = null;
                    return;
                }
                if (dy < DRAG_SLOP_PX) return;
                current.pulling = true;
                // Capturing also retargets the release, so the header button
                // the pull started on doesn't get clicked.
                sheet.setPointerCapture(e.pointerId);
                sheet.style.transition = "none";
            }

            const elapsed = e.timeStamp - current.lastTime;
            if (elapsed > 0) {
                current.velocity = (e.clientY - current.lastY) / elapsed;
            }
            current.lastY = e.clientY;
            current.lastTime = e.timeStamp;
            current.offset = Math.max(0, dy);
            sheet.style.translate = `0 ${current.offset}px`;
        },
        onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
            handlers.onPointerUp?.(e);
            const current = drag.current;
            if (current?.pointerId !== e.pointerId) return;
            const sheet = e.currentTarget;
            const flicked =
                e.timeStamp - current.lastTime < FLICK_MAX_PAUSE_MS &&
                current.velocity > DISMISS_VELOCITY_PX_PER_MS;
            release(
                sheet,
                flicked ||
                    current.offset >
                        sheet.offsetHeight * DISMISS_DISTANCE_RATIO,
            );
        },
        onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
            handlers.onPointerCancel?.(e);
            if (drag.current?.pointerId !== e.pointerId) return;
            release(e.currentTarget, false);
        },
    };
}

interface DialogHeaderProps
    extends React.ComponentProps<typeof BaseDialogHeader> {
    centerTitle?: boolean;
    closeButton?: boolean;
}

function DialogHeader({
    className,
    children,
    centerTitle = false,
    closeButton = true,
    ...props
}: DialogHeaderProps) {
    const t = useTranslations("common");
    return (
        <BaseDialogHeader
            data-sheet-drag-area
            {...props}
            className={cn(
                "border-b border-border -mx-4 px-4 flex flex-row items-center justify-between text-center gap-2 sticky top-0 z-10 bg-card sm:static max-sm:touch-none",
                className,
            )}
        >
            <div className={cn(centerTitle && "flex-1")}>{children}</div>
            {closeButton && (
                <BaseDialogClose className="ring-offset-background focus-visible:ring-ring inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none">
                    <Icon icon={Cancel01Icon} />
                    <span className="sr-only">{t("close")}</span>
                </BaseDialogClose>
            )}
        </BaseDialogHeader>
    );
}

function DialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof BaseDialogTitle>) {
    return (
        <BaseDialogTitle
            {...props}
            className={cn("text-lg font-semibold text-center", className)}
        />
    );
}

function DialogFooter({
    className,
    ...props
}: React.ComponentProps<typeof BaseDialogFooter>) {
    return (
        <BaseDialogFooter
            {...props}
            className={cn("px-4 -mx-4 pt-3 shrink-0", className)}
        />
    );
}

/**
 * Recent-activity / payment-picker sheet on small screens: floats inset from
 * the edges with rounded corners on every side, instead of an edge-to-edge
 * bottom drawer.
 */
export const mobileInsetSheetClassName =
    "max-sm:inset-x-3 max-sm:left-3 max-sm:right-3 max-sm:bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:w-auto max-sm:rounded-3xl max-sm:rounded-b-3xl max-sm:pb-4";

function DialogContent({
    className,
    children,
    ...props
}: React.ComponentProps<typeof BaseDialogContent>) {
    const pushOverlay = useUiStore((s) => s.pushOverlay);
    const popOverlay = useUiStore((s) => s.popOverlay);
    const pushed = useRef(false);
    const hasSidebarRail = useHasSidebarRail();
    const isSidebarOpen = useSidebarStore((s) => s.isSidebarOpen);
    // Below `sm` the dialog is a bottom sheet.
    const dragToClose = useSheetDragToClose("(width < 40rem)", props);

    // Track open/close via the `data-state` attribute change on the content element.
    // We use onAnimationStart which fires when the open animation begins.
    function handleStateChange(open: boolean) {
        if (open && !pushed.current) {
            pushed.current = true;
            pushOverlay();
        } else if (!open && pushed.current) {
            pushed.current = false;
            popOverlay();
        }
    }

    // Only on large screens (sidebar rail). Mobile stays full-width bottom sheet.
    const contentCenterClass = hasSidebarRail
        ? isSidebarOpen
            ? "lg:left-[calc(50%+9.25rem)]!"
            : "lg:left-[calc(50%+2.5rem)]!"
        : undefined;

    return (
        <BaseDialogContent
            {...props}
            {...dragToClose}
            showCloseButton={false}
            onOpenAutoFocus={(e) => {
                handleStateChange(true);
                props.onOpenAutoFocus?.(e);
            }}
            onCloseAutoFocus={(e) => {
                handleStateChange(false);
                props.onCloseAutoFocus?.(e);
            }}
            className={cn(
                "bg-card flex flex-col",
                // Mobile: bottom drawer with a consistent inset
                "max-w-none! w-full inset-x-0 left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 max-h-[80vh] rounded-t-3xl rounded-b-none",
                "p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:gap-0 sm:gap-4",
                "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                "data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100",
                // Desktop: centered modal
                "sm:max-w-lg! sm:inset-x-auto sm:top-[50%] sm:left-[50%] sm:bottom-auto sm:right-auto",
                "sm:w-full sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl",
                "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
                "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
                "overflow-y-auto scrollbar-hide",
                contentCenterClass,
                className,
            )}
        >
            {children}
        </BaseDialogContent>
    );
}

export {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
    DialogDescription,
    useConnectorPopupVisible,
    useSheetDragToClose,
};
