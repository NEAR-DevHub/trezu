import { Pill } from "./pill";

const GUEST_TOOLTIP =
    "You are a guest of this treasury. You can only view the data.";

interface GuestBadgeProps {
    showTooltip?: boolean;
    side?: "top" | "bottom" | "left" | "right";
    compact?: boolean;
    id?: string;
}

export function GuestBadge({
    showTooltip,
    side,
    compact,
    id,
}: GuestBadgeProps) {
    return (
        <Pill
            id={id}
            title="Guest"
            variant="info"
            info={showTooltip ? GUEST_TOOLTIP : undefined}
            side={side}
            className={compact ? "px-1 py-0.5 text-xxs" : undefined}
        />
    );
}
