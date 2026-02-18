const LEDGER_BRIDGE_REQUEST_TYPE = "trezu:ledger-bridge:request";
const LEDGER_BRIDGE_RESPONSE_TYPE = "trezu:ledger-bridge:response";
const LEDGER_BRIDGE_INSTALL_FLAG = "__TREZU_LEDGER_BRIDGE_INSTALLED__";
const LEDGER_BRIDGE_ALLOWED_PATHS = new Set([
    "/api/user/check-account-exists",
    "/api/user/create",
]);

interface LedgerBridgeRequestPayload {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

interface LedgerBridgeRequestMessage {
    type: typeof LEDGER_BRIDGE_REQUEST_TYPE;
    id: string;
    payload: LedgerBridgeRequestPayload;
}

interface LedgerBridgeResponsePayload {
    ok: boolean;
    status: number;
    body?: string;
    error?: string;
}

function normalizeBackendApiBase(base?: string): string {
    return (base || "").replace(/\/+$/, "");
}

function isAllowedLedgerBridgePath(pathname: string): boolean {
    return LEDGER_BRIDGE_ALLOWED_PATHS.has(pathname);
}

function buildLedgerBridgeTargetUrl(path: string): string {
    const backendApiBase = normalizeBackendApiBase(
        process.env.NEXT_PUBLIC_BACKEND_API_BASE,
    );
    return backendApiBase ? `${backendApiBase}${path}` : path;
}

export function setupLedgerSandboxBackendBridge() {
    if (typeof window === "undefined") return;

    const installMarker = window as typeof window & {
        [LEDGER_BRIDGE_INSTALL_FLAG]?: boolean;
    };
    if (installMarker[LEDGER_BRIDGE_INSTALL_FLAG]) {
        return;
    }
    installMarker[LEDGER_BRIDGE_INSTALL_FLAG] = true;

    window.addEventListener("message", async (event: MessageEvent) => {
        const data = event.data as LedgerBridgeRequestMessage | undefined;
        if (
            !data ||
            data.type !== LEDGER_BRIDGE_REQUEST_TYPE ||
            typeof data.id !== "string" ||
            typeof data.payload?.path !== "string"
        ) {
            return;
        }

        const source = event.source;
        if (
            !source ||
            typeof (source as WindowProxy).postMessage !== "function"
        ) {
            return;
        }

        let payload: LedgerBridgeResponsePayload;
        try {
            const pathUrl = new URL(data.payload.path, window.location.origin);
            if (!isAllowedLedgerBridgePath(pathUrl.pathname)) {
                throw new Error("Ledger bridge path is not allowed.");
            }

            const method = (data.payload.method || "GET").toUpperCase();
            if (method !== "GET" && method !== "POST") {
                throw new Error("Ledger bridge method is not allowed.");
            }

            const response = await fetch(
                buildLedgerBridgeTargetUrl(pathUrl.pathname + pathUrl.search),
                {
                    method,
                    headers: data.payload.headers || undefined,
                    body:
                        method === "GET"
                            ? undefined
                            : (data.payload.body ?? undefined),
                    credentials: "include",
                },
            );

            const responseText = await response.text();
            payload = {
                ok: response.ok,
                status: response.status,
                body: responseText,
            };
        } catch (error) {
            payload = {
                ok: false,
                status: 500,
                error:
                    error instanceof Error
                        ? error.message
                        : "Ledger bridge request failed.",
            };
        }

        (source as WindowProxy).postMessage(
            {
                type: LEDGER_BRIDGE_RESPONSE_TYPE,
                id: data.id,
                payload,
            },
            "*",
        );
    });
}
