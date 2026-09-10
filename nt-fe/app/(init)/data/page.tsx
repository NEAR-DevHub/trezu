import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal-page";

// English-only, like the rest of the marketing pages, so the copy stays out
// of the i18n catalogue.
export const metadata: Metadata = {
    title: "Data Processing Addendum",
    description: "How NEAR Business processes personal data on your behalf.",
};

export default function DataProcessingPage() {
    return (
        <LegalPage title={["Data", "Processing"]}>
            <p>
                <strong>near.com for Business</strong>
            </p>
            <p>
                <strong>Data Processing Addendum</strong>
            </p>
            <p>Last updated: 10 September 2026</p>
            <h2>
                <strong>1. Application and definitions</strong>
            </h2>
            <p>
                <strong>1.1 </strong>This Data Processing Addendum (the{" "}
                <strong>DPA</strong>) forms part of the near.com for Business
                Terms and Conditions between Intents Technology Ltd (
                <strong>Intents Technology</strong>, <strong>we</strong>,{" "}
                <strong>us</strong>) and the customer (<strong>you</strong>)
                (the <strong>Agreement</strong>), and applies where we process
                personal data on your behalf in providing the Business Platform.
                By accepting the Agreement you accept this DPA, and no signature
                is needed for it to take effect.
            </p>
            <p>
                <strong>1.2 </strong>If you need an executed copy, or a
                completed set of the transfer clauses in Annex 4, ask us at
                legal@near.com and give us your legal name, jurisdiction of
                incorporation, registered or business address and a contact for
                data protection matters. We will counter-sign this version as it
                stands. We do not otherwise collect those details, because
                access to the Business Platform is by blockchain account.
            </p>
            <p>
                <strong>1.3 </strong>If there is a conflict, Annex 4 prevails
                over the rest of this DPA, and this DPA prevails over the rest
                of the Agreement, in each case only to the extent of the
                conflict and only as regards the processing of personal data.
                Terms defined in the Agreement have the same meaning here.
            </p>
            <p>
                <strong>1.4 Data Protection Law</strong> means all laws on the
                processing of personal data applicable to our processing under
                this DPA, including the UK GDPR and the Data Protection Act
                2018, Regulation (EU) 2016/679 and its implementing laws, the
                Swiss Federal Act on Data Protection, the Virgin Islands Data
                Protection Act 2021, and applicable United States state privacy
                laws. <strong>Customer Personal Data</strong> means personal
                data we process on your behalf in providing the Business
                Platform, as described in Annex 1; it excludes Business Contact
                Information and personal data we process as controller under
                clause 2.2. <strong>Business Contact Information</strong> means
                the business contact details of your personnel, such as name,
                business email address, telephone number, job title and
                employer, processed to manage our relationship with you.{" "}
                <strong>Sub-processor</strong> means a third party we engage to
                process Customer Personal Data on our behalf.{" "}
                <strong>controller</strong>, <strong>processor</strong>,{" "}
                <strong>data subject</strong>, <strong>personal data</strong>,{" "}
                <strong>processing</strong> and{" "}
                <strong>personal data breach</strong> have the meanings given in
                Data Protection Law.
            </p>
            <h2>
                <strong>2. Roles</strong>
            </h2>
            <p>
                <strong>2.1 </strong>For Customer Personal Data you are the
                controller and we are the processor. Where you are yourself a
                processor for another controller, we are a sub-processor and
                your instructions to us must be consistent with that
                controller’s instructions.
            </p>
            <p>
                <strong>2.2</strong> We act as an independent controller, and
                not as your processor, when we process:
            </p>
            <p>
                (a) Business Contact Information; information you or your
                personnel give us in an enquiry, waitlist or early access
                request; marketing preferences and communications; and support
                correspondence sent directly to us;
            </p>
            <p>
                (b) authentication and session information used to identify
                users, sign them in, manage sessions, record acceptance of the
                Agreement and secure the Business Platform; and technical, log
                and security information generated by operation of the Business
                Platform, where we use it for platform-wide security and abuse
                prevention, our own security governance and compliance, legal
                claims or product analytics. We do not use Workspace contents,
                such as address book entries, notes or transaction details, for
                product analytics. Where we use technical, log or security
                information only to deliver, troubleshoot or secure the Business
                Platform for you, we process it as your processor under clause
                3.1;
            </p>
            <p>
                (c) sanctions, financial crime and blockchain risk screening,
                and any resulting decision to restrict or decline activity;
            </p>
            <p>
                (d) access to confidential transaction records for the purposes
                in clause 10.2(b); and
            </p>
            <p>
                (e) anything we must do to comply with a legal or regulatory
                obligation applying to us.
            </p>
            <p>
                <strong>2.3 </strong>Our processing as controller is described
                in our privacy notice at business.near.com/privacy-policy. This
                DPA does not apply to it.
            </p>
            <p>
                <strong>2.4 </strong>You are responsible for deciding what
                information is entered into your Workspace and for having a
                lawful basis for it, including information about people who are
                not your personnel, such as payees recorded in an address book.
            </p>
            <h2>
                <strong>3. Our obligations as processor</strong>
            </h2>
            <p>
                <strong>3.1 </strong>We will process Customer Personal Data,
                including any transfer of it to a third country or an
                international organisation, only to provide, maintain and secure
                the Business Platform in accordance with the Agreement, on your
                further documented instructions where those are consistent with
                the Agreement and technically feasible, or where required by a
                law applying to us, in which case we will tell you before
                processing unless the law prohibits it.
            </p>
            <p>
                <strong>3.2 </strong>The Agreement, this DPA and your use of the
                Business Platform’s features are your complete documented
                instructions. If you want us to process Customer Personal Data
                in any other way, ask us.
            </p>
            <p>
                <strong>3.3 </strong>We will tell you if, in our opinion, an
                instruction infringes Data Protection Law, and may suspend
                performance of that instruction until it is withdrawn or
                amended.
            </p>
            <p>
                <strong>3.4 </strong>We will not sell Customer Personal Data. We
                will not retain, use or disclose it other than to perform the
                services, as described in clause 10.2, or as permitted by law,
                and in particular will not use it for advertising, will not use
                it to train machine learning models, and will not use it to
                develop or improve any product or service other than the
                Business Platform. We may use aggregated information that does
                not identify you or any individual to improve the Business
                Platform.
            </p>
            <h2>
                <strong>4. Security and confidentiality</strong>
            </h2>
            <p>
                <strong>4.1 </strong>We will implement and maintain technical
                and organisational measures appropriate to the risk, having
                regard to the nature of the data and the state of the art. Our
                current measures are in Annex 2. We may change them provided we
                do not materially reduce the overall level of security.
            </p>
            <p>
                <strong>4.2 </strong>Anyone we authorise to process Customer
                Personal Data is subject to a duty of confidentiality, has
                access only to what they need, and is informed of the
                confidential nature of the data.
            </p>
            <h2>
                <strong>5. Sub-processors</strong>
            </h2>
            <p>
                <strong>5.1 </strong>You give us general authorisation to engage
                Sub-processors. The Sub-processors we engage are listed in Annex
                3.
            </p>
            <p>
                <strong>5.2 </strong>Before a new Sub-processor starts
                processing Customer Personal Data we will update Annex 3,
                publish the updated version of this DPA, and give notice of the
                change in the Business Platform, in each case at least 15 days
                beforehand.
            </p>
            <p>
                <strong>5.3 </strong>You may object to a new Sub-processor on
                reasonable data protection grounds within 15 days of that
                notice. If you do, we will work with you in good faith to find a
                solution. If we cannot, you may stop using the affected part of
                the Business Platform, or close your Workspace under clause 8.
                That is your only remedy.
            </p>
            <p>
                <strong>5.4 </strong>We will impose data protection obligations
                on each Sub-processor no less protective than those in this DPA,
                and remain responsible to you for their performance.
            </p>
            <p>
                <strong>5.5 </strong>The following are not our Sub-processors,
                and we do not control them or procure their compliance with this
                DPA:
            </p>
            <p>
                (a) blockchain networks, protocols, bridges, market makers,
                solvers and other infrastructure operated by third parties
                through which a transaction you authorise may be routed. They
                receive the transaction information necessary to execute it and
                act on their own account, not on our instructions. Where
                infrastructure of that kind is operated by us or by an affiliate
                of ours, this paragraph does not apply to it; and
            </p>
            <p>
                (b) providers we engage for our own controller processing under
                clause 2.2, including providers of support, marketing
                communications, analytics, screening and security incident
                investigation. They process personal data on our behalf, not on
                yours, and are addressed in our Privacy Notice. We configure
                those providers not to receive Customer Personal Data. If any
                such provider processes Customer Personal Data on our behalf, it
                is a Subprocessor and will be listed in Annex 3 before that
                processing begins.
            </p>
            <h2>
                <strong>6. Assistance, information and audit</strong>
            </h2>
            <p>
                <strong>6.1 </strong>The Business Platform provides features to
                access, export and change information in your Workspace, as
                described in Annex 1. You should use those to respond to a data
                subject in the first instance. Where a feature is not available
                for the information in question, clause 6.2 applies.
            </p>
            <p>
                <strong>6.2 </strong>We will provide reasonable assistance, at
                your cost where the request is not straightforward, to help you
                respond to a request to exercise rights of access,
                rectification, erasure, restriction, portability or objection,
                and to carry out a data protection impact assessment or consult
                a supervisory authority.
            </p>
            <p>
                <strong>6.3 </strong>If we receive a request directly from a
                data subject relating to Customer Personal Data, we will not
                respond substantively other than to direct the person to you,
                unless required by law or instructed by you.
            </p>
            <p>
                <strong>6.4 </strong>On reasonable written request, and no more
                than once in any twelve month period unless a supervisory
                authority requires otherwise or there has been a personal data
                breach affecting your Customer Personal Data, we will give you
                the information reasonably necessary to demonstrate our
                compliance with this DPA.{" "}
            </p>
            <p>
                <strong>6.5 </strong>If that is not sufficient to meet a
                requirement of Data Protection Law, we will allow an audit,
                subject to reasonable notice, confidentiality undertakings,
                conduct during business hours in a way that does not disrupt our
                operations or the security or confidentiality of other
                customers’ data, and your bearing the cost.
            </p>
            <h2>
                <strong>7. Personal data breach</strong>
            </h2>
            <p>
                <strong>7.1 </strong>We will notify you without undue delay
                after becoming aware of a personal data breach affecting
                Customer Personal Data. The notification will describe what we
                know at the time, including the nature of the breach, the
                categories and approximate volume of data and data subjects
                affected, the likely consequences, the measures taken or
                proposed and a contact point. Where we cannot provide all of
                that at once we will provide it in stages without undue delay.
            </p>
            <p>
                <strong>7.2 </strong>We will co-operate with you and take
                reasonable steps to help you meet your own notification
                obligations. Our notification is not an admission of fault or
                liability.
            </p>
            <h2>
                <strong>8. Deletion</strong>
            </h2>
            <p>
                <strong>8.1 </strong>Your treasury contract exists on the NEAR
                blockchain independently of the Business Platform. Closing your
                Workspace, and any deletion under this clause, does not affect
                your treasury contract, the assets held in it, or your ability
                to interact with it directly.
            </p>
            <p>
                <strong>8.2 </strong>At any time, and on the end of our
                provision of the Business Platform to you, you may instruct us
                to return or delete Customer Personal Data held off-chain in our
                systems, at your choice. Return is provided by export in a
                commonly used machine-readable format. We will comply as soon as
                reasonably practicable, will then delete any remaining copies
                except as clause 8.4 permits, and will confirm in writing on
                request. Deletion cannot be reversed, so export anything you
                want to keep first.
            </p>
            <p>
                An instruction under this clause may identify particular records
                or request deletion of all Customer Personal Data associated
                with a Workspace, and may be sent to legal@near.com.
            </p>
            <p>
                <strong>8.3 </strong>An instruction to close your Workspace is
                an instruction to delete. Between instruction and deletion we
                may restrict processing to storage only.
            </p>
            <p>
                <strong>8.4 </strong>We may retain Customer Personal Data where
                and for as long as required by a law applying to us, or where
                necessary to establish, exercise or defend legal claims, in
                which case we will keep it only for that purpose, apply this DPA
                to it, and delete it when the reason for keeping it ends. Data
                in backups is overwritten in the ordinary backup cycle,
                currently within seven days, and we do not delete individual
                records from a backup already taken.
            </p>
            <h2>
                <strong>9. International transfers</strong>
            </h2>
            <p>
                <strong>9.1 </strong>We are established in the British Virgin
                Islands and may process Customer Personal Data in, or provide
                access to it from, countries outside the United Kingdom, the
                European Economic Area and Switzerland.
            </p>
            <p>
                <strong>9.2 </strong>Where a transfer of Customer Personal Data
                is subject to Data Protection Law and no adequacy decision
                applies, the transfer mechanisms in Annex 4 apply and are
                incorporated into this DPA. Your details for the purposes of
                those mechanisms are those you give us under clause 1.2, and
                until you do so you are identified by the account through which
                the Agreement was accepted and by our record of that acceptance.
                If a mechanism we rely on is invalidated or superseded, we will
                apply an alternative lawful mechanism without undue delay.
            </p>
            <h2>
                <strong>10. Blockchain and confidential infrastructure</strong>
            </h2>
            <p>
                <strong>10.1 Public blockchain records. </strong>When you or
                your personnel authorise a transaction, deploy or configure a
                treasury contract, or create a proposal or a vote, that
                instruction is published to the public NEAR blockchain by you,
                using our interface. The resulting record, including account
                identifiers, contract addresses, membership and permission
                configuration, proposals, votes, non-confidential transactions
                and any free text written to an on-chain field, is public,
                permanent and outside the control of any person, including us.
                It cannot be amended, deleted, restricted or made confidential.
                Configuration recorded on-chain, such as membership and
                permissions, can be changed by a later transaction, but the
                earlier record and the change itself both remain permanently
                visible. You decide what to publish, and should not write
                personal details into an on-chain field.
            </p>
            <p>
                <strong>10.2</strong> Some transactions may use a confidential
                execution environment intended to reduce the information visible
                on a public blockchain. We can access information within that
                environment as necessary to operate the Business Platform.
                Operators of the confidential environment and third-party
                transaction infrastructure may receive the information necessary
                to perform their functions, as described in clause 5.5 and the
                Privacy Notice. We will:
            </p>
            <p>
                (a) Where we access them to provide the Business Platform to
                you, such as to display your balances and transaction history,
                we do so as your processor under this DPA.
            </p>
            <p>
                (b) Where we access them, or permit specialist security,
                incident response or blockchain analytics providers or an
                authority to access them, in order to secure the service, to
                investigate suspected fraud, theft, sanctions evasion, money
                laundering or other unlawful or prohibited activity, to respond
                to a security incident, to comply with a legal or regulatory
                requirement or a lawful request, or to establish, exercise or
                defend legal claims, we do so as controller and not as your
                processor. The Agreement sets out the corresponding rights, and
                our privacy notice describes that processing.
            </p>
            <p>
                <strong>10.3 Effect on data subject rights. </strong>A request
                for erasure, rectification or restriction can be satisfied in
                relation to data held off-chain in our systems, and we will do
                that under clauses 6.2 and 8. Neither we nor you can alter or
                remove a record already written to a public blockchain. Where a
                request relates to such a record we will take the steps within
                our control, which may include deleting our off-chain copies and
                any linkage we hold to it and, where the product allows it,
                supporting a further transaction that changes the current
                position going forward.
            </p>
            <p>
                <strong>10.4</strong> We do not require names or contact details
                from end users to use the Business Platform. Even where we hold
                such details as controller because an individual made an enquiry
                or contacted support, we may be unable to link them to a
                particular Workspace or blockchain account. Where a request
                concerns information associated with a blockchain account, we
                may require proof of control of that account before taking
                action.
            </p>
            <h2>
                <strong>11. Your obligations</strong>
            </h2>
            <p>
                <strong>11.1 </strong>You will:
            </p>
            <p>
                (a) give any notices and obtain any consents or other lawful
                basis required for us to process Customer Personal Data as
                described in this DPA, including in relation to people who are
                not your personnel;
            </p>
            <p>
                (b) not enter special category data, or data relating to
                children, into the Business Platform;
            </p>
            <p>
                (c) tell people whose information you record in your Workspace,
                before you record it, that account identifiers, transactions and
                free text published on-chain become a permanent public record;
                and
            </p>
            <p>
                (d) keep your Workspace membership and permissions accurate. We
                cannot recover access to a treasury contract and cannot reverse
                an authorised transaction.
            </p>
            <h2>
                <strong>12. General</strong>
            </h2>
            <p>
                <strong>12.1 </strong>Each party’s liability under or in
                connection with this DPA is subject to the exclusions and
                limitations of liability in the Agreement, and claims under this
                DPA and under the Agreement count towards the same aggregate
                cap. Nothing in this clause limits either party’s liability to a
                data subject, or a supervisory authority’s ability to exercise
                its powers.
            </p>
            <p>
                <strong>12.2 </strong>This DPA applies for as long as we process
                Customer Personal Data, and clauses 8, 10 and 12 survive.
            </p>
            <p>
                <strong>12.3 </strong>We may update this DPA. Where a change
                materially reduces your rights or our obligations we will give
                at least 15 days’ notice before it takes effect, by a notice in
                the Business Platform and, where we hold an address for you, by
                email. Otherwise a change takes effect when we publish it. We
                will not amend Annex 4 in a way that alters the standard
                contractual clauses themselves.
            </p>
            <p>
                <strong>12.4 </strong>This DPA is governed by the law and
                subject to the jurisdiction stated in the Agreement, except that
                Annex 4 is governed as stated in that Annex.
            </p>
            <h2>
                <strong>Annex 1: Description of the processing</strong>
            </h2>
            <section
                aria-label="Annex 1: Description of the processing"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the table horizontally.
                tabIndex={0}
                className="overflow-x-auto"
            >
                <table className="min-w-[640px]">
                    <tbody>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Subject matter</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Provision of the near.com for Business
                                    platform: an interface to a multi-signature
                                    treasury contract that the customer deploys
                                    and controls on the NEAR blockchain,
                                    together with payment, bulk transfer, swap
                                    and reporting features.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Duration</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    For as long as the customer’s Workspace
                                    exists, and thereafter as permitted by
                                    clause 8.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Nature and purpose</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Hosting, storage, display, transmission,
                                    caching, export and deletion of Workspace
                                    information; generation of quotes, receipts
                                    and statements; and delivering,
                                    troubleshooting and securing the Business
                                    Platform for the customer.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Categories of data subject</strong>
                                </p>
                            </th>
                            <td>
                                <p>Your personnel who use a Workspace.</p>
                                <p>
                                    Individuals whose details are recorded in a
                                    Workspace, in particular a payee recorded in
                                    an address book or named in a note.
                                </p>
                                <p>
                                    Individual recipients of transactions and of
                                    quotes for confidential transactions,
                                    whether or not recorded in an address book.
                                    Most recipients are businesses rather than
                                    individuals.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Categories of personal data</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    The following, in each case only to the
                                    extent that it relates to an identified or
                                    identifiable individual:
                                </p>
                                <p>
                                    <strong>
                                        Information about an individual:{" "}
                                    </strong>
                                </p>
                                <p>
                                    blockchain account identifiers; display name
                                    or alias and avatar image, where set;
                                    address book entries, being a wallet
                                    address, network and alias, where the entry
                                    relates to an individual rather than to a
                                    company; and free text notes and payment or
                                    proposal descriptions, where they identify
                                    or relate to an individual.
                                </p>
                                <p>
                                    <strong>
                                        Information about a Workspace, a
                                        Treasury Contract or a transaction:{" "}
                                    </strong>
                                </p>
                                <p>
                                    treasury contract addresses, membership and
                                    permission configuration, treasury name or
                                    alias, cached treasury balances and deposit,
                                    swap, transfer and payment history including
                                    confidential balances and history, and quote
                                    records for confidential transactions
                                    including intended recipient, amount, asset
                                    and time.
                                </p>
                                <p>
                                    The second group is information about your
                                    business and its treasury, and will usually
                                    relate to an individual only by linkage to a
                                    blockchain account identifier. To the extent
                                    that information in either group does not
                                    relate to an identified or identifiable
                                    individual, it is not Customer Personal Data
                                    and this DPA does not apply to it, although
                                    it remains subject to the confidentiality
                                    provisions of the Agreement.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Not included</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Business Contact Information; information
                                    provided in an enquiry, waitlist or early
                                    access request; marketing preferences and
                                    communications; direct support
                                    correspondence; authentication and session
                                    information (including passkey public keys
                                    and identifiers, session records and records
                                    of acceptance of the Agreement); screening
                                    records; and technical, log and security
                                    information used for the controller purposes
                                    in clause 2.2(b) are not Customer Personal
                                    Data. We process that information as
                                    controller under our Privacy Notice. Private
                                    keys, seed phrases and passkeys remain on
                                    the user's device and are not received or
                                    processed by us.
                                </p>
                                <p></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Special category data</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    None. Not requested and not to be entered.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Frequency</strong>
                                </p>
                            </th>
                            <td>
                                <p>Continuous for the duration.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>
                                        Available to the customer in the product
                                    </strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Export of transaction history and receipts;
                                    change of display name and avatar, which
                                    replaces the previous value; change of
                                    treasury name or alias.{" "}
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <h2>
                <strong>Annex 2: Technical and organisational measures</strong>
            </h2>
            <p>
                This Annex describes the measures in place as at the date this
                DPA was last updated. It may be updated under clause 4.1.
            </p>
            <h3>
                <strong>Access control</strong>
            </h3>
            <ul>
                <li>
                    Role-based access to production systems, granted on a need
                    to know basis.
                </li>
                <li>
                    Multi-factor authentication required for administrative
                    access to production systems and to the code repository.
                </li>
            </ul>
            <h3>
                <strong>Encryption</strong>
            </h3>
            <ul>
                <li>
                    Encryption of all traffic to and from the backend in transit
                    using TLS.
                </li>
                <li>
                    Encryption at rest of the database, backups and stored
                    quotes using AES-256.
                </li>
            </ul>
            <h3>
                <strong>Platform and application security</strong>
            </h3>
            <ul>
                <li>
                    End user authentication by a passkey or connected
                    wallet/blockchain account. Private keys, seed phrases and
                    passkeys remain on the user's device; we do not hold or
                    recover them.
                </li>
                <li>
                    Transactions require the signing threshold configured by the
                    customer on its own treasury contract, which we cannot
                    override.
                </li>
                <li>Error and exception monitoring.</li>
            </ul>
            <h3>
                <strong>Resilience and continuity</strong>
            </h3>
            <ul>
                <li>Managed cloud infrastructure.</li>
                <li>
                    Automated backups retained for a short period, currently up
                    to seven days, and overwritten thereafter.
                </li>
            </ul>
            <h3>
                <strong>Organisational measures</strong>
            </h3>
            <ul>
                <li>
                    Confidentiality obligations in contracts with personnel and
                    contractors.
                </li>
                <li>Contractual data protection terms with Sub-processors.</li>
            </ul>
            <h2>
                <strong>Annex 3: Sub-processors</strong>
            </h2>
            <p>
                The following Sub-processors are engaged as at the date this DPA
                was last updated.
            </p>
            <section
                aria-label="Annex 3: Sub-processors"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the table horizontally.
                tabIndex={0}
                className="overflow-x-auto"
            >
                <table className="min-w-[640px]">
                    <thead>
                        <tr>
                            <th scope="col">
                                <p>
                                    <strong>Provider</strong>
                                </p>
                            </th>
                            <th scope="col">
                                <p>
                                    <strong>Purpose</strong>
                                </p>
                            </th>
                            <th scope="col">
                                <p>
                                    <strong>Location</strong>
                                </p>
                            </th>
                            <th scope="col">
                                <p>
                                    <strong>Transfer mechanism</strong>
                                </p>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <p>Render Services, Inc.</p>
                            </td>
                            <td>
                                <p>
                                    Compute, database hosting and
                                    infrastructure, running on Amazon Web
                                    Services
                                </p>
                            </td>
                            <td>
                                <p>EU </p>
                            </td>
                            <td>
                                <p>
                                    Provider DPA incorporating the EU-US Data
                                    Privacy Framework, EU standard contractual
                                    clauses and the UK Addendum
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <p>Functional Software, Inc. (Sentry)</p>
                            </td>
                            <td>
                                <p>
                                    Application error and exception monitoring
                                </p>
                            </td>
                            <td>
                                <p>EU</p>
                            </td>
                            <td>
                                <p>
                                    Provider DPA relying on the Data Privacy
                                    Framework and, as a fallback, EU standard
                                    contractual clauses and the UK Addendum
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <p>
                The list above contains only providers that process Customer
                Personal Data on our behalf. Providers used only for our
                controller processing under clause 2.2, including marketing
                communications and product analytics, are addressed in our
                Privacy Notice and are not Subprocessors where they are
                configured not to receive Customer Personal Data. If a provider
                begins processing Customer Personal Data on our behalf, it will
                be treated as a Subprocessor and added to this Annex before that
                processing begins.
            </p>
            <h2>
                <strong>Annex 4: Transfer mechanisms</strong>
            </h2>
            <h3>
                <strong>A. European Economic Area</strong>
            </h3>
            <p>
                The standard contractual clauses approved by the European
                Commission in Decision 2021/914 (the SCCs) are incorporated into
                this DPA and apply to transfers of Customer Personal Data
                subject to Regulation (EU) 2016/679, as follows.
            </p>
            <section
                aria-label="Annex 4: Transfer mechanisms"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the table horizontally.
                tabIndex={0}
                className="overflow-x-auto"
            >
                <table className="min-w-[640px]">
                    <tbody>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Module</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Module Two (controller to processor) where
                                    you act as controller. Module Three
                                    (processor to sub-processor) where you act
                                    as processor for another controller.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Parties</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    You are the data exporter. Intents
                                    Technology Ltd is the data importer. Contact
                                    details, and the description of the transfer
                                    required by Annex I.B, are as set out in the
                                    Agreement and in Annex 1 to this DPA.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 7 (docking)</strong>
                                </p>
                            </th>
                            <td>
                                <p>Not used.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 9 (sub-processors)</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Option 2, general written authorisation. The
                                    notice period is the period in clause 5.2 of
                                    this DPA.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 11 (redress)</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    The optional independent dispute resolution
                                    wording does not apply.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 13 and Annex I.C</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    The competent supervisory authority is that
                                    of the EEA member state in which the
                                    exporter is established, or, where the
                                    exporter is not established in the EEA, the
                                    authority of the member state in which the
                                    exporter’s representative is established or
                                    in which the relevant data subjects are
                                    located.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 17 (governing law)</strong>
                                </p>
                            </th>
                            <td>
                                <p>The law of Ireland.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Clause 18 (forum)</strong>
                                </p>
                            </th>
                            <td>
                                <p>The courts of Ireland.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Annex II (measures)</strong>
                                </p>
                            </th>
                            <td>
                                <p>Annex 2 to this DPA.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <p>
                                    <strong>Annex III (sub-processors)</strong>
                                </p>
                            </th>
                            <td>
                                <p>
                                    Annex 3 to this DPA, as updated under clause
                                    5.
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <h3>
                <strong>B. United Kingdom</strong>
            </h3>
            <p>
                For transfers subject to the UK GDPR, the SCCs apply as amended
                by the International Data Transfer Addendum issued by the
                Information Commissioner under section 119A of the Data
                Protection Act 2018 (the UK Addendum), which is incorporated
                into this DPA. Table 1 is completed by the parties’ details in
                the Agreement. Tables 2 and 3 are completed by section A of this
                Annex and by Annexes 1 to 3 to this DPA. In Table 4, neither
                party may end the UK Addendum as set out in its section 19.
            </p>
            <h3>
                <strong>C. Switzerland</strong>
            </h3>
            <p>
                For transfers subject to the Swiss Federal Act on Data
                Protection, the SCCs apply with references to the GDPR read as
                references to that Act, references to a member state read so as
                not to prevent a data subject in Switzerland from bringing
                proceedings in Switzerland, and the competent authority being
                the Swiss Federal Data Protection and Information Commissioner.
            </p>
            <h3>
                <strong>D. United States</strong>
            </h3>
            <p>
                Where United States state privacy law applies to Customer
                Personal Data, we act as a service provider, contractor or
                processor as those laws define it, and the following apply.
            </p>
            <p>
                (a) We will not sell Customer Personal Data or share it for
                cross-context behavioural advertising. We will not retain, use
                or disclose it except to perform the business purposes set out
                in Annex 1 under nature and purpose, and will not use or
                disclose it for any other commercial purpose, outside our direct
                business relationship with you, or in combination with personal
                information from any other source, except as permitted by law.
            </p>
            <p>
                (b) We will comply with the obligations applicable to us under
                those laws, will provide the same level of privacy protection as
                they require of you, and will notify you after determining that
                we can no longer meet those obligations.
            </p>
            <p>
                (c) You may take reasonable and appropriate steps to satisfy
                yourself that we use Customer Personal Data consistently with
                your obligations, including the exercise in clause 6.4 no more
                than once in any twelve month period, and to stop and remediate
                any unauthorised use of Customer Personal Data.
            </p>
            <p>
                (d) We will assist you in responding to a consumer request in
                accordance with clause 6, and will impose equivalent obligations
                on any Sub-processor in accordance with clause 5.4.
            </p>
        </LegalPage>
    );
}
