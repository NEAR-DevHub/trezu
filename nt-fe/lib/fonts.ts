import { Figtree, Geist_Mono } from "next/font/google";

export const figtree = Figtree({
    variable: "--font-figtree",
    subsets: ["latin"],
});

// Marketing landing only. The design is set in PP Neue Montreal Mono, a
// commercial face that's only present when its files are synced into
// public/fonts/ (see app/globals.css); Geist Mono is the open fallback.
export const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});
