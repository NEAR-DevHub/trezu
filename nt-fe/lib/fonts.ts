import { Figtree, Geist_Mono } from "next/font/google";

export const figtree = Figtree({
    variable: "--font-figtree",
    subsets: ["latin"],
});

// Marketing landing only. The design is set in PP Neue Montreal Mono, which
// is a commercial face we don't ship; Geist Mono is the closest open stand-in.
export const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});
