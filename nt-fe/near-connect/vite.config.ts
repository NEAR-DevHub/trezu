import { defineConfig } from "vite";

export default defineConfig({
    root: "./",
    build: {
        emptyOutDir: false,
        outDir: "../.next/static/near-connect",
        rollupOptions: {
            input: {
                main: `./src/trezu-wallet`,
            },
            output: {
                entryFileNames: `trezu-wallet.js`,
                assetFileNames: `trezu-wallet.js`,
                format: "iife",
            },
        },
    },
});
