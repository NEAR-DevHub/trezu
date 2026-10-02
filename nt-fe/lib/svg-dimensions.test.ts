import { describe, expect, it } from "bun:test";
import { getSvgDimensions } from "./svg-dimensions";

describe("getSvgDimensions", () => {
    it("uses width/height attributes", () => {
        expect(
            getSvgDimensions('<svg width="256" height="256px"></svg>'),
        ).toEqual({ width: 256, height: 256 });
    });

    it("falls back to viewBox when size attributes are missing", () => {
        expect(
            getSvgDimensions('<svg viewBox="0 0 256 256"><path/></svg>'),
        ).toEqual({ width: 256, height: 256 });
    });

    it("returns null without usable dimensions", () => {
        expect(
            getSvgDimensions('<svg width="100%" height="100%"></svg>'),
        ).toBeNull();
        expect(getSvgDimensions("not an svg")).toBeNull();
    });
});
