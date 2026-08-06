"""Which résumé template suits which job.

The Design tab carries 37 templates, which is more choice than help: most
customers know their job title and have no idea whether a recruiter in their
field wants a photo, a skills band, or two pages of plain text. This module is
the curated answer — for ~60 of the most commonly applied-for roles, the three
or four templates that fit, each with the reason in one line.

It is data, deliberately: hand-written and reviewed rather than generated, so a
recommendation can be corrected without touching the UI or paying for an LLM
call on every page load. `role_template_fields()` drops any pick whose template
is no longer in the live catalogue, so retiring a template can never leave a
dangling recommendation or 500 the endpoint.

Conventions used when choosing picks:
  * first pick is the safe default for the field, not the most decorative;
  * every role includes at least one ATS-safe, single-column option;
  * design-led templates are only recommended where a portfolio matters;
  * regional formats are grouped under their market rather than a job title,
    because "applying in Germany" changes the format more than the job does.
"""

from .resume_pdf import TEMPLATES

# (field label, [(role id, role label, [(template id, why)])])
_FIELDS: list[tuple[str, list[tuple[str, str, list[tuple[str, str]]]]]] = [
    ("Data & Analytics", [
        ("data_scientist", "Data Scientist", [
            ("hybrid_combination", "Puts your stack in an Areas of Expertise band up top, then proves it with the roles underneath — what most DS screens look for first."),
            ("tech_clean_colorful", "Clean, single-column and low-decoration; keeps long model/tooling lists readable."),
            ("academic_cv", "Use this one if publications and research carry your profile more than job titles."),
            ("ats_plain", "The safest fallback when you're applying through a strict portal."),
        ]),
        ("data_engineer", "Data Engineer", [
            ("hybrid_combination", "Pipeline and platform skills sit above the roles, which is how data-engineering job specs are written."),
            ("tech_clean_colorful", "Roles read \"Title @ Company\" on one line, leaving room for a long tooling list."),
            ("swiss_grid", "Tight grid and tracked headings — good when you have many short contract roles."),
            ("ats_plain", "No colour, no columns: use it for portals that mangle anything else."),
        ]),
        ("data_analyst", "Data Analyst", [
            ("hybrid_combination", "Skills grid first, then the roles — reads well when your tooling is the hiring filter."),
            ("corporate_blue", "Conservative navy layout that suits in-house analytics and finance-adjacent teams."),
            ("compact_onepage", "Fits a longer history onto one page without dropping detail."),
        ]),
        ("ml_engineer", "ML / AI Engineer", [
            ("tech_clean_colorful", "Product-shaped and compact; keeps model, infra and language lists scannable."),
            ("hybrid_combination", "Leads with expertise areas, which is how ML specs are usually written."),
            ("academic_cv", "Choose this if papers, benchmarks or a PhD do the talking."),
        ]),
        ("analytics_engineer", "BI / Analytics Engineer", [
            ("corporate_blue", "Navy ruled headings and \"Technical Skills\" wording — the in-house BI house style."),
            ("hybrid_combination", "Warehouse and modelling skills up front, roles as evidence."),
            ("swiss_grid", "Best of the three if you want something more designed but still plain."),
        ]),
        ("research_scientist", "Research Scientist", [
            ("academic_cv", "Publications sit directly after the summary, where a research panel expects them."),
            ("harvard_classic", "Traditional, serif and ATS-safe — the safe choice for institutes and labs."),
            ("executive_elegant", "Use for industry research roles where the CV also has to look senior."),
        ]),
    ]),
    ("Software & Infrastructure", [
        ("software_engineer", "Software Engineer", [
            ("tech_clean_colorful", "Compact single column, \"Role @ Company\" lines, no rules — the shape most tech recruiters skim."),
            ("hybrid_combination", "Use when you want your languages and frameworks read before your job titles."),
            ("ats_plain", "For big-company portals that strip formatting."),
        ]),
        ("frontend_engineer", "Frontend Engineer", [
            ("tech_clean_colorful", "Clean and product-shaped, with room for framework lists."),
            ("creative_colorful", "A designed banner header without giving up the single column — reasonable for frontend and design-systems roles."),
            ("diagonal_split", "Only if the role explicitly values visual craft."),
        ]),
        ("backend_engineer", "Backend Engineer", [
            ("swiss_grid", "Structured and typographic; suits systems work where detail matters more than colour."),
            ("hybrid_combination", "Leads on languages, datastores and platforms."),
            ("ats_plain", "Fallback for strict parsers."),
        ]),
        ("fullstack_engineer", "Full-Stack Engineer", [
            ("tech_clean_colorful", "Keeps a wide stack readable in one column."),
            ("hybrid_combination", "Skills band up top stops a long stack from being buried."),
            ("compact_onepage", "When you have five-plus roles and still want one page."),
        ]),
        ("mobile_engineer", "Mobile Engineer", [
            ("tech_clean_colorful", "Clean accent header, plain body — fits mobile and consumer teams."),
            ("tech_clean_colorful", "Compact, low-decoration, easy to skim."),
            ("startup_energetic", "Room for links and shipped work; good when App Store listings matter."),
        ]),
        ("devops_sre", "DevOps / SRE", [
            ("swiss_grid", "Dense and structured, which suits long infrastructure tool lists."),
            ("twocolumn_sidebar", "Sidebar for the tooling list, wide column for incidents and platform work."),
            ("hybrid_combination", "Platform skills first, incident and reliability results underneath."),
            ("ats_plain", "Safest for enterprise portals."),
        ]),
        ("cloud_architect", "Cloud / Solutions Architect", [
            ("consulting_premium", "Split header and serif type read as senior and client-facing."),
            ("hybrid_combination", "Architecture domains up top, delivery evidence below."),
            ("executive_twopage", "For principal and above, where two pages are expected."),
        ]),
        ("security_engineer", "Security Engineer", [
            ("corporate_blue", "Conservative navy layout that suits banks, government and regulated industries."),
            ("ats_plain", "Plain text for cleared or portal-heavy applications."),
            ("hybrid_combination", "Certifications and domains up top where they get read."),
        ]),
        ("qa_engineer", "QA / Test Engineer", [
            ("ats_plain", "Test tooling and coverage detail survive any parser."),
            ("compact_onepage", "Dense enough for a long contract history."),
            ("hybrid_combination", "Automation skills first, roles as proof."),
        ]),
    ]),
    ("Product & Design", [
        ("product_manager", "Product Manager", [
            ("achievement_focused", "Promotes your top result per role into a Key Achievements block — PM screens are outcome-led."),
            ("consulting_premium", "Split header, serif, \"Selected Projects\" wording; reads senior."),
            ("hybrid_combination", "Balanced skills-plus-history for a first PM move."),
        ]),
        ("product_designer", "Product / UX Designer", [
            ("magazine_editorial", "Editorial cover band and serif body — shows craft without becoming a portfolio."),
            ("layered_papercard", "Each role on its own card; tactile but still ordered."),
            ("creative_colorful", "Most visual option; pair it with a portfolio link."),
        ]),
        ("graphic_designer", "Graphic Designer", [
            ("magazine_editorial", "The most art-directed layout here, and still one column for parsers."),
            ("diagonal_split", "Graphic two-tone banner with a conventional body underneath."),
            ("pastel_soft", "Softer palette with cards and chips — good for brand and illustration work."),
            ("twocolumn_sidebar", "Dark full-height panel for skills and contact; the most graphical option that still parses."),
        ]),
        ("ux_researcher", "UX Researcher", [
            ("academic_cv", "Publications and methods placed where a research lead looks first."),
            ("modern_minimalist", "Calm, airy and readable — suits method-heavy write-ups."),
            ("magazine_editorial", "If the team is design-led rather than research-led."),
        ]),
    ]),
    ("Business & Operations", [
        ("project_manager", "Project Manager", [
            ("achievement_focused", "Delivery results lead the page instead of sitting in the third role down."),
            ("corporate_blue", "Conservative and navy — the PMO house style."),
            ("timeline", "Puts the roles on a vertical rail, which reads well for a long linear delivery career."),
            ("hybrid_combination", "Methodology and tooling up top, delivery history below."),
        ]),
        ("program_manager", "Programme Manager", [
            ("consulting_premium", "Reads as senior and client-facing; \"Selected Projects\" fits programme work."),
            ("achievement_focused", "Puts scale and savings in the first block."),
            ("executive_twopage", "For portfolio-level roles that warrant two pages."),
        ]),
        ("business_analyst", "Business Analyst", [
            ("corporate_blue", "Navy, ruled and conventional — what most BA hiring managers expect."),
            ("hybrid_combination", "Domain and tooling skills first."),
            ("compact_onepage", "Dense option for a long client list."),
        ]),
        ("operations_manager", "Operations Manager", [
            ("achievement_focused", "Throughput, cost and service results promoted to the top."),
            ("corporate_blue", "Plain and conservative for corporate ops teams."),
            ("compact_onepage", "One page, many sites and roles."),
        ]),
        ("management_consultant", "Management Consultant", [
            ("consulting_premium", "Built for this: split header, serif, Profile / Core Skills / Selected Projects."),
            ("harvard_classic", "The traditional MBB-safe option."),
            ("executive_twopage", "For principal and partner-track CVs."),
        ]),
        ("supply_chain", "Supply Chain / Procurement", [
            ("corporate_blue", "Conservative navy layout that suits manufacturing and retail groups."),
            ("achievement_focused", "Savings and service-level wins lead the page."),
            ("compact_onepage", "Fits a long plant or category history."),
        ]),
    ]),
    ("Finance & Legal", [
        ("accountant", "Accountant", [
            ("finance_formal", "Serif, dense and mono-printable — built for finance conventions."),
            ("corporate_blue", "Slightly more modern while staying conservative."),
            ("ats_plain", "For practice and portal applications."),
        ]),
        ("financial_analyst", "Financial Analyst", [
            ("finance_formal", "Tight serif layout that fits detail without looking crowded."),
            ("consulting_premium", "Reads as client-facing for IB-adjacent and advisory roles."),
            ("hybrid_combination", "Modelling and systems skills up top."),
        ]),
        ("investment_banking", "Investment Banking / PE", [
            ("finance_formal", "The conservative, deal-sheet-friendly standard."),
            ("harvard_classic", "Traditional and safe for analyst programmes."),
            ("consulting_premium", "Split header reads senior for associate-plus."),
        ]),
        ("auditor", "Auditor / Risk", [
            ("finance_formal", "Formal serif with dense, ruled sections."),
            ("ats_plain", "For Big Four portals that parse aggressively."),
            ("corporate_blue", "Conservative in-house alternative."),
        ]),
        ("lawyer", "Lawyer / Legal Counsel", [
            ("harvard_classic", "Serif, ruled, traditional — what legal recruiters read."),
            ("finance_formal", "Dense formal serif; suits chambers and private practice."),
            ("executive_elegant", "For in-house counsel and GC-level moves."),
        ]),
    ]),
    ("Marketing & Sales", [
        ("marketing_manager", "Marketing Manager", [
            ("achievement_focused", "Campaign results lead — marketing hiring is numbers-first."),
            ("magazine_editorial", "Shows brand sense while staying readable."),
            ("hybrid_combination", "Channel skills up top, results underneath."),
        ]),
        ("digital_marketer", "Digital / Growth Marketer", [
            ("startup_energetic", "Punchy, chip-based skills; fits growth and agency roles."),
            ("achievement_focused", "Puts CAC, ROAS and growth numbers in the first block."),
            ("diagonal_split", "Graphic two-tone header without losing the single column."),
            ("bold_sidebar", "Sidebar layout with a strong accent — fits agency and brand-side applications."),
        ]),
        ("content_writer", "Content Writer / Editor", [
            ("magazine_editorial", "An editorial layout is the right argument for an editorial job."),
            ("newspaper_columns", "Masthead and serif body — reads as a byline."),
            ("executive_elegant", "Formal serif alternative for in-house comms."),
        ]),
        ("sales_executive", "Sales / Account Executive", [
            ("achievement_focused", "Quota attainment and deal sizes are promoted to the top."),
            ("corporate_blue", "Conservative option for enterprise and regulated sales."),
            ("compact_onepage", "One page, many territories."),
        ]),
        ("customer_success", "Customer Success Manager", [
            ("pastel_soft", "Warm, approachable layout for a relationship role."),
            ("achievement_focused", "Retention and NRR numbers lead."),
            ("pastel_soft", "Softer palette where the brand is consumer-facing."),
        ]),
    ]),
    ("People & Administration", [
        ("hr_recruiter", "HR / Recruiter", [
            ("pastel_soft", "Read by people who skim all day — this stays friendly and legible."),
            ("twocolumn_sidebar", "Contact, systems and certifications in a panel; experience gets the wide column."),
            ("modern_minimalist", "Calm and airy — reads as considered rather than decorated."),
            ("corporate_blue", "Conservative choice for in-house HR and shared services."),
        ]),
        ("executive_assistant", "Executive Assistant", [
            ("compact_onepage", "Dense and neat — fits a long list of principals supported."),
            ("modern_minimalist", "Quietly polished, easy to skim."),
            ("corporate_blue", "For corporate and financial-services EAs."),
        ]),
        ("office_manager", "Office / Practice Manager", [
            ("compact_onepage", "Everything on one page, in order."),
            ("pastel_soft", "Friendlier layout for smaller practices and studios."),
            ("corporate_blue", "Conservative fallback."),
        ]),
    ]),
    ("Healthcare & Science", [
        ("nurse", "Nurse / Allied Health", [
            ("government_formal", "Public-sector wording and grey rules — reads like an NHS or hospital-trust CV."),
            ("compact_onepage", "Fits rotations, placements and revalidation detail."),
            ("ats_plain", "For trust and agency portals."),
        ]),
        ("physician", "Doctor / Physician", [
            ("academic_cv", "Publications, research and training placed the way a clinical panel reads them."),
            ("harvard_classic", "Traditional serif CV for consultant and fellowship applications."),
            ("executive_elegant", "For private practice and leadership posts."),
        ]),
        ("pharmacist", "Pharmacist", [
            ("academic_cv", "Room for registrations, research and CPD."),
            ("ats_plain", "Plain text for chain and NHS portals."),
            ("corporate_blue", "Conservative option for industry roles."),
        ]),
        ("lab_technician", "Lab / Research Technician", [
            ("ats_plain", "Technique and instrument lists survive any parser."),
            ("academic_cv", "If you have publications or a research group history."),
            ("compact_onepage", "Neat one-pager for early-career applications."),
        ]),
    ]),
    ("Education & Public Sector", [
        ("teacher", "Teacher", [
            ("modern_minimalist", "Calm and readable; leaves room for subjects, key stages and pastoral detail."),
            ("government_formal", "Public-sector wording that fits state schools and academy trusts."),
            ("pastel_soft", "Warmer option for primary and early-years applications."),
        ]),
        ("professor", "Lecturer / Professor", [
            ("academic_cv", "Publications directly after the summary, research wording throughout."),
            ("harvard_classic", "Traditional and safe for faculty panels."),
            ("executive_elegant", "For chair, dean and institute-director applications."),
        ]),
        ("civil_servant", "Civil Servant / Policy", [
            ("government_formal", "Personal Statement, Employment History, GOV.UK-style palette."),
            ("uk_cv", "For UK departments that ask for a CV plus statement."),
            ("ats_plain", "For competency-based portals."),
        ]),
        ("social_worker", "Social Worker", [
            ("government_formal", "Local-authority wording and a plain, high-contrast layout."),
            ("modern_minimalist", "Readable and unfussy for casework detail."),
            ("compact_onepage", "When registration, training and placements all have to fit."),
        ]),
    ]),
    ("Engineering & Trades", [
        ("mechanical_engineer", "Mechanical Engineer", [
            ("swiss_grid", "Structured and technical; suits standards, tooling and CAD lists."),
            ("ats_plain", "For large manufacturers' portals."),
            ("hybrid_combination", "Competencies up top, projects underneath."),
        ]),
        ("civil_engineer", "Civil / Structural Engineer", [
            ("corporate_blue", "Conservative and navy, as consultancies and contractors expect."),
            ("achievement_focused", "Puts project value and delivery outcomes first."),
            ("ats_plain", "Plain fallback for framework applications."),
        ]),
        ("electrical_engineer", "Electrical Engineer", [
            ("swiss_grid", "Dense grid for standards, systems and certifications."),
            ("hybrid_combination", "Skills band keeps a wide competency list readable."),
            ("ats_plain", "Safest for portal applications."),
        ]),
        ("construction_manager", "Site / Construction Manager", [
            ("corporate_blue", "Plain, conservative and site-credible."),
            ("achievement_focused", "Programme, budget and safety results lead."),
            ("ats_plain", "For contractor portals and agencies."),
        ]),
        ("chef_hospitality", "Chef / Hospitality", [
            ("layered_papercard", "Each venue on its own card — reads well when you've worked many kitchens."),
            ("compact_onepage", "Keeps a long venue list to one page."),
            ("pastel_soft", "Front-of-house and management roles where personality matters."),
        ]),
        ("retail_manager", "Retail / Store Manager", [
            ("achievement_focused", "Sales, shrink and team results in the first block."),
            ("compact_onepage", "Fits many stores and promotions on one page."),
            ("corporate_blue", "Head-office and multi-site applications."),
        ]),
        ("logistics_driver", "Logistics / Driver", [
            ("ats_plain", "Licences and endorsements survive any parser."),
            ("compact_onepage", "One tidy page, which is what depots want."),
            ("government_formal", "For public-sector and council fleets."),
        ]),
    ]),
    ("Early career & transitions", [
        ("student_graduate", "Student / Recent Graduate", [
            ("graduate_entry", "Education first, then projects, then internships — the right order with no career history yet."),
            ("modern_minimalist", "Clean and roomy so a shorter CV doesn't look thin."),
            ("ats_plain", "For graduate-scheme portals."),
        ]),
        ("intern", "Intern / Placement", [
            ("graduate_entry", "Built for coursework, projects and part-time work."),
            ("modern_minimalist", "Airy layout that suits a one-page application."),
            ("compact_onepage", "If you have more to say than fits comfortably."),
        ]),
        ("career_changer", "Career Changer", [
            ("functional_skills", "Competencies and achievements carry the page; employment history shrinks to one line per role."),
            ("hybrid_combination", "Transferable skills up top, with dates still visible."),
            ("achievement_focused", "Leads on outcomes rather than job titles."),
        ]),
        ("returner", "Returning after a break", [
            ("functional_skills", "De-emphasises the chronology without hiding it."),
            ("modern_minimalist", "Calm and confident rather than apologetic."),
            ("graduate_entry", "If you retrained during the break, this leads with the qualification."),
        ]),
        ("executive_clevel", "Executive / C-level", [
            ("executive_twopage", "Executive Summary and Career Highlights, set to be read across two pages."),
            ("executive_elegant", "Serif and restrained; reads senior without decoration."),
            ("consulting_premium", "Split header for board and advisory applications."),
        ]),
        ("freelancer", "Freelancer / Contractor", [
            ("tech_clean_colorful", "Clean and modern, with room for clients and links."),
            ("layered_papercard", "Each engagement on its own card, which suits many short contracts."),
            ("modern_minimalist", "Plain and roomy — lets a varied client list breathe."),
            ("magazine_editorial", "For creative freelancers pairing this with a portfolio."),
        ]),
    ]),
    ("Applying in a specific market", [
        ("market_us", "United States", [
            ("us_chronological", "US Letter paper, no photo, no date of birth — anything else gets filtered."),
            ("hybrid_combination", "Modern US-friendly alternative with a skills band."),
            ("harvard_classic", "Centred serif classic — the shape US Word-based parsers handle most predictably."),
            ("ats_plain", "For the big applicant-tracking portals."),
        ]),
        ("market_uk", "United Kingdom", [
            ("uk_cv", "Personal Statement, Employment History and a references line, as UK employers expect."),
            ("government_formal", "For public-sector and NHS applications."),
            ("compact_onepage", "When you're asked for a strict one-pager."),
        ]),
        ("market_eu", "Europe (EU portals)", [
            ("europass_cv", "The row-and-label structure EU application portals are built around."),
            ("photo_banner", "Photo-led CV, which is the norm across much of the continent."),
            ("modern_minimalist", "For Nordic employers, who tend to prefer plainer CVs."),
            ("twocolumn_sidebar", "Sidebar layout, which several EU portals and agencies still prefer."),
        ]),
        ("market_de", "Germany / Austria / Switzerland", [
            ("europass_cv", "The row-and-label structure German and EU-wide portals accept."),
            ("photo_banner", "Photo-led CV, still conventional across the DACH region."),
            ("modern_minimalist", "Plain, photo-free option if the employer asks for one."),
        ]),
        ("market_in", "India", [
            ("india_resume", "Career Objective, academics above experience, Personal Details and a signed Declaration."),
            ("compact_onepage", "For product and MNC roles that prefer a lean one-pager."),
            ("hybrid_combination", "Modern option for experienced hires."),
        ]),
        ("market_ca", "Canada", [
            ("canadian_resume", "US Letter paper, no personal details, closing references line."),
            ("us_chronological", "Close equivalent if you're applying on both sides of the border."),
            ("ats_plain", "For government and large-employer portals."),
        ]),
        ("market_gulf", "Middle East / Gulf", [
            ("gulf_cv", "Nationality, visa status and notice period at the top, where Gulf recruiters screen first."),
            ("photo_banner", "Photo CV without the eligibility block."),
            ("corporate_blue", "Conservative option for banking and energy."),
        ]),
        ("market_jp", "Japan", [
            ("japan_rirekisho", "Ruled form layout, with the identity grid and dated history table."),
            ("photo_banner", "For foreign-capital employers who accept a Western CV with a photo."),
            ("ats_plain", "For global companies hiring in English."),
        ]),
    ]),
]


def role_template_fields() -> list[dict]:
    """The picker's payload: fields -> roles -> picks, live templates only.

    A pick naming a template that has been retired is dropped rather than
    returned with a dead id, and a role left with no picks disappears with it —
    the tab is a convenience, so it should degrade quietly.
    """
    out = []
    for field_label, roles in _FIELDS:
        field_roles = []
        for role_id, role_label, picks in roles:
            live = [
                {"template_id": tid, "name": TEMPLATES[tid]["name"], "why": why}
                for tid, why in picks if tid in TEMPLATES
            ]
            if live:
                field_roles.append({"id": role_id, "label": role_label, "picks": live})
        if field_roles:
            out.append({"id": field_label.lower().replace(" ", "_").replace("&", "and"),
                        "label": field_label, "roles": field_roles})
    return out


def unknown_pick_ids() -> list[str]:
    """Template ids referenced here that the catalogue no longer has.

    Used by the tests/evals to catch a rename before a customer sees a role with
    two picks instead of three.
    """
    missing = []
    for _field, roles in _FIELDS:
        for _rid, _label, picks in roles:
            missing += [tid for tid, _why in picks if tid not in TEMPLATES]
    return sorted(set(missing))
