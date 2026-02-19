// Ledger Hardware Wallet Executor for hot-connect
// This script provides Ledger device integration for NEAR Protocol transactions

// Import dependencies from npm packages
import { baseEncode, baseDecode } from "@near-js/utils";
import {
    Signature,
    createTransaction,
    encodeTransaction,
    encodeDelegateAction,
    SignedTransaction,
    buildDelegateAction,
    SignedDelegate,
    actionCreators,
} from "@near-js/transactions";
import { PublicKey } from "@near-js/crypto";
import { Buffer } from "buffer";
import {
    getSupportedTransport,
    createClient,
    isWebHidSupported,
    isWebUsbSupported,
    isWebBleSupported,
} from "./near-ledger.js";

// Destructure action creators for convenience
const {
    functionCall,
    transfer,
    addKey,
    deleteKey,
    createAccount,
    deleteAccount,
    stake,
    deployContract,
    fullAccessKey,
    functionCallAccessKey,
} = actionCreators;

// Ledger OS (BOLOS) constants for app management
const BOLOS_CLA = 0xb0;
const BOLOS_INS_GET_APP_NAME = 0x01;
const BOLOS_INS_QUIT_APP = 0xa7;
const P1_IGNORE = 0x00;
const P2_IGNORE = 0x00;

// Ledger app open constants
const APP_OPEN_CLA = 0xe0;
const APP_OPEN_INS = 0xd8;

// Default derivation path for NEAR
const DEFAULT_DERIVATION_PATH = "44'/397'/0'/0'/1'";

// Storage keys
const STORAGE_KEY_ACCOUNTS = "ledger:accounts";
const STORAGE_KEY_DERIVATION_PATH = "ledger:derivationPath";
const STORAGE_KEY_TRANSPORT_MODE = "ledger:transportMode";
const LEDGER_BRIDGE_REQUEST_TYPE = "trezu:ledger-bridge:request";
const LEDGER_BRIDGE_RESPONSE_TYPE = "trezu:ledger-bridge:response";

function createBridgeResponse(responsePayload) {
    return {
        ok: Boolean(responsePayload?.ok),
        status:
            typeof responsePayload?.status === "number"
                ? responsePayload.status
                : 500,
        async json() {
            if (typeof responsePayload?.body !== "string") {
                return null;
            }
            return JSON.parse(responsePayload.body);
        },
        async text() {
            if (typeof responsePayload?.body !== "string") {
                return "";
            }
            return responsePayload.body;
        },
    };
}

async function fetchViaParentBridge(path, init = {}) {
    if (typeof window === "undefined" || !window.parent) {
        throw new Error("Parent bridge is unavailable.");
    }

    const requestId = `ledger-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
        path,
        method: init.method || "GET",
        headers: init.headers || {},
        body: typeof init.body === "string" ? init.body : undefined,
    };

    return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            window.removeEventListener("message", onBridgeMessage);
            reject(new Error("Parent bridge timed out."));
        }, 15000);

        function onBridgeMessage(event) {
            const data = event.data;
            if (
                !data ||
                data.type !== LEDGER_BRIDGE_RESPONSE_TYPE ||
                data.id !== requestId
            ) {
                return;
            }

            clearTimeout(timeoutId);
            window.removeEventListener("message", onBridgeMessage);

            if (data.payload?.error) {
                reject(new Error(data.payload.error));
                return;
            }

            resolve(createBridgeResponse(data.payload));
        }

        window.addEventListener("message", onBridgeMessage);
        window.parent.postMessage(
            {
                type: LEDGER_BRIDGE_REQUEST_TYPE,
                id: requestId,
                payload,
            },
            "*",
        );
    });
}

async function fetchBackend(path, init = {}) {
    try {
        return await fetchViaParentBridge(path, init);
    } catch (bridgeError) {
        console.warn(
            "Ledger parent bridge unavailable, falling back to direct fetch:",
            bridgeError,
        );
        return await fetch(path, init);
    }
}

/**
 * Check which transport methods are supported in the current browser
 * @returns {Promise<{webHID: boolean, webUSB: boolean, webBLE: boolean}>}
 */
async function getAvailableTransports() {
    const [webHID, webUSB, webBLE] = await Promise.all([
        isWebHidSupported(),
        isWebUsbSupported(),
        isWebBleSupported(),
    ]);
    return {
        webHID,
        webUSB,
        webBLE,
    };
}

/**
 * Prompt user to select a transport method
 * @param {Object} availableTransports - Object with webHID, webUSB, webBLE boolean flags
 * @param {string} currentMode - Currently selected mode (if any)
 * @returns {Promise<string>} - Selected transport mode ('WebHID', 'WebUSB', or 'WebBLE')
 */
async function promptForTransportSelection(
    availableTransports,
    currentMode = null,
) {
    const hasUSBOption =
        availableTransports.webHID || availableTransports.webUSB;
    const hasBluetoothOption = availableTransports.webBLE;

    const resolveTransportMode = (selectedMode) => {
        if (selectedMode === "BLUETOOTH") {
            if (availableTransports.webBLE) return "WebBLE";
            throw new Error("WebBLE is not available for BLUETOOTH selection.");
        }

        if (selectedMode === "USB") {
            if (availableTransports.webHID) return "WebHID";
            if (availableTransports.webUSB) return "WebUSB";
            throw new Error(
                "No supported USB transport available for USB selection.",
            );
        }

        throw new Error(`Unknown transport selection mode: ${selectedMode}`);
    };

    const availableOptions = [];
    if (hasUSBOption) availableOptions.push("USB");
    if (hasBluetoothOption) availableOptions.push("BLUETOOTH");

    if (availableOptions.length === 0) {
        throw new Error(
            "No supported Ledger transport methods found in this browser.",
        );
    }

    if (availableOptions.length === 1) {
        return resolveTransportMode(availableOptions[0]);
    }

    let currentSelection = null;
    if (currentMode === "WebBLE") {
        currentSelection = "BLUETOOTH";
    } else if (currentMode === "WebHID" || currentMode === "WebUSB") {
        currentSelection = "USB";
    }

    // Show UI for selection
    await window.selector.ui.showIframe();

    const root = document.getElementById("root");
    root.style.display = "flex";

    function renderUI() {
        const transportOptions = [
            {
                id: "USB",
                name: "USB",
                description: "Wired Ledger connection",
                icon: "🔌",
                available: hasUSBOption,
            },
            {
                id: "BLUETOOTH",
                name: "BLUETOOTH",
                description: "Wireless Ledger connection",
                icon: "📡",
                available: hasBluetoothOption,
            },
        ];

        const availableOnly = transportOptions.filter((opt) => opt.available);

        root.innerHTML = `
        <div class="prompt-container" style="max-width: 420px; padding: 24px; box-sizing: border-box;">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="font-size: 48px; margin-bottom: 12px;">🔐</div>
            <h1 style="margin: 0 0 8px 0; font-size: 20px;">Connect Ledger</h1>
            <p style="margin: 0; color: #aaa; font-size: 13px;">Choose your connection method</p>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
            ${availableOnly
                .map(
                    (opt) => `
              <button
                class="transport-option"
                data-mode="${opt.id}"
                style="width: 100%; padding: 16px; border-radius: 10px;
                       border: 2px solid ${currentSelection === opt.id ? "#4c8bf5" : "#444"};
                       background: ${currentSelection === opt.id ? "#1a3a5c" : "#2c2c2c"};
                       color: #fff; cursor: pointer; text-align: left;
                       min-height: 88px; transition: border-color 0.2s, background-color 0.2s; box-sizing: border-box;
                       display: flex; align-items: center; gap: 12px;"
                onmouseover="this.style.borderColor='#4c8bf5'; this.style.background='#1a3a5c';"
                onmouseout="this.style.borderColor='${currentSelection === opt.id ? "#4c8bf5" : "#444"}'; this.style.background='${currentSelection === opt.id ? "#1a3a5c" : "#2c2c2c"}';"
              >
                <div style="font-size: 32px; flex-shrink: 0;">${opt.icon}</div>
                <div style="flex: 1;">
                  <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">${opt.name}</div>
                  <div style="color: #888; font-size: 12px;">${opt.description}</div>
                </div>
                <div style="width: 20px; text-align: center; color: #4c8bf5; font-size: 20px; flex-shrink: 0;">
                  ${currentSelection === opt.id ? "✓" : "&nbsp;"}
                </div>
              </button>
            `,
                )
                .join("")}
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="cancelBtn" style="padding: 10px 20px; border-radius: 8px; border: 1px solid #444; background: #444; color: #fff; cursor: pointer; font-size: 14px;">Cancel</button>
            <button id="continueBtn" style="padding: 10px 20px; border-radius: 8px; border: none; background: #4c8bf5; color: #fff; cursor: pointer; font-size: 14px; font-weight: 500;" ${!currentSelection ? "disabled" : ""}>Continue</button>
          </div>
        </div>
      `;
    }

    renderUI();

    return new Promise((resolve, reject) => {
        function setupListeners() {
            const continueBtn = document.getElementById("continueBtn");
            const cancelBtn = document.getElementById("cancelBtn");
            const transportOptions =
                document.querySelectorAll(".transport-option");

            transportOptions.forEach((btn) => {
                btn.addEventListener("click", () => {
                    currentSelection = btn.dataset.mode;
                    renderUI();
                    setupListeners();
                    // Enable continue button
                    const newContinueBtn =
                        document.getElementById("continueBtn");
                    newContinueBtn.disabled = false;
                    newContinueBtn.style.opacity = "1";
                });
            });

            continueBtn.addEventListener("click", () => {
                if (currentSelection) {
                    resolve(resolveTransportMode(currentSelection));
                }
            });

            cancelBtn.addEventListener("click", () => {
                root.innerHTML = "";
                root.style.display = "none";
                window.selector.ui.hideIframe();
                reject(new Error("User cancelled transport selection"));
            });
        }

        setupListeners();
    });
}

/**
 * LedgerClient class for APDU communication with Ledger device
 */
class LedgerClient {
    constructor() {
        this.transport = null;
        this.transportMode = null;
        this.client = null;
    }

    isConnected() {
        return this.transport !== null;
    }

    async getStoredTransportMode() {
        return await window.selector.storage.get(STORAGE_KEY_TRANSPORT_MODE);
    }

    async setStoredTransportMode(mode) {
        await window.selector.storage.set(STORAGE_KEY_TRANSPORT_MODE, mode);
    }

    async connect() {
        // Get available transports
        const availableTransports = await getAvailableTransports();

        // Get stored preference or prompt for selection
        let transportMode = await this.getStoredTransportMode();

        // If stored mode is not available, prompt for selection
        const isStoredModeAvailable =
            (transportMode === "WebHID" && availableTransports.webHID) ||
            (transportMode === "WebUSB" && availableTransports.webUSB) ||
            (transportMode === "WebBLE" && availableTransports.webBLE);

        if (!isStoredModeAvailable) {
            transportMode = await promptForTransportSelection(
                availableTransports,
                transportMode,
            );
            await this.setStoredTransportMode(transportMode);
        }

        this.transportMode = transportMode;

        // Request new device (requires user gesture)
        this.transport = await getSupportedTransport(transportMode);
        this.client = await createClient(this.transport, transportMode);
        this._setupDisconnectHandler();
    }

    async connectWithDevice(transportMode) {
        // Connect using the specified transport mode
        this.transportMode = transportMode;
        this.transport = await getSupportedTransport(transportMode);
        this.client = await createClient(this.transport, transportMode);
        this._setupDisconnectHandler();
    }

    _setupDisconnectHandler() {
        const handleDisconnect = () => {
            if (this.transport) {
                this.transport.off("disconnect", handleDisconnect);
            }
            this.transport = null;
            this.client = null;
        };

        this.transport.on("disconnect", handleDisconnect);
    }

    async disconnect() {
        if (!this.transport) {
            throw new Error("Device not connected");
        }

        await this.transport.close();
        this.transport = null;
        this.client = null;
    }

    async getVersion() {
        if (!this.client) {
            throw new Error("Device not connected");
        }

        return await this.client.getVersion();
    }

    async getPublicKey(derivationPath) {
        if (!this.client) {
            throw new Error("Device not connected");
        }

        const publicKeyBuffer = await this.client.getPublicKey(derivationPath);
        return baseEncode(publicKeyBuffer);
    }

    async sign(data, derivationPath) {
        if (!this.client) {
            throw new Error("Device not connected");
        }

        return await this.client.sign(data, derivationPath);
    }

    async signMessage(data, derivationPath) {
        if (!this.client) {
            throw new Error("Device not connected");
        }

        // NEP-413 prefix
        const NEP413_PREFIX = new Uint8Array([0x9d, 0x01, 0x00, 0x80]);
        const dataWithPrefix = new Uint8Array(
            NEP413_PREFIX.length + data.length,
        );
        dataWithPrefix.set(NEP413_PREFIX, 0);
        dataWithPrefix.set(data, NEP413_PREFIX.length);

        return await this.client.sign(dataWithPrefix, derivationPath);
    }

    async signDelegation(data, derivationPath) {
        if (!this.client) {
            throw new Error("Device not connected");
        }

        // NEP-366 prefix
        const NEP366_PREFIX = new Uint8Array([0x6e, 0x01, 0x00, 0x40]);
        const dataWithPrefix = new Uint8Array(
            NEP366_PREFIX.length + data.length,
        );
        dataWithPrefix.set(NEP366_PREFIX, 0);
        dataWithPrefix.set(data, NEP366_PREFIX.length);

        return await this.client.sign(dataWithPrefix, derivationPath);
    }

    /**
     * Get the name of the currently running app on the Ledger
     * @returns {Promise<string>} The app name (e.g., "NEAR", "BOLOS" for dashboard)
     */
    async getRunningAppName() {
        if (!this.transport) {
            throw new Error("Device not connected");
        }

        const res = await this.transport.send(
            BOLOS_CLA,
            BOLOS_INS_GET_APP_NAME,
            P1_IGNORE,
            P2_IGNORE,
        );

        // Response format: format u8, name length u8, name bytes
        const nameLength = res[1];
        const nameBytes = res.subarray(2, 2 + nameLength);
        return new TextDecoder().decode(nameBytes);
    }

    /**
     * Quit the currently open application on the Ledger
     */
    async quitOpenApplication() {
        if (!this.transport) {
            throw new Error("Device not connected");
        }

        await this.transport.send(
            BOLOS_CLA,
            BOLOS_INS_QUIT_APP,
            P1_IGNORE,
            P2_IGNORE,
        );
    }

    /**
     * Open the NEAR application on the Ledger device
     * This checks if NEAR is already running, quits any other app if needed,
     * and opens the NEAR app
     */
    async openNearApplication() {
        if (!this.transport) {
            throw new Error("Device not connected");
        }

        const runningApp = await this.getRunningAppName();

        if (runningApp === "NEAR") {
            // NEAR app already running
            return;
        }

        if (runningApp !== "BOLOS") {
            // Another app is running, quit it first
            await this.quitOpenApplication();
            // Wait for the Ledger to close the app
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Open the NEAR app
        const nearAppName = new TextEncoder().encode("NEAR");
        try {
            await this.transport.send(
                APP_OPEN_CLA,
                APP_OPEN_INS,
                0x00,
                0x00,
                nearAppName,
            );
        } catch (error) {
            // Check for specific error codes in the error message
            const errorMsg = error.message || "";
            if (errorMsg.includes("6807")) {
                throw new Error(
                    "NEAR application is missing on the Ledger device",
                );
            }
            if (errorMsg.includes("5501")) {
                throw new Error("User declined to open the NEAR app");
            }
            throw error;
        }
    }
}

/**
 * Get user-friendly error message for Ledger errors
 */
function getLedgerErrorMessage(error) {
    const errorMsg = error.message || "";

    if (errorMsg.includes("0xb005") || errorMsg.includes("UNKNOWN_ERROR")) {
        return "Please make sure your Ledger device is unlocked and the NEAR app is open. Please approve opening app on your Ledger device.";
    }
    if (errorMsg.includes("0x5515") || errorMsg.includes("Locked device")) {
        return "Your Ledger device is locked. Please unlock it and try again.";
    }
    if (errorMsg.includes("6807") || errorMsg.includes("missing")) {
        return "NEAR application is not installed on your Ledger device. Please install it using Ledger Live.";
    }
    if (errorMsg.includes("5501") || errorMsg.includes("declined")) {
        return "You declined to open the NEAR app. Please try again and please approve opening app on your device.";
    }
    if (errorMsg.includes("No device selected")) {
        return "No Ledger device was selected. Please try again and select your device.";
    }

    return errorMsg || "An unknown error occurred. Please try again.";
}

/**
 * Helper function to prompt user to connect Ledger device
 * This shows a button inside the sandbox iframe that provides the user gesture context
 * required by WebHID/WebUSB/WebBLE API
 */
async function promptForLedgerConnect(ledgerClient) {
    let storedMode = null;
    let canChangeConnectionMethod = false;

    // Read stored mode first, but always render UI before any Ledger interaction.
    storedMode = await ledgerClient.getStoredTransportMode();

    // Need to request device access - show UI with button for user gesture
    await window.selector.ui.showIframe();

    const root = document.getElementById("root");
    root.style.display = "flex";

    try {
        const availableTransports = await getAvailableTransports();
        const selectionOptionsCount =
            (availableTransports.webHID || availableTransports.webUSB ? 1 : 0) +
            (availableTransports.webBLE ? 1 : 0);
        canChangeConnectionMethod = selectionOptionsCount > 1;
    } catch {
        canChangeConnectionMethod = false;
    }

    function isGuidanceMessage(message) {
        const text = (message || "").toLowerCase();
        return (
            text.includes("device is locked") ||
            text.includes("please unlock") ||
            text.includes("please approve opening app")
        );
    }

    function renderUI(errorMessage = null) {
        // Transport selection may temporarily hide the root; force it visible here.
        root.style.display = "flex";

        const showGuidance =
            Boolean(errorMessage) && isGuidanceMessage(errorMessage);
        const messageContainerStyles = showGuidance
            ? "background: #232933; border: 1px solid #33435d;"
            : "background: #3d2020; border: 1px solid #5c3030;";
        const messageTextStyles = showGuidance
            ? "color: #9fc1ff;"
            : "color: #ff8080;";

        const connectionInstructions =
            ledgerClient.transportMode === "WebBLE"
                ? "Make sure your Ledger Nano X or newer is powered on, Bluetooth is enabled."
                : "Make sure your Ledger is connected via USB.";

        root.innerHTML = `
        <div class="prompt-container" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">${errorMessage ? (showGuidance ? "🔐" : "⚠️") : "🔐"}</div>
          <h1 style="margin-bottom: 16px;">${errorMessage ? (showGuidance ? "Action Required" : "Connection Failed") : "Connect Ledger"}</h1>
          ${
              errorMessage
                  ? `
          <div style="${messageContainerStyles} border-radius: 8px; padding: 12px; margin-bottom: 16px; text-align: left;">
            <p style="${messageTextStyles} font-size: 13px; margin: 0;">${errorMessage}</p>
          </div>
          `
                  : ""
          }
          <p id="connectionInstructions" style="margin-bottom: 12px; color: #aaa;">
            ${connectionInstructions}
          </p>
          <p id="connectionStatusMessage" style="margin-bottom: 16px; color: #4c8bf5; font-size: 13px; display: none;">
          </p>
          ${
              storedMode && canChangeConnectionMethod
                  ? `
          <button id="changeMethodBtn" style="background: transparent; border: none; color: #888; font-size: 12px; cursor: pointer; padding: 0; margin-bottom: 16px; text-decoration: underline;">
            Change connection method
          </button>
          `
                  : ""
          }
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button id="cancelBtn" style="background: #444;">Cancel</button>
            <button id="connectBtn" style="background: #4c8bf5;">${errorMessage ? "Try Again" : "Connect Ledger"}</button>
          </div>
        </div>
      `;
    }

    renderUI();

    return new Promise((resolve, reject) => {
        function setupListeners() {
            const connectBtn = document.getElementById("connectBtn");
            const cancelBtn = document.getElementById("cancelBtn");
            const changeMethodBtn = document.getElementById("changeMethodBtn");

            // Handle change connection method
            if (changeMethodBtn) {
                changeMethodBtn.addEventListener("click", async () => {
                    try {
                        // Show selection UI
                        const availableTransports =
                            await getAvailableTransports();
                        const newMode = await promptForTransportSelection(
                            availableTransports,
                            storedMode,
                        );
                        await ledgerClient.setStoredTransportMode(newMode);
                        ledgerClient.transportMode = newMode;
                        storedMode = newMode;
                        // Re-render UI with new mode
                        renderUI();
                        setupListeners();
                    } catch (error) {
                        if (
                            error.message !==
                            "User cancelled transport selection"
                        ) {
                            renderUI(getLedgerErrorMessage(error));
                            setupListeners();
                        }
                    }
                });
            }

            connectBtn.addEventListener("click", async () => {
                // Show loading state
                connectBtn.disabled = true;
                connectBtn.textContent = "Connecting...";
                const statusMessage = document.getElementById(
                    "connectionStatusMessage",
                );
                const instructions = document.getElementById(
                    "connectionInstructions",
                );

                try {
                    // Disconnect first to ensure clean state
                    if (ledgerClient.isConnected()) {
                        try {
                            await ledgerClient.disconnect();
                        } catch {
                            // Ignore disconnect errors
                        }
                    }
                    // This click provides the user gesture context for WebHID
                    await ledgerClient.connect();
                    if (statusMessage) {
                        statusMessage.textContent =
                            "Please approve opening app on your Ledger device.";
                        statusMessage.style.display = "block";
                    }
                    if (instructions) {
                        instructions.textContent =
                            "Check your Ledger screen and approve opening the NEAR app.";
                    }
                    connectBtn.textContent = "Waiting for approval...";
                    // Ensure NEAR app is open
                    await ledgerClient.openNearApplication();
                    // Don't hide iframe - let next UI (derivation path) take over smoothly
                    resolve();
                } catch (error) {
                    // Disconnect on failure to ensure clean state
                    if (ledgerClient.isConnected()) {
                        try {
                            await ledgerClient.disconnect();
                        } catch {
                            // Ignore disconnect errors
                        }
                    }
                    // Show error in UI and allow retry
                    const friendlyError = getLedgerErrorMessage(error);
                    renderUI(friendlyError);
                    setupListeners();
                }
            });

            cancelBtn.addEventListener("click", () => {
                root.innerHTML = "";
                root.style.display = "none";
                window.selector.ui.hideIframe();
                reject(new Error("User cancelled"));
            });
        }

        setupListeners();
    });
}

/**
 * Helper function to show derivation path selection UI
 * @param {string} currentPath - Current derivation path
 * @returns {Promise<string>} - Selected derivation path
 */
async function promptForDerivationPath(currentPath = DEFAULT_DERIVATION_PATH) {
    await window.selector.ui.showIframe();

    const root = document.getElementById("root");
    root.style.display = "flex";

    let showCustom = false;

    function renderUI() {
        root.innerHTML = `
        <div class="prompt-container" style="max-width: 380px; padding: 20px; box-sizing: border-box; overflow: hidden;">
          <h1 style="margin: 0 0 12px 0; font-size: 18px;">Select Derivation Path</h1>
          <p style="margin: 0 0 12px 0; color: #aaa; font-size: 13px;">
            Choose which account index to use from your Ledger device.
          </p>
          <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
            <button
              id="path0Btn"
              class="path-btn"
              data-path="44'/397'/0'/0'/0'"
              style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid ${currentPath === "44'/397'/0'/0'/0'" ? "#4c8bf5" : "#444"};
                     background: ${currentPath === "44'/397'/0'/0'/0'" ? "#1a3a5c" : "#2c2c2c"}; color: #fff; font-size: 13px; text-align: left; cursor: pointer; box-sizing: border-box;"
            >
              <span style="font-weight: 500;">Account 1</span>
              <span style="color: #888; font-size: 11px; font-family: monospace; display: block; margin-top: 2px;">44'/397'/0'/0'/0'</span>
            </button>
            <button
              id="path1Btn"
              class="path-btn"
              data-path="44'/397'/0'/0'/1'"
              style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid ${currentPath === "44'/397'/0'/0'/1'" ? "#4c8bf5" : "#444"};
                     background: ${currentPath === "44'/397'/0'/0'/1'" ? "#1a3a5c" : "#2c2c2c"}; color: #fff; font-size: 13px; text-align: left; cursor: pointer; box-sizing: border-box;"
            >
              <span style="font-weight: 500;">Account 2</span>
              <span style="color: #888; font-size: 11px; font-family: monospace; display: block; margin-top: 2px;">44'/397'/0'/0'/1'</span>
            </button>
            <button
              id="path2Btn"
              class="path-btn"
              data-path="44'/397'/0'/0'/2'"
              style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid ${currentPath === "44'/397'/0'/0'/2'" ? "#4c8bf5" : "#444"};
                     background: ${currentPath === "44'/397'/0'/0'/2'" ? "#1a3a5c" : "#2c2c2c"}; color: #fff; font-size: 13px; text-align: left; cursor: pointer; box-sizing: border-box;"
            >
              <span style="font-weight: 500;">Account 3</span>
              <span style="color: #888; font-size: 11px; font-family: monospace; display: block; margin-top: 2px;">44'/397'/0'/0'/2'</span>
            </button>
          </div>
          <div style="margin-bottom: 12px;">
            <button
              id="toggleCustomBtn"
              style="background: transparent; border: none; color: #888; font-size: 12px; cursor: pointer; padding: 0; text-decoration: underline;"
            >
              ${showCustom ? "Hide" : "Use"} custom path
            </button>
            ${
                showCustom
                    ? `
            <div style="margin-top: 10px;">
              <input
                type="text"
                id="customPathInput"
                value="${currentPath}"
                placeholder="44'/397'/0'/0'/0'"
                style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #444;
                       background: #2c2c2c; color: #fff; font-size: 12px; font-family: monospace; box-sizing: border-box;"
              />
            </div>
            `
                    : ""
            }
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="cancelBtn" style="background: #444;">Cancel</button>
            <button id="confirmBtn" style="background: #4c8bf5;">Continue</button>
          </div>
        </div>
      `;
    }

    renderUI();

    return new Promise((resolve, reject) => {
        function setupListeners() {
            const confirmBtn = document.getElementById("confirmBtn");
            const cancelBtn = document.getElementById("cancelBtn");
            const toggleCustomBtn = document.getElementById("toggleCustomBtn");
            const customPathInput = document.getElementById("customPathInput");
            const pathBtns = document.querySelectorAll(".path-btn");

            // Handle path button clicks
            pathBtns.forEach((btn) => {
                btn.addEventListener("click", () => {
                    currentPath = btn.dataset.path;
                    renderUI();
                    setupListeners();
                });
            });

            // Handle toggle custom path
            toggleCustomBtn.addEventListener("click", () => {
                showCustom = !showCustom;
                renderUI();
                setupListeners();
            });

            confirmBtn.addEventListener("click", () => {
                const finalPath =
                    showCustom && customPathInput
                        ? customPathInput.value.trim() || currentPath
                        : currentPath;
                root.innerHTML = "";
                root.style.display = "none";
                // Don't hide iframe - let next UI take over
                resolve(finalPath);
            });

            cancelBtn.addEventListener("click", () => {
                root.innerHTML = "";
                root.style.display = "none";
                window.selector.ui.hideIframe();
                reject(new Error("User cancelled"));
            });
        }

        setupListeners();
    });
}

/**
 * Helper function to show a waiting/approval UI
 * @param {string} title - Title to display
 * @param {string} message - Message to display
 * @param {Function} asyncOperation - Async operation to perform
 * @param {boolean} hideOnSuccess - Whether to hide iframe on success (default: false to allow smooth transition to next UI)
 * @returns {Promise} - Result of the async operation
 */
async function showLedgerApprovalUI(
    title,
    message,
    asyncOperation,
    hideOnSuccess = false,
) {
    await window.selector.ui.showIframe();

    const root = document.getElementById("root");
    root.style.display = "flex";

    function renderLoadingUI() {
        root.style.display = "flex";
        root.innerHTML = `
        <div class="prompt-container" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
          <h1 style="margin-bottom: 16px;">${title}</h1>
          <p style="margin-bottom: 24px; color: #aaa;">${message}</p>
          <div style="display: flex; justify-content: center;">
            <div style="width: 24px; height: 24px; border: 3px solid #444; border-top-color: #4c8bf5; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          </div>
          <style>
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          </style>
        </div>
      `;
    }

    function renderErrorUI(errorMessage) {
        root.style.display = "flex";
        root.innerHTML = `
        <div class="prompt-container" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
          <h1 style="margin-bottom: 12px;">Action Required</h1>
          <div style="background: #232933; border: 1px solid #33435d; border-radius: 8px; padding: 12px; margin-bottom: 16px; text-align: left;">
            <p style="color: #9fc1ff; font-size: 13px; margin: 0;">${errorMessage}</p>
          </div>
          <p style="margin-bottom: 16px; color: #aaa;">
            Unlock your Ledger and retry when ready.
          </p>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button id="approvalCancelBtn" style="background: #444;">Cancel</button>
            <button id="approvalRetryBtn" style="background: #4c8bf5;">Try Again</button>
          </div>
        </div>
      `;
    }

    function waitForRetryAction() {
        return new Promise((resolve, reject) => {
            const retryBtn = document.getElementById("approvalRetryBtn");
            const cancelBtn = document.getElementById("approvalCancelBtn");

            if (!retryBtn || !cancelBtn) {
                reject(new Error("Approval prompt controls are unavailable."));
                return;
            }

            retryBtn.addEventListener("click", () => resolve("retry"), {
                once: true,
            });
            cancelBtn.addEventListener("click", () => resolve("cancel"), {
                once: true,
            });
        });
    }

    while (true) {
        renderLoadingUI();
        try {
            const result = await asyncOperation();
            if (hideOnSuccess) {
                root.innerHTML = "";
                root.style.display = "none";
                window.selector.ui.hideIframe();
            }
            // Don't hide on success - let the next UI take over smoothly
            return result;
        } catch (error) {
            renderErrorUI(getLedgerErrorMessage(error));
            const action = await waitForRetryAction();
            if (action === "retry") {
                continue;
            }
            root.innerHTML = "";
            root.style.display = "none";
            window.selector.ui.hideIframe();
            throw new Error("User cancelled");
        }
    }
}

/**
 * Helper function to show account ID input dialog
 * @param {string} implicitAccountId - Optional implicit account ID for the button
 * @param {Function} onVerify - Optional async function to verify the account (receives accountId, returns true or throws)
 * @param {Function} onCreateAccount - Optional async function to create account when missing
 * @param {boolean} hideOnSuccess - Whether to hide iframe on success
 */
async function promptForAccountId(
    implicitAccountId = "",
    onVerify = null,
    onCreateAccount = null,
    hideOnSuccess = true,
) {
    await window.selector.ui.showIframe();

    const root = document.getElementById("root");
    root.style.display = "flex";

    function renderUI(errorMessage = null, currentValue = "") {
        root.innerHTML = `
        <div class="prompt-container" style="max-width: 400px; padding: 24px;">
          <h1 style="margin-bottom: 16px;">Enter Account ID</h1>
          <p style="margin-bottom: 16px; color: #aaa;">
            Ledger provides your public key. Please enter the NEAR account ID
            that this key has full access to.
          </p>
          ${
              errorMessage
                  ? `
          <div style="background: #3d2020; border: 1px solid #5c3030; border-radius: 8px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <p style="color: #ff8080; font-size: 13px; margin: 0;">${errorMessage}</p>
          </div>
          `
                  : ""
          }
          <input
            type="text"
            id="accountIdInput"
            placeholder="example.near"
            value="${currentValue}"
            style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid ${errorMessage ? "#5c3030" : "#444"};
                   background: #2c2c2c; color: #fff; font-size: 14px; margin-bottom: 8px;"
          />
          ${
              implicitAccountId
                  ? `
          <button
            id="useImplicitBtn"
            style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #555;
                   background: transparent; color: #aaa; font-size: 12px; margin-bottom: 16px;
                   cursor: pointer; text-align: left;"
          >
            Use implicit account: <span style="color: #4c8bf5; font-family: monospace;">${implicitAccountId.slice(0, 12)}...${implicitAccountId.slice(-8)}</span>
          </button>
          `
                  : ""
          }
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="cancelBtn" style="background: #444;">Cancel</button>
            <button id="confirmBtn" style="background: #4c8bf5;">Confirm</button>
          </div>
        </div>
      `;
    }

    renderUI();

    return new Promise((resolve, reject) => {
        function closeOnSuccess() {
            if (!hideOnSuccess) {
                return;
            }
            root.innerHTML = "";
            root.style.display = "none";
            window.selector.ui.hideIframe();
        }

        function setupListeners() {
            const input = document.getElementById("accountIdInput");
            const confirmBtn = document.getElementById("confirmBtn");
            const cancelBtn = document.getElementById("cancelBtn");
            const useImplicitBtn = document.getElementById("useImplicitBtn");

            // Handle "Use implicit account" button click
            if (useImplicitBtn && implicitAccountId) {
                useImplicitBtn.addEventListener("click", () => {
                    input.value = implicitAccountId;
                    input.focus();
                });
            }

            confirmBtn.addEventListener("click", async () => {
                const accountId = input.value.trim();
                if (!accountId) return;

                // If verification function provided, verify first
                if (onVerify) {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = "Verifying...";

                    try {
                        await onVerify(accountId);
                        closeOnSuccess();
                        resolve(accountId);
                    } catch (error) {
                        if (
                            error?.code === "ACCOUNT_CREATION_REQUIRED" &&
                            onCreateAccount
                        ) {
                            try {
                                const created = await promptForCreateAccount(
                                    accountId,
                                    error.message,
                                    onCreateAccount,
                                );
                                if (created) {
                                    closeOnSuccess();
                                    resolve(accountId);
                                    return;
                                }
                                // User cancelled create flow: return to account input without an error toast.
                                renderUI(null, accountId);
                                setupListeners();
                            } catch (createError) {
                                renderUI(createError.message, accountId);
                                setupListeners();
                            }
                        } else {
                            // Show error and allow retry
                            renderUI(error.message, accountId);
                            setupListeners();
                        }
                    }
                } else {
                    closeOnSuccess();
                    resolve(accountId);
                }
            });

            cancelBtn.addEventListener("click", () => {
                root.innerHTML = "";
                root.style.display = "none";
                window.selector.ui.hideIframe();
                reject(new Error("User cancelled"));
            });

            input.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    confirmBtn.click();
                }
            });

            // Focus the input
            setTimeout(() => input.focus(), 100);
        }

        setupListeners();
    });
}

/**
 * Show a confirm/create dialog for accounts that are not ready for Ledger sign-in.
 * Returns true when account creation succeeds, false when cancelled by user.
 */
async function promptForCreateAccount(
    accountId,
    reasonMessage,
    onCreateAccount,
) {
    const root = document.getElementById("root");
    root.style.display = "flex";

    function renderUI(errorMessage = null) {
        root.innerHTML = `
        <div class="prompt-container" style="width: min(420px, calc(100vw - 32px)); max-width: 100%; padding: 24px; box-sizing: border-box; overflow-wrap: anywhere; word-break: break-word;">
          <h1 style="margin-bottom: 12px;">Account Doesn't Exist</h1>
          <p style="margin-bottom: 12px; color: #aaa; overflow-wrap: anywhere; word-break: break-word;">
            The provided account does not exist on NEAR blockchain.
          </p>
          <p style="margin-bottom: 16px; color: #aaa;">
            Do you want to create this account now?
          </p>
          ${
              reasonMessage
                  ? `
          <div style="background: #232933; border: 1px solid #33435d; border-radius: 8px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <p style="color: #9fc1ff; font-size: 13px; margin: 0; overflow-wrap: anywhere; word-break: break-word;">Account<br/>${accountId}</p>
          </div>
          `
                  : ""
          }
          ${
              errorMessage
                  ? `
          <div style="background: #3d2020; border: 1px solid #5c3030; border-radius: 8px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <p style="color: #ff8080; font-size: 13px; margin: 0; overflow-wrap: anywhere; word-break: break-word;">${errorMessage}</p>
          </div>
          `
                  : ""
          }
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="createAccountCancelBtn" style="background: #444;">Cancel</button>
            <button id="createAccountConfirmBtn" style="background: #4c8bf5;">Create Account</button>
          </div>
        </div>
      `;
    }

    renderUI();

    return new Promise((resolve, reject) => {
        function setupListeners() {
            const cancelBtn = document.getElementById("createAccountCancelBtn");
            const createBtn = document.getElementById(
                "createAccountConfirmBtn",
            );

            cancelBtn.addEventListener("click", () => {
                resolve(false);
            });

            createBtn.addEventListener("click", async () => {
                createBtn.disabled = true;
                createBtn.textContent = "Creating...";
                try {
                    await onCreateAccount(accountId);
                    resolve(true);
                } catch (error) {
                    renderUI(error.message || "Failed to create account.");
                    setupListeners();
                }
            });
        }

        try {
            setupListeners();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Helper function to fetch from RPC
 */
async function rpcRequest(network, method, params) {
    // Use FastNEAR RPC endpoints
    const rpcUrls = {
        mainnet: "https://rpc.mainnet.fastnear.com",
        testnet: "https://rpc.testnet.fastnear.com",
    };

    // Always use our known-good RPC endpoints
    const rpcUrl = rpcUrls[network] || rpcUrls.mainnet;

    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: "dontcare",
            method,
            params,
        }),
    });

    const json = await response.json();

    if (json.error) {
        throw new Error(json.error.message || "RPC request failed");
    }

    // Some RPC providers return query failures in result.error instead of json.error.
    if (json.result?.error) {
        const resultError =
            typeof json.result.error === "string"
                ? json.result.error
                : json.result.error.message ||
                  JSON.stringify(json.result.error) ||
                  "RPC request failed";
        throw new Error(resultError);
    }

    return json.result;
}

/**
 * Request backend to create an account with Ledger public key.
 */
async function createUserAccountViaBackend(payload) {
    const response = await fetchBackend("/api/user/create", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            accountId: payload.accountId,
            publicKey: payload.publicKey,
        }),
    });

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok) {
        const message =
            body?.error ||
            body?.message ||
            (typeof body === "string" ? body : null) ||
            "Failed to create account. Please try again.";
        throw new Error(message);
    }

    return body;
}

async function checkAccountExistsViaBackend(accountId) {
    const response = await fetchBackend(
        `/api/user/check-account-exists?accountId=${encodeURIComponent(accountId)}`,
    );

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok) {
        const message =
            body?.error ||
            body?.message ||
            (typeof body === "string" ? body : null) ||
            "Failed to check account existence.";
        throw new Error(message);
    }

    if (typeof body?.exists !== "boolean") {
        throw new Error("Invalid account existence response from backend.");
    }

    return body.exists;
}

function isAccountMissingError(errorMessage) {
    return (
        errorMessage.includes("account does not exist while viewing") ||
        errorMessage.includes("does not exist while viewing") ||
        errorMessage.includes("UnknownAccount")
    );
}

async function checkAccountExists(network, accountId) {
    try {
        return await checkAccountExistsViaBackend(accountId);
    } catch (backendError) {
        console.warn(
            "Falling back to RPC for account existence check:",
            backendError,
        );
    }

    try {
        await rpcRequest(network, "query", {
            request_type: "view_account",
            finality: "final",
            account_id: accountId,
        });
        return true;
    } catch (error) {
        const errorMsg = error?.message || "";
        if (isAccountMissingError(errorMsg)) {
            return false;
        }
        throw error;
    }
}

/**
 * Verify that the public key has full access to the account
 */
async function verifyAccessKey(network, accountId, publicKey) {
    const accountExists = await checkAccountExists(network, accountId);
    if (!accountExists) {
        const creationRequiredError = new Error(
            `Account ${accountId} does not exist yet.`,
        );
        creationRequiredError.code = "ACCOUNT_CREATION_REQUIRED";
        throw creationRequiredError;
    }

    try {
        const accessKey = await rpcRequest(network, "query", {
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: publicKey,
        });

        // Some RPC responses embed query failures in a successful JSON-RPC result.
        if (accessKey?.error) {
            const errorMsg =
                typeof accessKey.error === "string"
                    ? accessKey.error
                    : accessKey.error.message ||
                      JSON.stringify(accessKey.error) ||
                      "Access key lookup failed.";
            if (
                errorMsg.includes("access key") ||
                isAccountMissingError(errorMsg) ||
                errorMsg.includes("does not exist")
            ) {
                throw new Error(
                    `Access key not found for account ${accountId}. Please make sure the Ledger public key is registered for this account.`,
                );
            }
            throw new Error(errorMsg);
        }

        // Check if it's a full access key
        if (accessKey.permission !== "FullAccess") {
            throw new Error(
                "The public key does not have FullAccess permission for this account.",
            );
        }

        return true;
    } catch (error) {
        const errorMsg = error?.message || "";
        if (
            errorMsg.includes("access key") ||
            isAccountMissingError(errorMsg) ||
            errorMsg.includes("does not exist")
        ) {
            throw new Error(
                `Access key not found for account ${accountId}. Please make sure the Ledger public key is registered for this account.`,
            );
        }
        throw error;
    }
}

/**
 * Convert action params from wallet-selector format to NEAR SDK action objects
 */
function buildNearActions(actions) {
    return actions.map((action) => {
        if (action.type === "FunctionCall") {
            const args = action.params.args || {};
            return functionCall(
                action.params.methodName,
                args,
                BigInt(action.params.gas || "30000000000000"),
                BigInt(action.params.deposit || "0"),
            );
        } else if (action.type === "Transfer") {
            return transfer(BigInt(action.params.deposit));
        } else if (action.type === "AddKey") {
            const publicKey = PublicKey.from(action.params.publicKey);
            const accessKey = action.params.accessKey;

            if (accessKey.permission === "FullAccess") {
                return addKey(publicKey, fullAccessKey());
            } else {
                return addKey(
                    publicKey,
                    functionCallAccessKey(
                        accessKey.permission.receiverId,
                        accessKey.permission.methodNames || [],
                        BigInt(accessKey.permission.allowance || "0"),
                    ),
                );
            }
        } else if (action.type === "DeleteKey") {
            const publicKey = PublicKey.from(action.params.publicKey);
            return deleteKey(publicKey);
        } else if (action.type === "CreateAccount") {
            return createAccount();
        } else if (action.type === "DeleteAccount") {
            return deleteAccount(action.params.beneficiaryId);
        } else if (action.type === "Stake") {
            const publicKey = PublicKey.from(action.params.publicKey);
            return stake(BigInt(action.params.stake), publicKey);
        } else if (action.type === "DeployContract") {
            return deployContract(action.params.code);
        }

        throw new Error(`Unsupported action type: ${action.type}`);
    });
}

/**
 * Build a borsh-serialized NEP-413 payload for message signing.
 */
function buildNep413Payload(message, recipient, nonce) {
    const messageBytes = new TextEncoder().encode(message);
    const recipientBytes = new TextEncoder().encode(recipient);

    const payloadSize =
        4 + messageBytes.length + 32 + 4 + recipientBytes.length + 1;
    const payload = new Uint8Array(payloadSize);
    const view = new DataView(payload.buffer);
    let offset = 0;

    // Write message (length-prefixed string)
    view.setUint32(offset, messageBytes.length, true);
    offset += 4;
    payload.set(messageBytes, offset);
    offset += messageBytes.length;

    // Write nonce (32 fixed bytes)
    payload.set(nonce, offset);
    offset += 32;

    // Write recipient (length-prefixed string)
    view.setUint32(offset, recipientBytes.length, true);
    offset += 4;
    payload.set(recipientBytes, offset);
    offset += recipientBytes.length;

    // Write callback_url (Option<String> = None)
    payload[offset] = 0;

    return payload;
}

/**
 * Main Ledger Wallet implementation
 */
class LedgerWallet {
    constructor() {
        this.ledger = new LedgerClient();
    }

    async getDerivationPath() {
        const derivationPath = await window.selector.storage.get(
            STORAGE_KEY_DERIVATION_PATH,
        );
        return derivationPath || DEFAULT_DERIVATION_PATH;
    }

    /**
     * Reconnect Ledger for signing flows without showing the Connect Ledger screen.
     * This uses the stored transport mode from sign-in.
     */
    async _reconnectLedgerForSigning() {
        const storedMode = await this.ledger.getStoredTransportMode();
        if (!storedMode) {
            throw new Error(
                "Ledger is not connected. Please sign in with Ledger first.",
            );
        }

        try {
            await showLedgerApprovalUI(
                "Reconnect Ledger",
                "Please reconnect your Ledger and approve opening app on your Ledger device.",
                async () => {
                    // Retry path can re-enter while transport is still connected.
                    // Reuse existing session to avoid "device is already open" errors.
                    if (!this.ledger.isConnected()) {
                        await this.ledger.connectWithDevice(storedMode);
                    }
                    await this.ledger.openNearApplication();
                },
                false,
            );
        } catch (error) {
            if (this.ledger.isConnected()) {
                try {
                    await this.ledger.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
            }
            throw new Error(
                `${getLedgerErrorMessage(error)} Please sign in again if the issue persists.`,
            );
        }
    }

    /**
     * Ensure accounts exist and Ledger is connected. Returns stored accounts.
     */
    async _ensureReady() {
        const accounts = await this.getAccounts();
        if (!accounts || accounts.length === 0) {
            throw new Error("No account connected");
        }
        if (!this.ledger.isConnected()) {
            await this._reconnectLedgerForSigning();
        }
        return accounts;
    }

    /**
     * Fetch access key info and latest block from RPC.
     */
    async _getAccessKeyAndBlock(network, signerId, publicKey) {
        const accessKey = await rpcRequest(network, "query", {
            request_type: "view_access_key",
            finality: "final",
            account_id: signerId,
            public_key: publicKey,
        });
        const block = await rpcRequest(network, "block", {
            finality: "final",
        });
        return { accessKey, block };
    }

    /**
     * Core sign-in flow used by signIn and signInAndSignMessage.
     * Does not hide the iframe on success; caller controls final UI transition.
     */
    async _performSignInFlow(params) {
        // Prompt user to connect Ledger (provides user gesture for WebHID)
        await promptForLedgerConnect(this.ledger);

        // Let user select derivation path
        const defaultDerivationPath = await this.getDerivationPath();
        const derivationPath = await promptForDerivationPath(
            defaultDerivationPath,
        );

        // Get public key from Ledger (requires user approval on device)
        const publicKeyString = await showLedgerApprovalUI(
            "Approve on Ledger",
            "Please approve the request on your Ledger device to share your public key.",
            () => this.ledger.getPublicKey(derivationPath),
        );
        const publicKey = `ed25519:${publicKeyString}`;

        // Calculate implicit account ID (hex-encoded public key bytes)
        const publicKeyBytes = baseDecode(publicKeyString);
        const implicitAccountId = Buffer.from(publicKeyBytes).toString("hex");

        // Verification function to check account access
        const network = params?.network || "mainnet";
        const verifyAccount = async (accountId) => {
            await verifyAccessKey(network, accountId, publicKey);
        };
        const createUserAccount = async (accountId) => {
            await createUserAccountViaBackend({
                accountId,
                publicKey,
                implicitAccountId,
                transportMode: this.ledger.transportMode,
                derivationPath,
                network,
            });
        };

        // Keep iframe mounted so follow-up prompts can transition smoothly.
        const accountId = await promptForAccountId(
            implicitAccountId,
            verifyAccount,
            createUserAccount,
            false,
        );

        // Store the account information
        const accounts = [{ accountId, publicKey }];
        await window.selector.storage.set(
            STORAGE_KEY_ACCOUNTS,
            JSON.stringify(accounts),
        );
        await window.selector.storage.set(
            STORAGE_KEY_DERIVATION_PATH,
            derivationPath,
        );

        return { accounts, derivationPath };
    }

    /**
     * Sign in with Ledger device
     */
    async signIn(params) {
        try {
            const { accounts } = await this._performSignInFlow(params);
            window.selector.ui.hideIframe();
            return accounts;
        } catch (error) {
            // Disconnect on error
            if (this.ledger.isConnected()) {
                await this.ledger.disconnect();
            }
            throw error;
        }
    }

    /**
     * Sign in and sign a message in one unified flow (NEP-413)
     */
    async signInAndSignMessage(params) {
        try {
            const { accounts, derivationPath } =
                await this._performSignInFlow(params);

            const { message, recipient, nonce } = params.messageParams;
            const payload = buildNep413Payload(
                message,
                recipient || "",
                nonce || new Uint8Array(32),
            );

            const signature = await showLedgerApprovalUI(
                "Sign Message",
                "Please review and approve the message signing on your Ledger device.",
                () => this.ledger.signMessage(payload, derivationPath),
                true,
            );

            const signatureBase64 = btoa(String.fromCharCode(...signature));

            return accounts.map((account) => ({
                ...account,
                signedMessage: {
                    accountId: account.accountId,
                    publicKey: account.publicKey,
                    signature: signatureBase64,
                },
            }));
        } catch (error) {
            if (this.ledger.isConnected()) {
                await this.ledger.disconnect();
            }
            throw error;
        }
    }

    /**
     * Sign out and disconnect
     */
    async signOut() {
        if (this.ledger.isConnected()) {
            await this.ledger.disconnect();
        }

        await window.selector.storage.remove(STORAGE_KEY_ACCOUNTS);
        await window.selector.storage.remove(STORAGE_KEY_TRANSPORT_MODE);
        await window.selector.storage.remove(STORAGE_KEY_DERIVATION_PATH);

        return true;
    }

    /**
     * Get stored accounts
     */
    async getAccounts() {
        const accountsJson =
            await window.selector.storage.get(STORAGE_KEY_ACCOUNTS);
        if (!accountsJson) {
            return [];
        }

        try {
            return JSON.parse(accountsJson);
        } catch (error) {
            console.warn("Failed to parse stored accounts:", error);
            return [];
        }
    }

    /**
     * Sign and send a single transaction
     */
    async signAndSendTransaction(params) {
        const accounts = await this._ensureReady();
        const network = params.network || "mainnet";
        const signerId = accounts[0].accountId;
        const { receiverId, actions } = params.transactions[0];

        const { accessKey, block } = await this._getAccessKeyAndBlock(
            network,
            signerId,
            accounts[0].publicKey,
        );
        const blockHash = baseDecode(block.header.hash);

        const txActions = buildNearActions(actions);

        // Create transaction
        const transaction = createTransaction(
            signerId,
            PublicKey.from(accounts[0].publicKey),
            receiverId,
            accessKey.nonce + 1,
            txActions,
            blockHash,
        );

        // Serialize and sign with Ledger (requires user approval on device)
        const serializedTx = encodeTransaction(transaction);
        const derivationPath = await this.getDerivationPath();
        const signature = await showLedgerApprovalUI(
            "Approve Transaction",
            "Please review and approve the transaction on your Ledger device.",
            () => this.ledger.sign(serializedTx, derivationPath),
            true, // Hide on success since we're done with UI
        );

        // Create signed transaction
        const signedTx = new SignedTransaction({
            transaction,
            signature: new Signature({
                keyType: transaction.publicKey.keyType,
                data: signature,
            }),
        });

        // Broadcast transaction (RPC expects base64 encoded signed transaction)
        const signedTxBytes = signedTx.encode();
        const base64Tx = btoa(String.fromCharCode(...signedTxBytes));
        const result = await rpcRequest(network, "broadcast_tx_commit", [
            base64Tx,
        ]);

        return result;
    }

    /**
     * Sign a delegation (NEP-366 meta-transaction)
     */
    async signDelegateAction(params) {
        const accounts = await this._ensureReady();
        const network = params.network || "mainnet";
        const { accountId: signerId, publicKey } = accounts[0];
        const { receiverId, actions } = params.transaction;

        const { accessKey, block } = await this._getAccessKeyAndBlock(
            network,
            signerId,
            publicKey,
        );

        const nearActions = buildNearActions(actions);

        // Create DelegateAction (NEP-366)
        const delegateAction = buildDelegateAction({
            senderId: signerId,
            receiverId,
            actions: nearActions,
            nonce: BigInt(accessKey.nonce) + 1n,
            maxBlockHeight: BigInt(block.header.height) + 120n,
            publicKey: PublicKey.from(publicKey),
        });

        // Ledger app expects only the DelegateAction bytes (no NEP-366 prefix).
        // It injects the 4-byte discriminant when hashing; we must not send it.
        const fullEncoded = encodeDelegateAction(delegateAction);
        const serialized = fullEncoded.subarray(4); // strip DelegateActionPrefix (u32)
        const derivationPath = await this.getDerivationPath();
        const signature = await showLedgerApprovalUI(
            "Approve Transaction",
            "Please review and approve the transaction on your Ledger device.",
            () => this.ledger.signDelegation(serialized, derivationPath),
            true,
        );

        // Create SignedDelegate (SignDelegateActionResult.signedDelegate)
        const signedDelegate = new SignedDelegate({
            delegateAction,
            signature: new Signature({
                keyType: delegateAction.publicKey.keyType,
                data: signature,
            }),
        });

        // Delegate hash = SHA-256 of the signed payload (NEP-366 prefix + borsh(DelegateAction))
        const delegateHash = new Uint8Array(
            await crypto.subtle.digest("SHA-256", fullEncoded),
        );

        return {
            delegateHash,
            signedDelegate,
        };
    }

    /**
     * Sign and send multiple transactions
     */
    async signAndSendTransactions(params) {
        const results = [];

        for (const tx of params.transactions) {
            const result = await this.signAndSendTransaction({
                ...params,
                transactions: [tx],
            });
            results.push(result);
        }

        return results;
    }

    /**
     * Sign and send multiple delegate actions
     */
    async signDelegateActions(params) {
        const results = [];
        for (const tx of params.delegateActions) {
            const result = await this.signDelegateAction({
                ...params,
                transaction: tx,
            });
            results.push(result);
        }
        return { signedDelegateActions: results };
    }

    /**
     * Sign a message (NEP-413)
     */
    async signMessage(params) {
        const accounts = await this._ensureReady();

        // Build NEP-413 message payload using borsh serialization
        const message = params.message;
        const recipient = params.recipient || "";
        const nonce = params.nonce || new Uint8Array(32);

        // NEP-413 payload structure (borsh serialized):
        // - message: string (4 bytes length + utf8 bytes)
        // - nonce: [u8; 32] (32 fixed bytes)
        // - recipient: string (4 bytes length + utf8 bytes)
        // - callback_url: Option<String> (1 byte for Some/None + optional string)

        // Manually construct borsh-serialized payload
        const messageBytes = new TextEncoder().encode(message);
        const recipientBytes = new TextEncoder().encode(recipient);

        // Calculate total size
        const payloadSize =
            4 +
            messageBytes.length + // message (length + data)
            32 + // nonce (fixed 32 bytes)
            4 +
            recipientBytes.length + // recipient (length + data)
            1; // callback_url (0 = None)

        const payload = new Uint8Array(payloadSize);
        const view = new DataView(payload.buffer);
        let offset = 0;

        // Write message (length-prefixed string)
        view.setUint32(offset, messageBytes.length, true);
        offset += 4;
        payload.set(messageBytes, offset);
        offset += messageBytes.length;

        // Write nonce (32 fixed bytes)
        payload.set(nonce, offset);
        offset += 32;

        // Write recipient (length-prefixed string)
        view.setUint32(offset, recipientBytes.length, true);
        offset += 4;
        payload.set(recipientBytes, offset);
        offset += recipientBytes.length;

        // Write callback_url (Option<String> = None)
        payload[offset] = 0; // 0 = None

        // Sign with Ledger (requires user approval on device)
        const derivationPath = await this.getDerivationPath();
        const signature = await showLedgerApprovalUI(
            "Sign Message",
            "Please review and approve the message signing on your Ledger device.",
            () => this.ledger.signMessage(payload, derivationPath),
            true, // Hide on success since we're done with UI
        );

        // Convert signature to base64 (backend expects base64, not base58)
        const signatureBase64 = btoa(String.fromCharCode(...signature));

        return {
            accountId: accounts[0].accountId,
            publicKey: accounts[0].publicKey,
            signature: signatureBase64,
        };
    }
}

// Initialize and register the wallet with hot-connect
const wallet = new LedgerWallet();
window.selector.ready(wallet);
