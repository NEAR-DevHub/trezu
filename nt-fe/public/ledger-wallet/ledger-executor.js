// Ledger Hardware Wallet Executor for hot-connect
// This script provides Ledger device integration for NEAR Protocol transactions

// Import dependencies from CDN
import { baseEncode, baseDecode } from "https://esm.sh/@near-js/utils@0.2.2";
import {
    Signature,
    createTransaction,
    encodeTransaction,
    encodeDelegateAction,
    SignedTransaction,
    buildDelegateAction,
    SignedDelegate,
    actionCreators,
} from "https://esm.sh/@near-js/transactions@2.5.1";
import { PublicKey } from "https://esm.sh/@near-js/crypto@2.5.1";
import { Buffer } from "https://esm.sh/buffer@6.0.3";
import LedgerTransport from "https://esm.sh/@ledgerhq/hw-transport@6.29";
import LedgerTransportWebBle from "https://esm.sh/@ledgerhq/hw-transport-web-ble@6.29";
import LedgerTransportWebUsb from "https://esm.sh/@ledgerhq/hw-transport-webusb@6.29";
import LedgerTransportWebHid from "https://esm.sh/@ledgerhq/hw-transport-webhid@6.29";

// Inlined transport/client helpers previously in supportedTransport.js and near-ledger.js
// TODO: remove after fixing https://github.com/LedgerHQ/ledgerjs/issues/352#issuecomment-615917351
class LedgerTransportWebBleAndroidFix extends LedgerTransportWebBle {
    static async open(device, ...args) {
        if (!navigator.userAgent.includes("Mobi"))
            return super.open(device, ...args);
        const getPrimaryServicesOrig = device.gatt?.getPrimaryServices;
        if (getPrimaryServicesOrig == null) return super.open(device, ...args);
        device.gatt.getPrimaryServices = async () => {
            const [service] = await getPrimaryServicesOrig.call(device.gatt);
            const getCharacteristicOrig = service.getCharacteristic;
            service.getCharacteristic = async (id) => {
                const characteristic = await getCharacteristicOrig.call(
                    service,
                    id,
                );
                if (id === "13d63400-2c97-0004-0002-4c6564676572") {
                    const writeValueOrig = characteristic.writeValue;
                    let delayed = false;
                    characteristic.writeValue = async (data) => {
                        if (!delayed) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 500),
                            );
                            delayed = true;
                        }
                        return writeValueOrig.call(characteristic, data);
                    };
                }
                return characteristic;
            };
            return [service];
        };
        return super.open(device, ...args);
    }
}

class LedgerTransportTauri extends LedgerTransport {
    constructor(deviceName) {
        super();
        this.deviceName = deviceName;
    }

    static async open(deviceName) {
        return new LedgerTransportTauri(deviceName);
    }

    async exchange(apdu) {
        const response = await window.__TAURI__.core.invoke(
            "send_ledger_command",
            {
                ledgerDeviceName: this.deviceName,
                command: Array.from(apdu),
            },
        );
        return Buffer.from(response);
    }
}

let ENABLE_DEBUG_LOGGING = false;
const debugLog = (...args) => {
    ENABLE_DEBUG_LOGGING && console.log(...args);
};

function isIOS() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
}

function isFirefox() {
    return navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
}

function isSafari() {
    const userAgent = navigator.userAgent.toLowerCase();
    return (
        userAgent.includes("safari") &&
        !userAgent.includes("chrome") &&
        !userAgent.includes("chromium")
    );
}

async function isWebHidSupported() {
    try {
        return await LedgerTransportWebHid.isSupported();
    } catch (e) {
        return false;
    }
}

async function isWebUsbSupported() {
    try {
        return await LedgerTransportWebUsb.isSupported();
    } catch (e) {
        return false;
    }
}

async function isWebBleSupported() {
    try {
        return await LedgerTransportWebBleAndroidFix.isSupported();
    } catch (e) {
        return false;
    }
}

function setDebugLogging(value) {
    ENABLE_DEBUG_LOGGING = value;
}

async function getSupportedTransport(mode) {
    console.log("Using Ledger mode", JSON.stringify(mode));
    if (mode === "Disabled") {
        const err = new Error("Please choose a Ledger connection method.");
        err.name = "LedgerDisabled";
        throw err;
    }

    debugLog(`Attempting to create specific transport: ${mode}`);

    let transport = null;
    try {
        if (mode === "WebHID") {
            const isSupported = await isWebHidSupported();
            if (!isSupported) {
                const err = new Error(
                    "WebHID is not supported in this browser.",
                );
                err.name = "WebHIDNotSupported";
                throw err;
            }
            transport = await LedgerTransportWebHid.create();
        } else if (mode === "WebUSB") {
            const isSupported = await isWebUsbSupported();
            if (!isSupported) {
                let err;
                if (isIOS()) {
                    err = new Error("WebUSB is not supported on iOS devices.");
                    err.name = "WebUSBNotSupportedIOS";
                } else if (isFirefox()) {
                    err = new Error("WebUSB is not supported in Firefox.");
                    err.name = "WebUSBNotSupportedFirefox";
                } else if (isSafari()) {
                    err = new Error("WebUSB is not supported in Safari.");
                    err.name = "WebUSBNotSupportedSafari";
                } else {
                    err = new Error("WebUSB is not supported in this browser.");
                    err.name = "WebUSBNotSupported";
                }
                throw err;
            }
            transport = await LedgerTransportWebUsb.create();
        } else if (mode === "WebBLE") {
            const isSupported = await isWebBleSupported();
            if (!isSupported) {
                let err;
                if (isIOS()) {
                    err = new Error("WebBLE is not supported on iOS devices.");
                    err.name = "WebBLENotSupportedIOS";
                } else if (isFirefox()) {
                    err = new Error("WebBLE is not supported in Firefox.");
                    err.name = "WebBLENotSupportedFirefox";
                } else if (isSafari()) {
                    err = new Error("WebBLE is not supported in Safari.");
                    err.name = "WebBLENotSupportedSafari";
                } else {
                    err = new Error("WebBLE is not supported in this browser.");
                    err.name = "WebBLENotSupported";
                }
                throw err;
            }
            transport = await LedgerTransportWebBleAndroidFix.create();
        } else if (mode instanceof Object && mode.TauriDevice) {
            transport = await LedgerTransportTauri.open(mode.TauriDevice);
        } else {
            const err = new Error(
                "Unknown transport mode: " + JSON.stringify(mode),
            );
            err.name = "UnknownTransportMode";
            throw err;
        }

        if (transport) {
            debugLog(`Successfully created ${mode} transport!`, transport);
            return transport;
        }
    } catch (err) {
        console.error(`Failed to create ${mode} transport:`, err);
        throw err;
    }
}

function bip32PathToBytes(path) {
    const parts = path.split("/");
    return Buffer.concat(
        parts
            .map((part) =>
                part.endsWith("'")
                    ? Math.abs(parseInt(part.slice(0, -1))) | 0x80000000
                    : Math.abs(parseInt(part)),
            )
            .map((i32) =>
                Buffer.from([
                    (i32 >> 24) & 0xff,
                    (i32 >> 16) & 0xff,
                    (i32 >> 8) & 0xff,
                    i32 & 0xff,
                ]),
            ),
    );
}

const NEAR_NETWORK_ID = "W".charCodeAt(0);
const SIGN_TRANSACTION = 2;
const SIGN_MESSAGE = 7;
const SIGN_META_TRANSACTION = 8;
const NEAR_LEDGER_DEFAULT_PATH = "44'/397'/0'/0'/1'";

async function createClient(transport, mode) {
    return {
        mode,
        transport,
        async getVersion() {
            const response = await this.transport.send(0x80, 6, 0, 0);
            const [major, minor, patch] = Array.from(response);
            return `${major}.${minor}.${patch}`;
        },
        async getPublicKey(path) {
            // NOTE: getVersion call allows to reset state to avoid starting from partially filled buffer
            await this.getVersion();

            path = path || NEAR_LEDGER_DEFAULT_PATH;
            const response = await this.transport.send(
                0x80,
                4,
                0,
                NEAR_NETWORK_ID,
                bip32PathToBytes(path),
            );
            return Buffer.from(response.subarray(0, -2));
        },
        async sign(transactionData, path) {
            const isNep413 =
                transactionData.length >= 4 &&
                transactionData[0] === 0x9d &&
                transactionData[1] === 0x01 &&
                transactionData[2] === 0x00 &&
                transactionData[3] === 0x80;
            if (isNep413) {
                transactionData = transactionData.slice(4);
            }
            const isNep366 =
                transactionData.length >= 4 &&
                transactionData[0] === 0x6e &&
                transactionData[1] === 0x01 &&
                transactionData[2] === 0x00 &&
                transactionData[3] === 0x40;
            if (isNep366) {
                transactionData = transactionData.slice(4);
            }

            // NOTE: getVersion call allows to reset state to avoid starting from partially filled buffer
            const version = await this.getVersion();
            console.info("Ledger app version:", version);
            // TODO: Assert compatible versions

            path = path || NEAR_LEDGER_DEFAULT_PATH;
            transactionData = Buffer.from(transactionData);
            // 128 - 5 service bytes
            const CHUNK_SIZE = 123;
            const allData = Buffer.concat([
                bip32PathToBytes(path),
                transactionData,
            ]);
            for (
                let offset = 0;
                offset < allData.length;
                offset += CHUNK_SIZE
            ) {
                const chunk = Buffer.from(
                    allData.subarray(offset, offset + CHUNK_SIZE),
                );
                const isLastChunk = offset + CHUNK_SIZE >= allData.length;
                let code = SIGN_TRANSACTION;
                if (isNep413) {
                    code = SIGN_MESSAGE;
                } else if (isNep366) {
                    code = SIGN_META_TRANSACTION;
                }
                const response = await this.transport.send(
                    0x80,
                    code,
                    isLastChunk ? 0x80 : 0,
                    NEAR_NETWORK_ID,
                    chunk,
                );
                if (isLastChunk) {
                    return Buffer.from(response.subarray(0, -2));
                }
            }
        },
    };
}

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

/**
 * Check which transport methods are supported in the current browser
 * @returns {Promise<{webHID: boolean, webUSB: boolean, webBLE: boolean}>}
 */
async function getAvailableTransports() {
    const results = {
        webHID: false,
        webUSB: false,
        webBLE: false,
    };

    // Check WebHID support
    try {
        const TransportWebHID = await import(
            "https://esm.sh/@ledgerhq/hw-transport-webhid@6.29"
        );
        results.webHID = await TransportWebHID.default.isSupported();
    } catch (e) {
        results.webHID = false;
    }

    // Check WebUSB support
    try {
        const TransportWebUSB = await import(
            "https://esm.sh/@ledgerhq/hw-transport-webusb@6.29"
        );
        results.webUSB = await TransportWebUSB.default.isSupported();
    } catch (e) {
        results.webUSB = false;
    }

    // Check WebBLE support
    try {
        const TransportWebBLE = await import(
            "https://esm.sh/@ledgerhq/hw-transport-web-ble@6.29"
        );
        results.webBLE = await TransportWebBLE.default.isSupported();
    } catch (e) {
        results.webBLE = false;
    }

    return results;
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
        return "Please make sure your Ledger device is unlocked and the NEAR app is open. You may need to approve the action on your device.";
    }
    if (errorMsg.includes("0x5515") || errorMsg.includes("Locked device")) {
        return "Your Ledger device is locked. Please unlock it and try again.";
    }
    if (errorMsg.includes("6807") || errorMsg.includes("missing")) {
        return "NEAR application is not installed on your Ledger device. Please install it using Ledger Live.";
    }
    if (errorMsg.includes("5501") || errorMsg.includes("declined")) {
        return "You declined to open the NEAR app. Please try again and approve on your device.";
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
    let initialError = null;
    let storedMode = null;
    let canChangeConnectionMethod = false;

    // Try to connect with stored transport mode if available
    storedMode = await ledgerClient.getStoredTransportMode();
    if (storedMode) {
        try {
            // Check if we already have device access for this transport
            let hasExistingDevice = false;

            if (storedMode === "WebHID" && navigator?.hid) {
                const devices = await navigator.hid.getDevices();
                hasExistingDevice = devices.some((d) => d.vendorId === 0x2c97);
            } else if (storedMode === "WebUSB" && navigator?.usb) {
                const devices = await navigator.usb.getDevices();
                hasExistingDevice = devices.some((d) => d.vendorId === 0x2c97);
            } else if (storedMode === "WebBLE" && navigator?.bluetooth) {
                // WebBLE doesn't have a getDevices method, skip this check
                hasExistingDevice = false;
            }

            if (hasExistingDevice) {
                await ledgerClient.connectWithDevice(storedMode);
                await ledgerClient.openNearApplication();
                return;
            }
        } catch (error) {
            // Connection failed, disconnect to ensure clean state
            if (ledgerClient.isConnected()) {
                try {
                    await ledgerClient.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
            }
            // Show UI with error
            initialError = getLedgerErrorMessage(error);
        }
    }

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

    function renderUI(errorMessage = null) {
        // Transport selection may temporarily hide the root; force it visible here.
        root.style.display = "flex";

        const connectionInstructions =
            ledgerClient.transportMode === "WebBLE"
                ? "Make sure your Ledger Nano X is powered on, Bluetooth is enabled, and the NEAR app is open."
                : "Make sure your Ledger is connected via USB and the NEAR app is open.";

        root.innerHTML = `
        <div class="prompt-container" style="max-width: 400px; padding: 24px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">${errorMessage ? "⚠️" : "🔐"}</div>
          <h1 style="margin-bottom: 16px;">${errorMessage ? "Connection Failed" : "Connect Ledger"}</h1>
          ${
              errorMessage
                  ? `
          <div style="background: #3d2020; border: 1px solid #5c3030; border-radius: 8px; padding: 12px; margin-bottom: 16px; text-align: left;">
            <p style="color: #ff8080; font-size: 13px; margin: 0;">${errorMessage}</p>
          </div>
          `
                  : ""
          }
          <p style="margin-bottom: 16px; color: #aaa;">
            ${connectionInstructions}
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

    renderUI(initialError);

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
        root.innerHTML = "";
        root.style.display = "none";
        window.selector.ui.hideIframe();
        throw error;
    }
}

/**
 * Helper function to show account ID input dialog
 * @param {string} implicitAccountId - Optional implicit account ID for the button
 * @param {Function} onVerify - Optional async function to verify the account (receives accountId, returns true or throws)
 */
async function promptForAccountId(implicitAccountId = "", onVerify = null) {
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
                        root.innerHTML = "";
                        root.style.display = "none";
                        window.selector.ui.hideIframe();
                        resolve(accountId);
                    } catch (error) {
                        // Show error and allow retry
                        renderUI(error.message, accountId);
                        setupListeners();
                    }
                } else {
                    root.innerHTML = "";
                    root.style.display = "none";
                    window.selector.ui.hideIframe();
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

    return json.result;
}

/**
 * Verify that the public key has full access to the account
 */
async function verifyAccessKey(network, accountId, publicKey) {
    try {
        const accessKey = await rpcRequest(network, "query", {
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: publicKey,
        });

        // Check if it's a full access key
        if (accessKey.permission !== "FullAccess") {
            throw new Error(
                "The public key does not have FullAccess permission for this account",
            );
        }

        return true;
    } catch (error) {
        if (error.message.includes("does not exist")) {
            throw new Error(
                `Access key not found for account ${accountId}. Please make sure the account exists and has the Ledger public key registered.`,
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
     * Ensure accounts exist and Ledger is connected. Returns stored accounts.
     */
    async _ensureReady() {
        const accounts = await this.getAccounts();
        if (!accounts || accounts.length === 0) {
            throw new Error("No account connected");
        }
        if (!this.ledger.isConnected()) {
            await promptForLedgerConnect(this.ledger);
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
     * Sign in with Ledger device
     */
    async signIn(params) {
        try {
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
            const implicitAccountId =
                Buffer.from(publicKeyBytes).toString("hex");

            // Verification function to check account access
            const network = params?.network || "mainnet";
            const verifyAccount = async (accountId) => {
                await verifyAccessKey(network, accountId, publicKey);
            };

            // Prompt user for account ID with inline verification
            const accountId = await promptForAccountId(
                implicitAccountId,
                verifyAccount,
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
