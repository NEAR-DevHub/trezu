// Esbuild shims for Node.js globals in browser
import { Buffer } from "buffer";

// Make Buffer available globally
if (typeof window !== "undefined") {
    window.Buffer = Buffer;
}

export { Buffer };
