import type { Metadata } from "next";
import Link from "next/link";
import { DATA_PROCESSING_HREF } from "@/constants/config";
import { LegalPage } from "@/features/landing/components/legal-page";

// English-only, like the rest of the marketing pages, so the copy stays out
// of the i18n catalogue.
export const metadata: Metadata = {
    title: "Privacy Policy",
    description: "How NEAR Business handles your data.",
};

export default function PrivacyPolicyPage() {
    return (
        <LegalPage title={["Privacy", "Policy"]}>
            <p>
                <strong>near.com for Business</strong>
            </p>
            <p>
                <strong>Privacy Notice</strong>
            </p>
            <p>Last updated: 10 September 2026</p>
            <h2>
                <strong>1. About this notice</strong>
            </h2>
            <p>
                This notice explains how Intents Technology Ltd (
                <strong>we</strong>, <strong>us</strong>) handles personal
                information in connection with near.com for Business at
                business.near.com (the <strong>Business Platform</strong>), and
                in connection with enquiries about it. The near.com privacy
                policy at{" "}
                <a
                    href="https://near.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    near.com/privacy
                </a>{" "}
                covers near.com itself, the near.com app and our other services.
            </p>
            <p>
                Intents Technology Ltd is a company incorporated in the British
                Virgin Islands, company number 2207088, registered office Rodus
                Building, P.O. Box 3093, Road Town, Tortola, VG1110, British
                Virgin Islands.
            </p>
            <p>
                We are subject to the Virgin Islands Data Protection Act 2021
                and, where they apply to our processing, United Kingdom and
                European Union data protection laws. References below to our
                legitimate interests describe our basis under United Kingdom and
                European Union law. Under the Virgin Islands Data Protection Act
                2021, we process personal information with consent or where
                another condition permitted by that Act applies, including where
                processing is necessary for a contract with the person
                concerned, steps they request, a legal obligation or the
                administration of justice.
            </p>
            <h2>
                <strong>2. Our role</strong>
            </h2>
            <p>
                The Business Platform is an interface to a multi-signature
                treasury contract that is deployed and controlled on the NEAR
                blockchain. We do not hold, control or have access to the assets
                in it.
            </p>
            <p>
                A treasury is set up and run by a business, which we call{" "}
                <strong>the business</strong> in this notice. The business
                decides who has access to its workspace, what information goes
                into it and why. For that information the business is the data
                controller and we act as its data processor, on its
                instructions. Our obligations to it are set out in our Data
                Processing Addendum at{" "}
                <Link href={DATA_PROCESSING_HREF}>
                    https://business.near.com/data
                </Link>
                .
            </p>
            <p>
                If you use a workspace and want to exercise your rights over
                information in it, ask the business first. It decides what
                happens to that information, and we will help it respond.
            </p>
            <p>
                We act in our own right, and not on the business’s instructions,
                for enquiries and early access requests made to us, support
                requests you send us directly, security and abuse prevention,
                sanctions and financial crime screening, and product analytics
                where we use them. Sections 6 to 9 cover those.
            </p>
            <h2>
                <strong>3. Information we hold</strong>
            </h2>
            <p>
                We do not require your name, email address or telephone number
                to use the Business Platform. You sign in with a passkey or by
                connecting a wallet. We also receive the account,
                authentication, session and technical information described
                below and in section 8. Without the sign-in information, we
                cannot sign you in.
            </p>
            <p>
                <strong>About you:</strong>
            </p>
            <ul>
                <li>your NEAR account identifier;</li>
                <li>
                    the identifiers of a Telegram chat and of your Telegram
                    account, if you link a treasury to a Telegram chat so that
                    we can send notifications there;
                </li>
                <li>
                    a display name or alias, and an avatar image, if you set
                    one, which you do not have to do; and
                </li>
                <li>
                    authentication and session information. If you sign in with
                    a passkey, the passkey stays on your device and we receive
                    its public key and an identifier for it. We keep records of
                    sign-in sessions and acceptance of the Business Platform
                    terms. Other authentication information may be stored in
                    your browser. See section 11.
                </li>
            </ul>
            <p>
                <strong>About a business and its treasury:</strong>
            </p>
            <ul>
                <li>the name or alias given to a treasury;</li>
                <li>
                    address book entries, being a wallet address, the network
                    and an alias chosen by whoever added it;
                </li>
                <li>free text notes and payment or proposal descriptions;</li>
                <li>
                    a cached copy of treasury balances and of deposit, swap,
                    transfer and payment history, including confidential
                    balances and history that cannot be read from the public
                    blockchain; and
                </li>
                <li>
                    records of quotes generated for confidential transactions,
                    including the intended recipient, amount, asset and time,
                    whether or not the transaction was signed.
                </li>
            </ul>
            <p>
                Most of the second group is information about a business rather
                than about a person. We describe it here because it is linked to
                account identifiers, which means that in some cases it will also
                be personal information about the people who use a workspace.
            </p>
            <p>
                Address book entries and notes may also include information
                about other people, such as someone a business pays. The
                business decides what goes into its workspace, and anyone who
                wants information of that kind changed or removed should contact
                the business in the first instance.
            </p>
            <p>
                Receipts, statements and exports are produced when you ask for
                them and are not stored by us.
            </p>
            <p>
                Most of this information reaches us from the business whose
                workspace it relates to, or from a public blockchain, rather
                than from you.
            </p>
            <p>
                We do not ask for special category information, such as health
                or biometric details, and it should not be entered into the
                Business Platform.
            </p>
            <h2>
                <strong>4. Public blockchain information</strong>
            </h2>
            <p>
                Your NEAR account identifier, the treasury contract address, its
                membership and permission settings, proposals, votes and
                non-confidential transactions are recorded on the public NEAR
                blockchain. Where a treasury sends or receives assets on another
                network, that transaction and the addresses involved are
                recorded on that network’s public blockchain in the same way.
                That record is public, permanent and outside the control of any
                person, including us. We cannot amend or delete it, and nor can
                you.
            </p>
            <p>
                Settings recorded on the blockchain, such as who has access to a
                treasury and what they can do, can be changed by a later
                transaction. The earlier record and the change itself both
                remain permanently visible.
            </p>
            <p>
                Where free text is typed into a field that is written to the
                blockchain, such as a proposal description, that text becomes
                part of the permanent public record. Do not put personal details
                into those fields.
            </p>
            <h2>
                <strong>5. Confidential transactions</strong>
            </h2>
            <p>
                Some transactions are executed through a confidential
                environment rather than being published on the public
                blockchain. Balances and transaction details there are not
                visible to the public or to other users.
            </p>
            <p>
                We can access that information, and we do so where necessary to:
            </p>
            <ul>
                <li>operate, monitor, debug and secure the service;</li>
                <li>
                    investigate suspected fraud, theft, sanctions evasion, money
                    laundering or other unlawful or prohibited activity;
                </li>
                <li>
                    respond to a security incident, including working with
                    specialist incident response and blockchain analytics
                    providers;
                </li>
                <li>
                    comply with a legal or regulatory requirement, or a lawful
                    request from an authority or court; or
                </li>
                <li>establish, exercise or defend legal claims.</li>
            </ul>
            <p>
                Confidentiality here means that transactions are not published
                publicly and are not visible to other users. It does not mean
                that they are anonymous. The operators of the confidential
                environment, and the solvers and bridge operators that process a
                confidential transaction, can see the details they need to
                process it. The near.com for Business Terms and Conditions
                describe Confidential Mode and who may be able to see
                information about a confidential transaction.
            </p>
            <p>
                Where we do this for our own purposes rather than on the
                business’s instructions, we rely on our legitimate interests in
                operating and securing the service and in preventing and
                investigating unlawful activity, on compliance with a legal
                obligation where one applies, and on the establishment, exercise
                or defence of legal claims.
            </p>
            <h2>
                <strong>6. Enquiries and early access</strong>
            </h2>
            <p>
                If you request early access, or contact us about the Business
                Platform, we collect the information you give us. On the early
                access form that is your name, company, email address and
                Telegram handle, along with the type of business you are in and
                how you heard about us.
            </p>
            <p>
                We use this information to reply to you, assess and prioritise
                access, and keep a record of the enquiry. Where United Kingdom
                or European Union law applies, we rely on our legitimate
                interests in responding to business enquiries and developing our
                products and business.
            </p>
            <p>
                If you separately opt in to marketing, we may use your email
                address to send news, events and offers about the Business
                Platform and related Intents Technology products and services.
                We rely on consent for that marketing. You can withdraw consent
                at any time by using the unsubscribe link in any marketing email
                or by contacting us at{" "}
                <a href="mailto:legal@near.com">legal@near.com</a>.
            </p>
            <h2>
                <strong>7. Support</strong>
            </h2>
            <p>
                If you contact support we process the content of your messages
                and anything you choose to include, such as an account
                identifier, a screenshot or transaction details. Support is
                handled through a third-party helpdesk platform. We rely on our
                legitimate interest in supporting users of the Business Platform
                and in keeping a record of what was asked and answered.
            </p>
            <h2>
                <strong>8. Technical information</strong>
            </h2>
            <p>
                We and our infrastructure providers process technical
                information generated when you use the Business Platform,
                including IP address, request logs, browser and device
                information, and error reports. We use it to deliver the
                service, keep it available, and detect and investigate faults,
                abuse and security incidents. We rely on our legitimate
                interests in operating and securing the service.
            </p>
            <h2>
                <strong>9. Screening</strong>
            </h2>
            <p>
                We may screen wallet addresses, transactions and counterparties
                against sanctions lists and blockchain risk data, using
                third-party screening tools. We do this to meet applicable
                sanctions and financial crime requirements and in our legitimate
                interest in not facilitating unlawful activity. The information
                used comes mainly from the blockchain and from those tools
                rather than from you. The Business Platform terms explain when
                we may restrict or decline activity.
            </p>
            <h2>
                <strong>10. Who we share information with</strong>
            </h2>
            <ul>
                <li>
                    <strong>Service providers</strong> who host our
                    infrastructure, monitor errors, provide support tooling,
                    provide screening and, where we use them, provide analytics
                    or marketing communications. They act on our instructions,
                    or on the business’s where we act as its processor.
                </li>
                <li>
                    <strong>Security and incident response providers</strong>,
                    where necessary to investigate or respond to an incident, a
                    theft, or suspected illicit activity.
                </li>
                <li>
                    <strong>
                        Blockchain networks and protocol infrastructure
                    </strong>
                    , including the operators of the confidential environment,
                    the solvers that fill a quote, bridge operators and the node
                    providers your browser connects to. Anything you transact is
                    processed by public or shared infrastructure, some of which
                    we do not control.
                </li>
                <li>
                    <strong>Authorities, courts and regulators</strong>, where
                    we are required to disclose, or where disclosure is
                    necessary to establish, exercise or defend legal claims, or
                    to prevent or investigate crime.
                </li>
                <li>
                    <strong>Group companies and professional advisers</strong>,
                    on a need to know basis.
                </li>
                <li>
                    <strong>A buyer or successor</strong>, in connection with a
                    reorganisation, financing or sale of our business.
                </li>
                <li>
                    <strong>
                        Services the business connects to its workspace
                    </strong>
                    , such as a custodian or an application that uses our API on
                    the business’s behalf. They receive what the business
                    instructs us to share, under their own terms.
                </li>
            </ul>
            <p>
                We do not sell personal information, and we do not share it for
                cross-context behavioural advertising or targeted advertising.
            </p>
            <h2>
                <strong>11. Cookies and browser storage</strong>
            </h2>
            <p>
                We use browser storage that is strictly necessary for the
                Business Platform to work, mainly to keep you signed in and to
                remember your interface preferences. Storage of that kind does
                not require your consent.
            </p>
            <p>
                In addition to strictly necessary storage, we may use analytics
                and similar technologies to understand how the Business Platform
                is used and improve it. Our cookie settings identify the
                technologies currently in use, their providers, purposes and
                duration. Any non-essential analytics or session-recording
                technologies will be disabled unless and until you consent. You
                can refuse or withdraw consent at any time through those
                settings without losing access to the Business Platform. We do
                not use these technologies for advertising. If session recording
                is used, it will be configured not to capture private keys,
                passkeys, transaction details, address book entries, notes or
                free-text inputs.
            </p>
            <h2>
                <strong>12. International transfers</strong>
            </h2>
            <p>
                We are established in the British Virgin Islands and our
                providers are in a number of countries, including the United
                States. Where personal information is transferred out of the
                British Virgin Islands, the United Kingdom, the European
                Economic Area or Switzerland, we rely on the European
                Commission’s standard contractual clauses, the UK International
                Data Transfer Addendum, or another lawful transfer mechanism,
                with additional safeguards where appropriate. Ask us if you want
                the details.
            </p>
            <h2>
                <strong>13. How long we keep information</strong>
            </h2>
            <p>
                We keep information in a workspace for as long as the workspace
                exists, and delete it when the business asks us to close the
                workspace or to delete it. We do not delete it on a timer,
                because you may not use the Business Platform for months and
                then return to a treasury, and would expect an address book and
                transaction history to still be there.
            </p>
            <p>
                Everything else we keep for as long as we need it for the
                purpose we collected it, and then delete it. Technical logs are
                kept for up to 14 days, unless a longer period is needed to
                investigate a security incident or to meet a legal requirement.
                Backups are kept for up to seven days and are then overwritten,
                and a deletion is not applied to a backup already taken within
                that window.
            </p>
            <p>
                We keep early access and enquiry information while we respond
                and manage the relationship. If you subscribe to marketing, we
                keep your contact details until you unsubscribe or we stop the
                relevant programme. After an opt-out, we may retain a minimal
                suppression record so that we do not contact you again.
            </p>
            <p>
                Records on a public blockchain are permanent. We cannot delete
                them.
            </p>
            <h2>
                <strong>14. Your rights</strong>
            </h2>
            <p>
                Subject to conditions and exemptions, you may have the right to
                ask us for access to your personal information, correction,
                deletion, restriction of processing, and portability, and to
                object to processing we carry out on the basis of legitimate
                interests. Where we rely on consent you can withdraw it at any
                time.
            </p>
            <p>
                Three practical limits, which we would rather set out than leave
                you to discover:
            </p>
            <p>
                <strong>
                    We may be unable to link you to workspace information.
                </strong>{" "}
                We do not require a name or email address to use the Business
                Platform. Even if we hold contact details because you made an
                enquiry or asked for support, we may be unable to link them to a
                particular account or workspace. If you ask us to act in
                relation to information tied to an account, we will normally
                need you to show control of it, and we may be unable to act if
                you cannot.
            </p>
            <p>
                <strong>
                    We cannot alter or remove a record on a public blockchain.{" "}
                </strong>
                Neither can you, and neither can anyone else. Where a request
                relates to such a record we will take the steps that are within
                our control, which may include deleting the copies and links we
                hold off-chain and, where the product allows it, supporting a
                further transaction that changes the current position going
                forward.
            </p>
            <p>
                <strong>
                    Where we act as the business’s processor we act on its
                    instructions.{" "}
                </strong>
                If the information is in a workspace, the business decides what
                happens to it. Ask it, and we will help it respond.
            </p>
            <p>
                You can change your own display name and avatar at any time,
                which replaces the previous value. To close a workspace, or to
                ask us to delete information or remove a particular entry such
                as an address book record or a note, contact us at{" "}
                <a href="mailto:legal@near.com">legal@near.com</a>. Closing a
                workspace does not affect the treasury contract, the assets in
                it, or anyone’s ability to reach it directly. What it removes is
                the layer we provide: aliases, avatars, address book entries,
                notes and our cached copy of balances and history. It does not
                remove records on a public blockchain.
            </p>
            <p>
                You can also complain to a data protection authority. In the
                British Virgin Islands that is the Office of the Information
                Commissioner. In the United Kingdom it is the Information
                Commissioner’s Office, and in the European Economic Area it is
                the authority for your country.
            </p>
            <h2>
                <strong>15. Changes to this notice</strong>
            </h2>
            <p>
                We may update this notice. We will post the updated version and
                change the date at the top. Where a change is material we will
                take additional steps to bring it to your attention.
            </p>
            <h2>
                <strong>16. Contact us</strong>
            </h2>
            <p>
                <a href="mailto:legal@near.com">legal@near.com</a>
            </p>
            <p>
                Intents Technology Ltd, Rodus Building, P.O. Box 3093, Road
                Town, Tortola, VG1110, British Virgin Islands.
            </p>
        </LegalPage>
    );
}
