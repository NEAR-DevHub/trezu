import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal-page";

// English-only, like the rest of the marketing pages, so the copy stays out
// of the i18n catalogue.
export const metadata: Metadata = {
    title: "Terms of Use",
    description: "The terms that govern your use of NEAR Business.",
};

export default function TermsOfUsePage() {
    return (
        <LegalPage title={["Terms", "of Use"]}>
            <p>
                <strong>NEAR.COM FOR BUSINESS TERMS AND CONDITIONS</strong>
            </p>
            <p>Updated 6 September 2026</p>
            <p>
                These Terms &amp; Conditions constitute a legally binding
                agreement between any User of the Services (
                <strong>"you"</strong>) and Intents Technology Ltd. (
                <strong>"Intents Technology"</strong>, <strong>"we,"</strong>{" "}
                <strong>"us,"</strong> and <strong>"our"</strong>), the provider
                of the Services. If you access or use the Services for or on
                behalf of an entity or another person, references to{" "}
                <strong>"you"</strong> include that entity or person and you
                represent and warrant that you have authority to bind it to this
                Agreement. These Terms &amp; Conditions, together with any
                documents or policies they expressly incorporate by reference
                (collectively, the <strong>"Agreement"</strong>) govern your
                access to and use of the platform available at business.near.com
                (the <strong>“Platform”</strong> or{" "}
                <strong>“Business Platform”</strong>) and the business-facing
                software, features and services made available through it (each
                a <strong>“Service”</strong> and, collectively, the{" "}
                <strong>“Services”</strong>) (each person accessing or using the
                Services, a <strong>“User”</strong>, and collectively, the{" "}
                <strong>“Users”</strong>). The Business Platform provides
                user-interface and software tools that enable Users to interact
                with customer-governed smart contracts, blockchain-based
                protocols and third-party services using cryptocurrency or
                digital asset wallets. NEAR Intents is an intent-based system:
                you express an <strong>“intent”</strong> (an instruction
                specifying a desired transaction outcome, such as swapping or
                bridging digital assets), which may be fulfilled by independent
                third-party solvers and related routing, bridging, and
                settlement infrastructure. The Business Platform may facilitate
                access to the 1ClickSwap Service (<strong>“1CS”</strong>),
                bridge software, the Protocol and Third Party Services, as
                described below.
            </p>
            <p>
                These Terms govern only your access to and use of the Services
                through the Business Platform. They do not govern direct or
                standalone use of near.com, the 1ClickSwap API, the Solver Bus
                API, the PoA Bridge or any relevant smart contract outside the
                Business Platform. Transactions initiated through the Business
                Platform that use 1CS or the PoA Bridge form part of the
                Services for the purposes of this Agreement. Direct or
                standalone access to those components is governed by the
                separate terms applicable to that access.
            </p>
            <h2>
                <strong>Acceptance of Terms and Conditions</strong>
            </h2>
            <p>
                By using the Services, creating a Business Workspace, accessing
                the Content (as defined below) or otherwise interacting with the
                Services, you acknowledge that you have read, understood and
                agree to be bound by this Agreement. If you do not accept this
                Agreement, you must stop accessing and using the Services and
                the Business Platform. We may amend this Agreement from time to
                time. We will give reasonable advance notice of a material
                change where practicable, including by posting the updated
                Agreement on the Business Platform, sending an email to an
                address you have provided or giving an in-Service notification.
                Advance notice may not be possible where an immediate change is
                reasonably necessary for legal, regulatory, security or
                technical reasons. The current version is available at
                business.near.com/terms, and the date shown above identifies
                when it was last updated. Our Privacy Policy at
                https://business.near.com/privacy forms part of this Agreement.
                An updated Agreement applies to your use of the Services from
                its effective date. If you do not agree to an update, you must
                stop using the Services before that date; continued use on or
                after that date constitutes acceptance.
            </p>
            <h2>
                <strong>Supplemental Terms</strong>
            </h2>
            <p>
                Intents Technology may publish or otherwise make available
                additional terms that apply to a particular product, asset,
                feature, service or programme ("
                <strong>Supplemental Terms</strong>"). Supplemental Terms form
                part of this Agreement in respect of the Customer's access to or
                use of the product, asset, feature, service or programme to
                which they relate, and apply from the date stated in them.
                Unless the Supplemental Terms state otherwise, they control to
                the extent of any conflict with the remainder of this Agreement.
                Continued use of the relevant product, asset, feature, service
                or programme after Supplemental Terms are published or presented
                constitutes acceptance of them. Intents Technology may amend
                Supplemental Terms in the same manner as this Agreement.
            </p>
            <p>
                In this Agreement, the following terms have the following
                meanings:
            </p>
            <p>
                “<strong>1Click Service</strong>” or “<strong>1CS</strong>”: the
                backend routing and settlement service through which Intents may
                be routed and settled using the Protocol when accessed through
                the Business Platform.{" "}
            </p>
            <p>
                <strong>“Authorized User”:</strong> an individual authorised by
                a Customer to access or use the Customer’s Business Workspace or
                act in relation to the Customer’s Treasury Contract. A wallet,
                passkey or other credential used by that individual is a means
                of authentication and is not itself an Authorized User.
            </p>
            <p>
                <strong>“Bulk Transfer”:</strong> a group of transfers to
                multiple recipients initiated through the bulk transfer
                functionality of the Business Platform.
            </p>
            <p>
                <strong>“Bulk Transfer Contract”:</strong> a smart contract
                configured for a Treasury Contract and used to hold and process
                digital assets approved for a Bulk Transfer.
            </p>
            <p>
                <strong>“Business Workspace”</strong>: the shared workspace in
                the Business Platform through which a Customer and its
                Authorized Users access and administer one or more Treasury
                Contracts and related Services. An Authorized User may have
                access to more than one Business Workspace, and this Agreement
                applies separately in respect of each Customer and each Treasury
                Contract accessed. A Business Workspace is a shared interface
                and organisational record only. It is not a wallet or smart
                contract, does not hold digital assets and does not represent a
                claim against Intents Technology.
            </p>
            <p>
                “<strong>Confidential Information</strong>”: non-public
                information disclosed by or on behalf of one party to the other
                that is identified as confidential or that reasonably should be
                understood to be confidential given its nature and the
                circumstances of disclosure. Customer Data is Customer
                Confidential Information. Confidential Information does not
                include information that the recipient can demonstrate was
                lawfully known without restriction, becomes public without
                breach, is received lawfully from a third party without a duty
                of confidentiality, or is independently developed without use of
                the disclosing party’s Confidential Information.
            </p>
            <p>
                “Customer Data”: data, content and information submitted to,
                stored in or generated for a Customer through a Business
                Workspace, including organisation and member information, wallet
                addresses, roles, address-book entries, transaction notes,
                Proposal descriptions, uploaded files, quote information,
                receipts and support communications and, if AI Features are
                expressly made available, AI inputs and outputs. Customer Data
                excludes data that is public on a blockchain through the
                Customer’s use of the Services and aggregated or de-identified
                data that cannot reasonably identify the Customer, an Authorized
                User or another person.
            </p>
            <p>
                <strong>“Confidential Intents Protocol”:</strong> the smart
                contracts deployed on the NEAR Private Shard which enable users
                to post, match and settle confidential Intents, to be executed
                by the Solver Network. The Confidential Intents Protocol is not
                operated or controlled by Intents Technology.
            </p>
            <p>
                <strong>“Customer”:</strong> the individual or entity for which
                a Business Workspace is created or operated and whose treasury
                is administered through the Services.
            </p>
            <p>
                <strong>“Governance Rules”:</strong> the members, roles,
                permissions, voting thresholds, quorum and other governance
                settings recorded in or applicable to a Treasury Contract.
            </p>
            <p>
                <strong>“Intent”:</strong> a User’s declarative instruction,
                expressed in a standardized format recognized by the Protocol,
                that specifies the desired outcome of a transaction or series of
                transactions without prescribing the method of execution. An
                Intent may include parameters such as asset type, quantity,
                timing, or other conditions, and is designed to be fulfilled by
                one or more Solvers through on-chain settlement.
            </p>
            <p>
                <strong>“Intents Protocol”:</strong> the smart contracts
                deployed on NEAR Protocol, including intents.near, which enable
                users to post, match and settle Intents, to be executed by the
                Solver Network. The Intents Protocol is not operated or
                controlled by Intents Technology.
            </p>
            <p>
                <strong>“MPC Service”:</strong> the NEAR multi-party computation
                signing infrastructure or related service configured so that a
                Treasury Contract may request a signature after the applicable
                Governance Rules have been satisfied.
            </p>
            <p>
                <strong>“NEAR Private Shard”:</strong> the blockchain, being a
                fork of NEAR Protocol, which operates to provide a
                restricted-visibility execution environment for confidential
                Intents and the Confidential Intents Protocol, or such other
                name as may be designated from time to time.
            </p>
            <p>
                <strong>“Proposal”:</strong> a proposed transaction,
                configuration change or other action submitted to a Treasury
                Contract for approval under the Governance Rules.
            </p>
            <p>
                <strong>“Protocol”:</strong> together, the Intents Protocol and
                the Confidential Intents Protocol. The Protocol does not include
                the Business Platform, 1CS, any bridge, or any other integration
                or component outside those protocols.
            </p>
            <p>
                “<strong>Restricted Jurisdiction</strong>”: a country, territory
                or region subject to comprehensive sanctions or other legal
                restrictions that prohibit or materially restrict provision of
                the Services, or that Intents Technology designates in a
                published access or compliance policy on the basis of applicable
                law, regulatory guidance, or the Company’s risk assessment.
            </p>
            <p>
                “<strong>Restricted Person</strong>”: a person, entity or wallet
                address that is (a) listed on, or directly or indirectly owned
                50 per cent or more in the aggregate or controlled by one or
                more persons listed on, a sanctions or restricted-party list
                maintained by a Sanctions Authority; (b) subject to an
                applicable asset freeze or transaction restriction; (c) located,
                organized, incorporated or ordinarily resident in a Restricted
                Jurisdiction; or (d) otherwise a person or entity with whom
                Intents Technology, a relevant Affiliate, Customer or Authorized
                User is prohibited or restricted from dealing under applicable
                law.
            </p>
            <p>
                “<strong>Sanctions Authority</strong>”: the United Nations
                Security Council; the government and competent authorities of
                the British Virgin Islands; the United Kingdom, including HM
                Treasury and OFSI, the United States (including OFAC), the
                European Union and its member states, and any other
                governmental, regulatory or sanctions authority whose laws,
                regulations or measures apply to Intents Technology, a relevant
                Affiliate, the Services, a Customer, an Authorized User or a
                relevant transaction.
            </p>
            <p>
                <strong>“Solver”:</strong> any third-party service, software
                agent, algorithmic or artificial intelligence– assisted system,
                or human-operated entity that, within the Solver Network and
                Protocol, receives an Intent and translates such Intent into one
                or more executable on-chain transactions. A Solver is
                responsible for determining the method of execution, including
                sourcing liquidity, routing, or composing multiple actions, and
                for submitting the resulting transaction(s) for settlement on
                the applicable blockchain via the Solver Bus API. Solvers may
                operate autonomously or under human supervision and may be
                compensated or rewarded for successful fulfillment of such
                intent.
            </p>
            <p>
                <strong>“Solver Bus API”:</strong> a communication layer
                connecting Solvers to the Protocol.
            </p>
            <p>
                <strong>"Solver Network":</strong> the collective noun for
                independent Solvers, whether software-based, algorithmic,
                artificial intelligence–assisted systems, or human-operated
                entities that participate within the Protocol to receive,
                compete for, and fulfill Intents. The Solver Network functions
                as a marketplace of execution services, where Solvers may
                operate autonomously or under human supervision and are
                compensated or rewarded for the successful settlement of Intents
                on the applicable blockchain.
            </p>
            <p>
                <strong>“Treasury Contract”:</strong> the SputnikDAO smart
                contract, or any successor customer-governed smart contract,
                deployed on the public NEAR blockchain and configured for a
                Customer through the Services.
            </p>
            <p>
                <strong>“User”:</strong> any person accessing or using the
                Services, including a Customer or an Authorized User, as the
                context requires.
            </p>
            <h2>
                <strong>
                    Business Workspaces, Customer Authority and Authorized Users
                </strong>
            </h2>
            <p>
                You may use the Services as an individual or for or on behalf of
                an entity or another person. You may use the Services only in
                relation to digital assets that you own or are lawfully
                authorised to access, manage, transfer or otherwise control. If
                you act for another person, including a client, investor, fund,
                affiliate, trust, partnership or beneficial owner, you
                represent, warrant and covenant that you have and will maintain
                every authority, mandate, licence, registration, consent and
                disclosure required for that activity and that your use of the
                Services complies with applicable law.
            </p>
            <p>
                The Services are general-purpose, use-case-agnostic software.
                Intents Technology does not select, originate, approve or
                monitor the Customer's business, its underlying activities or
                obligations, its counterparties, or the purposes for which
                digital assets are held, managed or transferred, and is not
                required to investigate or determine the legal or regulatory
                characterisation of any such matter. The availability of
                functionality, technical access, screening or absence of
                intervention does not constitute approval, endorsement,
                verification or an assumption of responsibility by Intents
                Technology. Nothing in this paragraph limits Intents
                Technology's rights to monitor use of, or restrict, suspend or
                terminate access to, the Services under this Agreement.
            </p>
            <p>
                As between the Customer and Intents Technology, the Customer
                remains solely responsible and liable for its use cases,
                business and underlying activities, transactions, counterparties
                and obligations and for determining whether they are lawful and
                appropriately structured. The Customer is also solely
                responsible for any fiduciary, trust, safeguarding, segregation,
                client-money, recordkeeping, reporting, disclosure, tax,
                accounting, anti-money laundering, sanctions or other duty that
                applies to it or to digital assets it manages. The Services do
                not determine whether the Customer is authorised or regulated to
                act for another person and do not satisfy any legal or
                regulatory obligation that applies to the Customer.
            </p>
            <p>
                The Customer is responsible for selecting, verifying,
                appointing, supervising and removing its Authorized Users;
                assigning roles and permissions; establishing internal approval
                procedures; and ensuring that each Authorized User complies with
                this Agreement and the Customer's internal authority. An action
                validly approved or performed using an Authorized User's wallet,
                credential or role will be treated by the Services as authorised
                by the Customer, whether or not it complied with the Customer's
                separate internal policies.
            </p>
            <p>
                The Services are general-purpose software. Intents Technology
                does not represent that the Services satisfy any
                Customer-specific security, operational resilience, outsourcing,
                asset-safeguarding, audit, accounting, tax, regulatory,
                risk-management, business-continuity or record-retention
                requirement.
            </p>
            <h2>
                <strong>Wallet Security, Recovery Phrases and Passkeys</strong>
            </h2>
            <p>
                You retain and are solely responsible for the control of your
                wallets, Recovery Phrase, and Passkeys when using the Services.
                This means that you are solely responsible for the retention and
                security of your recovery or seed phrase(s) for any
                cryptocurrency wallets <strong>(CWs)</strong> you connect to the
                Platform for the purposes of using the Services or any recovery
                key you create for your CWs (in each case, a{" "}
                <strong>"Recovery Phrase"</strong>), as well as your unique
                digital or hardware credentials (for example, iCloud and Google
                Passkeys and hardware authentication devices such as Yubikeys)
                that are tied to your CWs (<strong>"Passkeys"</strong>). Your
                Recovery Phrase and/or Passkeys are the only way to access the
                cryptocurrency associated with your CW. Anyone that has access
                to your Recovery Phrase and/or Passkeys can access your
                cryptocurrency. Intents Technology does not offer CWs or CW
                software to customers. You are solely responsible for obtaining
                a CW with which you can connect to the Platform for the purposes
                of using the Services. Intents Technology does not have control
                over third-party CW software providers’ content or their
                products and does not warrant or endorse, and is not responsible
                for the availability or legitimacy of, any CW.
            </p>
            <p>
                <strong>
                    IF YOU SHARE YOUR RECOVERY PHRASE OR YOUR PASSKEYS WITH A
                    THIRD PARTY, IF YOUR RECOVERY PHRASE OR PASSKEYS ARE
                    COMPROMISED, OR IF YOU SUSPECT YOUR RECOVERY PHRASE OR
                    PASSKEYS ARE COMPROMISED, YOU SHOULD IMMEDIATELY MOVE YOUR
                    ASSETS INTO A NEW, UNCOMPROMISED WALLET. IF YOU LOSE YOUR
                    RECOVERY PHRASE AND/OR PASSKEYS TO ANY WALLET, YOU WILL NOT
                    BE ABLE TO ACCESS YOUR CRYPTOCURRENCY IN THAT WALLET. YOU
                    ACKNOWLEDGE THAT INTENTS TECHNOLOGY DOES NOT STORE AND IS
                    NOT RESPONSIBLE IN ANY WAY FOR THE SECURITY OF YOUR RECOVERY
                    PHRASE AND/OR PASSKEYS. YOU AGREE TO HOLD INTENTS TECHNOLOGY
                    AND ITS CORPORATE AFFILIATES (“AFFILIATES”) HARMLESS FOR ANY
                    LOSSES ARISING FROM YOU LOSING YOUR RECOVERY PHRASE AND/OR
                    PASSKEYS. YOU AGREE THAT INTENTS TECHNOLOGY AND ITS
                    AFFILIATES SHALL NOT BE LIABLE IN ANY WAY IF YOU LOSE YOUR
                    RECOVERY PHRASE AND/OR PASSKEYS AND CANNOT ACCESS YOUR
                    CRYPTOCURRENCY.
                </strong>
            </p>
            <p>
                For a Business Workspace, each Authorized User is solely
                responsible for the security and continued availability of its
                wallet, keys, passkeys and credentials. If enough Authorized
                Users lose access to fall below an applicable approval
                threshold, digital assets may become inaccessible. If enough
                Authorized Users collude or are compromised to meet the
                threshold, they may transfer or otherwise affect the Customer's
                digital assets or change the Governance Rules. Intents
                Technology cannot restore access, reverse an approved action or
                protect the Customer against those outcomes.
            </p>
            <h2>
                <strong>Treasury Governance and Control</strong>
            </h2>
            <p>
                The Business Platform helps a Customer initialise and configure
                a Treasury Contract. The Treasury Contract records and enforces
                the Governance Rules, including members, roles, permissions,
                voting thresholds and quorum. Those rules and governance
                activity live on the public NEAR blockchain. Public governance
                data may include member wallet addresses, roles, policies,
                Proposal creators, quote hashes, votes and approval status; the
                governance flow is not intended to disclose the underlying
                recipient, amount or full quote. Once the approvals required by
                the Governance Rules have been obtained, the Treasury Contract
                may request the MPC Service to sign the relevant instruction.
                Intents Technology cannot, without those approvals, change the
                Governance Rules, change who may approve an action, cause the
                Treasury Contract to approve an action, or cause the MPC Service
                to sign through the configured Treasury Contract flow.
            </p>
            <p>
                For a Business Workspace, the Services help configure an MPC
                signing authority and register it with the Confidential Intents
                Protocol. Customer balances are maintained through the
                Confidential Intents Protocol on the NEAR Private Shard and are
                not held in the Treasury Contract. For a payment, Bulk Transfer
                or swap, the Business Platform or its backend may obtain and
                temporarily store an unsigned confidential quote. The front end
                enables Authorized Users to create and approve a Proposal to
                sign the hash of that quote. Once the required approvals are
                obtained, the Treasury Contract requests the MPC signature, and
                the backend may combine the stored quote with the signature and
                submit the signed instruction to the confidential 1CS API for
                processing through the Confidential Intents Protocol.
            </p>
            <p>
                The backend's role in obtaining, storing, assembling or
                submitting a quote is operational. The Business Platform and
                Treasury-governance backend do not themselves receive or hold
                Customer digital assets. Assets may be processed through the
                Protocol, 1CS, bridges, Bulk Transfer Contracts and other
                smart-contract infrastructure as described in this Agreement.
                That operational role does not authorise the transaction and is
                not designed to permit Intents Technology to bypass the
                Governance Rules. Without the approvals required by those
                Governance Rules, Intents Technology cannot use the Treasury
                Contract or its configured MPC signing flow to move or otherwise
                affect the Customer's confidential balances, change who may do
                so, or recover access if the Customer no longer has enough
                Authorized Users.
            </p>
            <p>
                Treasury Contracts, the MPC Service, the Protocol and related
                smart contracts exist and operate on blockchain or other
                protocol infrastructure independently of the Business Platform.
                Intents Technology may provide or support convenient methods to
                interact with them but does not guarantee that the Business
                Platform or backend will remain available. The Customer is
                responsible for understanding its Governance Rules and
                maintaining the information, credentials and operational
                arrangements needed to use or recover its treasury.
            </p>
            <p>
                The Treasury Contract is a customer-governed smart contract
                based on third-party open-source software that Intents
                Technology did not write and does not control. Intents
                Technology does not warrant that it is free from defects or
                vulnerabilities, has been audited, or will continue to be
                maintained or supported, and gives no assurance as to any
                administrative, upgrade or governance mechanism within it or the
                persons able to exercise one. The Customer is responsible for
                satisfying itself as to the contract it deploys and configures.
            </p>
            <p>
                The MPC Service and the NEAR Private Shard are operated by
                parties other than Intents Technology. Intents Technology does
                not control them, does not guarantee their availability,
                continuity, performance or security, and is not liable for any
                act, omission, failure, delay, downtime, compromise or collusion
                affecting them. If either becomes unavailable or degraded,
                signing, settlement or confidentiality may be delayed, prevented
                or affected, and the Customer may be unable to transact until
                service is restored. Confidentiality also depends on the correct
                operation of the validators of the NEAR Private Shard.
            </p>
            <h2>
                <strong>Third Party Services and Environments</strong>
            </h2>
            <p>
                You can use the Services to access third-party services, such as
                decentralized exchanges, Solvers, lending protocols,
                social-media or messaging protocols and other services ("Third
                Party Services"), and to interact with them using your CW.
                Intents Technology does not control independent Third Party
                Services or their counterparties. Where Intents Technology makes
                a Third Party Service accessible through the Services, it does
                so as a matter of technical integration only, and that does not
                constitute an endorsement, recommendation, approval or assurance
                as to the Third Party Service, its operator, or its safety,
                performance, liquidity, solvency or regulatory status. For
                purposes of this Agreement, 1CS and the PoA Bridge are operated
                by Intents Technology or an Affiliate are not Third Party
                Services; other components in the same transaction route may be
                independently operated. We make Third Party Services accessible
                only as a convenience, do not control or endorse them and are
                not responsible for their availability, legitimacy, content,
                assets, products or services. Unless the Business Platform
                expressly states otherwise, you transact with the relevant third
                party, not Intents Technology or an Affiliate, and the third
                party’s own terms may apply.
            </p>
            <p>
                Certain Third Party Services, such as Solvers, decentralized
                exchanges, decentralized matching engines, and decentralized
                lending protocols, may provide access to services and assets
                that have high risks of illiquidity, devaluation, lockup, or
                loss. Before you initiate any transaction with or through any
                Third Party Service, it is important for you to understand that
                you are transacting directly with a third party that is not
                affiliated with Intents Technology or any Intents Technology
                Affiliate. You should assume that we have not verified the
                safety or legitimacy of any Third Party Service, and have not
                reviewed (or approved of) the services it provides or any
                representations it has made. It is your responsibility to ensure
                that you fully understand the nature of the services being
                provided by any Third Party Service, including the financial
                risks that you may be exposed to as a result of using such Third
                Party Service.
            </p>
            <p>
                Intents Technology enables you to interact with Third Party
                Services by signing and authorizing onchain transactions (each,
                an <strong>"Onchain Transaction"</strong>) using your CW,
                including transactions that transfer digital assets between your
                CW and other wallet addresses. For certain Onchain Transactions
                that involve multiple signing steps, the Services may enable you
                to authorize the bulk signing of all such messages using an
                alternative key or signer that is under your sole control.
                Onchain Transactions that you sign using your CW or that you
                otherwise authorize cannot be reversed once they have been
                broadcast to the relevant digital asset network (although they
                may be in a pending state, and designated accordingly, while the
                transaction is processed by network operators). Neither Intents
                Technology nor any other member of its corporate group makes any
                guarantee that an Onchain Transaction will be confirmed by the
                relevant digital asset network(s), and you agree to hold Intents
                Technology and its Affiliates harmless for any losses arising
                from such failure to execute correctly, timely, or as intended.
            </p>
            <h2>
                <strong>Third-Party Solvers</strong>
            </h2>
            <p>
                Solvers are independent third parties and Users of the Services.
                Intents Technology does not: guarantee optimal pricing or
                execution, assess Solvers’ reliability or security, or ensure or
                guarantee against losses from Solver errors, collusion, or
                malicious acts.
            </p>
            <p>
                The Solver Network may include AI-driven, algorithmic-driven and
                human-operated Solvers. Solvers may exhibit limitations
                including algorithmic biases, unpredictable behaviors under
                certain conditions, or optimization approaches that prioritize
                different factors than you might expect. Intents Technology does
                not develop, control, or validate the decision-making processes
                of individual Solvers and assumes no responsibility for their
                performance or outcomes.
            </p>
            <p>
                To the extent that you elect to conduct transactions in
                connection with the Business Platform, all transactions are
                conducted between the User publishing the Intent and the
                applicable Solver. Intents Technology is not a party to any
                transaction or any Intent. Intents Technology is not responsible
                for the quality, safety, accuracy, or any aspect of any
                transaction (regardless of whether such transaction is made
                available by the Business Platform).
            </p>
            <p>
                Intents Technology reserves the right to permit, condition, or
                terminate any Solver’s access to the Services at any time, for
                any reason or no reason, with or without notice, in Intents
                Technology’s sole and absolute discretion.
            </p>
            <h2>
                <strong>Acknowledgement of Risk</strong>
            </h2>
            <p>
                <strong>
                    THE FOLLOWING SECTION CONTAINS A DETAILED, THOUGH NOT
                    EXHAUSTIVE, DISCLOSURE OF THE SIGNIFICANT RISKS ASSOCIATED
                    WITH USING THE SERVICES. YOU ARE STRONGLY URGED TO READ AND
                    UNDERSTAND THESE RISKS THOROUGHLY BEFORE USING THE SERVICES.
                    YOUR USE OF THE SERVICES IS AT YOUR SOLE RISK. INTENTS
                    TECHNOLOGY WILL NOT BE LIABLE FOR ANY LOSSES INCURRED AS A
                    RESULT OF THESE RISKS.
                </strong>
            </p>
            <p>
                You should carefully review, acknowledge, understand and assume
                the risks set forth in this Agreement as well as other risks
                associated with the Services, all of which could render your
                digital assets worthless or of little value. You acknowledge and
                agree that you are accessing the Services for yourself or, where
                applicable, for a Customer and any other person for whom the
                Customer is lawfully authorised to act. Digital assets can
                increase or decrease in value or become worthless. You
                acknowledge, understand, and agree that you may lose some or all
                of your digital assets. You should consult your financial
                advisor, legal or tax professional regarding your specific
                situation and financial condition and carefully consider whether
                trading or holding digital assets is suitable for you.
            </p>
            <p>
                Intents Technology is not registered with the U.S. Securities
                and Exchange Commission or the Commodity Futures Trading
                Commission. You acknowledge that digital assets are not subject
                to protections or insurance provided by the Federal Deposit
                Insurance Corporation, the Securities Investor Protection
                Corporation, or similar bodies located in other jurisdictions.
            </p>
            <p>
                You acknowledge, understand, and agree that in using the
                Services, you have sufficient knowledge to utilize the Services
                and to make sure that any such usage is accurate and
                intentional. You acknowledge and agree that Intents Technology
                may, in some cases, and in its sole discretion, take measures to
                block or suspend your access to the Services in its sole
                discretion.
            </p>
            <p>
                You acknowledge, understand, and agree that digital assets may
                have no present or future value. Your use or transfer of digital
                assets is subject to all requirements imposed on such
                transactions, including any requirements to comply with
                applicable laws, rules, and regulations and any requirements to
                enter into additional terms and conditions. You acknowledge that
                use of digital assets, cryptocurrencies, and blockchain
                technology involve a high degree of risk. The use or accessing
                of digital assets may result in a loss of part or all of their
                value. Digital assets, and the blockchain technology on which
                they are based, are new and rapidly changing, and therefore may
                contain technical flaws and may be susceptible to malicious
                cyberattacks.
            </p>
            <p>
                You acknowledge, understand, and agree that Intents Technology
                may cease supporting any type of digital assets on the Services
                in our sole discretion with or without notice. Intents
                Technology does not guarantee that orders will execute or that
                it will be able to fill any orders. There is a risk that you may
                experience losses due to the inability to sell or convert
                digital assets into a preferred alternative asset immediately or
                where conversion is possible but at a loss. Intents Technology
                is not responsible for any loss you may incur, directly or
                indirectly, in connection with Intents Technology’s decision not
                to support any type of digital assets. Neither Intents
                Technology nor any of Intents Technology’s affiliates assumes
                any responsibility in connection with any attempt to use your CW
                to store, receive or otherwise transact with any digital asset
                that is on a blockchain, smart contract, or network not
                supported by the Services.
            </p>
            <p>
                You acknowledge, understand, and agree that (1) your use of the
                Services may have tax consequences for you; (2) you are solely
                responsible for compliance with your tax obligations; and (3)
                Intents Technology bears no liability or responsibility with
                respect to any tax consequences to you. Any fees generated or
                incurred through your use of the Services shall be your sole
                responsibility to track, quantify, and account for.
            </p>
            <p>
                You acknowledge, understand, and agree that transactions in
                connection with the Services and your CW cannot be reversed.
                Once you send digital assets to a digital address or smart
                contract, there is a risk that you may lose access to such
                digital assets indefinitely. For example, a digital address may
                have been entered incorrectly, or a digital address may belong
                to a person or entity that will not return the digital assets to
                you. If you lose your private key for your CW, you may
                permanently lose access to your digital wallet if the private
                key has been backed up on paper and subsequently lost or stolen,
                or the private key has been hacked or stolen. Intents Technology
                cannot access your CW. You are responsible for any transactions
                executed by or involving your CW, regardless of whether you
                approved such transactions. For a Business Workspace, you are
                also responsible for transactions authorised by the Treasury
                Contract in accordance with its Governance Rules, whether or not
                the transaction complied with any separate internal policy,
                mandate or approval process.
            </p>
            <p>
                Once an Onchain Transaction is submitted to a digital asset
                network, the transaction will be unconfirmed and remain in a
                pending state for a period of time sufficient to allow
                confirmation of the transaction by the digital asset network. An
                Onchain Transaction is not complete while it is in a pending
                state. Pending Onchain Transactions that are initiated using a
                CW will reflect a pending transaction status and are not
                complete while the transaction is pending. Neither Intents
                Technology nor any of its Affiliates is liable for any losses
                you may incur as a result of issues with the relevant digital
                asset network (e.g., network outages or excessive network
                congestion) that causes any Onchain Transaction to remain in a
                pending state for an extended duration.
            </p>
            <p>
                Save for the software and intellectual property used to provide
                the Services, Intents Technology does not own or control the
                underlying software protocols which govern the operation of
                digital assets. Generally, the underlying protocols are open
                source, and anyone can use, copy, modify, and distribute them.
                Intents Technology assumes no responsibility for the operation
                of the underlying protocols and does not guarantee the
                functionality or security of network operations. In particular,
                the underlying protocols may be subject to sudden changes in
                operating rules or applicable transaction histories, including
                but not limited to code changes which are commonly referred to
                as protocol "forks." Any such operating changes may materially
                affect the availability, value, functionality, and/or the name
                of the digital assets in your CW. Intents Technology does not
                control the timing and features of these operating changes.
            </p>
            <p>
                You acknowledge and accept the risks of operating changes to
                digital assets and digital asset protocols and agree that
                Intents Technology is not responsible for such operating changes
                and not liable for any loss of value you may experience as a
                result of such changes in operating rules or Intents
                Technology’s decisions on which version of those digital assets
                to support on the platform, including, without limitation, the
                selection of one fork versus another.
            </p>
            <p>
                Intents Technology does not verify, audit, or guarantee the
                accuracy, completeness, legitimacy, or safety of any Third Party
                Services, assets, liquidity sources, or transaction outcomes.
                Users are solely responsible for evaluating and accepting all
                risks associated with their interactions.
            </p>
            <h2>
                <strong>Eligibility and User Representations</strong>
            </h2>
            <p>
                The Services are intended solely for business and professional
                use by Users who meet the eligibility criteria in this
                Agreement. By accessing or using the Services, you represent,
                warrant and covenant, for yourself and, where applicable, for
                the Customer, that: (1) each individual User is at least 18
                years old or the age of legal majority in their jurisdiction,
                whichever is greater; (2) the Customer is validly organised or
                otherwise lawfully constituted, and each User has authority to
                bind and act for it; (3) you have full power and authority to
                enter into and comply with this Agreement and, if acting for
                another person, to bind and act for that person; (4) you access
                and use the Services wholly or mainly for purposes relating to
                your trade, business, craft or profession, or those of the
                Customer, and not as a consumer; (5) neither you nor the
                Customer, nor any of their respective beneficial owners or
                controlling persons, is a Restricted Person or is located,
                organised, incorporated or ordinarily resident in a Restricted
                Jurisdiction; (6) you and the Customer comply with all
                applicable anti-money-laundering, counter-terrorist-financing
                and counter-proliferation-financing requirements; and (7)
                neither you nor the Customer will access the Services where
                previously prohibited from doing so, where any law prohibits it,
                or after access has been suspended or terminated.
            </p>
            <h2>
                <strong>Transaction Execution</strong>
            </h2>
            <p>
                The Services provide a user interface which allows you to access
                smart contracts which conduct transactions with digital assets.
                You represent and warrant that you understand the nature of
                these transactions. If you do not understand the nature of these
                transactions, you should immediately cease your use of the
                Services. Routing, matching, execution, and settlement may be
                performed by smart contracts, third-party service providers, and
                infrastructure that Intents Technology or its Affiliates operate
                or make available. Intents Technology does not act as a broker,
                dealer, agent, or counterparty in any transaction.
            </p>
            <p>
                Transactions undertaken via the Services may be routed to or
                facilitated by Solvers, third-party matching engines, downstream
                aggregators, wallet interfaces, liquidity sources, and other
                third parties that participate in the Quoting Layers and the
                Execution Process described in the Quote and Execution Mechanics
                section below. Except for technology, interfaces, parameters, or
                contracts that Intents Technology itself operates or makes
                available, Intents Technology does not select, instruct,
                supervise, or control third-party Solvers, Quoting Layers,
                liquidity sources, and is not responsible for the price, speed,
                reliability, availability, or completion of any transaction
                routed through, matched by, fulfilled by, or settled by them.
                References in this Agreement to the “execution” or “fulfillment”
                of a transaction do not imply that Intents Technology has
                executed or fulfilled any transaction as principal, agent,
                broker, dealer, counterparty, fiduciary, adviser, or in any
                other regulated capacity. Intents Technology may make available
                API access programs, partner programs, or developer tools to
                which Solvers, integrators, or other developers may subscribe,
                including programs that require credentials, technical
                onboarding, identity verification, or commercial terms. Any such
                program is a technical and commercial program and does not
                constitute an endorsement, warranty, supervision, or vouching
                for any Solver’s conduct, performance, financial condition, or
                compliance.
            </p>
            <h2>
                <strong>Quote and Execution Mechanics</strong>
            </h2>
            <p>
                When the Services display price information for a proposed
                transaction, that information is indicative only unless the
                applicable interface expressly states otherwise. Such indicative
                price information is referred to in this Agreement as an{" "}
                <strong>“Indicative Quote.”</strong> You acknowledge,
                understand, and agree to each of the following.
            </p>
            <p>
                <strong>Indicative Quotes are non-binding.</strong> An
                Indicative Quote is an estimate generated, ranked, transmitted,
                or displayed through Solvers, liquidity sources, Quoting Layers,
                and related routing systems at the time of the request, based on
                conditions known to those parties or systems at that moment. An
                Indicative Quote does not constitute an offer, commitment,
                reservation of liquidity, locked price, or guarantee by any
                Solver, liquidity source, third party, Quoting Layer, or Intents
                Technology that the proposed transaction will execute at the
                indicated price, at the indicated speed, by the indicated route,
                by the indicated Solver, or at all.
            </p>
            <p>
                <strong>
                    Indicative Quotes may be produced by multiple auction,
                    routing, ranking, or selection processes.
                </strong>{" "}
                The generation, selection, routing, and display of an Indicative
                Quote may involve one or more layers (the{" "}
                <strong>“Quoting Layers”</strong>), which may include, without
                limitation, the wallet, application, or aggregator interface
                through which you access the Services, one or more downstream
                aggregators, the 1CS routing layer, and the Solver Network. Each
                Quoting Layer may apply its own ranking and selection criteria,
                which may include price, response latency, historical execution
                accuracy, fee structure, routing priority, available liquidity,
                commercial terms, and other factors. The Indicative Quote
                displayed to you may reflect the parameters, fees, incentives,
                and selection criteria of participating Quoting Layers.
            </p>
            <p>
                <strong>
                    Solvers and Quoting Layers compete for routing priority.
                </strong>{" "}
                Because Indicative Quotes are non-binding, Solvers, liquidity
                sources, aggregators, and intermediate Quoting Layers may have
                economic incentives to submit Indicative Quotes, response times,
                availability, or other parameters that appear more favorable
                than the price, timing, or liquidity that may ultimately be
                available in execution, in order to win routing priority for
                proposed transactions. You acknowledge, understand, and agree
                that an Indicative Quote may reflect optimistic indicative
                pricing, speed, availability, or routing assumptions submitted
                to win routing priority, and that those assumptions may differ
                materially from execution conditions. Intents Technology does
                not represent that any Indicative Quote is neutral, unbiased,
                firm, executable, reserved, or a price at which any Solver is
                willing or able to fulfill the transaction at the time of
                execution.
            </p>
            <p>
                <strong>Execution is a separate process.</strong> Once you
                authorize a transaction and your assets are submitted into the
                relevant escrow, settlement, or transaction process, a separate
                execution process is undertaken (the{" "}
                <strong>“Execution Process”</strong>). The Execution Process
                may, and in ordinary operation is expected to, include one or
                more separate auctions, solicitations, routing steps, or
                matching processes among Solvers or liquidity sources after you
                authorize the transaction. The Indicative Quote is not reserved,
                locked, or carried forward as a binding fill obligation, except
                that it may be used as a reference point for calculating any
                applicable Slippage Tolerance (defined below). Your transaction
                may be fulfilled at a price different from the Indicative Quote,
                subject to any applicable Slippage Tolerance.
            </p>
            <p>
                <strong>Settlement times may be material.</strong> The time
                interval between display of an Indicative Quote, authorization
                of a transaction, submission of assets, blockchain confirmation,
                completion of the Execution Process, and final settlement may be
                material, and in certain cases may extend to thirty (30)
                minutes, one (1) hour, or longer for transactions involving
                blockchains with longer confirmation times, including, without
                limitation, Bitcoin. The prevailing market price for the
                relevant assets may move materially in either direction during
                this interval. You bear the risk of unfavorable market and
                volatility movement during this interval up to any applicable
                Slippage Tolerance, and favorable movement may be subject to the
                Quote Improvement and Capture Share terms described in the Fees
                section.
            </p>
            <p>
                <strong>
                    Slippage Tolerance defines an operating range, not an
                    execution price.
                </strong>{" "}
                Where a maximum tolerance for variance between the Indicative
                Quote and the price at which your transaction is filled is
                displayed, selected, accepted, or otherwise applied to your
                transaction (the <strong>“Slippage Tolerance”</strong>), the
                Slippage Tolerance defines the operating range within which the
                Execution Process may settle your transaction. The Slippage
                Tolerance is not a guarantee of any particular execution price,
                is not a representation that the Indicative Quote is the price
                at which your transaction will fill and is not a representation
                that the Execution Process will return the best available price
                within the Slippage Tolerance. The Execution Process may retry
                one or more times within the Slippage Tolerance before settling,
                and the prevailing market price during such retries may move in
                either direction.
            </p>
            <p>
                <strong>
                    Intents Technology does not undertake best execution.
                </strong>{" "}
                Except to the extent non-waivable applicable law requires
                otherwise, Intents Technology does not undertake to provide
                “best execution,” “best price,” fiduciary execution, advisory
                execution, or any equivalent standard with respect to any
                Indicative Quote or any transaction undertaken via the Services.
                Intents Technology makes no representation or warranty that any
                Indicative Quote is the best available indicative price, that
                any Execution Process will return the best available execution
                price, or that the Quoting Layers or Execution Process operate
                in a manner that maximizes value to you.
            </p>
            <p>
                <strong>
                    Intents Technology does not control third-party Solvers or
                    Quoting Layers.
                </strong>{" "}
                Except for technology, interfaces, parameters, or contracts that
                Intents Technology itself operates or makes available, Intents
                Technology does not operate, control, oversee, or audit
                third-party Solvers, third-party Quoting Layers, or the criteria
                those parties apply. Intents Technology does not independently
                verify, and makes no representation or warranty regarding, the
                accuracy, reliability, completeness, or integrity of Indicative
                Quotes or other information supplied by third parties, the
                operation of any third-party Quoting Layer, the operation of any
                third-party component of the Execution Process, or the conduct
                of any Solver.
            </p>
            <p>
                <strong>Release.</strong> To the maximum extent permitted by
                applicable law, you acknowledge, understand, and agree to
                release and hold harmless Intents Technology and its Affiliates
                from any losses, damages, or claims arising from or relating to:
                any difference between an Indicative Quote and the price at
                which your transaction is ultimately filled; the failure of any
                Solver, liquidity source, or Quoting Layer to honor, deliver, or
                replicate any Indicative Quote; any submission, ranking,
                routing, or selection behavior of any Solver or Quoting Layer in
                the production or display of Indicative Quotes; market or
                volatility movement during the Execution Process or any
                settlement interval; any retry of the Execution Process within
                the Slippage Tolerance; or Intents Technology’s lack of
                oversight or control over third-party Solvers, third-party
                Quoting Layers, or liquidity sources.
            </p>
            <h2>
                <strong>Payments and Bulk Transfers</strong>
            </h2>
            <p>
                The Services may enable the Customer to propose and approve
                transfers to near.com users, public blockchain addresses or
                other supported recipients. The Customer is solely responsible
                for the purpose, legality, amount, asset, recipient, destination
                and timing of each transfer and for any invoice, contract,
                employment, tax, reporting or other obligation connected with
                it. The Services do not verify that a recipient address belongs
                to the intended person or that a transfer discharges any
                underlying obligation. The transaction, quote and execution
                terms in this Agreement apply to payments and Bulk Transfers
                where relevant.
            </p>
            <p>
                A Bulk Transfer may allow the Customer to approve multiple
                transfers through one governance process. After the required
                approval, the aggregate amount for the Bulk Transfer may be
                transferred from the Customer's confidential treasury balance to
                a Bulk Transfer Contract configured for, and administered by,
                the same Treasury Contract. The backend may temporarily store
                the underlying unsigned quotes and call or prompt the Bulk
                Transfer Contract to progress through signing and submission of
                the pre-approved quote hashes. Intents Technology cannot move,
                redirect or refund digital assets held in the Bulk Transfer
                Contract without the approvals required by the Customer's
                Governance Rules.
            </p>
            <p>
                A Bulk Transfer may not be atomic. Some transfers may complete
                while others remain pending, expire, fail or require replacement
                quotes. If the Business Platform or backend is unavailable,
                loses a quote or cannot progress the Bulk Transfer, digital
                assets may remain in the Bulk Transfer Contract until the
                Customer's authorised signers use valid contract instructions to
                resume, replace or refund the transfer. Doing so requires direct
                interaction with the relevant smart contract and may require
                technical expertise, command-line tooling or other means not
                provided through the Business Platform. Intents Technology does
                not undertake to provide, and may be unable to provide, the
                assistance or documentation needed to do so, and recovery is not
                guaranteed.
            </p>
            <p>
                Before approving a Bulk Transfer, each Authorized User must
                verify the complete recipient list, amounts, assets, networks
                and quote hashes and understand that approval may authorise the
                entire batch. The bulk transfer functionality is not a payroll,
                accounts-payable, money-remittance or managed payment service
                provided by Intents Technology. The Customer remains responsible
                for all underlying legal, compliance, tax, accounting and
                recipient-verification obligations.
            </p>
            <h2>
                <strong>Address Book, Transaction History and Exports</strong>
            </h2>
            <p>
                The Business Platform may allow Authorized Users to create and
                share labels and addresses. Address-book entries are
                Customer-provided data. Intents Technology does not verify the
                identity, ownership, authority, sanctions status, network
                compatibility or accuracy of any address. A saved entry may be
                altered, stale, compromised or entered incorrectly. The Customer
                must independently verify each destination before approval.
            </p>
            <p>
                The Business Platform may display and allow exports of
                transaction, Proposal, balance and activity information derived
                from on-chain and off-chain sources, including
                transaction-history exports in CSV, Excel or JSON format and
                printable PDF payment receipts where made available. Displayed
                information, activity feeds, receipts and exports may be
                delayed, incomplete, duplicated, inaccurate or inconsistent with
                the authoritative blockchain state. They are convenience tools,
                not audited statements, tax records, legal confirmations or
                accounting advice. The Customer is responsible for independently
                reconciling and retaining its records.
            </p>
            <p>
                Any activity feed, alert or notification is provided as a
                convenience only. Intents Technology is not responsible for
                notifying the Customer of activity affecting a Business
                Workspace, Treasury Contract, wallet or digital assets, or for
                identifying or flagging malicious transactions, addresses,
                tokens or other security threats. The Customer must monitor its
                own activity and independently verify each item before approving
                or relying on it.
            </p>
            <h2>
                <strong>Reversals &amp; Cancellations</strong>
            </h2>
            <p>
                You cannot cancel, reverse, or change any transaction once it
                has been submitted to the relevant network.
            </p>
            <h2>
                <strong>
                    Incorrect Transfers, Unsupported Assets, and No Recovery
                    Obligation
                </strong>
            </h2>
            <p>
                You are solely responsible for verifying all transaction details
                before submitting, signing, authorizing, or funding any
                transaction, including wallet addresses, deposit addresses,
                refund addresses, recipient addresses, blockchain networks,
                token types, token standards, smart contracts, routing
                parameters, memo or tag information, destination metadata,
                deadlines, and compatibility with the Services. Transactions
                executed on blockchain networks are irreversible. Assets
                transferred to incorrect addresses, incompatible smart
                contracts, unsupported blockchain networks, unsupported token
                standards, expired deposit addresses, missing or incorrect memo
                or tag information, incorrect refund addresses, or otherwise
                submitted with incorrect transaction instructions may be
                permanently lost. Intents Technology has no obligation to
                recover, reimburse, compensate, or return any assets transferred
                in error or otherwise lost as a result of user mistake,
                unsupported assets, unsupported networks, or incorrect
                transaction instructions. In limited circumstances, Intents
                Technology or its Affiliates may, in their sole discretion,
                attempt to assist with asset recovery or operational remediation
                where technically feasible. Any such assistance is voluntary,
                best-efforts only, may be refused, may be subject to minimum
                value thresholds, verification, compliance review and/or
                freezing or blocking, and administrative or operational fees,
                and does not create any duty, continuing obligation, or
                expectation of recovery.
            </p>
            <p>
                Without limiting the foregoing, Intents Technology will not
                consider a recovery request that it reasonably determines arises
                from User error where the USD value of the affected assets, as
                reasonably determined by Intents Technology at the time of the
                relevant transfer, was less than USD 300. Requests at or above
                this threshold remain entirely discretionary. Where Intents
                Technology elects to provide recovery assistance, it generally
                aims to complete the recovery process within 14 days after
                approving the request and receiving all required information.
                This target is indicative only, is subject to technical, legal
                and commercial feasibility, and does not constitute a commitment
                that recovery will be successful or completed within that
                timeframe.
            </p>
            <h2>
                <strong>Failed Execution, Deadlines, and Refunds</strong>
            </h2>
            <p>
                You acknowledge, understand, and agree that a quote may require
                you to transfer assets to a deposit address, deposit account, or
                other transaction destination before execution begins. If a swap
                is not completed, if a deposit is below the required amount, if
                a deposit is received after the applicable deadline, if a
                deposit address becomes inactive, if required memo or metadata
                is missing or incorrect, or if execution otherwise fails, the
                Services may attempt to return eligible assets to the refund
                address or refund account specified by you, subject to
                applicable network conditions, bridge availability, smart
                contract operation, refund fees, minimum amounts, compliance
                review and freezing and/or blocking, and technical feasibility.
                Intents Technology does not guarantee that any refund will be
                available, complete, timely, economically rational, or
                successful. You are solely responsible for providing a correct
                refund address and refund type.
            </p>
            <h2>
                <strong>Bridging and Cross-Chain Deposits</strong>
            </h2>
            <p>
                Depositing assets to, or withdrawing assets from, certain
                blockchains through the Services may require assets to be
                processed by one or more cross-chain bridge components. A route
                may use (a) a bridge or bridge component operated by Intents
                Technology or an Affiliate, including the PoA Bridge where
                applicable, and/or (b) an independently operated third-party
                bridge, including OmniBridge where applicable. The interface may
                not identify every infrastructure component in a route. Intents
                Technology is responsible only for a component that it actually
                operates and does not control an independently operated bridge.
                During bridging, assets may be locked, held, minted, burned or
                otherwise processed by the applicable smart contracts,
                validators or infrastructure participants. Where a bridge or
                bridge component is operated by Intents Technology or an
                Affiliate, including the PoA Bridge, assets may be held or
                controlled within that infrastructure, including by its
                validators or authorities, until the transfer completes.
            </p>
            <p>
                Bridging involves additional risks, including (without
                limitation) processing delays, failed or partial transfers,
                smart contract failure, depegging of wrapped assets, and the
                permanent loss of assets sent to an incorrect deposit address,
                an unsupported network, or with missing or incorrect memo or
                metadata. Refunds, where available, are subject to the section
                titled “Failed Execution, Deadlines, and Refunds” above.
            </p>
            <h2>
                <strong>Derivatives and Leveraged Products</strong>
            </h2>
            <p>
                The Business Platform does not currently include derivative,
                margin or leveraged products. If Intents Technology introduces
                any such functionality, separate product terms, eligibility
                controls and risk disclosures will apply. A link or interface to
                an independently operated third-party product does not make that
                product part of the Services. Derivative and leveraged products
                may involve heightened risks, including leverage, liquidation,
                funding costs and loss of the entire position. Derivative and
                leveraged products are not available in all jurisdictions and
                may be restricted, prohibited, or unavailable to users located
                in, or accessing the Services from, certain locations. You are
                solely responsible for ensuring that your use of any such
                product is permitted under the laws applicable to you, and
                Intents Technology may restrict or block access to these
                products in any jurisdiction in its sole discretion.
            </p>
            <h2>
                <strong>Additional Products and Services</strong>
            </h2>
            <p>
                From time to time, Intents Technology may make available
                additional products, services, or features through the Services,
                which may include, without limitation: tokenised real-world
                assets, including commodity- or asset-referenced tokens; fiat
                on-ramp and off-ramp services; yield-bearing, staking, or “earn”
                products; lending or borrowing functionality; and peer-to-peer
                transfers. Intents Technology does not represent that any such
                product or service is, will be, or will remain available, and
                any such product or service may be added, modified, suspended,
                or withdrawn at any time. Where made available, a product or
                service may be offered by Intents Technology or by a Third Party
                Service, may not be available in all jurisdictions, and may be
                subject to additional terms, conditions, and disclosures
                presented to you at or before the time of use, which form part
                of this Agreement. Each such product or service carries risks in
                addition to those described elsewhere in this Agreement, which
                may include, depending on the product: the risk that a tokenised
                asset is not redeemable for, or does not maintain the value of,
                the asset it references, and risks relating to the issuer,
                custodian, or backing of that asset; risks relating to the
                conversion between digital assets and fiat currency, including
                reliance on third-party payment, banking, or money services
                providers; and the risk of partial or total loss of principal or
                anticipated yield in connection with yield-bearing, staking,
                lending, or borrowing products. You are solely responsible for
                determining whether any such product or service is suitable and
                lawful for you. Where any additional terms apply to a product or
                service, those additional terms control to the extent of any
                conflict with this Agreement, and may include their own fees,
                eligibility criteria, and disclosures; your continued use of the
                relevant product or service after such additional terms are
                presented constitutes your acceptance of them. Intents
                Technology may restrict, condition, suspend, or block access to
                any such product or service, in whole or in part, by
                jurisdiction or by eligibility, at any time and in its sole
                discretion. A reference in this Agreement to any yield-bearing,
                staking or earn product does not mean that the product is
                available through the Business Platform or the Confidential
                Intents Protocol; such functionality may be supported only if
                and when it is expressly made available.
            </p>
            <h2>
                <strong>Asset-Level Characteristics and Controls</strong>
            </h2>
            <p>
                Digital assets accessible through the Services are created and
                administered by third parties and may include characteristics or
                controls that affect whether they can be transferred or used,
                including administrative, minting, pausing, blocklisting,
                freezing or upgrade functions exercisable by the issuer or
                another party. The exercise of any such function may prevent a
                transfer, block an address or render an asset unusable, and
                Intents Technology cannot prevent, reverse or override it. Where
                an asset is a stablecoin or otherwise references another asset,
                it may lose its peg or reference value, and redemption, if
                available at all, is a matter for the issuer. Where an asset is
                wrapped, bridged or synthetic, it represents a claim on a
                bridge, custodian or issuer rather than on the underlying asset,
                and depends on that party's solvency and continued operation.
                Where staking or locking is involved, assets may be subject to
                lock-up periods, unbonding delays and reductions such as
                slashing. Intents Technology does not control, and is not liable
                for, any such characteristic, control or action taken by an
                issuer or other third party in respect of the Customer's assets.
                This is separate from any measure described under the section
                titled "Compliance with Legal Requests".
            </p>
            <h2>
                <strong>Off-Chain Data Collected/Retained</strong>
            </h2>
            <p>
                Users may interact with the Services through the Business
                Platform’s web interface and any replacement or additional
                interface that Intents Technology expressly makes available.
            </p>
            <p>
                The interface is operated by or on behalf of Intents Technology
                and may collect off-chain data in a manner comparable to a
                conventional website. Where applicable, service providers may
                process that data on our behalf as processors, and other parties
                may process it in the roles identified in the applicable Privacy
                Policy or notice.
            </p>
            <p>
                Off-chain logs and Business Workspace information are not
                publicly accessible merely because they are processed by the
                Business Platform. The categories of information the Business
                Platform collects or generates, the purposes for which it is
                used, the parties to whom it may be disclosed, and applicable
                retention periods, are set out in the Privacy Policy and, in
                respect of Customer Data processed on the Customer's behalf, the
                Data Processing Agreement. Intents Technology does not sell
                personal data.
            </p>
            <h2>
                <strong>Customer Data and Confidentiality </strong>
            </h2>
            <p>
                As between the parties, the Customer retains all right, title
                and interest in Customer Data. The Customer grants Intents
                Technology and its Affiliates a non-exclusive, worldwide licence
                to host, copy, transmit, process, display and otherwise use
                Customer Data only as reasonably necessary to provide, secure,
                maintain and support the Services, comply with law, enforce this
                Agreement and act on the Customer’s documented instructions.
            </p>
            <p>
                Intents Technology may use aggregated or de-identified
                information to operate, secure, analyse and improve the
                Services, provided that it does not reasonably identify the
                Customer, an Authorized User or another person. Intents
                Technology will not use identifiable Customer Data to train a
                general-purpose artificial-intelligence model unless the
                Customer has expressly agreed to that use in a separate, clear
                disclosure.
            </p>
            <p>
                Each party will protect the other party’s Confidential
                Information using at least reasonable care and will use it only
                to perform or exercise rights under this Agreement. A recipient
                may disclose Confidential Information to its Affiliates,
                personnel, service providers, subprocessors and professional
                advisers who need to know it and are bound by confidentiality
                obligations, and where disclosure is permitted or required by
                law, regulation, court order or a competent authority, or as
                otherwise expressly permitted under this Agreement, including
                under the section titled “Compliance with Legal Requests”. Where
                legally permitted and reasonably practicable, the recipient will
                give advance notice of a compelled disclosure.
            </p>
            <p>
                The Customer is responsible for ensuring that it has all rights,
                notices, consents and lawful bases required for Intents
                Technology to process Customer Data under this Agreement.
                Personal data is processed in accordance with the Privacy Policy
                and the Data Processing Agreement published at [URL], which
                forms part of this Agreement and governs the parties' roles,
                international transfers, subprocessors, security, retention and
                data-subject rights.
            </p>
            <p>
                Following termination, Intents Technology will delete or return
                Customer Data within a commercially reasonable period where
                technically practicable, except to the extent retention is
                required or permitted for legal, regulatory, sanctions,
                security, fraud-prevention, backup, audit or dispute-management
                purposes. Blockchain records and data held by independent
                protocols or third parties may be immutable or outside Intents
                Technology’s control.
            </p>
            <h2>
                <strong>Market Manipulation</strong>
            </h2>
            <p>
                Use of the Services to carry out market manipulation is strictly
                prohibited. You agree that you will not engage in market
                manipulation of any kind through the Services. Market
                manipulation includes any and all actions taken by any market
                participant or a person acting in concert with a participant
                which are intended to (1) deceive, mislead, defraud, or
                improperly take advantage of other users or Intents Technology
                including but not limited to engaging in pump and dumps, trading
                with inside information, falsely promoting a digital asset to
                artificially inflate the price or volume, spoofing (placing
                fraudulent orders with no intent to execute trades thereby
                manipulating order books), churning, quote stuffing, spreading
                market rumors, front running, wash trading, or activities that
                serve no economic purpose; (2) control or manipulate the price
                or trading volume of any digital asset including but not limited
                to engaging in any trading activity which is designed to
                intentionally artificially increase the volume or price of any
                digital asset or any other activity that interferes with the
                fair operation of the markets; (3) engage in trading on the
                Platform while in possession of material non-public information
                concerning the subject digital asset; (4) aid, abet, enable,
                counsel, procure, finance, support, or endorse any of the above.
            </p>
            <h2>
                <strong>Fees</strong>
            </h2>
            <p>
                You agree to pay all fees associated with your use of the
                Services. Such fees are charged for access to and use of the
                interface and are independent of any underlying transaction
                execution performed by third-party protocols or services. Fees
                presented to you when using the Services may include, e.g., fees
                for using the Business Platform, fees for using 1CS, fees for
                using NEAR Intents, fees for accessing the NEAR protocol, fees
                for confidential transaction processing, fees charged by Third
                Party Services, deposit, withdrawal, and bridge fees, gas or
                contract execution fees, and slippage, and any other fee in
                relation to which notice of such fee is provided to you. The
                applicable interface displays the estimated resulting value, net
                of fees, applicable to potential transactions prior to
                execution. Your use of the Services may also incur fees for
                accessing Third Party Services for which you are solely
                responsible. Intents Technology makes no representation that the
                prices of digital assets transacted through the Services are the
                best prices. Intents Technology does not act as an intermediary
                in connection with any fees charged by Third-Party Service
                providers, which are charged to you directly by such Third Party
                Service providers. The fees applicable to your use of the
                Services, including the current fee types and amounts, are set
                out in our fee documentation available at
                https://docs.near-intents.org/resources/fees (the "Fee
                Schedule"). Those parts of the Fee Schedule that apply to the
                Business Platform form part of this Agreement and are expressly
                incorporated herein by reference; parts of that documentation
                that apply to other channels, integrations or products do not
                form part of this Agreement. The Fee Schedule may be updated
                from time to time, and the fees applicable to any transaction
                are those made available to you at or before the time you
                authorize that transaction.
            </p>
            <p>
                <strong>Quote Improvement and Capture Share.</strong> Where the
                price at which your transaction is filled is more favorable to
                you than the Indicative Quote, the difference is referred to in
                this Agreement as <strong>“Quote Improvement.”</strong> The
                portion of Quote Improvement disclosed in the applicable fee
                documentation, transaction interface, or other disclosure made
                available by Intents Technology before or at the time of the
                transaction may be retained by or allocated to Intents
                Technology, the operator of the relevant Service, the relevant
                Solver, the relevant Quoting Layer, or any combination of the
                foregoing (the <strong>“Capture Share”</strong>). Unless
                otherwise disclosed by Intents Technology before or at the time
                of the transaction, the Capture Share applicable to transactions
                executed through 1CS and the Platform is set out in, and
                governed by, the Fee Schedule (currently fifty percent (50%) of
                the Quote Improvement). The Capture Share may be retained by or
                allocated to Intents Technology and applied by Intents
                Technology for its own account or for programs it supports,
                including, without limitation, operational costs, treasury,
                ecosystem development, or other token-related programs (which
                may, from time to time, include token buyback, burn,
                distribution, or similar programs and may or may not be
                implemented at any given time), which may create economic
                interests for Intents Technology, its Affiliates, or ecosystem
                participants that differ from your interest in receiving the
                full amount of any favorable execution variance. The Capture
                Share, the events to which it applies, the eligibility window
                during which it applies, and the distribution of any Quote
                Improvement may be modified prospectively and are described in
                the Fee Schedule or transaction disclosures made available by
                Intents Technology from time to time; the terms applicable to a
                transaction are the terms made available at or before the time
                you authorize that transaction. You acknowledge, understand, and
                agree that Quote Improvement is not an entitlement on your part
                to receive the full amount of favorable execution variance above
                the Indicative Quote, that the Capture Share is a fee, spread,
                rebate, revenue share, or other economic amount retained by or
                allocated to Intents Technology or other participants for
                operating, maintaining, supplying, routing, settlement, or
                execution services, and that, to the maximum extent permitted by
                applicable law, you release and waive any claim arising from or
                relating to the retention or allocation of any Capture Share
                disclosed or made available to you.
            </p>
            <p>
                <strong>Asymmetric Treatment of Execution Variance.</strong> You
                acknowledge, understand, and agree that the combined operation
                of your Slippage Tolerance and the Capture Share may produce an
                asymmetric economic outcome relative to the Indicative Quote. If
                the price at which your transaction is filled is less favorable
                to you than the Indicative Quote but remains within your
                Slippage Tolerance, you bear the unfavorable variance. If the
                price at which your transaction is filled is more favorable to
                you than the Indicative Quote, all or a portion of the favorable
                variance may be retained or allocated as the Capture Share, with
                the remainder, if any, paid to you. This allocation of
                unfavorable and favorable variance is part of the fee and
                execution terms of the Services and is acknowledged and accepted
                by you when you use the Services. Intents Technology makes no
                representation that any individual transaction will be executed
                at the Indicative Quote, at the best available price, or at a
                price that produces a symmetric distribution of execution
                outcomes relative to the Indicative Quote.
            </p>
            <p>
                Intents Technology may sponsor or subsidise certain blockchain
                network, contract execution or similar fees from time to time.
                Any sponsorship is discretionary, may be subject to transaction,
                Customer, time-period or other limits, and may be changed,
                suspended or withdrawn without notice. Unless the applicable
                interface expressly indicates that a fee will be sponsored for a
                particular transaction, you remain responsible for that fee.
            </p>
            <h2>
                <strong>Referral and Other Programmes</strong>
            </h2>
            <p>
                Intents Technology may make referral, partner, rebate,
                incentive, early-access or other programmes available from time
                to time. Participation is optional, may be restricted by
                jurisdiction or eligibility, and is governed by separate
                programme terms. Nothing in this Agreement creates a right to a
                commission, rebate, tier, bonus, benefit or continued programme.
                A participant must not make unauthorised, misleading or unlawful
                statements about Intents Technology, the Services, digital
                assets or any financial product.
            </p>
            <h2>
                <strong>Protocol Governance</strong>
            </h2>
            <p>
                You acknowledge, understand, and agree that the Protocol may be
                subject to administrative roles, governance procedures, and
                upgrade mechanisms defined in the smart contract code, which
                may, among other things, modify fees and fee parameters, pause
                or upgrade the contract, or grant or modify administrative
                roles. These powers are governed by the underlying protocol and
                are not owned or controlled by Intents Technology. Any such
                action on the Protocol may take effect upon on-chain commit
                without prior individual notice to you or to Intents Technology.
                Intents Technology is not responsible for losses, fee changes,
                or asset movements resulting from such actions.
            </p>
            <h2>
                <strong>Taxes</strong>
            </h2>
            <p>
                You alone are responsible for determining what taxes apply to
                your use of the Services. You agree that Intents Technology has
                no responsibility or liability for determining what taxes apply
                or for collecting, reporting, withholding, or remitting any
                taxes arising from any trades or transactions made using the
                Services, except as provided by law.
            </p>
            <h2>
                <strong>Intellectual Property</strong>
            </h2>
            <p>
                The Services, including the Business Platform available at
                business.near.com, and its entire contents, features, and
                functionality (including but not limited to all information,
                software, text, displays, images, video, and audio, and the
                design, selection, and arrangement thereof) (the{" "}
                <strong>"Materials"</strong>) are owned by Intents Technology,
                its licensors, or other providers of such Materials and are
                protected by United States and international copyright,
                trademark, patent, trade secret, and other intellectual property
                or proprietary rights laws. Intents Technology grants you a
                limited, worldwide, royalty-free, non-transferable,
                non-assignable, non-sublicensable, revocable licence to use the
                Materials. Intents Technology may, in its sole discretion, also
                make software or components of the Services available to you in
                accordance with the terms of an open-source software licence.
                The Materials are and shall remain the property of Intents
                Technology, its licensors or the applicable provider. You have
                no rights with respect to the Materials other than those
                expressly set forth in this Agreement or any other agreement to
                which you are a direct party, if applicable. Nothing in this
                Agreement or displayed on or contained in the Services or
                elsewhere should be construed as granting, expressly, by
                implication, estoppel or otherwise, any licence or right to use
                any copyrighted materials, patents, trade secrets, trademarks,
                service marks or other proprietary rights of Intents Technology,
                except as described above. You must not reproduce, distribute,
                modify, create derivative works of, publicly display, publicly
                perform, republish, download, store, or transmit any of the
                material provided to you under the Services without Intents
                Technology’s express prior authorisation. You must not modify
                copies of any materials from the Services or delete or alter any
                copyright or other proprietary rights notices from copies of
                materials on the Business Platform. Intents Technology may
                terminate your access to the Services in its sole discretion or
                if you violate any provision in this Agreement.
            </p>
            <h2>
                <strong>AI Features</strong>
            </h2>
            <p>The Business Platform may in future</p>
            <p>
                {" "}
                make optional artificial-intelligence features available for
                authorised internal business use ("AI Features"). AI Features
                and their outputs are informational tools only. Unless a
                separate feature is expressly described as having transaction
                capability and the Customer separately and expressly authorises
                that capability in accordance with its Governance Rules, an AI
                Feature cannot initiate, approve, authorise or execute a
                transaction or change a Business Workspace or Treasury Contract.
            </p>
            <p>
                AI output may be inaccurate, incomplete, outdated, misleading or
                fabricated and is not financial, investment, trading, legal,
                tax, accounting or other professional advice. The Customer and
                its Authorized Users must independently verify AI output before
                using or relying on it and remain responsible for every decision
                and action taken in reliance on it. AI inputs and outputs are
                Customer Data and are handled under the Customer Data and
                Confidentiality section, the Privacy Policy and any applicable
                data-processing agreement; they are not User Contributions
                merely because they are processed by an AI Feature. Additional
                AI terms presented for a particular feature apply to that
                feature.
            </p>
            <h2>
                <strong>User Contributions</strong>
            </h2>
            <p>
                The Services may offer public or community-facing message
                boards, forums or similar interactive features (collectively,
                "Interactive Services") through which Users intentionally post
                content for access by other users or the public ("User
                Contributions"). User Contributions do not include Customer
                Data, Business Workspace Information, private support
                communications or AI inputs and outputs.
            </p>
            <p>
                User Contributions must comply with the Content Standards. A
                User Contribution intentionally posted to a public or
                community-facing Interactive Service will be treated as
                non-confidential. You retain ownership of it and grant Intents
                Technology, its Affiliates and service providers a worldwide,
                non-exclusive, royalty-free licence to host, reproduce, format,
                display and distribute it only as reasonably necessary to
                operate, provide, secure and improve the relevant Interactive
                Service and as otherwise directed or authorised by you. This
                licence ends when the User Contribution is deleted from the
                Service, except to the extent it has been shared with others who
                have not deleted it or retention is required for legal,
                security, backup or dispute-management purposes.
            </p>
            <p>
                You represent and warrant that you own or control the rights
                necessary to submit each User Contribution and grant the licence
                above, and that each User Contribution complies with this
                Agreement. You are responsible for the legality, reliability,
                accuracy and appropriateness of your User Contributions. Intents
                Technology is not responsible for User Contributions posted by
                you or another User, except to the extent responsibility cannot
                lawfully be excluded.
            </p>
            <h2>
                <strong>Business User Competence</strong>
            </h2>
            <p>
                The Services are intended for business users with sufficient
                knowledge and experience to understand digital-asset treasury
                operations and the associated risks.
            </p>
            <p>
                Users may include treasury, finance, accounting, operations,
                legal and other personnel and need not be investment
                professionals. No person should rely on communications from
                Intents Technology or its Affiliates as financial, investment,
                legal, tax or accounting advice or as the sole basis for buying,
                selling, holding or transferring a digital asset. Each Customer
                is responsible for ensuring that its Authorized Users have
                appropriate competence and authority and for obtaining
                professional advice where appropriate.
            </p>
            <h2>
                <strong>Disclaimer</strong>
            </h2>
            <p>
                <strong>
                    YOUR USE OF THE SERVICES IS AT YOUR OWN RISK. THE SERVICES
                    AND CONTENT ARE PROVIDED ON AN "AS IS" AND "AS AVAILABLE"
                    BASIS, WITHOUT ANY WARRANTIES OF ANY KIND, EITHER EXPRESS OR
                    IMPLIED. TO THE FULLEST EXTENT PERMITTED UNDER APPLICABLE
                    LAW, NEITHER INTENTS TECHNOLOGY, ITS AFFILIATES, SERVICE
                    PROVIDERS, AND THEIR AND OUR RESPECTIVE OFFICERS, DIRECTORS,
                    AGENTS, JOINT VENTURERS, EMPLOYEES, AND REPRESENTATIVES
                    ("INTENTS TECHNOLOGY SERVICE PROVIDERS") NOR ANYONE
                    ASSOCIATED WITH INTENTS TECHNOLOGY MAKES ANY WARRANTY OR
                    REPRESENTATION WITH RESPECT TO THE COMPLETENESS, SECURITY,
                    RELIABILITY, QUALITY, ACCURACY, OR AVAILABILITY OF THE
                    SERVICES. WITHOUT LIMITING THE FOREGOING, NEITHER INTENTS
                    TECHNOLOGY, INTENTS TECHNOLOGY SERVICE PROVIDERS NOR ANYONE
                    ASSOCIATED WITH INTENTS TECHNOLOGY REPRESENTS OR WARRANTS
                    THAT THE SERVICES OR THE CONTENT WILL BE ACCURATE, RELIABLE,
                    ERROR-FREE, OR UNINTERRUPTED, THAT DEFECTS WILL BE
                    CORRECTED, THAT OUR SERVICES OR THE SERVER THAT MAKES IT
                    AVAILABLE ARE FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS,
                    OR THAT THE SERVICES WILL OTHERWISE MEET YOUR NEEDS OR
                    EXPECTATIONS. TO THE FULLEST EXTENT PROVIDED BY LAW, INTENTS
                    TECHNOLOGY HEREBY DISCLAIMS ALL WARRANTIES OF ANY KIND,
                    WHETHER EXPRESS OR IMPLIED, STATUTORY, OR OTHERWISE,
                    INCLUDING ANY WARRANTIES OF MERCHANTABILITY,
                    NON-INFRINGEMENT, AND FITNESS FOR PARTICULAR PURPOSE.
                </strong>
            </p>
            <p>
                You agree to use the Services and the Content only at your own
                risk. Neither Intents Technology nor the Intents Technology
                Service Providers explicitly or implicitly endorse or approve
                any content provided by third parties (
                <strong>"Third Party Content"</strong>). Third Party Content is
                provided for informational purposes only. The Content is not
                intended to provide financial, legal, tax or investment advice
                or recommendations. You are solely responsible for determining
                whether any self-directed investment, investment strategy or
                related transaction is appropriate for you based on your
                personal investment objectives, financial circumstances and risk
                tolerance. No information provided by Intents Technology,
                including information about digital assets, product markets,
                securities, commodities, whether provided on social media
                platforms or through other mediums, should be construed as
                intending to provide investment, tax, and or legal advice or
                create any relationship that includes the provision of such
                advice.
            </p>
            <h2>
                <strong>LIMITATION OF LIABILITY</strong>
            </h2>
            <p>
                <strong>
                    TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, YOU
                    UNDERSTAND AND AGREE THAT IN NO EVENT WILL INTENTS
                    TECHNOLOGY, ITS AFFILIATES, OR INTENTS TECHNOLOGY SERVICE
                    PROVIDERS (COLLECTIVELY, "INTENTS TECHNOLOGY PARTIES") BE
                    LIABLE FOR ANY INDIRECT, SPECIAL, INCIDENTAL, CONSEQUENTIAL,
                    OR PUNITIVE DAMAGES, ANY PERSONAL INJURY, PAIN AND
                    SUFFERING, EMOTIONAL DISTRESS, LOSS OF REVENUE, LOSS OF
                    PROFITS, LOSS OF BUSINESS OR ANTICIPATED SAVINGS, LOSS OF
                    USE, LOSS OF GOODWILL, OR LOSS OF DATA, IN EACH CASE HOWEVER
                    ARISING THAT RESULT FROM (A) YOUR ACCESS TO OR USE OF, OR
                    INABILITY TO ACCESS OR USE THE SERVICES, (B) ANY CONDUCT,
                    PERFORMANCE, OR CONTENT OF ANY THIRD PARTY, INCLUDING BUT
                    NOT LIMITED TO STRATEGISTS, INFRASTRUCTURE PROVIDERS, OR
                    OTHER USERS (C) ANY SMART CONTRACT BUGS, HACKS, EXPLOITS, OR
                    OTHER SECURITY FAILURES (D) ANY VOLATILITY OR LOSS IN VALUE
                    OF YOUR DIGITAL ASSETS (E) UNAUTHORIZED ACCESS, USE, OR
                    ALTERATION OF YOUR TRANSACTIONS OR DATA; OR (F) ANY OTHER
                    MATTER RELATING TO THE SERVICES.
                </strong>
            </p>
            <p>
                <strong>
                    THIS LIMITATION OF LIABILITY APPLIES REGARDLESS OF THE LEGAL
                    THEORY ON WHICH THE CLAIM IS BASED, WHETHER CONTRACT, TORT
                    (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR OTHERWISE.
                </strong>
            </p>
            <p>
                <strong>
                    IN NO EVENT SHALL THE AGGREGATE LIABILITY OF INTENTS
                    TECHNOLOGY, ITS AFFILIATES, INTENTS TECHNOLOGY SERVICE
                    PROVIDERS ARISING OUT OF OR RELATING TO THIS AGREEMENT OR
                    THE SERVICES EXCEED THE GREATER OF (A) ONE HUNDRED U.S.
                    DOLLARS (USD $100) OR (B) THE TOTAL AMOUNT OF FEES YOU
                    ACTUALLY PAID TO US UNDER THIS AGREEMENT IN THE SIX (6)
                    MONTH PERIOD PRECEDING THE DATE THE CLAIM AROSE.
                </strong>
            </p>
            <p>
                <strong>
                    SOME JURISDICTIONS DO NOT ALLOW CERTAIN WARRANTY DISCLAIMERS
                    OR LIMITATIONS ON LIABILITY. ONLY DISCLAIMERS OR LIMITATIONS
                    THAT ARE LAWFUL IN THE APPLICABLE JURISDICTION WILL APPLY TO
                    YOU AND OUR LIABILITY WILL BE LIMITED TO THE MAXIMUM EXTENT
                    PERMITTED BY LAW.
                </strong>
            </p>
            <h2>
                <strong>No Offer of Securities</strong>
            </h2>
            <p>
                <strong>
                    THE WEBSITE, THE SERVICES, THE CONTENT, AND THE INFORMATION
                    INCLUDED THEREIN ARE FOR GENERAL INFORMATION PURPOSES ONLY.
                    UNDER NO CIRCUMSTANCES SHOULD ANY MATERIAL ON THE PLATFORM
                    BE USED OR CONSIDERED AS AN OFFER TO SELL OR A SOLICITATION
                    OF AN OFFER TO BUY ANY DIGITAL ASSET, SECURITY, FUTURE OR
                    OTHER FINANCIAL PRODUCT OR INSTRUMENT SPONSORED OR MANAGED
                    BY INTENTS TECHNOLOGY. THE PLATFORM, THE SERVICES, AND THE
                    CONTENT ARE DIRECTED AT AND MADE AVAILABLE SOLELY TO PERSONS
                    IN JURISDICTIONS IN WHICH THE PURCHASE AND SALE OF DIGITAL
                    ASSETS AND RELATED PRODUCTS IS LEGALLY PERMISSIBLE.
                </strong>
            </p>
            <h2>
                <strong>Sanctions and Restricted Jurisdictions</strong>
            </h2>
            <p>
                The Services are not offered or made available to any Restricted
                Person, any person acting on behalf of a Restricted Person, or
                any person located, incorporated, or resident in a Restricted
                Jurisdiction. Intents Technology may also restrict all or part
                of the Services in any jurisdiction where it reasonably
                determines that providing or using them would be unlawful, would
                expose Intents Technology, its Affiliates or its third party
                service providers to sanctions, legal liability or material
                regulatory risk, or the activity would be inconsistent with the
                Company’s risk appetite. The current operational list of
                restricted jurisdictions and prohibited activities may be
                published in a separate access or compliance policy and is
                subject to change at any time without prior notice as legal
                requirements, sanctions lists, and risk assessments change.
            </p>
            <p>
                The Services and Content shall not be considered a solicitation
                to any Restricted Person, any person located in a Restricted
                Jurisdiction, or any person in a jurisdiction where such
                solicitation or provision of services is illegal or unlawful.
                Moreover, relevant legal restrictions or considerations may
                apply in your individual circumstances (including those based
                upon the risks of investing in digital assets), therefore, you
                are solely responsible for consulting with your own legal,
                accounting, and other professional advisors prior to engaging in
                any transactions or services described herein.
            </p>
            <p>
                The Services may not be available in all markets and
                jurisdictions, and Intents Technology may restrict or prohibit
                use of all or part of the Services from any country, region or
                territory, and may restrict particular assets, features or
                products by jurisdiction or by eligibility. Intents Technology
                may implement IP blocking, geo-blocking or other technical
                measures for that purpose and may terminate access at any time
                in its sole discretion. Intents Technology is not liable for any
                loss relating to the Customer's ability or inability to access
                or use the Services. You must not use a virtual private network,
                proxy server, Tor network or any other means to circumvent those
                restrictions. Each Customer represents and warrants on an
                ongoing basis that neither it, its Authorized Users nor, to its
                knowledge after reasonable inquiry, its beneficial owners or
                controlling persons is a Restricted Person or is located,
                organised or ordinarily resident in a Restricted Jurisdiction,
                must notify Intents Technology promptly if that ceases to be
                accurate, and must provide information reasonably requested for
                sanctions, anti-money-laundering or other compliance purposes.
                Intents Technology is not required to process or facilitate any
                action that it reasonably believes may breach applicable law or
                sanctions. The Customer will indemnify and hold Intents
                Technology harmless against all actions, claims, costs and
                losses arising from or in connection with its access to the
                Services in breach of this section.
            </p>
            <p>
                The Services, and any software or technology made available
                through them, may be subject to export control, re-export and
                import restrictions. The Customer must not export, re-export,
                transfer or make the Services available in breach of those
                restrictions, or to any person or destination they prohibit.
            </p>
            <p>
                Intents Technology is not conducting any activity pursuant to
                the Securities Exchange Act or the Commodity Exchange Act (each
                as amended from time to time), and therefore Intents Technology
                is not registered in any capacity with the Securities and
                Exchange Commission, the Commodity Futures Trading Commission,
                nor their relevant self-regulatory organizations.
            </p>
            <h2>
                <strong>Content Posted Relating to the Services</strong>
            </h2>
            <p>
                The Services may include or make available certain content (the{" "}
                <strong>"Content"</strong>). Content includes, without
                limitation:
            </p>
            <ul>
                <li>transactions, confirmations, and transaction history</li>
                <li>
                    general news and information, commentary, research reports,
                    educational material and information and data concerning the
                    financial markets, securities and other subjects;
                </li>
                <li>
                    market data such as quotations for digital asset
                    transactions and/or last sale information for completed
                    digital asset transactions;
                </li>
            </ul>
            <p>
                financial and investment interactive tools, such as alerts or
                calculators;
            </p>
            <p>
                tax preparation, bill payment and other account management
                tools;
            </p>
            <ul>
                <li>
                    company names, logos, product and service names, trade
                    names, trademarks and services marks (collectively,{" "}
                    <strong>"Marks"</strong>) owned by, or licensed to, Intents
                    Technology and Intents Technology Service Providers;
                </li>
                <li>
                    any other information, content, services, or software
                    available on the Services; and
                </li>
                <li>
                    information, content, service or software made available by
                    or through social media websites, blogs, wikis, online
                    conferences, telecasts, podcasts, and other forums.
                </li>
            </ul>
            <p>
                You acknowledge and agree that the Content may not always be
                entirely accurate, complete or current and may also include
                technical inaccuracies or typographical errors, and Intents
                Technology does not guarantee the accuracy, timeliness,
                completeness, or usefulness of such Content. In an effort to
                continue to provide you with as complete and accurate
                information as possible, information may be changed or updated
                from time to time without notice, including without limitation
                information regarding our policies, products and services.
                Accordingly, you should verify all information you obtain from
                the Content, and all decisions based on information contained in
                the Content are your sole responsibility and we shall have no
                liability for such decisions. Information provided by Intents
                Technology or Intents Technology Service Providers, including
                historical price and supply data for digital assets, is for
                informational purposes only and Intents Technology makes no
                representations or warranties to its accuracy. Links to
                third-party materials (including without limitation websites)
                may be provided as a convenience but are not controlled by us.
                You acknowledge and agree that we are not responsible for any
                aspect of the information, content, or services contained in any
                third-party materials or on any third-party sites accessible or
                linked to the Content.
            </p>
            <p>
                Content posted on the Services is published as of its stated
                date or, if no date is stated, the date of first posting.
                Neither Intents Technology nor the Intents Technology Service
                Providers have undertaken any duty to update any such
                information. Intents Technology does not prepare, edit, or
                endorse Third Party Content.
            </p>
            <p>
                You understand and agree that Intents Technology and/or any
                Intents Technology Service Provider will not be liable in any
                way for (1) any inaccuracy of, error or delay in, or omission of
                the Content; or (2) any loss or damage arising from or
                occasioned by (i) any error or delay in the transmission of such
                Content; (ii) interruption in any such Content due either to any
                negligent act or omission by any party to any Force Majeure
                Events, (iii) to any other cause beyond the reasonable control
                of Intents Technology and/or Intents Technology Service
                Provider, or (iv) non-performance.
            </p>
            <p>
                Neither Intents Technology nor the Intents Technology Service
                Providers make any representations, warranties or other
                guarantees as to the accuracy or timeliness of any price quotes.
                Neither Intents Technology nor the Intents Technology Service
                Providers make any representations, warranties or other
                guarantees as to the present or future value or suitability of
                any sale, trade or other transaction involving any particular
                security or any other investment.
            </p>
            <p>
                Content is provided exclusively for your authorised internal
                business or personal access and use. No part of the Services or
                Content may be copied, reproduced, republished, uploaded,
                posted, publicly displayed, encoded, translated, transmitted or
                distributed in any way (including "mirroring") to any other
                computer, server, web site or other medium for publication,
                external distribution, sale or other exploitation without
                Intents Technology’s express prior written consent. You
                acknowledge that Intents Technology is the sole owner of Intents
                Technology’s Marks and that other Marks are the property of
                their respective owners. You agree that you will not use any
                Marks for any purpose without the prior express written consent
                of the respective owners.
            </p>
            <h2>
                <strong>
                    Suspension; Termination; Modification; and Assignment
                </strong>
            </h2>
            <p>
                Intents Technology may suspend, restrict or terminate access to
                all or part of the Services immediately where it reasonably
                considers this necessary to address an actual or suspected
                security incident, fraud, abuse, sanctions or other legal or
                regulatory risk, prohibited activity, material breach, threat to
                the Services or third parties, or operational emergency. Where
                practicable and legally permitted, we will notify the Customer
                and provide information about available remediation. We may
                discontinue a Service or terminate this Agreement for business
                or operational reasons on reasonable advance notice where
                practicable. The Customer may terminate this Agreement at any
                time by ceasing use and following any available
                workspace-closure process, but remains responsible for
                outstanding fees and obligations.
            </p>
            <p>Intents Technology does not </p>
            <p>
                guarantee that the Business Platform, Services or Content will
                always be available or uninterrupted. We may suspend, withdraw
                or restrict all or part of them for business, security, legal or
                operational reasons in accordance with this section. The
                Customer is responsible for ensuring that its Authorized Users
                are aware of and comply with this Agreement and any other
                applicable terms.
            </p>
            <p>
                Suspension or termination of access to the Business Platform
                does not terminate a Treasury Contract or give Intents
                Technology authority to move digital assets governed by it. It
                may, however, prevent or delay use of the interface, 1CS,
                confidential execution, stored quote data, MPC-related workflows
                or backend services. The Customer may need alternative
                compatible tools or technical assistance to interact with
                relevant smart contracts or recover or transfer assets, and
                independent access is not guaranteed.
            </p>
            <p>
                Intents Technology may assign or transfer this Agreement, in
                whole or in part, including as part of a reorganisation,
                financing, merger, acquisition or sale of business or assets,
                subject to applicable law and the confidentiality and
                data-protection obligations in this Agreement. We will give
                notice where reasonably practicable. You may not assign or
                transfer this Agreement or your rights to access or use the
                Services or Content without our prior written consent. Subject
                to the foregoing, this Agreement binds and benefits the parties
                and their successors and permitted assigns.
            </p>
            <h2>
                <strong>Relationship between the Parties</strong>
            </h2>
            <p>
                Nothing in this Agreement is intended to or shall operate to
                create a partnership or joint venture between you and Intents
                Technology, or authorize you to act as agent of Intents
                Technology. Intents Technology does not act as an agent, broker,
                advisor, fiduciary, or in any similar capacity on behalf of any
                user. No fiduciary or advisory relationship is created by your
                use of the Services.
            </p>
            <p>
                Providing the Business Platform, Treasury Contract
                configuration, MPC signing flow or related backend services does
                not give Intents Technology control of the Treasury Contract or
                discretion over the Customer's transactions. Intents Technology
                does not decide whether, when, to whom or on what terms the
                Customer should transact.
            </p>
            <h2>
                <strong>Compliance with Legal Requests</strong>
            </h2>
            <p>
                Intents Technology may comply with a restraining order,
                subpoena, warrant or other legal order or process that it
                believes in good faith to be valid. Where legally permitted and
                reasonably practicable, we will notify the affected Customer
                before disclosing its non-public information in response to
                legal process. This does not apply, and no notice will be given,
                where the disclosure relates to actual or suspected fraud,
                illicit activity, a security incident or an investigation, where
                notice would or might prejudice that matter or the security of
                the Services, or where notice is prohibited or restricted by
                law. We may honour valid legal process regardless of the method
                or place of service.
            </p>
            <p>
                Transactions, assets and wallet addresses in connection with the
                Services are subject to transaction screening, sanctions and
                other compliance, legal and security controls, whether applied
                by Intents Technology, its service providers or the operators of
                any underlying network, protocol, bridge or other
                infrastructure. As a result, a transaction may be delayed,
                blocked or rejected, and assets to which it relates may be
                restricted or unavailable for a period or indefinitely, where
                this is required or considered appropriate for legal,
                regulatory, compliance, sanctions or security reasons. The
                Customer acknowledges that Intents Technology may be prohibited
                by applicable law, or otherwise unable, from disclosing the
                existence of, the reasons for, or any details of any such
                measure, and has no obligation to do so. Nothing in this
                paragraph obliges Intents Technology to apply any control, to
                screen, review or monitor any transaction, or to detect any
                activity. To the maximum extent permitted by applicable law,
                Intents Technology is not liable for any measure taken, or not
                taken, under this paragraph.
            </p>
            <p>
                The Business Platform uses the Confidential Intents Protocol to
                reduce the public visibility of certain balance and transaction
                information. Intents Technology does not represent or warrant
                that the Confidential Intents Protocol will make use of the
                Services anonymous, untraceable, private against all parties or
                immune from disclosure, or provide any particular level of
                privacy, anonymity, confidentiality, unlinkability or
                non-disclosure. Confidentiality is designed to limit the
                visibility of transaction information to other network
                participants and the public. It does not limit Intents
                Technology's own access to that information. Information
                relating to a transaction may remain visible to, or be
                obtainable by, Intents Technology, its Affiliates, service
                providers, infrastructure providers, counterparties, regulators,
                law enforcement or other third parties, including through
                operational data, on-chain or off-chain activity, analytics or
                information obtained from other sources. Intents Technology may
                access, use and disclose information relating to a transaction,
                including a transaction processed through the Confidential
                Intents Protocol, where it considers this necessary or
                appropriate for legal, regulatory, compliance, sanctions,
                security or investigative purposes, including to its Affiliates
                and professional advisers, to service providers engaged for
                compliance, security or incident-response purposes, to law
                enforcement, regulators and other competent authorities, and, in
                limited circumstances and at its discretion, to other persons
                affected by the relevant matter. Intents Technology may be
                unable, or prohibited by applicable law, from notifying the
                Customer of any such access, use or disclosure. Personal data is
                handled as described in the Privacy Policy and the Data
                Processing Agreement.
            </p>
            <p>
                For a Business Workspace, member wallet addresses, governance
                roles, Proposals and votes remain on the public NEAR blockchain
                even though balances and transaction details are processed
                through the Confidential Intents Protocol. Confidential balance
                and transaction information may be available to Authorized Users
                and may be processed by the Business Platform, its backend and
                the infrastructure described in the Privacy Policy or applicable
                notice. The Customer is responsible for restricting membership
                and access and for any disclosure by an Authorized User.
            </p>
            <h2>
                <strong>Indemnification</strong>
            </h2>
            <p>
                The Customer will indemnify, defend and hold harmless Intents
                Technology, its Affiliates and their respective officers,
                directors and employees from third-party claims, and resulting
                losses, damages, liabilities, costs and reasonable legal fees,
                to the extent caused by: (a) the Customer’s or an Authorized
                User’s material breach of this Agreement; (b) unlawful use of
                the Services by the Customer or an Authorized User; (c) the
                Customer’s lack of authority to hold, manage or transfer
                relevant digital assets or to act for another person; or (d) an
                allegation that Customer Data or a User Contribution supplied by
                the Customer infringes another person’s intellectual-property,
                privacy or other proprietary right. This indemnity does not
                apply to the extent a claim is caused by the indemnified party’s
                breach of this Agreement, gross negligence, wilful misconduct or
                violation of law.
            </p>
            <p>
                The indemnified party must give prompt notice of a claim, except
                that delay relieves the Customer only to the extent materially
                prejudicial; provide reasonable cooperation at the Customer’s
                expense; and allow the Customer to control the defence and
                settlement. The Customer may not settle a claim in a manner that
                admits fault by, imposes non-monetary obligations on or fails to
                provide a complete release to an indemnified party without that
                party’s prior written consent, not to be unreasonably withheld
                or delayed. The indemnified party may participate through its
                own counsel at its own expense.
            </p>
            <h2>
                <strong>Force Majeure</strong>
            </h2>
            <p>
                In no event shall Intents Technology be liable for any delays,
                failure in performance or interruption of the Services which
                results directly or indirectly from any cause or condition,
                whether or not foreseeable, beyond Intents Technology’s or the
                Intents Technology Service Providers' reasonable control,
                including, but not limited to, flood, tropical depression,
                extraordinary weather conditions, earthquake or other act of
                God, nuclear or natural disaster, epidemic, action or inaction
                of civil or military authorities, act of war, terrorism,
                sabotage, civil disturbance, strike or other labor dispute,
                accident, state or emergency or interruption, loss or
                malfunction of equipment or utility, communications, computer
                (hardware or software), internet or network provider Services (
                <strong>"Force Majeure Events"</strong>).
            </p>
            <h2>
                <strong>Consent to Electronic Communications</strong>
            </h2>
            <p>
                Intents Technology may provide you with certain communications,
                such as service announcements and administrative messages, to
                the contact information you have supplied Intents Technology
                with for this purpose, if any.
            </p>
            <p>
                By using the Services or the Content, you consent to any form of
                recording, recordkeeping, and retention of any communication,
                information and data exchanged between you and Intents
                Technology or its representatives or agents.
            </p>
            <p>
                Intents Technology may provide certain multi-party communication
                or communication processing services, including, but not limited
                to call lines, chat services, social forums, chat-rooms, and
                other communication channels (the <strong>"Forums"</strong>).
                All communications made at or through the Forums are public and
                the Forums may include information, materials, links and other
                information provided by third parties unrelated to Intents
                Technology or the Intents Technology Service Providers. Reliance
                on any Content available on or through the Forums is at your own
                risk. Without limitation, you agree not to do any of the
                following in relation to any Forum (the{" "}
                <strong>“Content Standards”</strong>):
            </p>
            <ul>
                <li>
                    upload, post, transmit or otherwise make available any
                    Content that is unlawful, harmful, threatening, abusive,
                    harassing, tortious, defamatory, vulgar, obscene, libelous,
                    invasive of another's privacy (including, but not limited
                    to, any address, email, phone number, or any other contact
                    information without the written consent of the owner of such
                    information), hateful, or racially, ethnically or otherwise
                    objectionable;
                </li>
            </ul>
            <p>harm minors in any way;</p>
            <ul>
                <li>
                    impersonate any person or entity, including, but not limited
                    to, (i) an Intents Technology or Intents Technology Service
                    Provider manager, employee, agent, or representative or (ii)
                    forum leader, guide or host;
                </li>
                <li>
                    falsely state or otherwise misrepresent your affiliation
                    with any person or entity;
                </li>
                <li>
                    forge headers or otherwise manipulate identifiers in order
                    to disguise the origin of any material;
                </li>
                <li>
                    upload, post or otherwise transmit any material that you do
                    not have a right to transmit under any law or under
                    contractual or fiduciary relationships (such as inside
                    information, proprietary and confidential information
                    learned or disclosed as part of employment relationships or
                    under nondisclosure agreements);
                </li>
                <li>
                    upload, post or otherwise transmit any material that
                    infringes any patent, trademark, trade secret, copyright,
                    rights of privacy or publicity, or other proprietary rights
                    of any party;
                </li>
                <li>
                    upload, post, or transmit unsolicited commercial email or
                    "SPAM," including, but not limited to, unethical marketing,
                    advertising, or any other practice that is in any way
                    connected with SPAM, such as: (1) sending mass email to
                    recipients who haven't requested email from you or with a
                    fake return address; (2) promoting a site with inappropriate
                    links, titles, or descriptions; or (3) promoting any site by
                    posting multiple submissions in forums that are identical;
                </li>
                <li>
                    upload, post or otherwise transmit any material that
                    contains software viruses or any other computer code, files
                    or programs designed to interrupt, destroy or limit the
                    functionality of any computer software or hardware or
                    telecommunications equipment;
                </li>
                <li>
                    interfere with or disrupt the Services or servers or
                    networks connected to the Services, or disobey any
                    requirements, procedures, policies or regulations of
                    networks connected to the Services;
                </li>
                <li>
                    intentionally or unintentionally violate any applicable
                    local, state, national or international law, including, but
                    not limited to, regulations promulgated by the U.S.
                    Securities and Exchange Commission, any rules of any
                    national or other securities exchange, and any regulations
                    having the force of law;
                </li>
                <li>"stalk" or otherwise harass another;</li>
                <li>
                    collect or store personal data about other users of the
                    Service;
                </li>
                <li>
                    promote or provide instructional information about illegal
                    activities, promote physical harm or injury against any
                    group or individual, or promote any act of cruelty;
                </li>
                <li>
                    promote, offer for sale or sell any security or item, good
                    or service that i) violates any applicable international,
                    federal, state, or local law or regulation, ii) you do not
                    have full power and authority under all relevant laws and
                    regulations to offer and sell, including all necessary
                    licenses and authorizations, or iii) Intents Technology or
                    Intents Technology Service Providers determine, in their
                    sole discretion, is inappropriate for sale;
                </li>
                <li>
                    use the Forums as a forwarding service to another website;
                    or
                </li>
                <li>
                    access or otherwise use the Forums in any unlawful manner,
                    for any unlawful purpose or in violation of this agreement
                    including the outlined prohibitions on market manipulation
                    and self-trading and or any other agreement between you and
                    Intents Technology.
                </li>
            </ul>
            <h2>
                <strong>Applicable Law and Dispute Resolution</strong>
            </h2>
            <p>
                You agree that this Agreement shall be governed by and
                interpreted in accordance with the laws of the British Virgin
                Islands without giving effect to principles of conflicts of law.
            </p>
            <h2>
                <strong>Mandatory Arbitration</strong>
            </h2>
            <p>
                Any dispute, controversy, difference or claim arising out of or
                relating to the Services or this Agreement, including the
                existence, validity, interpretation, performance, breach or
                termination thereof or any dispute regarding non-contractual
                obligations arising out of or relating to it shall be referred
                to and finally resolved by arbitration administered by the BVI
                International Arbitration Centre (<strong>“BVIIAC”</strong>)
                under the BVIIAC Administered Arbitration Rules in force when
                the relevant notice of arbitration is submitted. The arbitration
                shall be conducted in the English language and the law of this
                arbitration clause shall be under the laws of the British Virgin
                Islands. The seat of arbitration shall be the British Virgin
                Islands. The number of arbitrators shall be one. The decision of
                the sole arbitrator in relation to any such dispute,
                controversy, difference or claim shall be final and binding upon
                both Parties. If any litigation or arbitration is necessary to
                enforce the terms of this Agreement, or any arbitral award
                entered under it, the successful or prevailing Party shall be
                entitled to recover their attorney’s fees and other costs
                incurred in such proceeding from the other Party in addition to
                any other relief to which it may be entitled. Each Party waives
                any right it may have to assert the doctrine of forum non
                conveniens, to assert that it is not subject to the jurisdiction
                of such arbitration or courts or to object to venue to the
                extent any proceeding is brought in accordance herewith.
            </p>
            <p>
                You agree that any and all disputes must be brought in your
                individual capacity and not as a plaintiff or class member in
                any purported class or representative proceeding. You expressly
                waive your right to file a class action or seek relief on a
                class basis. Any claim arising out of or relating to this
                Agreement or the Services must be commenced within one (1) year
                after the cause of action arises; otherwise, that claim is
                permanently barred, except where a longer period is required by
                applicable law.
            </p>
            <p>
                Nothing in this Agreement prevents either party from seeking
                urgent interim, conservatory or protective relief from a court
                of competent jurisdiction or, where available, an emergency
                arbitrator. Seeking such relief does not waive or invalidate the
                agreement to arbitrate. Nothing in this Agreement excludes a
                right or remedy that cannot lawfully be excluded.
            </p>
            <h2>
                <strong>Severability</strong>
            </h2>
            <p>
                Each provision of this Agreement shall be considered separable;
                and if, for any reason, any provision of this Agreement is
                determined by an arbitrator or court of competent jurisdiction
                to be invalid, unlawful, or unenforceable, such determination
                shall not affect the enforceability of the remainder of this
                Agreement or the validity, lawfulness, or enforceability of such
                provision in any other jurisdiction.
            </p>
            <h2>
                <strong>Prohibited Use</strong>
            </h2>
            <p>
                For purposes of this Agreement, sanctions-related restrictions
                are governed by the definitions of Sanctions Authority,
                Restricted Person and Restricted Jurisdiction. References to
                particular authorities or jurisdictions are illustrative only
                and do not limit any applicable sanctions obligation.
            </p>
            <p>
                You may not use the Services or access the Content to engage in
                the following categories of activity:
            </p>
            <ul>
                <li></li>
                <li>
                    Any activity that violates, facilitates the violation of, or
                    evades any applicable law, sanctions restriction or
                    compliance control, involves proceeds of unlawful activity,
                    or involves a Restricted Person or Restricted Jurisdiction;
                </li>
                <li>Engage in market manipulation or self-trading;</li>
                <li>
                    Publish, distribute or disseminate any unlawful material or
                    information;
                </li>
                <li>
                    Directly or indirectly make funds, digital assets, economic
                    resources or Services available to or for the benefit of a
                    Restricted Person, or participate in a transaction whose
                    purpose or effect is to circumvent sanctions or geographic
                    restrictions;
                </li>
                <li>
                    Actions which impose an unreasonable or disproportionately
                    large load on our infrastructure, or detrimentally interfere
                    with, intercept, or expropriate any system, data, or
                    information; transmit or upload any material to the Platform
                    that contains viruses, trojan horses, worms, or any other
                    harmful or deleterious programs; attempt to gain
                    unauthorized access to the Platform, computer systems or
                    networks connected to the Platform, through password mining
                    or any other means; use the Content or Intents Technology
                    provided information of another party to access or use the
                    Services, except in the case of specific merchants and/or
                    applications which are specifically authorized by a user to
                    access such user's access and information; or allow any
                    third party to access the Services using your CW, other than
                    an Authorized User validly appointed for a Business
                    Workspace, unless by operation of law or with the express
                    permission of Intents Technology;
                </li>
                <li>
                    Interfere with another individual's or entity's access to or
                    use of any Services or Content; defame, abuse, extort,
                    harass, stalk, threaten or otherwise violate or infringe the
                    legal rights (such as, but not limited to, rights of
                    privacy, publicity and intellectual property) of others;
                    harvest or otherwise collect information from the Services
                    about others, including without limitation email addresses,
                    without proper consent;
                </li>
                <li>
                    Activity which operates to defraud Intents Technology,
                    Intents Technology users, or any other person; provide any
                    false, inaccurate, or misleading information to Intents
                    Technology;
                </li>
                <li>
                    Lotteries; bidding fee auctions; sports forecasting or odds
                    making; fantasy sports leagues with cash prizes; internet
                    gaming; contests; sweepstakes; or games of chance that are
                    not sanctioned by a governmental body or regulatory
                    authority; and
                </li>
                <li>
                    Engage in transactions involving items that infringe or
                    violate any copyright, trademark, right of publicity or
                    privacy or any other proprietary right under the law,
                    including but not limited to sales, distribution, or access
                    to counterfeit music, movies, software, or other licensed
                    materials without the appropriate authorization from the
                    rights holder; use of Intents Technology intellectual
                    property, name, or logo, including use of Intents Technology
                    trade or service marks, without express consent from Intents
                    Technology or in a manner that otherwise harms Intents
                    Technology or the Intents Technology brand; any action that
                    implies an untrue endorsement by or affiliation with Intents
                    Technology.
                </li>
            </ul>
            <p>
                By using the Services, you represent and warrant that you will
                not use the Services or the Platform in connection with any of
                the following businesses, activities, practices, or items where
                the activity is unlawful, is conducted without any required
                licence, registration, authorisation or consent, or has been
                prohibited or restricted by Intents Technology:
            </p>
            <ul>
                <li>
                    Investment and Credit Services: unlicensed securities
                    brokers; unlawful or unlicensed mortgage consulting or debt
                    reduction services; unlawful or unlicensed credit
                    counselling or repair; unlawful real estate opportunities;
                    investment schemes;
                </li>
                <li>
                    Restricted Financial Services: check cashing, bail bonds;
                    collections agencies;
                </li>
                <li>
                    Intellectual Property or Proprietary Rights Infringement:
                    sales, distribution, or access to counterfeit music, movies,
                    software, or other licensed materials without the
                    appropriate authorization from the rights holder;
                </li>
                <li>
                    Counterfeit or Unauthorized Goods: unauthorized sale or
                    resale of brand name or designer products or services; sale
                    of goods or services that are illegally imported or exported
                    or which are stolen;
                </li>
                <li>
                    Regulated Products and Services: marijuana dispensaries and
                    related businesses; sale of tobacco, e-cigarettes, and
                    e-liquid; online prescription or pharmaceutical services;
                    age restricted goods or services; weapons and munitions;
                    gunpowder and other explosives; fireworks and related goods;
                    toxic, flammable, and radioactive materials;
                </li>
                <li>
                    Drugs and Drug Paraphernalia: sale of narcotics, controlled
                    substances, and any equipment designed for making or using
                    drugs, such as bongs, vaporizers, and hookahs;
                </li>
                <li>
                    Pseudo-Pharmaceuticals: pharmaceuticals and other products
                    that make health claims that have not been approved or
                    verified by the applicable local and/or national regulatory
                    body;
                </li>
                <li>
                    Substances designed to mimic illegal drugs: sale of a legal
                    substance that provides the same effect as an illegal drug
                    (e.g., salvia, kratom);
                </li>
                <li>
                    Adult Content and Services: pornography and other obscene
                    materials (including literature, imagery and other media);
                    sites offering any sexually-related services such as
                    prostitution, escorts, pay-per view, adult live chat
                    features;
                </li>
                <li>
                    Multi-level Marketing: pyramid schemes, network marketing,
                    and referral marketing programs, other than a referral
                    programme expressly offered by Intents Technology;
                </li>
                <li>
                    Unfair, predatory or deceptive practices: investment
                    opportunities or other services that promise high rewards;
                    sale or resale of a service without added benefit to the
                    buyer; resale of government offerings without authorization
                    or added value; sites that we determine in our sole
                    discretion to be unfair, deceptive, or predatory towards
                    consumers; and
                </li>
                <li>
                    High-risk businesses: any businesses that we believe poses
                    elevated financial risk, legal liability.
                </li>
            </ul>
            <h2>
                <strong>Interpretation</strong>
            </h2>
            <p>
                Section headings in this Agreement are for convenience only, and
                do not govern the meaning or interpretation of any provision of
                this Agreement. Unless the express context otherwise requires,
                (1) the words "hereof," "herein," "hereunder" and words of
                similar import, when used in this Agreement, shall refer to this
                Agreement as a whole and not to any particular provision of this
                Agreement; (2) the terms defined in the singular have a
                comparable meaning when used in the plural and vice versa; (3)
                wherever the word "include," "includes" or "including" is used
                in this Agreement, it shall be deemed to be followed by the
                words "without limitation"; (4) the word "extent" in the phrase
                "to the extent" shall mean the degree to which a subject or
                other thing extends and such phrase shall not mean simply "if";
                and (5) the word "or" shall not be interpreted to be exclusive.
            </p>
            <h2>
                <strong>Survival</strong>
            </h2>
            <p>
                You acknowledge, understand, and agree that all provisions of
                this Agreement which by their nature extend beyond the
                termination or expiration of this Agreement, including, but not
                limited to, sections pertaining to suspension, investigations,
                remedies for breach, termination, debts owed, right to offset,
                unclaimed funds, indemnities, limitation of liability, disputes
                with us, and general provisions, shall survive the termination
                or expiration of this Agreement.
            </p>
            <h2>
                <strong>Waiver</strong>
            </h2>
            <p>
                No waiver of any provision of this Agreement by Intents
                Technology shall be effective unless made in writing and signed
                by Intents Technology. The failure of Intents Technology to
                require the performance of, or enforce, any term or obligation
                of this Agreement, or the waiver by Intents Technology of any
                breach of this Agreement, shall not prevent any subsequent
                enforcement of such term or obligation or be deemed a waiver of
                any subsequent breach.
            </p>
            <h2>
                <strong>Entire Agreement</strong>
            </h2>
            <p>
                This Agreement constitutes the entire agreement between you and
                Intents Technology concerning the Services and supersedes prior
                and contemporaneous understandings concerning them. It includes
                each document or policy expressly incorporated by reference and
                any applicable appendix or additional product terms.
            </p>
            <h2>
                <strong>Legal Resources</strong>
            </h2>
            <p>
                Certain other legal resources including links to the Intents
                Technology corporate group's law enforcement portal may be found
                at https://app.kodexglobal.com/nearintents/requests
            </p>
            <h2>
                <strong>Contact Information</strong>
            </h2>
            <p>
                If you have any questions about this Agreement, please contact
                us at legal@near.com.
            </p>
        </LegalPage>
    );
}
