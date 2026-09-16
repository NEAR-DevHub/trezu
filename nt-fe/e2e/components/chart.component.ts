import type { Locator, Page } from "@playwright/test";

interface AxisLabel {
    text: string;
    left: number;
    right: number;
}

interface LabelOverlap {
    label1: string;
    label2: string;
    overlapPx: number;
}

/**
 * The dashboard balance chart (Recharts) and its period selector. The
 * selector renders as a native-style `<select>` combobox on mobile
 * (`.md:hidden`) and a portaled trigger/menu on desktop
 * (`data-testid="chart-period-trigger"`/`chart-period-option-*`).
 */
export class ChartComponent {
    constructor(private readonly page: Page) {}

    get container(): Locator {
        return this.page.locator("[data-slot='chart']").first();
    }

    async waitForRendered(timeout = 15_000): Promise<void> {
        await this.container
            .locator("svg")
            .first()
            .waitFor({ state: "visible", timeout });
    }

    private mobilePeriodDropdown(): Locator {
        return this.page
            .locator(".md\\:hidden")
            .locator('button[role="combobox"]')
            .last();
    }

    async selectMobilePeriod(period: string): Promise<void> {
        await this.mobilePeriodDropdown().click();
        await this.page.getByRole("option").filter({ hasText: period }).click();
    }

    async selectDesktopPeriod(period: string): Promise<void> {
        await this.page.getByTestId("chart-period-trigger").click();
        await this.page.getByTestId(`chart-period-option-${period}`).click();
    }

    /** Bounding boxes + text of every rendered x-axis tick label. */
    async getXAxisLabels(): Promise<AxisLabel[]> {
        return this.page.evaluate(() => {
            const xAxisGroup = document.querySelector(".recharts-xAxis");
            if (!xAxisGroup) return [];

            const ticks = xAxisGroup.querySelectorAll(
                ".recharts-cartesian-axis-tick text",
            );
            return Array.from(ticks).map((tick) => {
                const rect = tick.getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    text: tick.textContent || "",
                };
            });
        });
    }

    /**
     * Number of data points rendered in the chart's area path. Recharts emits
     * one SVG path command per point — M for the first, then C (monotone
     * curve) or L (straight line) for the rest.
     */
    async getDataPointCount(): Promise<number> {
        return this.page.evaluate(() => {
            const path = document.querySelector(
                ".recharts-area-area path, .recharts-area .recharts-area-curve",
            );
            if (!path) return 0;

            const d = path.getAttribute("d");
            if (!d) return 0;

            const moveCount = (d.match(/M/g) || []).length;
            const curveCount = (d.match(/C/g) || []).length;
            const lineCount = (d.match(/L/g) || []).length;

            return moveCount + curveCount + lineCount;
        });
    }

    /** Adjacent labels whose bounding boxes overlap horizontally by more than 1px. */
    static findOverlaps(labels: AxisLabel[]): LabelOverlap[] {
        const overlaps: LabelOverlap[] = [];
        for (let i = 1; i < labels.length; i++) {
            const prev = labels[i - 1];
            const curr = labels[i];
            const overlapPx = prev.right - curr.left;
            if (overlapPx > 1) {
                overlaps.push({
                    label1: prev.text,
                    label2: curr.text,
                    overlapPx: Math.round(overlapPx),
                });
            }
        }
        return overlaps;
    }
}
