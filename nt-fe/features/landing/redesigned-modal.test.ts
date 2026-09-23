import { describe, expect, it } from "bun:test";
import {
    REDESIGNED_MODAL_QUERY,
    showsRedesignedModal,
} from "./redesigned-modal";

describe("showsRedesignedModal", () => {
    it("opts in only on an exact `true`", () => {
        expect(showsRedesignedModal("true")).toBe(true);
        expect(showsRedesignedModal("1")).toBe(false);
        expect(showsRedesignedModal("")).toBe(false);
        expect(showsRedesignedModal("TRUE")).toBe(false);
    });

    it("stays off without the param", () => {
        expect(showsRedesignedModal(null)).toBe(false);
        expect(showsRedesignedModal(undefined)).toBe(false);
    });

    it("reads the first value when Next passes an array", () => {
        expect(showsRedesignedModal(["true"])).toBe(true);
        expect(showsRedesignedModal([])).toBe(false);
    });

    it("exports the query key", () => {
        expect(REDESIGNED_MODAL_QUERY).toBe("show_redesigned_modal");
    });
});
