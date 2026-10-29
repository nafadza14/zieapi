// Legal documents for Apizie (Terms, Privacy, Cookies, Acceptable Use, Refunds).
// Written to match how the product actually works today (see src/core, src/db, src/dashboard).
// Text supports a tiny inline syntax: **bold**, `code`, [label](url). Blocks are strings or ["ul", [...]].

export const COMPANY = {
  name: "Ziera Technology",
  product: "Apizie",
  office: "Ziera HQ, Somodaran, Kalasan, Sleman, DI Yogyakarta, Indonesia 55571",
  email: "support@zieads.com",
  privacyEmail: "support@zieads.com",
  court: "Sleman District Court (Pengadilan Negeri Sleman)",
};

export const LEGAL_UPDATED = "29 October 2026";

const C = COMPANY;
const contactBlock = [
  `**${C.name}**`,
  `Office: ${C.office}`,
  `Email: [${C.email}](mailto:${C.email})`,
];

export const LEGAL_DOCS = {
  terms: {
    title: "Terms of Service",
    lead: `These terms are an agreement between you and ${C.name}, the company that operates ${C.product}. Please read them before you create an account or call the API.`,
    sections: [
      { h: "1. Who we are and what these terms cover", blocks: [
        `${C.product} is operated by **${C.name}** ("we", "us", "our"), with its office at ${C.office}.`,
        `These Terms of Service ("Terms") apply to the ${C.product} website, dashboard, REST API, MCP server, bulk jobs, webhooks and any related documentation (together, the "Service"). By creating an account, generating an API key or calling the Service, you agree to these Terms, the [Privacy Policy](/privacy), the [Acceptable Use Policy](/aup), the [Cookie Policy](/cookies) and the [Refund Policy](/refund).`,
        "If you use the Service on behalf of a company or other organisation, you confirm that you are authorised to accept these Terms for it, and \"you\" means that organisation.",
        "You must be at least 18 years old, or the age of legal majority where you live, to use the Service.",
      ] },
      { h: "2. Definitions", blocks: [
        ["ul", [
          "**Account**: the profile you create to use the Service, including its settings, keys and billing history.",
          "**API Key**: a secret credential (starting with `apz_`) that identifies your Account when you call the Service.",
          "**Upstream Provider**: a third party whose public API, open data set or feed the Service connects to, such as a government data portal, an exchange or a publisher.",
          "**Upstream Data**: data the Service returns from an Upstream Provider.",
          "**Provider Key**: a credential for an Upstream Provider that you send with a request in the `x-upstream-key` header.",
          "**Plan**: the Free plan or a paid plan described on the [Pricing](/pricing) page, including its monthly quota and rate limits.",
        ]],
      ] },
      { h: "3. The Service", blocks: [
        `${C.product} gives you one API key and one response format for many public data sources. We build on official public APIs, open data and publisher feeds. We do not own Upstream Data, and we do not bypass paywalls, logins or bot protection to obtain it.`,
        "Upstream Providers can change, limit or switch off their services at any time. We work to keep endpoints running, but we cannot guarantee that a particular source, endpoint or field will stay available. We may add, change, rename or retire endpoints. Features marked beta, preview or planned may change or be removed without notice.",
      ] },
      { h: "4. Your account and API keys", blocks: [
        ["ul", [
          "Give accurate information when you sign up and keep your email address current.",
          "Keep your API keys and session secret. Do not put keys in public code, client-side apps or shared documents.",
          "You are responsible for all activity under your Account and keys, including usage and charges.",
          "Tell us promptly at " + `[${C.email}](mailto:${C.email})` + " if you believe a key or your Account has been compromised. You can revoke and rotate keys yourself in the dashboard.",
          "We may disable a key that appears in public, is used abusively or puts the Service or others at risk.",
        ]],
      ] },
      { h: "5. Bring your own provider key", blocks: [
        "Some APIs in the catalog need your own Provider Key. When you send one in `x-upstream-key`, we forward it only to that Upstream Provider for that single request. **We never store or log Provider Keys.**",
        "You confirm that you are allowed to use the Provider Key, that your use complies with the Upstream Provider's terms, and that any fees the Upstream Provider charges are your responsibility.",
      ] },
      { h: "6. Upstream Data and source terms", blocks: [
        "Upstream Data belongs to its owners and is subject to their terms and licences (for example Creative Commons attribution or share-alike requirements, or open data licences). You are responsible for following those terms, including attribution, when you store, display or redistribute Upstream Data.",
        "We pass Upstream Data through as received, sometimes reformatted into JSON. We do not check it for accuracy, completeness or timeliness. Do not rely on the Service as your only source for decisions where mistakes could cause harm, such as emergency alerts, medical, legal or financial decisions. Nothing returned by the Service is professional advice.",
      ] },
      { h: "7. Acceptable use", blocks: [
        "You must use the Service lawfully and in line with the [Acceptable Use Policy](/aup). In particular you must not:",
        ["ul", [
          "use the Service to harass, stalk, dox, discriminate against or spam anyone, or to build profiles of individuals without a lawful basis;",
          "attempt to bypass rate limits, quotas, authentication, paywalls or access controls, here or at any Upstream Provider;",
          "interfere with, overload or probe the Service or any Upstream Provider, or use it to attack other systems;",
          "resell, sublicense or provide raw access to the Service as a competing API gateway without our written permission;",
          "use the Service in breach of export controls or sanctions, or for any illegal purpose.",
        ]],
      ] },
      { h: "8. Plans, quotas and limits", blocks: [
        "The Free plan includes 1,000 requests a month. Paid plans, prices and limits are shown on the [Pricing](/pricing) page. Each Plan has a monthly request quota and a per-minute rate limit.",
        ["ul", [
          "Monthly quotas reset on the 1st of each month (UTC). Unused requests do not roll over.",
          "Requests that fail because of a server-side error (HTTP 5xx) are not counted against your quota.",
          "When you reach your quota, requests are refused with HTTP 429 unless you have pay-as-you-go balance, which is then used at the rate shown on the Pricing page.",
          "We may apply fair-use limits to protect the Service and Upstream Providers, and we will tell you if a limit affects your Account specifically.",
        ]],
      ] },
      { h: "9. Prices, payment and taxes", blocks: [
        "All prices are in US dollars. You pay by card, Apple Pay or Google Pay at a checkout run by Dodo Payments.",
        ["ul", [
          "Payments are processed by Dodo Payments, which acts as the merchant of record for those sales and adds any sales tax or VAT that applies where you are at checkout. Its own terms apply to the payment itself; we never receive your full card details.",
          "A paid Plan starts once we have verified your payment. Monthly plans run for one month and yearly plans for twelve months. Yearly plans are priced at ten months.",
          "Plans do not renew automatically. The end date is shown in your dashboard; if the Plan is not renewed by then, the Account returns to the Free plan.",
          "Pay-as-you-go top-ups are prepaid and stay on your Account while it is active.",
          "We may change prices with at least 30 days' notice. Changes never affect a period you have already paid for.",
        ]],
        "Refunds are handled under the [Refund Policy](/refund).",
      ] },
      { h: "10. Your content", blocks: [
        "You keep all rights to what you send us, such as request parameters, webhook URLs, support messages and showcase submissions (\"Your Content\"). You give us a limited licence to host, process and transmit Your Content only to run, secure and improve the Service. Showcase submissions you mark for publication may be shown publicly after review.",
        "Do not include personal data or secrets in request parameters unless you need to. Parameters are sent to the relevant Upstream Provider to answer your request.",
      ] },
      { h: "11. Our intellectual property", blocks: [
        `The Service, including its software, design, documentation and the ${C.product} name and logo, belongs to ${C.name} or its licensors. We give you a limited, non-exclusive, non-transferable licence to use the Service under these Terms. You may not copy, reverse engineer or create derivative works of the Service except as the law allows or as an open-source licence for a specific component permits.`,
        "If you send us feedback or suggestions, we may use them without obligation to you.",
      ] },
      { h: "12. Availability and support", blocks: [
        "We aim for high availability but do not promise uninterrupted service unless we have signed a separate service level agreement with you. We may carry out maintenance, and we publish operational information on the [Status](/status) page. Support is available through the dashboard, the [report form](/report) and email.",
      ] },
      { h: "13. Suspension and termination", blocks: [
        "You may stop using the Service at any time and delete your Account from the dashboard settings.",
        "We may suspend or close your Account, or disable keys, if you breach these Terms or the Acceptable Use Policy, if payment fails or is reversed, if required by law, or if your use creates a security or legal risk. Where reasonable we will tell you first and give you a chance to fix the problem.",
        "When an Account is closed, its keys stop working and its data is deleted as described in the [Privacy Policy](/privacy). Sections that by their nature should continue (such as payment obligations, intellectual property, disclaimers, liability and governing law) survive termination.",
      ] },
      { h: "14. Disclaimers", blocks: [
        "To the extent permitted by law, the Service and all Upstream Data are provided \"as is\" and \"as available\", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement.",
      ] },
      { h: "15. Limitation of liability", blocks: [
        `To the extent permitted by law, ${C.name} is not liable for indirect, incidental, special or consequential losses, or for loss of profits, revenue, data or goodwill, arising from your use of the Service or Upstream Data.`,
        "Our total liability for any claim relating to the Service is limited to the amount you paid us for the Service in the three months before the event giving rise to the claim, or USD 50 if you have not paid us anything.",
        "Nothing in these Terms limits liability that cannot be limited by law, including liability for fraud or wilful misconduct, or your rights as a consumer under mandatory law.",
      ] },
      { h: "16. Indemnity", blocks: [
        `You agree to compensate ${C.name} for reasonable losses and costs (including legal fees) arising from claims by third parties that result from your breach of these Terms, your misuse of the Service, or your use of Upstream Data in breach of its owner's terms.`,
      ] },
      { h: "17. Changes to these Terms", blocks: [
        "We may update these Terms as the Service or the law changes. For material changes we will notify you on the website or by email at least 14 days before they take effect. If you keep using the Service after that date, the new Terms apply. If you do not agree, you can close your Account.",
      ] },
      { h: "18. Governing law and disputes", blocks: [
        "These Terms are governed by the laws of the Republic of Indonesia.",
        `If a dispute arises, please contact us first. Both parties will try to resolve it in good faith within 30 days. If it cannot be resolved, it will be settled by the ${C.court}, without prejudice to any mandatory consumer protection rights you have where you live.`,
      ] },
      { h: "19. General", blocks: [
        ["ul", [
          "These Terms, together with the policies linked above and any order or agreement you sign with us, are the entire agreement about the Service.",
          "If any part of these Terms is found unenforceable, the rest stays in effect.",
          "Failing to enforce a right is not a waiver of it.",
          "You may not transfer your rights under these Terms without our consent. We may transfer them as part of a reorganisation, merger or sale of the business.",
          "Neither party is responsible for delays caused by events beyond its reasonable control, including failures of Upstream Providers, networks or hosting providers.",
          "These Terms are written in English. Where Indonesian law requires an Indonesian-language version, we will provide one on request and both versions are equally valid.",
        ]],
      ] },
      { h: "20. Contact", blocks: contactBlock },
    ],
  },

  privacy: {
    title: "Privacy Policy",
    lead: `This policy explains what personal data ${C.name} collects when you use ${C.product}, why, who we share it with and the rights you have. It is written to meet Indonesia's Personal Data Protection Law (Law No. 27 of 2022, "UU PDP") and to respect the main privacy laws of the other countries our users come from.`,
    sections: [
      { h: "1. Who is responsible for your data", blocks: [
        `The data controller is **${C.name}**, ${C.office}. For any privacy question or request, email [${C.privacyEmail}](mailto:${C.privacyEmail}).`,
        `This policy covers the ${C.product} website, dashboard, REST API, MCP server, bulk jobs and webhooks.`,
      ] },
      { h: "2. Data we collect", blocks: [
        "**Account data.** Your name, email address and profile picture URL. If you sign in with Google, GitHub or Discord we receive these from that provider together with your user ID there. If you sign up with email, we store your password only as a salted scrypt hash.",
        "**Keys and security.** Your API keys (stored encrypted so you can reveal them in the dashboard), key names, optional IP allowlists, and session records with sign-in time, IP address and browser user agent.",
        "**Request logs and usage.** For each API or MCP call: time, method, API and endpoint, status code, response time, which key was used, IP address, source (REST, MCP or bulk), cache result and any error message. We count requests per day and per API to show usage and enforce quotas. **We do not store your request parameters or response bodies in your logs.**",
        "**Provider keys.** Keys you send in `x-upstream-key` are forwarded to the Upstream Provider for that request only. **They are never stored or logged.**",
        "**Billing.** Plan, invoices, amounts, tax, payment status from our payment provider (never your full card number), pay-as-you-go balance and referral commissions.",
        "**Webhooks and apps.** Webhook URLs, signing secrets, event settings and delivery history, and the MCP or OAuth apps you have authorised.",
        "**Things you send us.** Support requests, issue reports, showcase submissions and any other messages.",
        "**Referrals.** If you arrive through a referral link, we record the referral so the referrer can earn commission.",
        "We do not ask for sensitive personal data (such as health, biometric or financial account data), and we ask you not to send it through the Service.",
      ] },
      { h: "3. How and why we use it", blocks: [
        "We process personal data only for clear purposes and on a lawful basis under UU PDP (Article 20):",
        ["ul", [
          "**To provide the Service under our contract with you:** create and secure your Account, authenticate requests, run the API and MCP server, show usage, logs and invoices, and send webhooks.",
          "**To meet legal obligations:** keep billing and tax records and respond to lawful requests from authorities.",
          "**For our legitimate interests:** prevent abuse and fraud, enforce rate limits and the Acceptable Use Policy, keep the Service secure, fix problems and improve features. We balance these interests against your rights.",
          "**With your consent:** optional emails such as product news, where we ask for it. You can withdraw consent at any time.",
        ]],
        "We do not sell personal data, show advertising or build advertising profiles. We do not make automated decisions that have legal or similarly significant effects on you; automated checks such as rate limiting only limit request volume.",
      ] },
      { h: "4. Who we share it with", blocks: [
        "We share personal data only as needed to run the Service, with service providers bound by confidentiality and data protection obligations:",
        ["ul", [
          "**Vercel** (application hosting and compute)",
          "**Supabase** (database and sign-in)",
          "**Dodo Payments** (card payments, as merchant of record: it receives your email, name and payment details for card checkouts)",
          "**Resend** (transactional email, when email notifications are enabled)",
          "**Google, GitHub and Discord** (only if you choose to sign in with them)",
        ]],
        "**Upstream Providers.** When you call an endpoint, we send the request parameters to the relevant Upstream Provider from our servers. They see our server's address, not your identity or your API key. Their own privacy policies apply to what they receive.",
        "We may also disclose data when required by law or a valid order, to protect the rights and safety of our users or the public, or to a successor if the business is reorganised or sold, in which case this policy continues to apply.",
      ] },
      { h: "5. International transfers", blocks: [
        "Our hosting and database providers may store and process data on servers outside Indonesia. When data leaves Indonesia we make sure the receiving provider offers a level of protection equal to or higher than UU PDP, or that appropriate contractual safeguards are in place, as required by Article 56 of UU PDP.",
      ] },
      { h: "6. How long we keep it", blocks: [
        ["ul", [
          "**Request logs:** shown in your dashboard for 7 days on Free, 30 days on Pro and 90 days on Ultra and Max, and limited to the most recent 5,000 entries per Account.",
          "**Account, keys and settings:** for as long as your Account is open.",
          "**Sessions:** up to 30 days, or until you sign out or revoke the session.",
          "**Billing records:** 10 years, as required by Indonesian company document and tax rules.",
          "**Support messages and reports:** until resolved and for up to 2 years after, to handle follow-ups.",
        ]],
        "When you delete your Account in the dashboard, we delete your profile, keys, logs, webhooks, notifications and sessions from our active systems straight away. Invoices are kept as billing records. Copies in provider backups expire on their normal schedule, usually within 30 days.",
      ] },
      { h: "7. How we protect it", blocks: [
        "All traffic uses HTTPS. Passwords are hashed, API keys are encrypted at rest, session and sign-in cookies are signed, access to admin tools is restricted, and webhook targets are checked to block requests to private networks.",
        "No system is perfectly secure. If a personal data breach affects you, we will notify you and the relevant authority in writing within 3 x 24 hours of becoming aware of it, as required by Article 46 of UU PDP, and tell you what happened and what we are doing about it.",
      ] },
      { h: "8. Your rights", blocks: [
        "Under UU PDP you have the right to:",
        ["ul", [
          "get information about how we process your data and access a copy of it;",
          "correct inaccurate or incomplete data;",
          "have your data deleted or destroyed;",
          "withdraw consent you have given;",
          "object to decisions based solely on automated processing;",
          "restrict or suspend processing;",
          "receive your data in a commonly used format and have it transferred to another controller;",
          "claim compensation for violations of your data rights.",
        ]],
        "Many of these you can do yourself in the dashboard: edit your profile, revoke keys and sessions, export logs as CSV, and delete your Account. For anything else, email " + `[${C.privacyEmail}](mailto:${C.privacyEmail})` + ". We may need to verify your identity first. We respond within the time limits set by UU PDP, generally 3 x 24 hours for access, correction and similar requests.",
        "If you are in the European Economic Area, the United Kingdom or another region with similar laws, you have equivalent rights, and you can complain to your local data protection authority. We would appreciate the chance to address your concern first.",
      ] },
      { h: "9. Cookies", blocks: [
        "We use only strictly necessary cookies and a referral cookie. Details are in the [Cookie Policy](/cookies).",
      ] },
      { h: "10. Children", blocks: [
        "The Service is not meant for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has given us personal data, contact us and we will delete it.",
      ] },
      { h: "11. Changes to this policy", blocks: [
        "We will post any changes on this page and update the date at the top. If a change materially affects how we use your data, we will tell you by email or in the dashboard before it takes effect.",
      ] },
      { h: "12. Contact", blocks: contactBlock },
    ],
  },

  cookies: {
    title: "Cookie Policy",
    lead: `${C.product} keeps cookies to a minimum. We do not use advertising or third-party analytics cookies.`,
    sections: [
      { h: "Cookies we set", blocks: [
        ["ul", [
          "`apz_session`: keeps you signed in. Strictly necessary. Lasts up to 30 days or until you sign out.",
          "`apz_oauth` and `apz_sb`: protect the sign-in flow against forgery. Strictly necessary. Last 10 minutes.",
          "`apz_ref`: remembers a referral link you followed so the referrer can be credited. Lasts 30 days. Set only when you open a referral link.",
        ]],
      ] },
      { h: "Local storage", blocks: [
        "The website may save small preferences in your browser's local storage, such as an API key you paste into the playground. This stays on your device and is only sent to us when you make a request.",
      ] },
      { h: "Managing cookies", blocks: [
        "You can delete or block cookies in your browser settings. If you block strictly necessary cookies, you will not be able to sign in.",
      ] },
      { h: "Contact", blocks: contactBlock },
    ],
  },

  aup: {
    title: "Acceptable Use Policy",
    lead: `This policy sets out what you may and may not do with ${C.product}. It forms part of the [Terms of Service](/terms).`,
    sections: [
      { h: "Allowed", blocks: [
        "Building products, research, dashboards, agents and automations on the data the Service returns, in line with each source's terms and applicable law.",
      ] },
      { h: "Not allowed", blocks: [
        ["ul", [
          "Collecting or combining personal data for harassment, stalking, doxxing, discrimination or unlawful profiling.",
          "Spam, phishing, fraud, credential stuffing or impersonation.",
          "Attacking, overloading or probing the Service, Upstream Providers or any other system.",
          "Bypassing rate limits, quotas, paywalls, authentication or other access controls.",
          "Sharing API keys publicly, or reselling raw access to the Service without written permission.",
          "Any use that infringes intellectual property or breaks the law, including sanctions and export rules.",
        ]],
      ] },
      { h: "Personal data", blocks: [
        "If you process personal data obtained through the Service, you are the data controller for that processing and must comply with UU PDP and any other applicable laws.",
      ] },
      { h: "Enforcement", blocks: [
        "We may throttle, suspend or close Accounts that break this policy. Report abuse to " + `[${C.email}](mailto:${C.email})` + " or through the [report form](/report).",
      ] },
    ],
  },

  refund: {
    title: "Refund Policy",
    lead: "We want you to pay only for what works.",
    sections: [
      { h: "Failed requests", blocks: [
        "Requests that fail because of a server-side error (HTTP 5xx) are never counted against your quota or balance.",
      ] },
      { h: "Plan payments", blocks: [
        ["ul", [
          "If you paid and your Plan was not activated, we refund in full.",
          "If you cancel within 3 days of activation and have used less than 10% of the Plan's quota, we refund in full.",
          "Otherwise, payments for a period that has started are not refundable, but your Plan stays active until the period ends.",
        ]],
      ] },
      { h: "Pay-as-you-go balance", blocks: [
        "Unused top-up balance can be refunded within 14 days of the top-up if none of it has been used.",
      ] },
      { h: "How to ask", blocks: [
        `Email [${C.email}](mailto:${C.email}) with your invoice ID. Approved refunds go back to the original payment method through Dodo Payments, usually within 5 to 10 business days.`,
      ] },
      { h: "Contact", blocks: contactBlock },
    ],
  },
};
