import { APP_DOCS_URL } from "@/constants/config";

// The landing is English-only marketing copy lifted verbatim from the Figma
// file, so it lives here instead of the i18n catalogue (which would force
// twelve translations of every headline).

// TODO: swap for the real booking link once sales settles on one; the Figma
// file has the button but no destination.
export const BOOK_DEMO_HREF =
    "mailto:hello@near.org?subject=NEAR%20Business%20demo";

export const NAV_LINKS = [
    { label: "Product", href: "#product" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
    { label: "Docs", href: APP_DOCS_URL },
] as const;

export const PROOF_STATS = [
    { value: "35+", label: "Chains" },
    { value: "180+", label: "Assets" },
    { value: "$27B+", label: "All-time volume" },
    { value: "$50M+", label: "Confidential TVL" },
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
    "Balances visible only to your quorum",
    "Payroll settles with confidential receipts",
    "Recipients named and verified, never exposed",
    "Auditors get everything; the chain gets nothing",
] as const;

export const CONTROL_TICKER = [
    "Roles",
    "Thresholds",
    "Recipients",
    "Audit log",
] as const;

export const CONTROL_CARDS = [
    {
        title: "Roles",
        body: "Requestor, finance, governance. Permissions that match your org chart.",
    },
    {
        title: "Thresholds",
        body: "Configurable per action. Routine payments move fast, large transfers gather signatures.",
    },
    {
        title: "Recipients",
        body: "Named, verified addresses from your address book. No raw-hex paste mistakes.",
    },
    {
        title: "Audit log",
        body: "The chain itself, verifiable by construction. Your auditors don't have to trust ours.",
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
        body: "Pay dozens of recipients in a single batch. One approval flow, one confidential receipt per payment.",
    },
    {
        title: "Cross-chain swaps",
        body: "Swap between 35+ chains from the treasury itself. No external bridges, no chain-by-chain ops overhead.",
    },
    {
        title: "History and exports",
        body: "Every movement in one record, exportable for your accountants, auditors and board pack.",
    },
    {
        title: "Roles and thresholds",
        body: "Requestor, finance, governance. Set rules that match how your organisation already makes decisions.",
    },
    {
        title: "Address book",
        body: "Named, verified addresses for every counterparty. No raw-hex paste mistakes.",
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

// `featured` is the mist-filled middle card; the other two are outlined.
export const BUILT_FOR = [
    {
        title: "Foundations",
        body: "Mandates, vesting, and grants executed exactly as the council approved them. Prudence your community can verify.",
        featured: false,
    },
    {
        title: "Digital asset treasury companies",
        body: "Multi-treasury view, reporting, and reconciliation across every chain and entity you run.",
        featured: true,
    },
    {
        title: "Funds, desks, and family offices",
        body: "Cross-chain positions, allocation, and settlement risk from one account. Balances and counterparties stay off the public ledger.",
        featured: false,
    },
] as const;

export const COMPARISON_ROWS = [
    {
        label: "Multichain",
        nearBusiness: "35+ chains, BTC, ETH, SOL and beyond",
        enterprise: "EVM only",
    },
    { label: "Self-custodial", nearBusiness: "Yes", enterprise: "No" },
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
    { label: "Setup time", nearBusiness: "Yes", enterprise: "Weeks" },
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
    "Bulk payments",
    "Audit-ready exports",
    "Granular permissions",
    "Multi-treasury view",
    "Cross-chain swaps built in",
    "Confidential receipts",
    "Ledger support",
    "Unlimited users, no asset caps",
] as const;

// Answers aren't in the design (every item is collapsed); they restate the
// claims the page already makes above.
export const FAQ_ITEMS = [
    {
        question: "What is NEAR Business?",
        answer: "A self-custodial, multisig treasury for organisations that hold assets across many chains. Payments, bulk payouts, swaps, roles and audit-ready history from one dashboard, with balances confidential by default.",
    },
    {
        question: "Confidential from whom, exactly?",
        answer: "From the public. Balances, payroll and counterparties are hidden from block explorers and address watchers, while the people accountable for the treasury (your signers, board and auditors) can be granted full visibility.",
    },
    {
        question: "Can NEAR move or freeze our funds?",
        answer: "No. Funds move only on the signatures your organisation defines. NEAR holds no key, no key share, and has no technical capability to initiate, alter or reverse a transaction.",
    },
    {
        question: "Which chains and assets are supported?",
        answer: "BTC, ETH, SOL, NEAR and 35+ chains with 180+ assets, without external bridges. Native chains are supported alongside EVM networks.",
    },
    {
        question: "How do approvals and permissions work?",
        answer: "Assign roles such as requestor, finance and governance, then set thresholds per action. Routine payments move fast; large transfers gather the signatures your policy requires before funds leave.",
    },
    {
        question: "Is the code audited?",
        answer: "Yes. The core contract has been audited by Valhalla Security, and the chain itself serves as the audit log, verifiable by construction.",
    },
    {
        question: "How do we get access during the private beta?",
        answer: "Book a demo. We walk through your actual signer setup and chains in a 30-minute session and onboard your treasury from there.",
    },
] as const;
