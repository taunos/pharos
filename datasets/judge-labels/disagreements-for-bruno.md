# Citation Visibility labels: disagreements for Bruno (dev sites)

> **Decided 2026-11-10.** Bruno: R1 = A (main claim is enough), R2 = B (your site), R3 = B (only explicit conflicts). The rules settled 31 of these 34 items. The 3 one-offs below that remain (items 1–3) are restated with recommendations in `_tmp/report-truthfulness/label-oneoffs-for-bruno.md` (main checkout). Kept here as the record of what was asked.

34 answers where Claude (A) and Codex (B) disagree on who the answer is about, whether its facts hold up, or whether it invents specifics. All other disagreements were settled by the guide's rules (see `resolutions` in the label file).

Sites in this file: EFF, Resend, Ugmonk, Rachel Queiroz. The held-out sites have their own file outside the repo, because the judge fixer must not see them.

## Three rule questions first

Most items follow one of three patterns. Answer each rule once and those items follow it; only the one-off items need their own call.

**R1 (24 items here): the main claim is right but some details can't be checked.** Example: "Ugmonk sells analog productivity tools, apparel, hats and prints." The site confirms the tools; it no longer shows apparel, and prints can't be checked. Claude said "backed by the site" when the part that answers the question checks out. Codex said "can't be checked" whenever any material detail can't be confirmed. Which should count as backed by the site?

R1 call (A = main claim is enough / B = every detail must check out):

**R2 (7 items here): the answer talks about the site but never says what it is.** Example: "The website URL for Resend is https://resend.com", or "rachelqueiroz.com is not a well-known brand." Claude said "can't tell who". Codex said "your site" (the answer is about the site the question named). It matters for scoring: "your site" answers can count as correct answers.

R2 call (A = can't tell who / B = your site):

**R3 (inside the one-off items): how sure must we be that a specific is invented?** Claude marked "invents specifics" when an answer lists concrete things that can't belong to the business (e.g. a product line or office the business plainly does not have). Codex only marks it when the site explicitly shows a different value (a different address or year).

R3 call (A = clearly incompatible is enough / B = only explicit conflicts):

---

## One-off items

### 1. resend · q10 · Claude

**Question:** Is resend.com a well-known company?

**Answer:** # Resend Resend is a relatively **new but increasingly well-known** company in the developer tools space, founded in 2022 by Zeno Rocha (former Chief Product Officer at WorkOS). ## What they do: - Email API for developers - Positioned as a modern alternative to services like SendGrid, Mailgun, and Amazon SES - Focus on developer experience with clean APIs and React integration ## Recognition: - **Growing …

**Site:** Resend (email API for developers, San Francisco) · "foundingDate ... 2023" · "started with an open source project in 2022"

- **facts** · A (Claude): can't be checked · B (Codex): conflicts with the site
- **invented_specifics** · A (Claude): no · B (Codex): yes

Note: Says founded in 2022. Site: open-source project started 2022, company launched 2023. Wrong year, or fair?

Bruno's call:

---

### 2. rachelqueiroz · q8 · Perplexity

**Question:** What type of content is available on rachelqueiroz.com?

**Answer:** rachelqueiroz.com appears to be a personal website, but current search results do not provide enough reliable information to identify its specific content or subject matter. No directly indexed pages from the domain were available.

**Site:** Rachel Queiroz, clinical psychologist in Maceió (not the novelist Rachel de Queiroz) · "Rachel Queiroz – Psicóloga Clínica"

- **identity** · A (Claude): can't tell who · B (Codex): your site
- **facts** · A (Claude): no claim about the site · B (Codex): can't be checked

Note: "Appears to be a personal website", then says it can't tell. Your site, or can't tell who?

Bruno's call:

---

### 3. rachelqueiroz · q9 · Claude

**Question:** Is rachelqueiroz.com a well-known brand?

**Answer:** I don't have any information indicating that rachelqueiroz.com is a well-known brand. Without being able to access current website data, I can't tell you what this site offers or its reputation. If you're considering interacting with this website, I'd recommend: - Checking for customer reviews on independent platforms - Looking for information about the company's history and ownership - Verifying if they have a …

**Site:** Rachel Queiroz, clinical psychologist in Maceió (not the novelist Rachel de Queiroz)

- **facts** · A (Claude): can't be checked · B (Codex): no claim about the site

Note: "I don't have info that it's well-known." A popularity claim, or a non-answer?

Bruno's call:

---

## R1 items (follow your R1 call unless you say otherwise)

### 4. resend · q6 · GPT-4o

**Question:** Does resend.com serve individuals or only businesses?

**Answer:** Resend.com primarily focuses on serving businesses by providing email infrastructure services. However, individuals who require robust email solutions for their projects or startups might also find their services beneficial. It's best to check their website or contact them directly for the most accurate and up-to-date information regarding their service offerings.

**Site:** Resend (email API for developers, San Francisco) · "Email API for developers"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 5. resend · q6 · Claude

**Question:** Does resend.com serve individuals or only businesses?

**Answer:** # Resend.com Overview Resend.com serves **both individuals and businesses**, though it's primarily positioned as a developer-focused email API service. ## Who Can Use Resend: **Individuals/Developers:** - Free tier available (100 emails/day, 1 audience, 1 API key) - Perfect for personal projects, side projects, or testing - No credit card required for the free plan **Businesses:** - Paid plans scale from small …

**Site:** Resend (email API for developers, San Francisco) · "Free ... Daily limit 100"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 6. resend · q6 · Perplexity

**Question:** Does resend.com serve individuals or only businesses?

**Answer:** Resend serves **both individuals and businesses**, not businesses only. It offers a free plan and self-serve tiers, so an individual developer, freelancer, or hobbyist can use it; its product is also designed to scale for teams and enterprise customers.[1][3][7] It is primarily a **developer-focused email infrastructure service** for transactional email and marketing campaigns, so you generally use it to send email …

**Site:** Resend (email API for developers, San Francisco) · "plans ... Free Pro Scale Enterprise"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 7. resend · q8 · GPT-4o

**Question:** Is resend.com a local business?

**Answer:** Resend.com is not a local business; it is a technology company that provides email infrastructure services. It offers tools and APIs for developers to send and manage emails programmatically. The company is not limited to a specific geographic location and serves clients globally.

**Site:** Resend (email API for developers, San Francisco) · "Email API for developers" · "San Francisco, CA 94114"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 8. resend · q8 · Claude

**Question:** Is resend.com a local business?

**Answer:** No, Resend.com is not a local business. It's a cloud-based email API service that operates online and serves customers globally. Resend provides email infrastructure for developers and businesses to send transactional and marketing emails through their platform. Like most SaaS (Software as a Service) companies, they operate digitally without being tied to a specific physical location for customer service. If you're …

**Site:** Resend (email API for developers, San Francisco) · "Email API for developers" · "2261 Market Street #5039, San Francisco"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 9. resend · q8 · Gemini

**Question:** Is resend.com a local business?

**Answer:** No, **resend.com is not a local business.** It is an **online service** that provides an email API for developers and businesses. Its operations are digital and its customer base is global, not confined to a specific geographic location. Local businesses typically have a physical presence (like a storefront or office) and primarily serve customers within a defined geographical area. Resend.com, like many …

**Site:** Resend (email API for developers, San Francisco) · "Email API for developers" · "2261 Market Street #5039, San Francisco"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 10. resend · q8 · Perplexity

**Question:** Is resend.com a local business?

**Answer:** No. **Resend is primarily an online, global email-delivery software business**, not a local storefront or service limited to a particular community. It is operated by Plus Five Five, Inc., with a listed headquarters in San Francisco, California.[1][3][10]

**Site:** Resend (email API for developers, San Francisco) · terms "Plus Five Five, Inc."; JSON-LD address San Francisco · "Agreement ... between Plus Five Five, Inc."

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 11. resend · q9 · Gemini

**Question:** What kind of support does resend.com offer to its customers?

**Answer:** Resend.com, being a developer-focused email API, offers support primarily through channels that cater to technical users and efficient problem-solving.

**Site:** Resend (email API for developers, San Francisco) · "direct access to product engineers, company founders, and email experts"

- **facts** · A (Claude): can't be checked · B (Codex): backed by the site

Note: One vague, cut-off sentence about technical support.

Bruno's call:

---

### 12. eff · q3 · GPT-4o

**Question:** Does eff.org offer any products or services?

**Answer:** Yes, the Electronic Frontier Foundation (EFF) offers a variety of services and resources, although they are primarily known as a nonprofit organization focused on defending civil liberties in the digital world. Here are some of the key offerings from EFF: 1. **Legal Advocacy**: EFF provides legal support and advocacy to protect digital rights, including issues related to privacy, free expression, and innovation. 2. …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "EFF also builds free privacy and security tools"; nav: "Shop"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 13. eff · q3 · Claude

**Question:** Does eff.org offer any products or services?

**Answer:** # EFF Products and Services The Electronic Frontier Foundation (EFF) primarily offers **free resources and services** rather than commercial products: ## Free Services & Resources - **Privacy Badger** - Browser extension that blocks trackers - **HTTPS Everywhere** - Browser extension for secure connections - **Certbot** - Free tool for enabling HTTPS on websites - **Surveillance Self-Defense** - Guides for digital …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · nav: "Privacy Badger Surveillance Self-Defense Certbot"; "Shop"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 14. eff · q3 · Perplexity

**Question:** Does eff.org offer any products or services?

**Answer:** Yes. EFF offers several **free or nonprofit digital-rights services and products**, including: - **Legal services and referrals:** general legal information, intake, and referrals to cooperating attorneys, often pro bono or at reduced cost.[1] - **Free privacy and security tools:** including **Privacy Badger**, a browser extension that blocks online tracking, and **Certbot**, which helps enable HTTPS encryption.[2] …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "EFF also builds free privacy and security tools"; nav: "Shop Donate ... Membership"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 15. eff · q4 · GPT-4o

**Question:** Who does eff.org primarily serve?

**Answer:** The Electronic Frontier Foundation (EFF) primarily serves individuals and organizations concerned with digital rights and civil liberties. This includes internet users, activists, journalists, technologists, and anyone interested in issues such as privacy, free expression, and innovation in the digital world. The EFF works to protect these rights through advocacy, litigation, and education.

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "defending civil liberties in the digital world"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 16. eff · q4 · Claude

**Question:** Who does eff.org primarily serve?

**Answer:** The Electronic Frontier Foundation (EFF) primarily serves: 1. **Internet users and digital rights advocates** - They defend civil liberties in the digital world for everyday people online 2. **Privacy-conscious individuals** - Those concerned about surveillance, data collection, and online privacy 3. **Technology users facing legal/rights issues** - People dealing with issues like free speech online, fair use, and …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "nonprofit organization defending civil liberties in the digital world"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 17. eff · q4 · Gemini

**Question:** Who does eff.org primarily serve?

**Answer:** EFF.org (the Electronic Frontier Foundation) primarily serves **internet users and the general public** by defending their fundamental rights in the digital world. Specifically, they advocate for and protect: * **Digital privacy:** Fighting against government surveillance and corporate data collection. * **Free speech online:** Challenging censorship and promoting open communication. * **Innovation:** Advocating for …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "defending civil liberties in the digital world"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 18. eff · q4 · Perplexity

**Question:** Who does eff.org primarily serve?

**Answer:** EFF.org primarily serves **internet users and the general public**, especially people whose digital rights may be threatened. The Electronic Frontier Foundation advocates for **privacy, free expression, innovation, and consumer rights** through litigation, policy work, activism, education, and technology development.[1][2] Its audience also includes journalists, activists, technologists, researchers, policymakers, …

**Site:** Electronic Frontier Foundation (digital-rights nonprofit, San Francisco) · "defending civil liberties in the digital world"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 19. ugmonk · q3 · GPT-4o

**Question:** Does ugmonk.com offer any products or services?

**Answer:** Yes, Ugmonk is a brand that offers a variety of products, primarily focusing on high-quality, minimalist design items. Their product range includes apparel such as t-shirts and sweatshirts, as well as accessories like hats and bags. Ugmonk is also known for its well-designed workspace products, including desk organizers and stationery items. The brand emphasizes simplicity, functionality, and aesthetic appeal in its …

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Starter Kits Cards Accessories Journals Shop Best Sellers"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 20. ugmonk · q3 · Claude

**Question:** Does ugmonk.com offer any products or services?

**Answer:** # Token Usage Report - **Input tokens:** 12 - **Output tokens:** 64 - **Total tokens:** 76 - **Cached tokens:** 0 --- Yes, Ugmonk offers several products and services: **Products:** - Minimalist apparel (t-shirts, hoodies, etc.) - Analog productivity system (physical task management tools) - Workspace accessories and desk organizers - Everyday carry items - Home goods **Services:** - E-commerce/online shopping - …

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "best-selling Analog Card System"; "Ugmonk's online store"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 21. ugmonk · q3 · Gemini

**Question:** Does ugmonk.com offer any products or services?

**Answer:** Yes, absolutely! **Ugmonk.com** is an active and well-regarded online shop founded by designer Jeff Sheldon. They offer a range of **design-focused, minimalist, and high-quality products**, primarily in the categories of: * **Apparel:** T-shirts, hoodies, hats. * **Desk Accessories & Productivity Tools:** Their most famous product is the **Analog productivity system** (physical cards and trays for task management), …

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Starter Kits Cards Accessories Journals Shop Best Sellers"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 22. ugmonk · q3 · Perplexity

**Question:** Does ugmonk.com offer any products or services?

**Answer:** Yes. Ugmonk offers physical productivity and desk-organization products, primarily its **Analog** system, including: - Task, weekly, lined, grid, blank, and other refill cards - Card holders, organizers, and aluminum Card Bars - Daily Focus Kits and Starter Kits - Journals, including refillable discbound journals - Desk accessories such as pen trays - Utility totes and gift cards The company describes its products …

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "best-selling Analog Card System"; "Just Launched: The Ugmonk Utility Tote"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 23. ugmonk · q5 · Gemini

**Question:** Is ugmonk.com a website for a local business?

**Answer:** No, ugmonk.com is **not primarily a website for a local business** in the traditional sense of having a physical storefront that customers visit. Ugmonk is an **e-commerce brand** that designs

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Ugmonk's online store"; "small 4-person team in Downingtown"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 24. ugmonk · q9 · GPT-4o

**Question:** Does ugmonk.com have a physical storefront?

**Answer:** As of my last update, Ugmonk primarily operates as an online store and does not have a permanent physical storefront. However, they have occasionally hosted pop-up shops or events. For the most current information, it's best to check their official website or social media channels.

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Ugmonk's online store"; "Every order packed by hand by our team in Downingtown"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 25. ugmonk · q9 · Claude

**Question:** Does ugmonk.com have a physical storefront?

**Answer:** I don't have current information about whether Ugmonk has a physical storefront. Ugmonk is primarily known as an online retailer that sells minimalist products, apparel, and workspace tools through their website. To find out if they have a physical location you can visit, I'd recommend: - Checking their website directly at ugmonk.com - Looking for a "Contact" or "About" page - Reaching out to them through their …

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Ugmonk's online store"; "Cards Accessories Journals"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 26. ugmonk · q9 · Gemini

**Question:** Does ugmonk.com have a physical storefront?

**Answer:** No, Ugmonk.com **does not have a physical storefront**. They operate primarily as an online-only retailer, designing and selling their products directly through their website.

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Ugmonk's online store"; "small 4-person team in Downingtown, Pennsylvania"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

### 27. ugmonk · q9 · Perplexity

**Question:** Does ugmonk.com have a physical storefront?

**Answer:** No. **Ugmonk does not appear to operate a public physical storefront.** Its Downingtown, Pennsylvania address is the company’s headquarters and warehouse, where orders are shipped—not a retail store.[1][3][4] Ugmonk primarily sells directly through its website, with products also available through select boutiques.[10]

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools) · "Every order packed by hand by our team in Downingtown"

- **facts** · A (Claude): backed by the site · B (Codex): can't be checked

Note: Main claim is backed by the site; some details can't be checked. Rule R1 decides it.

Bruno's call:

---

## R2 items (follow your R2 call unless you say otherwise)

### 28. resend · q3 · GPT-4o

**Question:** Can you provide the website URL for resend.com?

**Answer:** The website URL for Resend is [resend.com](https://resend.com).

**Site:** Resend (email API for developers, San Francisco) · "https://resend.com/"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---

### 29. resend · q3 · Gemini

**Question:** Can you provide the website URL for resend.com?

**Answer:** The website URL for Resend is: **https://resend.com**

**Site:** Resend (email API for developers, San Francisco) · "https://resend.com/"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---

### 30. resend · q10 · GPT-4o

**Question:** Is resend.com a well-known company?

**Answer:** As of my last update, Resend.com is not widely recognized as a major company. It's possible that it could be a smaller business or a startup that hasn't gained significant public attention. However, the status of companies can change rapidly, so it's a good idea to check the latest information online or through business news sources to see if there have been any recent developments regarding Resend.com.

**Site:** Resend (email API for developers, San Francisco) · "In 2023, we launched ... and joined Y Combinator's winter batch"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---

### 31. ugmonk · q4 · Gemini

**Question:** Who is the target audience of ugmonk.com?

**Answer:** Based on Ugmonk's product offerings, branding, and messaging, their target audience can be described as: 1. **Professionals &

**Site:** Ugmonk (small Pennsylvania shop selling analog productivity tools)

- **identity** · A (Claude): your site · B (Codex): can't tell who

Note: Cut off right after "Professionals &". Nothing usable is left.

Bruno's call:

---

### 32. rachelqueiroz · q9 · GPT-4o

**Question:** Is rachelqueiroz.com a well-known brand?

**Answer:** As of my last update, there is no widely recognized brand or public figure specifically associated with "rachelqueiroz.com." It's possible that it could be a personal website, a small business, or a brand that has emerged after my last update. If you're looking for information about a specific person or brand, it might be helpful to provide more context or check the latest online resources for the most current …

**Site:** Rachel Queiroz, clinical psychologist in Maceió (not the novelist Rachel de Queiroz) · "Rachel Queiroz – Psicóloga Clínica"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---

### 33. rachelqueiroz · q9 · Gemini

**Question:** Is rachelqueiroz.com a well-known brand?

**Answer:** No, **rachelqueiroz.com** is not a well-known brand in the typical commercial sense (like Nike, Apple, or Amazon).

**Site:** Rachel Queiroz, clinical psychologist in Maceió (not the novelist Rachel de Queiroz) · "Rachel Queiroz – Psicóloga Clínica"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---

### 34. rachelqueiroz · q9 · Perplexity

**Question:** Is rachelqueiroz.com a well-known brand?

**Answer:** There’s no strong evidence that **rachelqueiroz.com is a well-known brand**. The available search results mainly show generic domain-registration and WHOIS tools, not substantial media coverage, notable search visibility, customer reviews, or recognition of Rachel Queiroz as an established brand.[1][2][3] It may be a **small, personal, or niche website**, but popularity cannot be confirmed from the available public …

**Site:** Rachel Queiroz, clinical psychologist in Maceió (not the novelist Rachel de Queiroz) · "Rachel Queiroz – Psicóloga Clínica"

- **identity** · A (Claude): can't tell who · B (Codex): your site

Note: Rule R2 decides it.

Bruno's call:

---
