import { APP_DOCS_URL } from "@/constants/config";

// The landing is English-only marketing copy lifted verbatim from the Figma
// file, so it lives here instead of the i18n catalogue (which would force
// twelve translations of every headline).

// The private-beta waitlist form. External, so every link to it opens in a
// new tab.
export const EARLY_ACCESS_HREF =
    "https://airtable.com/app5IOgKsH6H3RVp1/pagQscnz5uBKiHxc7/form";

export const CONTACT_HREF = "mailto:hello@near.org?subject=NEAR%20Business";

// Rooted fragments: the nav also renders on the legal pages, where a bare
// "#product" would go nowhere.
export const NAV_LINKS = [
    { label: "Product", href: "/#product" },
    { label: "Security", href: "/#security" },
    { label: "Pricing", href: "/#pricing" },
    { label: "Docs", href: APP_DOCS_URL },
] as const;

export const PROOF_STATS = [
    { value: "35+", label: "Chains" },
    { value: "180+", label: "Assets" },
    {
        value: "$30B+",
        label: "All-time volume",
        note: "NEAR Intents metric as of 08 September 2026.",
    },
    {
        value: "$65M+",
        label: "Confidential TVL",
        note: "NEAR Intents metric as of 08 September 2026.",
    },
] as const;

export const CONFIDENTIAL_TAGS = [
    "Confidential receipts",
    "Bulk payments",
    "Audit-ready exports",
] as const;

export const PUBLIC_CHAIN_POINTS = [
    "Balances readable by anyone, at any time",
    "Payroll amounts and timing sit in the open",
    "Counterparties mapped by address watchers",
    "History scraped by block explorers forever",
] as const;

export const NEAR_BUSINESS_POINTS = [
    "Balances visible to your quorum, not the public",
    "Payroll payments settle with confidential receipts",
    "Recipients named and verified, never exposed to the general public",
    "Auditors get everything; the chain gets nothing",
] as const;

export const CONTROL_CARDS = [
    {
        title: "Hardware signing",
        body: "Sign with hardware through Ledger support. Your Treasury Contract remains self-custodial.",
    },
    {
        title: "Roles and thresholds",
        body: "Requestor, finance, governance. Set rules that match how your organization already makes decisions.",
    },
    {
        title: "Recipients",
        body: "Named, verified addresses from your contacts. No raw-hex paste mistakes.",
    },
    {
        title: "Audit log",
        body: "The chain itself, verifiable by construction. Your auditors don't have to trust a vendor.",
    },
] as const;

// Only the first capability carries copy in the design; the rest is written
// from the page's own language so the list can expand.
export const CAPABILITIES = [
    {
        title: "Payments",
        body: "Send to any address on any supported chain. Every payment carries your approval rules and settles with a confidential receipt.",
    },
    {
        title: "Bulk payments",
        body: "Pay dozens of recipients in one batch: payroll, grants, vendor runs. One approval flow, one record, zero public exposure.",
    },
    {
        title: "Cross-chain swaps",
        body: "Swap across 35+ chains in seconds without leaving the app or touching a separate bridge interface. Powered by NEAR Intents.",
    },
    {
        title: "Capital allocation",
        body: "Deploy treasury capital across chains and assets: positions, reserves, and rebalancing runs. Same approval thresholds, same confidential receipts as any other payment.",
    },
    {
        title: "History and exports",
        body: "A complete record of every movement, exportable and audit-ready. Your accountants get everything; the public chain gets nothing.",
    },
    {
        title: "Roles and thresholds",
        body: "Requestor, finance, governance. Configurable approval thresholds per action, so a $500 payment and a $5M transfer follow different rules.",
    },
    {
        title: "Contacts",
        body: "Named, verified recipients instead of raw addresses. Because treasury mistakes are usually paste mistakes.",
    },
] as const;

/**
 * The monochrome network marks from the Figma export. Each one keeps the
 * design's intrinsic pixel size, so the marquee shows the real silhouettes
 * instead of squeezing every mark into one square.
 */
export const MARQUEE_CHAINS = [
    { slug: "aptos", width: 23, height: 23 },
    { slug: "arbitrum", width: 26, height: 30 },
    { slug: "aurora", width: 19, height: 19 },
    { slug: "avalanche", width: 17, height: 15 },
    { slug: "base", width: 21, height: 21 },
    { slug: "berachain", width: 22, height: 11 },
    { slug: "bitcoin", width: 17, height: 20 },
    { slug: "bitcoin-cash", width: 16, height: 21 },
    { slug: "bnb", width: 15, height: 18 },
    { slug: "cardano", width: 25, height: 23 },
    { slug: "dash", width: 23, height: 19 },
    { slug: "dogecoin", width: 19, height: 18 },
    { slug: "ethereum", width: 17, height: 28 },
    { slug: "gnosis", width: 23, height: 23 },
    { slug: "litecoin", width: 13, height: 17 },
    { slug: "monad", width: 22, height: 22 },
    { slug: "near", width: 23, height: 23 },
    { slug: "optimism", width: 23, height: 11 },
    { slug: "plasma", width: 25, height: 25 },
    { slug: "polygon", width: 17, height: 15 },
    { slug: "ripple", width: 22, height: 16 },
    { slug: "scroll", width: 20, height: 19 },
    { slug: "solana", width: 21, height: 19 },
    { slug: "stellar", width: 23, height: 20 },
    { slug: "sui", width: 16, height: 30 },
    { slug: "ton", width: 14, height: 23 },
] as const;

export type MarqueeChain = (typeof MARQUEE_CHAINS)[number];

export function chainIconUrl(chain: MarqueeChain) {
    return `/landing/chains/${chain.slug}.svg`;
}

export const BUILT_FOR = [
    {
        title: "Foundations",
        body: "Mandates, vesting, and grants executed exactly as the council approved them. Prudence your community can verify.",
    },
    {
        title: "Digital asset treasury companies",
        body: "Multi-treasury view, reporting, and reconciliation across every chain and entity you run.",
    },
    {
        title: "Funds, desks, and family offices",
        body: "Cross-chain positions, allocation, and settlement risk from one account. Balances and counterparties stay off the public ledger.",
    },
] as const;

export const COMPARISON_ROWS = [
    {
        label: "Multichain",
        nearBusiness: "35+ chains, BTC, ETH, SOL and beyond",
        enterprise: "EVM only",
    },
    {
        label: "Self-custodial Treasury Contract",
        nearBusiness: "Yes",
        enterprise: "No",
    },
    {
        label: "Confidential treasuries",
        nearBusiness: "Always",
        enterprise: "No",
    },
    { label: "Team permissions", nearBusiness: "Yes", enterprise: "Yes" },
    {
        label: "Starting price",
        nearBusiness: "Free",
        enterprise: "$18,000+ a year",
    },
    {
        label: "Commitment",
        nearBusiness: "None",
        enterprise: "Annual contracts",
    },
    { label: "Setup time", nearBusiness: "Minutes", enterprise: "Weeks" },
] as const;

export const PRICING_CELLS = [
    {
        label: "Treasuries",
        icon: "diamond",
        price: "$0",
        unit: null,
        body: ["Create as many as you need.", "No caps, no tiers."],
    },
    {
        label: "Swap fee",
        icon: "swap",
        price: "0.70",
        unit: "%",
        body: ["Only charged when you swap tokens.", "No swap, no fee."],
    },
    {
        label: "Gas fees",
        icon: "drop",
        price: "Covered",
        unit: null,
        body: [
            "First 1,000 actions a month on us.",
            "Standard network fees after.",
        ],
    },
] as const;

export const INCLUDED_FEATURES = [
    "Confidential treasuries",
    "Multichain, 180+ assets",
    "Bulk send",
    "Audit-ready exports",
    "Granular permissions",
    "Multi-treasury view",
    "Cross-chain swaps built in",
    "Confidential receipts",
    "Ledger support",
    "Unlimited users, no asset caps",
] as const;

export const FAQ_ITEMS = [
    {
        question: "What is NEAR Business?",
        answer: "A confidential multisig treasury for foundations, DATs, and crypto-native finance teams. Payments, bulk payments, and cross-chain swaps across 35+ chains, governed by roles and approval thresholds your organization defines. Built on NEAR Intents and audited multisig infrastructure.",
    },
    {
        question: "Confidential from whom, exactly?",
        answer: "Confidential from the public chain, from market observers, and from anyone watching your treasury address. Fully legible to your own members, your board, and your auditors. Confidentiality is about controlling who can watch your operations, not about hiding them from the people accountable for them. Transaction data is processed as needed to operate and secure the service and meet legal obligations, as described in our Privacy Policy.",
    },
    {
        question: "Can NEAR move or freeze our funds?",
        answer: "No. NEAR Business cannot unilaterally move funds held in your Treasury Contract or override the approval rules your organization defines. Deposits, withdrawals and swaps made through connected services remain subject to applicable legal and regulatory requirements, our Terms of Service, and the availability and requirements of the relevant networks and providers.",
    },
    {
        question: "Which chains and assets are supported?",
        answer: "35+ chains including Bitcoin, Ethereum, Solana and NEAR, and 180+ assets, with cross-chain swaps built in. No external bridges for your team to manage.",
    },
    {
        question: "How do approvals and permissions work?",
        answer: "Roles (requestor, finance, governance) with configurable thresholds per action. Every movement requires the approvals your policy defines, and changing the policy requires the same quorum as moving funds.",
    },
    {
        question: "Is the code audited?",
        answer: "The core contract is audited by Valhalla Security. The full report is available for download.",
    },
    {
        question: "How do we get access during the private beta?",
        answer: "Request early access. We are onboarding a small group of ecosystem treasuries and open access after a walkthrough with your team.",
    },
] as const;
