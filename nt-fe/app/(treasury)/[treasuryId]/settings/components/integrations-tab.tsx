"use client";

import { TelegramSettingsIntegration } from "@/features/telegram";

export function IntegrationsTab() {
    return (
        <div className="flex flex-col gap-6">
            <TelegramSettingsIntegration />
        </div>
    );
}
