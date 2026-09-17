"""
Resume Builder PDF engine.

Templates:
  - "classic_professional": single column, bold all-caps section headers with
    a rule underneath, right-aligned dates — modeled on a traditional
    professional resume layout. (Generic / US-friendly.)
  - "modern_two_column": narrow left sidebar (contact / skills / education /
    certifications) + wide right column (summary / experience / projects).
  - "us_resume": American-market resume — left-aligned header, punchy accent
    rule, single column, no photo/DOB/personal details (standard US norm),
    optimized to fit one page.
  - "uk_cv": British-market CV — "Curriculum Vitae" kicker, Personal
    Statement, Key Skills, Employment History, Education & Qualifications,
    optional driving licence line, closes with a references note.
  - "europe_cv": Continental-European / Europass-style CV — includes a photo
    (initials avatar), a Personal Details block (nationality, date of birth,
    driving licence), and a Languages table — laid out in the sidebar +
    main-column structure used across most EU application portals.
  - "india_cv": Indian-market resume — centered header with photo avatar,
    Career Objective, education shown with percentage/CGPA emphasis, a
    Personal Details block (father's name, DOB, nationality, gender, marital
    status, languages known), and a closing signed Declaration — all
    conventional on resumes used in the Indian job market.

All templates are generated as real text PDFs (not flattened images), which
parses far better in real-world ATS systems than a screenshot-style export.
"""
import os
import re

from reportlab.lib.pagesizes import LETTER, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, BaseDocTemplate, PageTemplate, Frame, Flowable, FrameBreak,
    NextPageTemplate,
    Paragraph, Spacer, Table, TableStyle,
    ListFlowable, ListItem, HRFlowable, KeepInFrame,
)
from reportlab.graphics.shapes import Drawing, Circle, String

import threading

ACCENT = colors.HexColor("#12283A")
MINT = colors.HexColor("#2FBFA0")
MUTED = colors.HexColor("#5B6672")
LIGHT_RULE = colors.HexColor("#E2E4E8")
SIDEBAR_BG = colors.HexColor("#F4F6F8")

# ---------------------------------------------------------------------------
# Per-resume theming (colour / font / size)
# ---------------------------------------------------------------------------
# So the customer can restyle ANY template — accent colour, font family and
# overall size — we thread a small theme through style creation. It's held in
# a threadlocal (PDF builds are synchronous and CPU-bound; FastAPI may run two
# in different threads at once, so a plain module global would race).
_theme = threading.local()

_FONT_MAP = {
    "sans":  ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique"),
    "serif": ("Times-Roman", "Times-Bold", "Times-Italic"),
    "mono":  ("Courier", "Courier-Bold", "Courier-Oblique"),
}

# Register the bundled open-source TTFs (shipped in app/fonts) so the customer's
# font choice produces a genuinely different typeface in the PDF, not just a
# serif/sans swap. Anything that fails to register falls back to a base-14 font,
# so the engine still works even if a file is missing.
from reportlab.pdfbase import pdfmetrics as _pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as _TTFont
_FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
_REG = {}
for _fam, _reg_file, _bold_file in [
    ("Lato", "Lato-Regular.ttf", "Lato-Bold.ttf"),
    ("Carlito", "Carlito-Regular.ttf", "Carlito-Bold.ttf"),
    ("Caladea", "Caladea-Regular.ttf", "Caladea-Bold.ttf"),
    ("DejaVuSans", "DejaVuSans.ttf", "DejaVuSans-Bold.ttf"),
    ("DejaVuSerif", "DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf"),
    ("DejaVuMono", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"),
]:
    try:
        _pdfmetrics.registerFont(_TTFont(_fam, os.path.join(_FONT_DIR, _reg_file)))
        _pdfmetrics.registerFont(_TTFont(_fam + "-Bold", os.path.join(_FONT_DIR, _bold_file)))
        _REG[_fam] = True
    except Exception:
        _REG[_fam] = False


def _face(fam, fb):
    """(regular, bold, italic-as-regular) for a registered family, else fallback."""
    if _REG.get(fam):
        return (fam, fam + "-Bold", fam)
    return fb


_SANS = ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique")
_SERIF = ("Times-Roman", "Times-Bold", "Times-Italic")
_MONO = ("Courier", "Courier-Bold", "Courier-Oblique")

# 12 famous resume fonts (the UI id -> the best available PDF typeface). Where a
# font is proprietary (Arial, Calibri, Cambria, Georgia…) we map to an open,
# metric-close equivalent; the live preview uses the real font when the viewer
# has it.
_FONT_MAP.update({
    "helvetica":    _SANS,
    "arial":        _SANS,
    "times":        _SERIF,
    "calibri":      _face("Carlito", _SANS),
    "cambria":      _face("Caladea", _SERIF),
    "georgia":      _face("DejaVuSerif", _SERIF),
    "garamond":     _face("Caladea", _SERIF),
    "merriweather": _face("DejaVuSerif", _SERIF),
    "lato":         _face("Lato", _SANS),
    "roboto":       _face("DejaVuSans", _SANS),
    "opensans":     _face("Lato", _SANS),
    "montserrat":   _face("Lato", _SANS),
    "verdana":      _face("DejaVuSans", _SANS),
    "tahoma":       _face("DejaVuSans", _SANS),
})
# ===========================================================================
# TYPE SCALE — absolute point sizes, not multipliers
# ---------------------------------------------------------------------------
# The four presets are fixed body sizes in points. "Standard" means the body
# text measures exactly 10pt in every one of the templates, full stop. This
# replaced a multiplier ladder (1.15 … 1.55) which could not make that promise:
# each template declared its own body base, and those bases ranged from 6.3pt
# (Compact) to 10.0pt (Corporate Letter), so one preset printed 7.2pt in one
# template and 15.5pt in another. The multiplier was the bug.
#
# How it works: every template's type goes through _sz(). A template declares
# the body size its design was drawn at, via _set_type_base(); _sz() then maps
# that design's numbers onto the requested body size. Body text lands on the
# preset exactly, and the rest of the design follows in proportion.
BODY_PT = {"pt9": 9.0, "pt10": 10.0, "pt11": 11.0, "pt12": 12.0}
DEFAULT_BODY_PT = 10.0
# The ids the picker used to save. A résumé written before the presets became
# absolute must still open, so every retired id resolves to the nearest new
# preset rather than failing or silently reverting to the default.
_BODY_PT_ALIASES = {
    "small": "pt9", "xs": "pt9", "compact": "pt9",
    "standard": "pt10", "medium": "pt10",
    "large": "pt11",
    "xl": "pt12", "xxl": "pt12",
    # plain-language ids, in case the client sends the label
    "s": "pt9", "m": "pt10", "l": "pt11", "xxl_": "pt12",
    "9": "pt9", "10": "pt10", "11": "pt11", "12": "pt12",
    "9pt": "pt9", "10pt": "pt10", "11pt": "pt11", "12pt": "pt12",
}
# The body size a template's design was drawn at, when it doesn't say.
# 7.5pt is what most of the catalogue measures, so it's the safest default for
# any builder that forgets to declare one.
FALLBACK_TYPE_BASE = 7.5
# Display type — the name, and anything else set much larger than the body —
# grows more slowly than the body does. Scaling it linearly is what made a
# 12pt résumé print a 32pt name: at that size the name stops being a heading
# and starts being a poster. Damping keeps the hierarchy of each design intact
# while holding the name in the 22–25pt range a résumé actually wants.
#
# Damping starts at 1.4x the design's body size — above ordinary headings and
# leading, which still scale in full so line spacing stays honest — and reaches
# its full strength at 2.6x, which is roughly where names sit. The exponent is
# applied to the scale factor, not the size, so the curve is continuous: a
# value on the threshold scales identically either side of it.
DISPLAY_DAMP_FROM = 1.4
DISPLAY_DAMP_TO = 2.6
DISPLAY_DAMP_MIN_POWER = 0.45


def _set_theme(accent=None, font_family=None, font_size=None):
    """Set the active theme for the current build. accent = hex string;
    font_family in {sans,serif,mono}; font_size a scale (number) or a named
    size (small/standard/large)."""
    try:
        _theme.accent = colors.HexColor(accent) if accent else ACCENT
    except Exception:
        _theme.accent = ACCENT
    fam = (font_family or "sans").lower()
    _theme.fonts = _FONT_MAP.get(fam, _FONT_MAP["sans"])
    _theme.body_pt = _resolve_body_pt(font_size)
    # Every build starts from the fallback base; the template's own style
    # factory declares its real one. Without the reset, a base left behind by
    # the previous build in the same process would size this one.
    _theme.base_pt = FALLBACK_TYPE_BASE


def _resolve_body_pt(font_size) -> float:
    """The requested body size in points, from a preset id or a bare number."""
    if isinstance(font_size, (int, float)):
        pt = float(font_size)
    elif isinstance(font_size, str) and font_size.strip():
        s = font_size.strip().lower()
        key = _BODY_PT_ALIASES.get(s, s)
        pt = BODY_PT.get(key)
        if pt is None:
            try:
                pt = float(s)
            except ValueError:
                pt = DEFAULT_BODY_PT
    else:
        pt = DEFAULT_BODY_PT
    # A number small enough to be one of the old multipliers is one: a saved
    # résumé carrying 1.27 wants a readable size, not 1.27pt type.
    if pt <= 3.0:
        pt = DEFAULT_BODY_PT
    return max(7.0, min(14.0, pt))


def _set_type_base(body_pt: float):
    """Declare the body size this template's design was drawn at.

    Called at the top of each template's style factory. Everything the factory
    then measures with _sz() is read as a proportion of this number, so the
    design keeps its own hierarchy while its body text lands exactly on the
    customer's chosen preset.
    """
    try:
        _theme.base_pt = max(4.0, float(body_pt))
    except (TypeError, ValueError):
        _theme.base_pt = FALLBACK_TYPE_BASE


def _reset_theme():
    _theme.accent = ACCENT
    _theme.fonts = _FONT_MAP["sans"]
    _theme.body_pt = DEFAULT_BODY_PT
    _theme.base_pt = FALLBACK_TYPE_BASE


def _acc():
    return getattr(_theme, "accent", ACCENT)


def _fonts():
    return getattr(_theme, "fonts", _FONT_MAP["sans"])


def _sz(v):
    """Map a size from the template's own design onto the chosen body preset.

    `v` is whatever the design measured — a font size, a leading, a spacer, an
    indent. It is read as a proportion of the design's body size, so a value
    equal to the base comes out as the preset exactly: that is the guarantee
    that "Standard" means 10pt body text in all 40 templates.

    Display type is damped. Everything up to 1.4x the base scales in full, so
    headings, leading and spacing keep their relationship to the body text.
    Above that the scale factor is raised to a power that falls to 0.45, so a
    name drawn at 20pt against a 7.5pt body grows to about 22pt at the 9pt
    preset and 25pt at the 12pt preset, rather than 24pt and 32pt. The power is
    applied to the factor rather than the size, which keeps the curve
    continuous — a value sitting exactly on the threshold scales the same from
    either side — and monotonic, so a larger design value always prints larger.
    """
    base = getattr(_theme, "base_pt", FALLBACK_TYPE_BASE) or FALLBACK_TYPE_BASE
    body = getattr(_theme, "body_pt", DEFAULT_BODY_PT) or DEFAULT_BODY_PT
    scale = body / base
    try:
        v = float(v)
    except (TypeError, ValueError):
        return v
    if scale == 1.0 or v <= 0:
        return round(v, 2)
    knee = base * DISPLAY_DAMP_FROM
    if v <= knee:
        return round(v * scale, 2)
    span = base * (DISPLAY_DAMP_TO - DISPLAY_DAMP_FROM)
    t = min(1.0, (v - knee) / span) if span > 0 else 1.0
    power = 1.0 - (1.0 - DISPLAY_DAMP_MIN_POWER) * t
    return round(v * (scale ** power), 2)


def _lines(text: str) -> list[str]:
    if not text:
        return []
    return [l.strip() for l in text.split("\n") if l.strip()]


def _esc_pdf(text) -> str:
    """Escape user text for ReportLab's mini-HTML paragraph parser.

    Paragraph() treats its input as markup, so a bare "&" or "<" in a resume
    ("Data Analysis & Visualisation", "C++ < C#") either renders wrong or
    raises. Templates that inject their own tags (bold prefixes, coloured
    runs) must escape the user's text before concatenating.
    """
    return (str(text or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def parse_entries(block_text: str) -> list[dict]:
    """Parse a '---'-separated textarea into entries with a header line
    (pipe-separated parts) and following '-' bullet lines.

    NOTHING IS EVER DROPPED. This used to keep the first line as the header,
    keep any line starting with "-" as a bullet, and silently discard
    everything else — so a Projects section typed as three plain lines
    printed as one project and the other two disappeared from the PDF. The
    person could see them in the editor and not in their résumé, which is the
    worst possible place to lose someone's work.

    A line with no "-" is read one of two ways, depending on what else is in
    the block:

      no bullets anywhere in the block   each line is its own entry — this is
                                         a list (three projects, three
                                         certifications) typed without
                                         separators, and that is what it means
      the block already has bullets      the loose line is a continuation of
                                         this entry and becomes a bullet, the
                                         same repair _ensure_bullet_prefixes()
                                         already makes to model output

    Either way the text reaches the page."""
    if not block_text:
        return []
    blocks = [b.strip() for b in block_text.split("\n---\n") if b.strip()]
    entries = []
    for b in blocks:
        raw_lines = [l for l in b.split("\n") if l.strip()]
        if not raw_lines:
            continue
        rest = raw_lines[1:]
        has_bullets = any(l.strip().startswith("-") for l in rest)
        if rest and not has_bullets:
            # A list typed on consecutive lines: every line is an entry.
            for line in raw_lines:
                entries.append({"parts": [p.strip() for p in line.split("|")], "bullets": []})
            continue
        header = raw_lines[0]
        parts = [p.strip() for p in header.split("|")]
        bullets = [l.strip()[1:].strip() if l.strip().startswith("-") else l.strip()
                   for l in rest]
        entries.append({"parts": parts, "bullets": bullets})
    return entries


def _get_styles():
    _set_type_base(9.5)   # the body size this design was drawn at
    base = getSampleStyleSheet()
    acc = _acc()
    reg, bold, ital = _fonts()
    styles = {
        "name": ParagraphStyle("name", parent=base["Title"], fontSize=_sz(22), leading=_sz(26),
                                textColor=acc, spaceAfter=2, alignment=TA_LEFT, fontName=bold),
        "title": ParagraphStyle("title", parent=base["Normal"], fontSize=_sz(11.5), leading=_sz(14),
                                 textColor=MUTED, spaceAfter=4, fontName=reg),
        "contact": ParagraphStyle("contact", parent=base["Normal"], fontSize=_sz(9), leading=_sz(12),
                                   textColor=MUTED, spaceAfter=2, fontName=reg),
        "heading": ParagraphStyle("heading", parent=base["Normal"], fontSize=_sz(11.5), leading=_sz(14),
                                   textColor=acc, spaceBefore=_sz(10), spaceAfter=3, fontName=bold),
        "body": ParagraphStyle("body", parent=base["Normal"], fontSize=_sz(9.5), leading=_sz(13.5), spaceAfter=2, fontName=reg),
        "entry_title": ParagraphStyle("entry_title", parent=base["Normal"], fontSize=_sz(10), leading=_sz(13),
                                       fontName=bold),
        "entry_sub": ParagraphStyle("entry_sub", parent=base["Normal"], fontSize=_sz(9.5), leading=_sz(12),
                                     textColor=MUTED, fontName=reg),
        "entry_date": ParagraphStyle("entry_date", parent=base["Normal"], fontSize=_sz(9), leading=_sz(12),
                                      textColor=MUTED, alignment=2, fontName=reg),  # right
        "bullet": ParagraphStyle("bullet", parent=base["Normal"], fontSize=_sz(9.5), leading=_sz(13), fontName=reg),
    }
    return styles


def _section(title: str, flowables: list, styles) -> list:
    if not flowables:
        return []
    return [
        Paragraph(title.upper(), styles["heading"]),
        HRFlowable(width="100%", thickness=0.75, color=_acc(), spaceAfter=5),
        *flowables,
    ]


def _bullets(items: list, styles) -> list:
    if not items:
        return []
    return [ListFlowable(
        [ListItem(Paragraph(_esc_pdf(item), styles["bullet"]), leftIndent=6) for item in items],
        bulletType="bullet", start="•", leftIndent=12, bulletFontSize=7,
    ), Spacer(1, 4)]


def _paragraph_or_bullets(text: str, styles) -> list:
    lines = _lines(text)
    if not lines:
        return []
    if any(l.startswith("-") for l in lines):
        return _bullets([l.lstrip("- ").strip() for l in lines], styles)
    return [Paragraph(_esc_pdf(" ".join(lines)), styles["body"]), Spacer(1, 4)]


def _skills_flowables(skills_text: str, styles) -> list:
    out = []
    for line in _lines(skills_text):
        if ":" in line:
            category, items = line.split(":", 1)
            out.append(Paragraph(f"<b>{_esc_pdf(category.strip())}:</b> {_esc_pdf(items.strip())}", styles["body"]))
        else:
            out.append(Paragraph(_esc_pdf(line), styles["body"]))
    if out:
        out.append(Spacer(1, 4))
    return out


def _entries_flowables(entries: list, styles, kind: str, total_width=6.2 * inch) -> list:
    """Renders experience/education/project entries. `total_width` MUST match
    the actual available width of whatever column this is being placed into
    (single-column page, or one side of a two-column layout) — the header
    row uses a Table internally to right-align the date, and a Table's
    column widths are absolute, not auto-fit, so passing the wrong width
    here causes it to overflow into neighboring content."""
    date_col = min(1.6 * inch, total_width * 0.28)
    title_col = total_width - date_col
    out = []
    for entry in entries:
        parts = entry["parts"]
        if kind == "experience":
            title, company, location, dates = (parts + ["", "", "", ""])[:4]
            left = (f"{_esc_pdf(title)}" + (f", {_esc_pdf(company)}" if company else "")
                    + (f" — {_esc_pdf(location)}" if location else ""))
            row = Table([[Paragraph(left, styles["entry_title"]), Paragraph(_esc_pdf(dates), styles["entry_date"])]],
                        colWidths=[title_col, date_col])
        elif kind == "education":
            degree, institution, dates = (parts + ["", "", ""])[:3]
            left = _esc_pdf(degree) + (f" — {_esc_pdf(institution)}" if institution else "")
            row = Table([[Paragraph(left, styles["entry_title"]), Paragraph(_esc_pdf(dates), styles["entry_date"])]],
                        colWidths=[title_col, date_col])
        else:  # projects — single block, no date column, so just a plain Paragraph
            name_desc = parts[0] if parts else ""
            row = Paragraph(_esc_pdf(name_desc), styles["entry_title"])
        if isinstance(row, Table):
            row.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]))
        block = [row]
        if entry["bullets"]:
            block.append(Spacer(1, 1))
            block += _bullets(entry["bullets"], styles)
        else:
            block.append(Spacer(1, 5))
        out.extend(block)
    return out


def _header_block(data: dict, styles, centered: bool) -> list:
    align = TA_CENTER if centered else TA_LEFT
    name_style = ParagraphStyle("name2", parent=styles["name"], alignment=align)
    title_style = ParagraphStyle("title2", parent=styles["title"], alignment=align)
    contact_style = ParagraphStyle("contact2", parent=styles["contact"], alignment=align)

    out = [Paragraph(_esc_pdf(data.get("full_name", "")), name_style)]
    if data.get("title"):
        out.append(Paragraph(_esc_pdf(data["title"]), title_style))
    contact_bits = [b for b in [data.get("location"), data.get("phone"), data.get("email")] if b]
    if contact_bits:
        out.append(Paragraph(" &nbsp;|&nbsp; ".join(_esc_pdf(b) for b in contact_bits), contact_style))
    link_bits = [b for b in [data.get("linkedin"), data.get("website")] if b]
    if link_bits:
        out.append(Paragraph(" &nbsp;|&nbsp; ".join(_esc_pdf(b) for b in link_bits), contact_style))
    out.append(Spacer(1, 8))
    return out


def _main_sections(data: dict, styles, total_width=6.2 * inch) -> list:
    story = []
    story += _section("Professional Summary", _paragraph_or_bullets(data.get("summary", ""), styles), styles)
    story += _section("Professional Experience",
                       _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", total_width), styles)
    story += _section("Selected Projects",
                       _entries_flowables(parse_entries(data.get("projects", "")), styles, "projects", total_width), styles)
    story += _section("Publications", _bullets(_lines(data.get("publications", "")), styles), styles)
    return story


def _side_sections(data: dict, styles, total_width=6.2 * inch) -> list:
    story = []
    story += _section("Technical Skills", _skills_flowables(data.get("skills", ""), styles), styles)
    story += _section("Education",
                       _entries_flowables(parse_entries(data.get("education", "")), styles, "education", total_width), styles)
    story += _section("Certifications", _bullets(_lines(data.get("certifications", "")), styles), styles)
    return story


def _avatar_drawing(initials: str, size: float = 0.72 * inch, bg=ACCENT, fg=colors.white) -> Drawing:
    """A small circular initials avatar, used as a lightweight stand-in for a
    photo on templates where one is conventional (EU, India) — keeps the PDF
    fully text-based (no embedded binary image needed) while still giving
    the resume the expected visual anchor in that top corner."""
    d = Drawing(size, size)
    r = size / 2
    d.add(Circle(r, r, r - 1, fillColor=bg, strokeColor=bg))
    letters = (initials or "").strip().upper()[:2] or "•"
    d.add(String(r, r - 5, letters, fontName="Helvetica-Bold", fontSize=size * 0.32,
                 fillColor=fg, textAnchor="middle"))
    return d


def _personal_details_flowables(data: dict, styles, fields: list) -> list:
    """Renders a compact 'label: value' block for regional personal-detail
    conventions (DOB, nationality, marital status, father's name, etc.).
    `fields` is a list of (label, data_key) pairs; blank values are skipped."""
    rows = []
    for label, key in fields:
        val = data.get(key)
        if val:
            rows.append(Paragraph(f"<b>{_esc_pdf(label)}:</b> {_esc_pdf(val)}", styles["body"]))
    return rows


def _languages_table_flowables(languages_text: str, styles, total_width=2.2 * inch) -> list:
    """Parses 'Language — Proficiency' (or 'Language: Proficiency') lines
    into a compact two-column table, matching how Europass-style CVs and
    most professional CVs present language ability. `total_width` must
    match the actual column this renders into (see _entries_flowables)."""
    rows = []
    for line in _lines(languages_text):
        for sep in ["—", "-", ":"]:
            if sep in line:
                lang, level = line.split(sep, 1)
                rows.append([Paragraph(_esc_pdf(lang.strip()), styles["entry_title"]),
                             Paragraph(_esc_pdf(level.strip()), styles["entry_sub"])])
                break
        else:
            rows.append([Paragraph(_esc_pdf(line.strip()), styles["entry_title"]), Paragraph("", styles["entry_sub"])])
    if not rows:
        return []
    half = total_width / 2
    t = Table(rows, colWidths=[half, half])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return [t, Spacer(1, 4)]


def build_classic_professional(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                             topMargin=0.55 * inch, bottomMargin=0.55 * inch,
                             leftMargin=0.65 * inch, rightMargin=0.65 * inch,
                             title=data.get("full_name", "Resume"))
    story = _header_block(data, styles, centered=True)
    story += _main_sections(data, styles, total_width=7.0 * inch)
    story += _side_sections(data, styles, total_width=7.0 * inch)
    doc.build(story)


def build_modern_two_column(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                             topMargin=0.55 * inch, bottomMargin=0.55 * inch,
                             leftMargin=0.55 * inch, rightMargin=0.55 * inch,
                             title=data.get("full_name", "Resume"))

    header = _header_block(data, styles, centered=False)
    left_col = _side_sections(data, styles, total_width=1.7 * inch)
    right_col = _main_sections(data, styles, total_width=4.55 * inch)

    # A real Table (not KeepInFrame) lets the row grow to whatever height
    # the content actually needs — spilling onto a second page if it runs
    # long, same as any other multi-page document — instead of forcibly
    # shrinking one column to fit, which was producing mismatched font
    # sizes and misaligned column tops between the sidebar and main
    # column. The shaded sidebar background makes an uneven column height
    # look intentional (a real sidebar) rather than like a layout bug.
    body_table = Table([[left_col, right_col]], colWidths=[2.1 * inch, 5.05 * inch])
    body_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SIDEBAR_BG),
        ("LEFTPADDING", (0, 0), (0, 0), 14), ("RIGHTPADDING", (0, 0), (0, 0), 12),
        ("TOPPADDING", (0, 0), (0, 0), 16), ("BOTTOMPADDING", (0, 0), (0, 0), 16),
        ("LEFTPADDING", (1, 0), (1, 0), 18), ("RIGHTPADDING", (1, 0), (1, 0), 2),
        ("TOPPADDING", (1, 0), (1, 0), 16), ("BOTTOMPADDING", (1, 0), (1, 0), 16),
        ("LINEAFTER", (0, 0), (0, 0), 0.75, LIGHT_RULE),
    ]))

    story = header + [Spacer(1, 8), body_table]
    doc.build(story)


# ---------------------------------------------------------------------------
# US Resume — left-aligned header, no photo/DOB/personal details (the US
# norm — including those invites equal-opportunity/legal risk and is
# generally omitted), tuned to read cleanly to both a human and an ATS
# parser on one page.
# ---------------------------------------------------------------------------
def build_us_resume(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                             topMargin=0.6 * inch, bottomMargin=0.5 * inch,
                             leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                             title=data.get("full_name", "Resume"))
    story = _header_block(data, styles, centered=False)
    quick_facts = _personal_details_flowables(data, styles, [
        ("Expected Salary", "expected_salary"), ("Notice Period", "notice_period"),
        ("Visa / Work Authorization", "visa_status"),
    ])
    if quick_facts:
        story += quick_facts
        story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.5, color=MINT, spaceAfter=8))
    story += _main_sections(data, styles, total_width=6.9 * inch)
    story += _side_sections(data, styles, total_width=6.9 * inch)
    footer_note = data.get("references_note")
    if footer_note:
        story.append(Spacer(1, 6))
        story.append(Paragraph(footer_note, styles["contact"]))
    doc.build(story)


# ---------------------------------------------------------------------------
# Europe / Europass-style CV — photo avatar, Personal Details block
# (nationality, date of birth, driving licence), Languages table, laid out
# as a narrow sidebar + wide main column, matching the structure used across
# most continental-European application portals and Europass exports.
# ---------------------------------------------------------------------------
def build_europe_cv(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             topMargin=14 * mm, bottomMargin=14 * mm,
                             leftMargin=14 * mm, rightMargin=14 * mm,
                             title=data.get("full_name", "CV"))

    name_style = ParagraphStyle("eu_name", parent=styles["name"], alignment=TA_LEFT, fontSize=20)
    title_style = ParagraphStyle("eu_title", parent=styles["title"], alignment=TA_LEFT)
    header_left = [Paragraph(_esc_pdf(data.get("full_name", "")), name_style)]
    if data.get("title"):
        header_left.append(Paragraph(_esc_pdf(data["title"]), title_style))
    contact_bits = [b for b in [data.get("location"), data.get("phone"), data.get("email")] if b]
    if contact_bits:
        header_left.append(Paragraph(" &nbsp;|&nbsp; ".join(_esc_pdf(b) for b in contact_bits), styles["contact"]))

    avatar = _avatar_drawing(data.get("photo_initials") or "".join(w[0] for w in (data.get("full_name") or "?").split()[:2]))
    header_table = Table([[header_left, avatar]], colWidths=[5.6 * inch, 0.9 * inch])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    personal_details = _personal_details_flowables(data, styles, [
        ("Nationality", "nationality"),
        ("Date of Birth", "date_of_birth"),
        ("Driving Licence", "driving_license"),
        ("Visa / Work Permit", "visa_status"),
    ])
    left_col = []
    left_col += _section("Personal Details", personal_details, styles)
    left_col += _section("Languages", _languages_table_flowables(data.get("languages", ""), styles, total_width=1.6 * inch), styles)
    left_col += _side_sections(data, styles, total_width=1.6 * inch)

    right_col = _main_sections(data, styles, total_width=4.55 * inch)

    body_table = Table([[left_col, right_col]], colWidths=[2.0 * inch, 4.9 * inch])
    body_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SIDEBAR_BG),
        ("LEFTPADDING", (0, 0), (0, 0), 12), ("RIGHTPADDING", (0, 0), (0, 0), 10),
        ("TOPPADDING", (0, 0), (0, 0), 12), ("BOTTOMPADDING", (0, 0), (0, 0), 12),
        ("LEFTPADDING", (1, 0), (1, 0), 16), ("RIGHTPADDING", (1, 0), (1, 0), 2),
        ("TOPPADDING", (1, 0), (1, 0), 12), ("BOTTOMPADDING", (1, 0), (1, 0), 12),
        ("LINEAFTER", (0, 0), (0, 0), 0.75, LIGHT_RULE),
    ]))

    story = [header_table, Spacer(1, 10), body_table]
    doc.build(story)


# ---------------------------------------------------------------------------
# India Resume — centered header with photo avatar, Career Objective,
# education with percentage/CGPA emphasis, Personal Details block (father's
# name, DOB, nationality, gender, marital status, languages known), and a
# closing signed Declaration — all conventional on resumes used in the
# Indian job market.
# ---------------------------------------------------------------------------
def build_india_cv(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             topMargin=14 * mm, bottomMargin=14 * mm,
                             leftMargin=16 * mm, rightMargin=16 * mm,
                             title=data.get("full_name", "Resume"))

    avatar = _avatar_drawing(data.get("photo_initials") or "".join(w[0] for w in (data.get("full_name") or "?").split()[:2]),
                              size=0.85 * inch)
    header_center = _header_block(data, styles, centered=True)
    header_table = Table([[avatar, header_center]], colWidths=[1.0 * inch, 5.5 * inch])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    story = [header_table]
    story.append(HRFlowable(width="100%", thickness=1, color=ACCENT, spaceBefore=6, spaceAfter=8))

    story += _section("Career Objective", _paragraph_or_bullets(data.get("summary", ""), styles), styles)
    story += _section("Technical Skills", _skills_flowables(data.get("skills", ""), styles), styles)
    story += _section("Work Experience",
                       _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", 6.9 * inch), styles)
    story += _section("Academic Qualifications",
                       _entries_flowables(parse_entries(data.get("education", "")), styles, "education", 6.9 * inch), styles)
    story += _section("Projects",
                       _entries_flowables(parse_entries(data.get("projects", "")), styles, "projects", 6.9 * inch), styles)
    story += _section("Certifications", _bullets(_lines(data.get("certifications", "")), styles), styles)

    personal_details = _personal_details_flowables(data, styles, [
        ("Father's Name", "father_name"),
        ("Date of Birth", "date_of_birth"),
        ("Nationality", "nationality"),
        ("Gender", "gender"),
        ("Marital Status", "marital_status"),
        ("Languages Known", "languages"),
    ])
    story += _section("Personal Details", personal_details, styles)

    declaration = data.get("declaration") or (
        "I hereby declare that the above information is true to the best of my knowledge and belief."
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph(declaration, styles["body"]))
    story.append(Spacer(1, 18))
    sig_row = Table([[Paragraph("Date: ____________________", styles["body"]),
                       Paragraph(f"Signature: ({data.get('full_name', '')})", styles["body"])]],
                     colWidths=[3.2 * inch, 3.2 * inch])
    sig_row.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(sig_row)
    doc.build(story)


# ---------------------------------------------------------------------------
# Canada Resume — left-aligned header with a full-width navy underline,
# pill-style section headers, single column, no photo/DOB (Canadian norm
# mirrors the US on this). Closes with a references note per convention.
# ---------------------------------------------------------------------------
def _pill_section_header(title: str, styles) -> Table:
    t = Table([[Paragraph(f"<b>{title.upper()}</b>", ParagraphStyle(
        "pill", parent=styles["body"], textColor=colors.white, fontSize=9.5))]], colWidths=[1.8 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _pill_section(title: str, flowables: list, styles) -> list:
    if not flowables:
        return []
    return [Spacer(1, 6), _pill_section_header(title, styles), Spacer(1, 5), *flowables]


def build_canada_resume(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                             topMargin=0.6 * inch, bottomMargin=0.5 * inch,
                             leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                             title=data.get("full_name", "Resume"))
    story = _header_block(data, styles, centered=False)
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceAfter=6))
    story += _pill_section("Professional Summary", _paragraph_or_bullets(data.get("summary", ""), styles), styles)
    story += _pill_section("Core Competencies", _skills_flowables(data.get("skills", ""), styles), styles)
    story += _pill_section("Professional Experience",
                            _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", 6.9 * inch), styles)
    story += _pill_section("Education",
                            _entries_flowables(parse_entries(data.get("education", "")), styles, "education", 6.9 * inch), styles)
    story += _pill_section("Projects",
                            _entries_flowables(parse_entries(data.get("projects", "")), styles, "projects", 6.9 * inch), styles)
    story += _pill_section("Certifications", _bullets(_lines(data.get("certifications", "")), styles), styles)
    footer_note = data.get("references_note") or "References available upon request."
    story.append(Spacer(1, 8))
    story.append(Paragraph(footer_note, styles["contact"]))
    doc.build(story)


# ---------------------------------------------------------------------------
# Middle East / Gulf CV — photo avatar, Personal Details surfaced near the
# TOP (nationality, date of birth, marital status, gender, visa/passport
# status) rather than the bottom — a distinguishing convention for the Gulf
# region, where this information is expected upfront. Single column below.
# ---------------------------------------------------------------------------
def build_middle_east_cv(data: dict, output_path: str):
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             topMargin=14 * mm, bottomMargin=14 * mm,
                             leftMargin=16 * mm, rightMargin=16 * mm,
                             title=data.get("full_name", "CV"))

    avatar = _avatar_drawing(data.get("photo_initials") or "".join(w[0] for w in (data.get("full_name") or "?").split()[:2]))
    header_center = _header_block(data, styles, centered=False)
    header_table = Table([[header_center, avatar]], colWidths=[5.5 * inch, 1.0 * inch])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [header_table]
    story.append(HRFlowable(width="100%", thickness=1, color=ACCENT, spaceBefore=6, spaceAfter=8))

    personal_details = _personal_details_flowables(data, styles, [
        ("Nationality", "nationality"), ("Date of Birth", "date_of_birth"),
        ("Gender", "gender"), ("Marital Status", "marital_status"),
        ("Passport / Visa Status", "passport_status"), ("Visa / Work Permit", "visa_status"),
        ("Languages", "languages"),
    ])
    story += _section("Personal Details", personal_details, styles)
    story += _section("Career Objective", _paragraph_or_bullets(data.get("summary", ""), styles), styles)
    story += _section("Key Skills", _skills_flowables(data.get("skills", ""), styles), styles)
    story += _section("Work Experience",
                       _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", 6.9 * inch), styles)
    story += _section("Education",
                       _entries_flowables(parse_entries(data.get("education", "")), styles, "education", 6.9 * inch), styles)
    story += _section("Certifications", _bullets(_lines(data.get("certifications", "")), styles), styles)
    doc.build(story)


# ===========================================================================
# Additional layouts.
#
# These cover the archetypes people actually pick between — where the
# emphasis sits (achievements vs experience), whether there's a photo, and
# whether the page is one column or two. They reuse the same section
# helpers as the originals, so a change to how experience or skills render
# flows through every template rather than needing seven edits.
# ===========================================================================
DARK_PANEL = colors.HexColor("#1F2C3D")
TEAL_PANEL = colors.HexColor("#12564C")
SOFT_TINT = colors.HexColor("#EEF3F8")


def _panel_para(text, size=8.4, color=colors.white, bold=False, leading=None, space=2):
    """Paragraph styled for a dark sidebar panel."""
    st = ParagraphStyle(
        f"panel{size}{bold}{color}", fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size, leading=leading or size + 3.2, textColor=color, spaceAfter=space,
    )
    return Paragraph(text, st)


def _panel_heading(text):
    return _panel_para(text.upper(), size=8.6, bold=True, color=colors.HexColor("#9FB3C8"), space=5)


def _dark_panel_content(data: dict) -> list:
    """Achievements / skills / courses / passions column for the dark-sidebar
    templates. Only sections with real content are emitted, so a sparse
    resume doesn't render a column of empty headings."""
    out = []
    ach = _lines(data.get("achievements", "") or "")
    if ach:
        out.append(_panel_heading("Achievements"))
        for a in ach[:6]:
            if ":" in a:
                head, body = a.split(":", 1)
                out.append(_panel_para(_esc_pdf(head.strip()), size=8.6, bold=True, space=1))
                out.append(_panel_para(_esc_pdf(body.strip()), size=7.8, color=colors.HexColor("#C6D2DF"), space=7))
            else:
                out.append(_panel_para(_esc_pdf(a), size=8.2, color=colors.HexColor("#C6D2DF"), space=6))
    skills = _lines(data.get("skills", "") or "")
    if skills:
        out.append(Spacer(1, 6))
        out.append(_panel_heading("Skills"))
        for line in skills[:8]:
            out.append(_panel_para(_esc_pdf(line), size=7.9, color=colors.HexColor("#C6D2DF"), space=4))
    education = parse_entries(data.get("education", "") or "")
    if education:
        out.append(Spacer(1, 6))
        out.append(_panel_heading("Education"))
        for entry in education[:4]:
            degree, institution, dates = (entry["parts"] + ["", "", ""])[:3]
            head = _esc_pdf(degree) + (f" — {_esc_pdf(institution)}" if institution else "")
            out.append(_panel_para(head, size=8.2, bold=True, color=colors.HexColor("#C6D2DF"), space=1))
            if dates:
                out.append(_panel_para(_esc_pdf(dates), size=7.6, color=colors.HexColor("#C6D2DF"), space=6))
    courses = _lines(data.get("certifications", "") or "")
    if courses:
        out.append(Spacer(1, 6))
        out.append(_panel_heading("Courses & Certifications"))
        for cline in courses[:6]:
            out.append(_panel_para(_esc_pdf(cline), size=7.9, color=colors.HexColor("#C6D2DF"), space=4))
    langs = _lines(data.get("languages", "") or "")
    if langs:
        out.append(Spacer(1, 6))
        out.append(_panel_heading("Languages"))
        for l in langs[:6]:
            out.append(_panel_para(_esc_pdf(l), size=7.9, color=colors.HexColor("#C6D2DF"), space=4))
    return out or [_panel_para("", size=8)]


def _sidebar_template(data: dict, output_path: str, panel_colour, panel_on_right: bool):
    """Shared implementation for the dark-panel layouts — the only real
    difference between them is the panel's colour and which side it sits on,
    so they share one code path rather than being copy-pasted."""
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            title=data.get("full_name", "Resume"))
    main = _header_block(data, styles, centered=False) + [Spacer(1, 6)] + \
           _main_sections(data, styles, total_width=4.6 * inch)
    panel = _dark_panel_content(data)
    cols = [2.05 * inch, 5.05 * inch]
    row = [panel, main] if not panel_on_right else [main, panel]
    if panel_on_right:
        cols = [5.05 * inch, 2.05 * inch]
    panel_idx = 1 if panel_on_right else 0
    t = Table([row], colWidths=cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (panel_idx, 0), (panel_idx, -1), panel_colour),
        ("LEFTPADDING", (panel_idx, 0), (panel_idx, 0), 13),
        ("RIGHTPADDING", (panel_idx, 0), (panel_idx, 0), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
        ("LEFTPADDING", (1 - panel_idx, 0), (1 - panel_idx, 0), 16 if panel_on_right else 18),
        ("RIGHTPADDING", (1 - panel_idx, 0), (1 - panel_idx, 0), 16),
    ]))
    doc.build([t])


def build_executive_sidebar(data: dict, output_path: str):
    """Dark navy panel on the right carrying achievements and skills, with
    experience leading on the left. Suits senior roles where the wins matter
    as much as the history."""
    _sidebar_template(data, output_path, DARK_PANEL, panel_on_right=True)


def build_teal_sidebar(data: dict, output_path: str):
    """Deep-teal panel on the left — same structure, calmer palette, and the
    achievements read first."""
    _sidebar_template(data, output_path, TEAL_PANEL, panel_on_right=False)


def build_header_band(data: dict, output_path: str):
    """Full-width dark header band with the name reversed out of it, then a
    conventional two-column body. High contrast at the top without colouring
    the whole page."""
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.42 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            title=data.get("full_name", "Resume"))
    name = _panel_para(_esc_pdf(data.get("full_name", "")), size=19, bold=True, leading=23, space=2)
    title = _panel_para(_esc_pdf(data.get("title", "") or ""), size=9.6,
                        color=colors.HexColor("#9FB3C8"), space=6)
    contact_bits = [b for b in [data.get("phone"), data.get("email"), data.get("location"),
                                data.get("linkedin"), data.get("website")] if b]
    contact = _panel_para("  •  ".join(_esc_pdf(b) for b in contact_bits), size=8, color=colors.HexColor("#C6D2DF"), space=0)
    band = Table([[[name, title, contact]]], colWidths=[7.1 * inch])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK_PANEL),
        ("LEFTPADDING", (0, 0), (-1, -1), 22), ("RIGHTPADDING", (0, 0), (-1, -1), 22),
        ("TOPPADDING", (0, 0), (-1, -1), 18), ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
    ]))
    left = _main_sections(data, styles, total_width=4.5 * inch)
    right = _side_sections(data, styles, total_width=2.0 * inch)
    body = Table([[left, right]], colWidths=[4.85 * inch, 2.25 * inch])
    body.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 16),
        ("LEFTPADDING", (1, 0), (1, 0), 14), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("LINEBEFORE", (1, 0), (1, 0), 0.75, LIGHT_RULE),
    ]))
    doc.build([band, Spacer(1, 4), body])


def build_centered_minimal(data: dict, output_path: str):
    """Centred name, hairline rules, generous spacing, single column. The
    most conservative option here and the safest for strict ATS parsers."""
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.62 * inch, bottomMargin=0.6 * inch,
                            leftMargin=0.78 * inch, rightMargin=0.78 * inch,
                            title=data.get("full_name", "Resume"))
    story = _header_block(data, styles, centered=True)
    story.append(HRFlowable(width="100%", thickness=0.9, color=ACCENT, spaceBefore=6, spaceAfter=10))
    story += _main_sections(data, styles, total_width=6.9 * inch)
    story += _side_sections(data, styles, total_width=6.9 * inch)
    doc.build(story)


def build_tinted_sidebar(data: dict, output_path: str):
    """Light tinted sidebar rather than a dark panel — softer, and prints
    cleanly on a mono printer where a dark block turns into a grey slab."""
    styles = _get_styles()
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            title=data.get("full_name", "Resume"))
    header = _header_block(data, styles, centered=False)
    left = _side_sections(data, styles, total_width=2.0 * inch)
    right = _main_sections(data, styles, total_width=4.5 * inch)
    t = Table([[left, right]], colWidths=[2.3 * inch, 4.8 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_TINT),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ("LEFTPADDING", (0, 0), (0, 0), 14), ("RIGHTPADDING", (0, 0), (0, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 15), ("BOTTOMPADDING", (0, 0), (-1, -1), 15),
        ("LEFTPADDING", (1, 0), (1, 0), 18), ("RIGHTPADDING", (1, 0), (1, 0), 2),
    ]))
    doc.build(header + [Spacer(1, 8), t])


def build_compact_dense(data: dict, output_path: str):
    """Tighter margins and leading for people with a lot of history who
    still want one page. Same sections, less air."""
    styles = _get_styles()
    for key in ("body", "bullet", "entry_sub"):
        if key in styles:
            styles[key].leading = max(9.5, styles[key].fontSize + 2.0)
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.4 * inch, bottomMargin=0.4 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            title=data.get("full_name", "Resume"))
    left = _main_sections(data, styles, total_width=4.35 * inch)
    right = _side_sections(data, styles, total_width=2.1 * inch)
    body = Table([[left, right]], colWidths=[4.6 * inch, 2.5 * inch])
    body.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 14),
        ("LEFTPADDING", (1, 0), (1, 0), 14), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("LINEBEFORE", (1, 0), (1, 0), 0.75, LIGHT_RULE),
    ]))
    story = _header_block(data, styles, centered=False)
    story.append(HRFlowable(width="100%", thickness=1.4, color=ACCENT, spaceBefore=4, spaceAfter=8))
    story.append(body)
    doc.build(story)


# ===========================================================================
# HARVARD CLASSIC
# ---------------------------------------------------------------------------
# A faithful rebuild of the uploaded 01_Harvard_Classic.pdf. Geometry was
# measured off that file rather than eyeballed, so the numbers below are
# deliberately odd:
#
#   page          A4, 595 x 842 pt
#   frame         hairline rectangle inset 9.8pt from every edge
#   text column   x 14.4 -> 579.7  (a very tight 0.2" margin)
#   name          16.7pt bold, centred, upper-case
#   contact       6.9pt, centred, " | " separated, wraps to a second line
#   section head  8.6pt bold upper-case, with a 0.58pt rule ~10pt below it
#   entry head    8.1pt bold left, dates right-aligned on the same line
#   entry meta    7.5pt italic (location / institution)
#   bullets       8.1pt, indented 10.3pt, no glyph, wraps stay on the indent
#   skills        two columns: 7.5pt bold label (115pt wide) + 7.5pt values
#   projects      8.1pt, bold up to and including the first colon
#
# Everything is expressed through _sz() so the customer's S/M/L size choice
# still scales the whole document proportionally.
# ===========================================================================

HC_PAGE = A4
HC_MARGIN = 36.0          # text column inset (half an inch, like every other template)
HC_FRAME_INSET = 9.8      # border rectangle inset
HC_RULE_COLOR = colors.HexColor("#000000")
HC_BULLET_INDENT = 10.3


def _hc_fonts():
    """Harvard Classic is a serif layout and needs a true italic for the
    location lines, so it defaults to a family that has one. An explicit
    customer font choice still wins."""
    reg, bold, ital = _fonts()
    if reg == ital:          # family has no distinct italic registered
        return reg, bold, "Times-Italic"
    return reg, bold, ital


def _hc_styles():
    _set_type_base(8.1)   # the body size this design was drawn at
    reg, bold, ital = _hc_fonts()
    base = getSampleStyleSheet()
    ink = colors.HexColor("#000000")
    return {
        "name": ParagraphStyle(
            "hc_name", parent=base["Normal"], fontName=bold, fontSize=_sz(16.7),
            leading=_sz(19.5), alignment=TA_CENTER, textColor=ink, spaceAfter=0),
        "contact": ParagraphStyle(
            "hc_contact", parent=base["Normal"], fontName=reg, fontSize=_sz(6.9),
            leading=_sz(9.2), alignment=TA_CENTER, textColor=ink, spaceAfter=0),
        "sec": ParagraphStyle(
            "hc_sec", parent=base["Normal"], fontName=bold, fontSize=_sz(8.6),
            leading=_sz(10.4), textColor=ink, spaceBefore=0, spaceAfter=0),
        "body": ParagraphStyle(
            "hc_body", parent=base["Normal"], fontName=reg, fontSize=_sz(8.1),
            leading=_sz(11.0), textColor=ink, spaceAfter=0),
        "meta": ParagraphStyle(
            "hc_meta", parent=base["Normal"], fontName=ital, fontSize=_sz(7.5),
            leading=_sz(10.2), textColor=ink, spaceAfter=0),
        "small": ParagraphStyle(
            "hc_small", parent=base["Normal"], fontName=reg, fontSize=_sz(7.5),
            leading=_sz(10.2), textColor=ink, spaceAfter=0),
        "entry": ParagraphStyle(
            "hc_entry", parent=base["Normal"], fontName=bold, fontSize=_sz(8.1),
            leading=_sz(11.0), textColor=ink, spaceAfter=0),
        # Indented, no marker — projects / publications / certifications.
        "bullet": ParagraphStyle(
            "hc_bullet", parent=base["Normal"], fontName=reg, fontSize=_sz(8.1),
            leading=_sz(11.0), textColor=ink, leftIndent=HC_BULLET_INDENT, spaceAfter=0),
        # Indented with a round marker — experience achievements only, matching
        # the small filled circles the source draws at x+1.7.
        "dot": ParagraphStyle(
            "hc_dot", parent=base["Normal"], fontName=reg, fontSize=_sz(8.1),
            leading=_sz(11.0), textColor=ink, leftIndent=HC_BULLET_INDENT,
            bulletIndent=_sz(1.7), bulletFontName=reg, bulletFontSize=_sz(6.6), spaceAfter=0),
        "skill_label": ParagraphStyle(
            "hc_sk_label", parent=base["Normal"], fontName=bold, fontSize=_sz(7.5),
            leading=_sz(10.2), textColor=ink),
        "skill_value": ParagraphStyle(
            "hc_sk_value", parent=base["Normal"], fontName=reg, fontSize=_sz(7.5),
            leading=_sz(10.2), textColor=ink),
    }


class _HCTracked(Flowable):
    """A single line of letter-spaced text.

    The source document tracks its name (+1.15pt) and section headings
    (+0.86pt), which is a large part of why it reads as "Harvard". ReportLab's
    Paragraph accepts a charSpace style key but ignores it, so this draws
    straight to the canvas with setCharSpace instead. The string stays a single
    run in the content stream, so it still extracts as one word for an ATS.
    """

    def __init__(self, text, font, size, leading, tracking=0.0,
                 align="left", color=colors.black):
        Flowable.__init__(self)
        self.text = text or ""
        self.font, self.size, self.leading = font, size, leading
        self.tracking, self.align, self.color = tracking, align, color
        self._avail = 0

    def wrap(self, availWidth, availHeight):
        self._avail = availWidth
        return availWidth, self.leading

    def _fitted(self):
        """The size this line can actually be drawn at inside the frame.

        A tracked line is drawn straight onto the canvas, so nothing wraps it: a
        long job title simply kept going past the right edge. Tracking has to be
        counted in the measurement — it adds its value once per character, which
        on a 79-character title is most of the overflow.
        """
        size, tracking = self.size, self.tracking
        if not self._avail or not self.text:
            return size, tracking
        while size > 5.0:
            w = _pdfmetrics.stringWidth(self.text, self.font, size) + tracking * len(self.text)
            if w <= self._avail:
                break
            size -= 0.2
            tracking = self.tracking * (size / self.size)
        return size, tracking

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(self.color)
        size, tracking = self._fitted()
        x = 0.0
        if self.align == "center":
            w = _pdfmetrics.stringWidth(self.text, self.font, size) + tracking * len(self.text)
            x = max(0.0, (self._avail - w) / 2.0)
        # Character spacing lives on the text object, not the canvas. Sit the
        # cap-height against the top of the flowable, as a Paragraph would.
        t = c.beginText(x, self.leading - size * 0.94)
        t.setFont(self.font, size)
        t.setCharSpace(tracking)
        t.textOut(self.text)
        c.drawText(t)
        c.restoreState()


def _hc_page_frame(canvas, doc):
    """The hairline box around the page."""
    canvas.saveState()
    canvas.setStrokeColor(HC_RULE_COLOR)
    canvas.setLineWidth(0.58)
    w, h = HC_PAGE
    canvas.rect(HC_FRAME_INSET, HC_FRAME_INSET,
                w - 2 * HC_FRAME_INSET, h - 2 * HC_FRAME_INSET, stroke=1, fill=0)
    canvas.restoreState()


def _hc_section(title: str, styles):
    """Section heading + the rule that sits under it."""
    _reg, bold, _ital = _hc_fonts()
    return [
        Spacer(1, _sz(9)),
        _HCTracked(str(title or "").upper(), bold, _sz(8.6), _sz(10.4), tracking=_sz(0.86)),
        Spacer(1, _sz(1.1)),
        HRFlowable(width="100%", thickness=0.58, color=HC_RULE_COLOR,
                   spaceBefore=0, spaceAfter=0),
        Spacer(1, _sz(9.3)),
    ]


def _hc_head_row(left: str, right: str, styles, width: float):
    """Bold title on the left, dates flush right, on one line."""
    if not right:
        return Paragraph(left, styles["entry"])
    right_style = ParagraphStyle("hc_right", parent=styles["entry"], alignment=TA_RIGHT)
    t = Table([[Paragraph(left, styles["entry"]), Paragraph(right, right_style)]],
              colWidths=[width * 0.70, width * 0.30])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _hc_entries(entries, styles, width):
    """Experience / project style blocks.

    Header line convention (pipe separated, same as every other template):
        Role | Company | Dates | Location
    """
    out = []
    for i, e in enumerate(entries):
        parts = [p for p in e.get("parts", []) if p]
        if not parts and not e.get("bullets"):
            continue
        if i:
            out.append(Spacer(1, _sz(6)))
        title = ", ".join(parts[:2]) if len(parts) > 1 else (parts[0] if parts else "")
        dates = parts[2] if len(parts) > 2 else ""
        location = parts[3] if len(parts) > 3 else ""
        out.append(_hc_head_row(_esc_pdf(title), _esc_pdf(dates), styles, width))
        if location:
            out.append(Paragraph(_esc_pdf(location), styles["meta"]))
        if e.get("bullets"):
            out.append(Spacer(1, _sz(1.6)))
            for b in e["bullets"]:
                out.append(Paragraph(_esc_pdf(b), styles["dot"], bulletText="\u2022"))
                out.append(Spacer(1, _sz(1.2)))
    return out


def _hc_indented_lines(items, styles, bold_prefix=False):
    """Projects / publications / certifications — one indented paragraph each.
    With bold_prefix, everything up to the first colon is bolded, matching the
    'Project Name: what it does' pattern in the source document."""
    _reg, bold, _ital = _hc_fonts()
    out = []
    for item in items:
        text = _esc_pdf(item)
        if bold_prefix and ":" in item:
            head, _, tail = item.partition(":")
            text = f'<font name="{bold}">{_esc_pdf(head)}:</font>{_esc_pdf(tail)}'
        out.append(Paragraph(text, styles["bullet"]))
        out.append(Spacer(1, _sz(1.6)))
    return out


def _hc_skills_table(skills_text, styles, width):
    """Two-column 'Category | items' table. Lines without a colon fall back to
    a single full-width row so nothing is silently dropped."""
    rows = []
    for line in _lines(skills_text):
        if ":" in line:
            label, _, value = line.partition(":")
            rows.append([Paragraph(_esc_pdf(label.strip()), styles["skill_label"]),
                         Paragraph(_esc_pdf(value.strip()), styles["skill_value"])])
        else:
            rows.append([Paragraph(_esc_pdf(line), styles["skill_value"]), ""])
    if not rows:
        return []
    label_w = 115.2
    t = Table(rows, colWidths=[label_w, width - label_w])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 6),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.4), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.4),
    ]))
    return [t]


def build_harvard_classic(data: dict, output_path: str):
    styles = _hc_styles()
    width = HC_PAGE[0] - 2 * HC_MARGIN
    # SimpleDocTemplate's frame adds 6pt of padding on every side, which would
    # push the text column in to 20.4pt. The source sits flush at 14.4, so the
    # frame is built explicitly with zero padding.
    doc = BaseDocTemplate(
        output_path, pagesize=HC_PAGE,
        leftMargin=HC_MARGIN, rightMargin=HC_MARGIN,
        topMargin=HC_MARGIN, bottomMargin=HC_MARGIN,
        title=data.get("full_name", "Resume"), author=data.get("full_name", ""),
    )
    frame = Frame(
        HC_MARGIN, HC_MARGIN, width, HC_PAGE[1] - 2 * HC_MARGIN,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="hc")
    doc.addPageTemplates([PageTemplate(id="hc", frames=[frame], onPage=_hc_page_frame)])

    _reg, _bold, _ital = _hc_fonts()
    story = [_HCTracked(str(data.get("full_name", "")).upper(), _bold,
                        _sz(16.7), _sz(19.5), tracking=_sz(1.15), align="center")]

    # Contact details across two centred lines, exactly as the source does:
    # location / phone / email first, then the online profiles.
    line1 = [data.get(k) for k in ("location", "phone", "email")]
    line2 = [data.get(k) for k in ("linkedin", "website")]
    if data.get("title"):
        line1.insert(0, data["title"])
    first_contact = True
    for group in (line1, line2):
        parts = [_esc_pdf(p.strip()) for p in group if p and p.strip()]
        if not parts:
            continue
        if first_contact:
            story.append(Spacer(1, _sz(7)))
            first_contact = False
        story.append(Paragraph(" | ".join(parts), styles["contact"]))
    story.append(Spacer(1, _sz(2.8)))

    def section(title, flowables):
        if flowables:
            story.extend(_hc_section(title, styles))
            story.extend(flowables)

    summary = (data.get("summary") or "").strip()
    if summary:
        section("Professional Summary",
                [Paragraph(_esc_pdf(p), styles["body"]) for p in summary.split("\n") if p.strip()])

    section("Professional Experience",
            _hc_entries(parse_entries(data.get("experience", "")), styles, width))

    # Education keeps the same head/meta shape but adds the free-text line the
    # source puts under a degree (modules covered, grade notes, …).
    edu = []
    for i, e in enumerate(parse_entries(data.get("education", ""))):
        parts = [p for p in e.get("parts", []) if p]
        if not parts:
            continue
        if i:
            edu.append(Spacer(1, _sz(6)))
        degree = parts[0]
        dates = parts[2] if len(parts) > 2 else ""
        institution = ", ".join(parts[3:]) if len(parts) > 3 else (parts[1] if len(parts) > 1 else "")
        edu.append(_hc_head_row(_esc_pdf(degree), _esc_pdf(dates), styles, width))
        if institution:
            edu.append(Paragraph(_esc_pdf(institution), styles["meta"]))
        for b in e.get("bullets", []):
            edu.append(Spacer(1, _sz(1.2)))
            edu.append(Paragraph(_esc_pdf(b), styles["small"]))
    section("Education", edu)

    section("Technical Skills", _hc_skills_table(data.get("skills", ""), styles, width))

    projects = parse_entries(data.get("projects", ""))
    project_lines = []
    for e in projects:
        parts = [p for p in e.get("parts", []) if p]
        headline = parts[0] if parts else ""
        detail = " ".join(e.get("bullets", []) or parts[1:2])
        project_lines.append(f"{headline}: {detail}" if detail else headline)
    section("Selected Projects", _hc_indented_lines(project_lines, styles, bold_prefix=True))

    section("Publications", _hc_indented_lines(_lines(data.get("publications", "")), styles))
    section("Certifications", _hc_indented_lines(_lines(data.get("certifications", "")), styles))

    for sec in (data.get("custom_sections") or []):
        items = []
        for it in (sec.get("items") or []):
            heading = (it.get("heading") or "").strip()
            meta = (it.get("meta") or "").strip()
            if heading:
                items.append(_hc_head_row(_esc_pdf(heading), _esc_pdf(meta), styles, width))
            if it.get("subheading"):
                items.append(Paragraph(_esc_pdf(it["subheading"]), styles["meta"]))
            if it.get("text"):
                items.append(Paragraph(_esc_pdf(it["text"]), styles["body"]))
            for b in (it.get("bullets") or []):
                items.append(Paragraph(_esc_pdf(b), styles["bullet"]))
                items.append(Spacer(1, _sz(1.2)))
        section(sec.get("title") or "Additional", items)

    doc.build(story)


# ===========================================================================
# SHARED HELPERS FOR THE REBUILT TEMPLATE SET
# ---------------------------------------------------------------------------
# Every template below was measured off its source PDF, so the numbers are
# specific rather than tidy. These few helpers cover what they all need: a
# zero-padding A4 frame, a right-aligned date row, and split entry parsing.
# ===========================================================================

TPL_PAGE = A4


# The templates were measured off source PDFs that used a 14.4pt (5mm) inset —
# tight enough that text runs almost to the paper edge, which looks cramped on
# screen and risks being clipped by a printer's unprintable margin. Every page
# built here gets at least this much white space on all four sides. It is a
# floor, not a fixed value: templates that already breathe keep their own
# margins.
TPL_MIN_MARGIN = 36.0        # 12.7mm — half an inch, the usual CV minimum


def _tpl_contact_line_count(bits, font, size, max_w, sep="   |   ") -> int:
    """How many lines _tpl_draw_contact will need, without drawing them.

    A header band has to be tall enough for the contact details it is about to
    contain, and that isn't known until the details have been wrapped. Sharing
    the wrap arithmetic keeps the band and the text in agreement.
    """
    if not bits:
        return 0
    lines, line = 1, []
    for bit in bits:
        trial = sep.join(line + [bit])
        if line and _pdfmetrics.stringWidth(trial, font, size) > max_w:
            lines += 1
            line = [bit]
        else:
            line.append(bit)
    return lines


def _tpl_draw_contact(canvas, bits, x, y, max_w, font, size, sep="   |   ", line_gap=None):
    """Draw contact details inside `max_w`, wrapping and — as a last resort —
    shrinking so the line physically cannot leave the page.

    Header bands draw this straight onto the canvas, where a long address simply
    kept going: one template printed 108pt past the right edge. Wrapping alone
    proved not to be enough to trust, so each line is measured again before it is
    drawn and the font is stepped down until it fits. The result is always inside
    the margin, whatever the customer types.
    """
    if not bits:
        return y
    line_gap = line_gap or size * 1.45
    lines, line = [], []
    for bit in bits:
        trial = sep.join(line + [bit])
        if line and _pdfmetrics.stringWidth(trial, font, size) > max_w:
            lines.append(sep.join(line))
            line = [bit]
        else:
            line.append(bit)
    if line:
        lines.append(sep.join(line))

    for i, text in enumerate(lines):
        draw_size = size
        while draw_size > 4.5 and _pdfmetrics.stringWidth(text, font, draw_size) > max_w:
            draw_size -= 0.2
        # Drawn through a text object with the tracking explicitly zeroed.
        # Character spacing set on an earlier text object stays in the graphics
        # state — ReportLab writes Tc into the content stream and nothing clears
        # it — so a tracked-out kicker above this line silently widened every
        # string after it. stringWidth() knows nothing about Tc, so the
        # measurement above passed while the drawn line ran 138pt off the page.
        # Stating the tracking here makes the drawn width match the measured one
        # whatever state the caller left behind.
        t = canvas.beginText(x, y - i * line_gap)
        t.setFont(font, draw_size)
        t.setCharSpace(0)
        t.textOut(text)
        canvas.drawText(t)
    canvas.setFont(font, size)
    return y - (len(lines) - 1) * line_gap


def _tpl_draw_fit(canvas, text, x, y, max_w, font, size, min_size=5.0):
    """Draw one line at `size`, stepping down until it fits inside `max_w`.

    Header bands draw the name and job title straight onto the canvas, where
    nothing wraps them: a 79-character job title ran 30pt past the right edge.
    Shrinking rather than wrapping is deliberate here — a banner is designed
    around a single line, and a second line would collide with whatever sits
    below it. Body copy still wraps and paginates normally; this applies only to
    the one-line elements of a header.
    """
    text = str(text or "")
    if not text:
        return size
    draw = float(size)
    while draw > min_size and _pdfmetrics.stringWidth(text, font, draw) > max_w:
        draw -= 0.2
    t = canvas.beginText(x, y)
    t.setFont(font, draw)
    t.setCharSpace(0)
    t.textOut(text)
    canvas.drawText(t)
    canvas.setFont(font, size)
    return draw


def _tpl_clear_tracking(canvas):
    """Clear leaked character spacing so plain drawString calls aren't tracked.

    Canvas has no setCharSpace of its own, so the operator is emitted the only
    public way there is: through an empty text object.
    """
    t = canvas.beginText(0, 0)
    t.setCharSpace(0)
    canvas.drawText(t)


def _tpl_doc(output_path, data, margin, top_margin=None, on_page=None, page=None):
    """A4 document whose frame has no padding, so a stated margin is the real
    distance from the paper edge (SimpleDocTemplate silently adds 6pt).

    `page` overrides the size for the templates whose market expects US Letter.
    """
    page = page or TPL_PAGE
    margin = max(margin, TPL_MIN_MARGIN)
    top = max(margin if top_margin is None else top_margin, TPL_MIN_MARGIN)
    doc = BaseDocTemplate(
        output_path, pagesize=page,
        leftMargin=margin, rightMargin=margin, topMargin=top, bottomMargin=margin,
        title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    frame = Frame(margin, margin, page[0] - 2 * margin, page[1] - top - margin,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="body")
    doc.addPageTemplates([PageTemplate(id="body", frames=[frame], onPage=on_page or (lambda c, d: None))])
    return doc


def _tpl_row(left_html, right_html, left_style, right_style, width, split=0.72):
    """Title on the left, dates flush right, sharing one line."""
    if not right_html:
        return Paragraph(left_html, left_style)
    rs = ParagraphStyle(right_style.name + "_r", parent=right_style, alignment=TA_RIGHT)
    t = Table([[Paragraph(left_html, left_style), Paragraph(right_html, rs)]],
              colWidths=[width * split, width * (1 - split)])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


# Anything that reads like a date range: a year, a month name, or "Present".
# Used only to tell the third and fourth header fields apart.
_TPL_DATEISH = re.compile(
    r"(19|20)\d{2}|present|current|ongoing|"
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec", re.I)


def _tpl_entry(e):
    """Header line convention shared by every template:
       Role | Company | Dates | Location  ->  (title, company, dates, location)

    Résumés parsed out of an uploaded file often come back with those last two
    swapped ("Role | Company | Newcastle, UK | Aug 2025 - Present"), which used
    to print a city where the dates belong. If the fourth field looks like a
    date range and the third doesn't, they are read the other way round.
    """
    p = [x for x in e.get("parts", []) if x]
    title = p[0] if p else ""
    company = p[1] if len(p) > 1 else ""
    third = p[2] if len(p) > 2 else ""
    fourth = p[3] if len(p) > 3 else ""
    if third and fourth and not _TPL_DATEISH.search(third) and _TPL_DATEISH.search(fourth):
        third, fourth = fourth, third
    return (title, company, third, fourth)


def _tpl_named_lines(text):
    """'Label: value' lines -> [(label, value)], keeping label-less lines."""
    out = []
    for line in _lines(text):
        if ":" in line:
            a, _, b = line.partition(":")
            out.append((a.strip(), b.strip()))
        else:
            out.append(("", line))
    return out


def _tpl_project_lines(text):
    """Project blocks -> [(name, description)]."""
    out = []
    for e in parse_entries(text):
        parts = [x for x in e.get("parts", []) if x]
        name = parts[0] if parts else ""
        detail = " ".join(e.get("bullets", []) or parts[1:2])
        out.append((name, detail))
    return out


# ===========================================================================
# 02 — MODERN MINIMALIST
# ---------------------------------------------------------------------------
#   margins 14.4pt, no rules anywhere, sage accent #5A8F7B
#   name 20.2pt extra-light  |  role 9.2pt bold accent  |  contact 6.9pt grey
#   section head 8.1pt bold accent, caps, no underline
#   entry 8.1pt bold ink, dates 6.9pt #888 right, meta 6.9pt #555 "Co · Place"
#   bullets 7.5pt indented 9.2pt with a 2.3pt dot
#   skills two columns: 6.9pt bold label (80pt) + values
#   projects "Name — description", name bold
# ===========================================================================
MM_ACCENT = colors.HexColor("#5A8F7B")
MM_INK = colors.HexColor("#2B2B2B")
MM_BODY = colors.HexColor("#333333")
MM_META = colors.HexColor("#555555")
MM_FAINT = colors.HexColor("#888888")


def _mm_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    light = "Helvetica" if reg == "Helvetica" else reg
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("mm_name", fontName=light, fontSize=_sz(20.2), leading=_sz(23),
                  textColor=colors.HexColor("#111111")),
        "role": S("mm_role", fontName=bold, fontSize=_sz(9.2), leading=_sz(11.4), textColor=acc),
        "contact": S("mm_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4),
                     textColor=colors.HexColor("#666666")),
        "sec": S("mm_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10), textColor=acc, keepWithNext=1),
        "entry": S("mm_entry", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.4), textColor=MM_INK, keepWithNext=1),
        "dates": S("mm_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.4), textColor=MM_FAINT),
        "meta": S("mm_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=MM_META),
        "body": S("mm_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=MM_BODY),
        "bullet": S("mm_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=MM_INK,
                    leftIndent=9.2, bulletIndent=_sz(0.5), bulletFontName=reg, bulletFontSize=_sz(6)),
        "skill_l": S("mm_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=MM_BODY),
        "skill_v": S("mm_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=MM_INK),
        "proj": S("mm_proj", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=MM_INK,
                  leftIndent=9.2),
    }


def build_modern_minimalist(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else MM_ACCENT
    st = _mm_styles(acc)
    _reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)
    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = [c for c in (data.get("location"), data.get("phone"), data.get("email"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    if contact:
        story += [Spacer(1, _sz(5.6)),
                  Paragraph(" &bull; ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if flows:
            story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                          Spacer(1, _sz(8.4))])
            story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Summary", [Paragraph(_esc_pdf(p), st["body"])
                        for p in data["summary"].split("\n") if p.strip()])

    def entry_block(text, meta_join=" &middot; "):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(7)))
            out.append(_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], width))
            meta = meta_join.join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                out.append(Spacer(1, _sz(1.4)))
                out.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                out.append(Spacer(1, _sz(2.4)))
                for b in e["bullets"]:
                    out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    out.append(Spacer(1, _sz(1.4)))
        return out

    sec("Experience", entry_block(data.get("experience", "")))
    sec("Education", entry_block(data.get("education", "")))

    rows = _tpl_named_lines(data.get("skills", ""))
    if rows:
        label_w = 80
        t = Table([[Paragraph(_esc_pdf(a), st["skill_l"]), Paragraph(_esc_pdf(b), st["skill_v"])]
                   for a, b in rows], colWidths=[label_w, width - label_w])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 6),
            ("RIGHTPADDING", (1, 0), (1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1.3), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.3),
        ]))
        sec("Skills", [t])

    proj = [Paragraph(f'<font name="{bold}">{_esc_pdf(n)}</font>' +
                      (f" &mdash; {_esc_pdf(d)}" if d else ""), st["proj"])
            for n, d in _tpl_project_lines(data.get("projects", ""))]
    sec("Projects", [f for pair in zip(proj, [Spacer(1, _sz(2.2))] * len(proj)) for f in pair])

    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            flows = []
            for it in items:
                flows.append(Paragraph(_esc_pdf(it), st["proj"]))
                flows.append(Spacer(1, _sz(2.2)))
            sec(label, flows)

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], width))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
            if it.get("text"):
                flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 03 — TWO-COLUMN SIDEBAR
# ---------------------------------------------------------------------------
#   navy panel #1F2D3D bleeding the full page height, 9.8 -> 193.6pt
#   sidebar content 35.9 -> 176.3 (140pt), hairline #3D5266 dividers
#   name 14.4pt bold #EEF2F5 | role 8.1pt #9FB3C8 | heads 7.5pt mint #7FD9C4
#   skill label 6.9pt bold white, values 6.3pt #C4D2DD
#   main column 211 -> 553.8, heads 8.6pt bold navy over a 1.15pt navy rule
#   entry 7.5pt bold, dates 6.9pt #666 right, meta 6.9pt oblique #444
# ===========================================================================
TS_PANEL = colors.HexColor("#1F2D3D")
TS_DIVIDER = colors.HexColor("#3D5266")
TS_MINT = colors.HexColor("#7FD9C4")
TS_NAME = colors.HexColor("#EEF2F5")
TS_ROLE = colors.HexColor("#9FB3C8")
TS_SIDE_TEXT = colors.HexColor("#C4D2DD")
TS_SIDE_LINE = colors.HexColor("#DBE4EA")
TS_INK = colors.HexColor("#262626")

TS_PANEL_W = 193.6
TS_SIDE_X = 35.9
TS_SIDE_W = 140.4
TS_MAIN_X = 211.0
TS_MAIN_W = 342.8


def _ts_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("ts_name", fontName=bold, fontSize=_sz(14.4), leading=_sz(17), textColor=TS_NAME),
        "role": S("ts_role", fontName=reg, fontSize=_sz(8.1), leading=_sz(10.4), textColor=TS_ROLE),
        "side_h": S("ts_side_h", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=acc, keepWithNext=1),
        "side_line": S("ts_side_l", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=TS_SIDE_LINE),
        "side_lab": S("ts_side_lab", fontName=bold, fontSize=_sz(6.9), leading=_sz(9), textColor=colors.white),
        "side_val": S("ts_side_val", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.4), textColor=TS_SIDE_TEXT),
        "sec": S("ts_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.6), textColor=TS_PANEL, keepWithNext=1),
        "entry": S("ts_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10), textColor=TS_INK),
        "dates": S("ts_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10), textColor=colors.HexColor("#666666")),
        "meta": S("ts_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.4), textColor=colors.HexColor("#444444")),
        "body": S("ts_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=TS_INK),
        "bullet": S("ts_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=TS_INK,
                    leftIndent=8.7, bulletIndent=_sz(0.4), bulletFontName=reg, bulletFontSize=_sz(6)),
    }


def build_twocolumn_sidebar(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else TS_MINT
    st = _ts_styles(acc)
    reg, bold, _it = _fonts()

    def paint_panel(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(TS_PANEL)
        canvas.rect(0, 0, TS_PANEL_W, TPL_PAGE[1], stroke=0, fill=1)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    top = 50.0
    bottom = TPL_MIN_MARGIN   # the shared floor: content stops here, not 24pt in
    side_frame = Frame(TS_SIDE_X, bottom, TS_SIDE_W, TPL_PAGE[1] - top - bottom,
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="side")
    main_frame = Frame(TS_MAIN_X, bottom, TS_MAIN_W, TPL_PAGE[1] - top - bottom,
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="main")
    # Page 1 has two frames — the sidebar fills first, then the main column.
    # Later pages carry only the main column, otherwise a long resume would
    # spill its overflow back into the narrow sidebar. The panel is still
    # painted so the page furniture stays consistent.
    doc.addPageTemplates([
        PageTemplate(id="cols", frames=[side_frame, main_frame], onPage=paint_panel),
        PageTemplate(id="cont", frames=[
            Frame(TS_MAIN_X, bottom, TS_MAIN_W, TPL_PAGE[1] - TPL_MIN_MARGIN - bottom,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="cont")],
            onPage=paint_panel),
    ])

    story = [NextPageTemplate("cont"),
             Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]

    def side_sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(9)),
                      Paragraph(_esc_pdf(title).upper(), st["side_h"]),
                      Spacer(1, _sz(2)),
                      HRFlowable(width="100%", thickness=0.58, color=TS_DIVIDER, spaceBefore=0, spaceAfter=0),
                      Spacer(1, _sz(5.4))])
        story.extend(flows)

    contact = [c for c in (data.get("phone"), data.get("email"), data.get("location"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    side_sec("Contact", [f for c in contact
                         for f in (Paragraph(_esc_pdf(c), st["side_line"]), Spacer(1, _sz(1.4)))])

    skill_flows = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        if label:
            skill_flows.append(Paragraph(_esc_pdf(label), st["side_lab"]))
            skill_flows.append(Spacer(1, _sz(0.8)))
        skill_flows.append(Paragraph(_esc_pdf(value), st["side_val"]))
        skill_flows.append(Spacer(1, _sz(4)))
    side_sec("Skills", skill_flows)

    edu_flows = []
    for e in parse_entries(data.get("education", "")):
        title, company, dates, place = _tpl_entry(e)
        edu_flows.append(Paragraph(_esc_pdf(title), st["side_lab"]))
        detail = ", ".join(x for x in (company or place, dates) if x)
        if detail:
            edu_flows.append(Paragraph(_esc_pdf(detail), st["side_val"]))
        edu_flows.append(Spacer(1, _sz(4)))
    side_sec("Education", edu_flows)

    certs = _lines(data.get("certifications", ""))
    side_sec("Certifications", [f for c in certs
                                for f in (Paragraph(_esc_pdf(c), st["side_val"]), Spacer(1, _sz(3)))])

    # ---- main column ----
    story.append(FrameBreak())

    def main_sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.6)),
                      HRFlowable(width="100%", thickness=1.15, color=TS_PANEL, spaceBefore=0, spaceAfter=0),
                      Spacer(1, _sz(7.4))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        main_sec("Summary", [Paragraph(_esc_pdf(p), st["body"])
                             for p in data["summary"].split("\n") if p.strip()])

    exp = []
    for i, e in enumerate(parse_entries(data.get("experience", ""))):
        title, company, dates, place = _tpl_entry(e)
        if i:
            exp.append(Spacer(1, _sz(7)))
        exp.append(_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], TS_MAIN_W))
        meta = " &mdash; ".join(_esc_pdf(x) for x in (company, place) if x)
        if meta:
            exp.append(Spacer(1, _sz(1.4)))
            exp.append(Paragraph(meta, st["meta"]))
        if e.get("bullets"):
            exp.append(Spacer(1, _sz(2.2)))
            for b in e["bullets"]:
                exp.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                exp.append(Spacer(1, _sz(1.4)))
    main_sec("Experience", exp)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(f'<font name="{bold}">{_esc_pdf(n)}</font>', st["body"]))
        if d:
            proj.append(Paragraph(_esc_pdf(d), st["meta"]))
        proj.append(Spacer(1, _sz(3.4)))
    main_sec("Projects", proj)

    pubs = _lines(data.get("publications", ""))
    main_sec("Publications", [f for p in pubs
                              for f in (Paragraph(_esc_pdf(p), st["body"]), Spacer(1, _sz(2.6)))])

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], TS_MAIN_W))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
            if it.get("text"):
                flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        main_sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 04 — CREATIVE COLORFUL
# ---------------------------------------------------------------------------
#   full-bleed 118pt gradient header band, name 20.2pt bold reversed out of it
#   content 49 -> 545 (a generous 49pt margin)
#   section heads 9.2pt bold #F9844A in Title Case, not caps
#   entry 7.5pt bold #222 at +10.3, dates 6.9pt #999 right, meta 6.9pt #777
#   bullets 7.5pt at +19, small square markers
#   skills render as tinted #FFF1E6 chips with 6.3pt bold #D9480F labels
#   NOTE: the source omits contact details entirely — a resume needs them, so
#   they are set below the name in the band.
# ===========================================================================
CC_DEEP = colors.HexColor("#D9480F")
CC_LIGHT = colors.HexColor("#F9844A")
CC_CHIP_BG = colors.HexColor("#FFF1E6")
CC_INK = colors.HexColor("#333333")
CC_TITLE = colors.HexColor("#222222")
CC_META = colors.HexColor("#777777")
CC_FAINT = colors.HexColor("#999999")
CC_MARGIN = 49.0
CC_BAND_H = 118.14


class _CCChips(Flowable):
    """Skill chips: rounded tinted pills that wrap across the column."""

    def __init__(self, items, width, font, size, pad_x=5.0, pad_y=3.2, gap=2.3, line_gap=3.0,
                 bg=CC_CHIP_BG, fg=CC_DEEP):
        Flowable.__init__(self)
        self.items = [i for i in items if i]
        self.avail = width
        self.font, self.size = font, size
        self.pad_x, self.pad_y, self.gap, self.line_gap = pad_x, pad_y, gap, line_gap
        self.bg, self.fg = bg, fg
        self._rows = []
        self._h = 0

    def _layout(self):
        rows, row, x = [], [], 0.0
        chip_h = self.size + self.pad_y * 2
        for it in self.items:
            w = _pdfmetrics.stringWidth(it, self.font, self.size) + self.pad_x * 2
            if row and x + w > self.avail:
                rows.append(row); row, x = [], 0.0
            row.append((it, w)); x += w + self.gap
        if row:
            rows.append(row)
        self._rows = rows
        self._h = len(rows) * chip_h + max(0, len(rows) - 1) * self.line_gap
        return chip_h

    def wrap(self, availWidth, availHeight):
        self.avail = availWidth
        self._layout()
        return availWidth, self._h

    def draw(self):
        chip_h = self._layout()
        c = self.canv
        y = self._h - chip_h
        for row in self._rows:
            x = 0.0
            for text, w in row:
                c.setFillColor(self.bg)
                c.roundRect(x, y, w, chip_h, chip_h / 2.0, stroke=0, fill=1)
                c.setFillColor(self.fg)
                c.setFont(self.font, self.size)
                c.drawString(x + self.pad_x, y + self.pad_y + self.size * 0.22, text)
                x += w + self.gap
            y -= chip_h + self.line_gap


def _cc_styles(deep, light):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("cc_sec", fontName=bold, fontSize=_sz(9.2), leading=_sz(11.6), textColor=light, keepWithNext=1),
        "entry": S("cc_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10),
                   textColor=CC_TITLE, leftIndent=10.3),
        "dates": S("cc_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10), textColor=CC_FAINT),
        "meta": S("cc_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4),
                  textColor=CC_META, leftIndent=10.3),
        "body": S("cc_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10), textColor=CC_INK),
        "bullet": S("cc_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10), textColor=CC_INK,
                    leftIndent=19.0, bulletIndent=10.3, bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "proj_t": S("cc_proj_t", fontName=bold, fontSize=_sz(7.5), leading=_sz(10), textColor=CC_INK),
        "proj_d": S("cc_proj_d", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=CC_META),
    }


def build_creative_colorful(data: dict, output_path: str):
    deep = _acc() if data.get("accent_color") else CC_DEEP
    light = CC_LIGHT if not data.get("accent_color") else _acc()
    st = _cc_styles(deep, light)
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * CC_MARGIN

    def paint_band(canvas, doc):
        canvas.saveState()
        # A horizontal wash between the two accent tones, drawn as thin strips —
        # ReportLab has no gradient primitive on the canvas.
        steps = 120
        w = TPL_PAGE[0] / steps
        for i in range(steps):
            t = i / (steps - 1)
            canvas.setFillColorRGB(
                deep.red + (light.red - deep.red) * t,
                deep.green + (light.green - deep.green) * t,
                deep.blue + (light.blue - deep.blue) * t)
            canvas.rect(i * w, TPL_PAGE[1] - CC_BAND_H, w + 0.6, CC_BAND_H, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        _tpl_draw_fit(canvas, data.get("full_name", ""), CC_MARGIN, TPL_PAGE[1] - 62,
                      TPL_PAGE[0] - 2 * CC_MARGIN, bold, _sz(20.2))
        bits = [x for x in (data.get("title"), data.get("location"), data.get("phone"),
                            data.get("email"), data.get("linkedin"), data.get("website"))
                if x and str(x).strip()]
        if bits:
            canvas.setFont(reg, _sz(6.9))
            canvas.setFillColorRGB(1, 1, 1)
            _tpl_draw_contact(canvas, bits, CC_MARGIN, TPL_PAGE[1] - 80,
                              TPL_PAGE[0] - 2 * CC_MARGIN, reg, _sz(6.9), sep="  •  ")
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    top_first = CC_BAND_H + 24
    frame = Frame(CC_MARGIN, TPL_MIN_MARGIN, width,
                  TPL_PAGE[1] - top_first - TPL_MIN_MARGIN,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="body")
    plain = Frame(CC_MARGIN, TPL_MIN_MARGIN, width, TPL_PAGE[1] - 46 - TPL_MIN_MARGIN,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="body2")
    doc.addPageTemplates([
        PageTemplate(id="first", frames=[frame], onPage=paint_band),
        PageTemplate(id="rest", frames=[plain]),
    ])

    # The gradient band belongs to page 1 only.
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(8))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Profile", [Paragraph(_esc_pdf(p), st["body"])
                        for p in data["summary"].split("\n") if p.strip()])

    exp = []
    for i, e in enumerate(parse_entries(data.get("experience", ""))):
        title, company, dates, place = _tpl_entry(e)
        if i:
            exp.append(Spacer(1, _sz(7)))
        exp.append(_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], width))
        meta = " &middot; ".join(_esc_pdf(x) for x in (company, place) if x)
        if meta:
            exp.append(Paragraph(meta, st["meta"]))
        if e.get("bullets"):
            exp.append(Spacer(1, _sz(2.2)))
            for b in e["bullets"]:
                exp.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                exp.append(Spacer(1, _sz(1.4)))
    sec("Experience", exp)

    chips = []
    for _label, value in _tpl_named_lines(data.get("skills", "")):
        chips += [s.strip() for s in value.split(",") if s.strip()]
    if chips:
        sec("Skills", [_CCChips(chips, width, bold, _sz(6.3), bg=CC_CHIP_BG, fg=deep)])

    edu = []
    for e in parse_entries(data.get("education", "")):
        title, company, dates, place = _tpl_entry(e)
        edu.append(Paragraph(_esc_pdf(title), st["proj_t"]))
        meta = " &middot; ".join(_esc_pdf(x) for x in (company or place, dates) if x)
        if meta:
            edu.append(Paragraph(meta, st["proj_d"]))
        edu.append(Spacer(1, _sz(3.4)))
    sec("Education", edu)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(_esc_pdf(n), st["proj_t"]))
        if d:
            proj.append(Paragraph(_esc_pdf(d), st["proj_d"]))
        proj.append(Spacer(1, _sz(3.4)))
    sec("Projects", proj)

    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            sec(label, [f for it in items
                        for f in (Paragraph(_esc_pdf(it), st["body"]), Spacer(1, _sz(2.6)))])

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(Paragraph(_esc_pdf(it["heading"]), st["proj_t"]))
            if it.get("subheading") or it.get("meta"):
                flows.append(Paragraph(" &middot; ".join(
                    _esc_pdf(x) for x in (it.get("subheading"), it.get("meta")) if x), st["proj_d"]))
            if it.get("text"):
                flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
            flows.append(Spacer(1, _sz(3)))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 05 — EXECUTIVE ELEGANT
# ---------------------------------------------------------------------------
#   serif throughout, gold #8A6D3B accents, margins 14.4pt
#   name 18.4pt regular (not bold) #2C2416, role 8.6pt bold caps gold
#   a double gold hairline closes the header (two 0.58pt rules 1.1pt apart)
#   section heads 8.6pt bold gold caps, no rule
#   entry 8.1pt bold, dates + meta 7.5pt italic #555
#   competencies run full width as "Label: values", label bold
# ===========================================================================
EE_GOLD = colors.HexColor("#8A6D3B")
EE_NAME = colors.HexColor("#2C2416")
EE_INK = colors.HexColor("#1C1C1C")
EE_META = colors.HexColor("#555555")


def _ee_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("ee_name", fontName=reg, fontSize=_sz(18.4), leading=_sz(21.6), textColor=EE_NAME),
        "role": S("ee_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("ee_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4),
                     textColor=colors.HexColor("#444444")),
        "sec": S("ee_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc, keepWithNext=1),
        "entry": S("ee_entry", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.6), textColor=EE_INK, keepWithNext=1),
        "dates": S("ee_dates", fontName=ital, fontSize=_sz(7.5), leading=_sz(10.6), textColor=EE_META),
        "meta": S("ee_meta", fontName=ital, fontSize=_sz(7.5), leading=_sz(10.4), textColor=EE_META),
        "body": S("ee_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=EE_INK),
        "bullet": S("ee_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=EE_INK,
                    leftIndent=9.8, bulletIndent=_sz(1.1), bulletFontName=reg, bulletFontSize=_sz(6)),
        "comp": S("ee_comp", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=EE_INK),
    }


def build_executive_elegant(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else EE_GOLD
    st = _ee_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(4)), Paragraph(_esc_pdf(data["title"]).upper(), st["role"])]
    contact = [c for c in (data.get("location"), data.get("phone"), data.get("email"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    if contact:
        story += [Spacer(1, _sz(5)), Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact"])]
    # the double gold rule that closes the header
    story += [Spacer(1, _sz(6)),
              HRFlowable(width="100%", thickness=0.58, color=acc, spaceBefore=0, spaceAfter=0),
              Spacer(1, _sz(1.1)),
              HRFlowable(width="100%", thickness=0.58, color=acc, spaceBefore=0, spaceAfter=0)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(9))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Executive Summary", [Paragraph(_esc_pdf(p), st["body"])
                                  for p in data["summary"].split("\n") if p.strip()])

    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(7)))
            out.append(_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], width))
            meta = " | ".join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                out.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                out.append(Spacer(1, _sz(2.2)))
                for b in e["bullets"]:
                    out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    out.append(Spacer(1, _sz(1.2)))
        return out

    sec("Professional Experience", entries(data.get("experience", "")))
    sec("Education", entries(data.get("education", "")))

    comps = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        text = (f'<font name="{bold}">{_esc_pdf(label)}:</font> {_esc_pdf(value)}'
                if label else _esc_pdf(value))
        comps.append(Paragraph(text, st["comp"]))
    sec("Core Competencies", comps)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        text = f'<font name="{bold}">{_esc_pdf(n)}:</font> {_esc_pdf(d)}' if d else \
               f'<font name="{bold}">{_esc_pdf(n)}</font>'
        proj.append(Paragraph(text, st["bullet"]))
        proj.append(Spacer(1, _sz(2)))
    sec("Selected Projects", proj)

    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            sec(label, [f for it in items
                        for f in (Paragraph(_esc_pdf(it), st["bullet"]), Spacer(1, _sz(2)))])

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], width))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
            if it.get("text"):
                flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 07 — ATS PLAIN
# ---------------------------------------------------------------------------
#   Pure black on white, no rules, no colour, no decoration of any kind.
#   name 12.1 bold | role 8.1 | contact 7.5 pipe-separated
#   section head 9.2 bold in Title Case | body 8.1 | bullets indented 11.5
#   The point of this one is that a parser has nothing to trip over.
# ===========================================================================
def _ap_styles():
    _set_type_base(8.1)   # the body size this design was drawn at
    reg, bold, _it = _fonts()
    base = getSampleStyleSheet()
    ink = colors.black
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], textColor=ink, **kw)
    return {
        "name": S("ap_name", fontName=bold, fontSize=_sz(12.1), leading=_sz(15)),
        "role": S("ap_role", fontName=reg, fontSize=_sz(8.1), leading=_sz(10.6)),
        "contact": S("ap_contact", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4)),
        "sec": S("ap_sec", fontName=bold, fontSize=_sz(9.2), leading=_sz(11.4), keepWithNext=1),
        "entry": S("ap_entry", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.8), keepWithNext=1),
        "body": S("ap_body", fontName=reg, fontSize=_sz(8.1), leading=_sz(11.4)),
        "bullet": S("ap_bullet", fontName=reg, fontSize=_sz(8.1), leading=_sz(11.4),
                    leftIndent=11.5, bulletIndent=_sz(1.5), bulletFontName=reg, bulletFontSize=_sz(6.4)),
    }


def build_ats_plain(data: dict, output_path: str):
    st = _ap_styles()
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=20)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = [c for c in (data.get("location"), data.get("phone"), data.get("email"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    if contact:
        story += [Spacer(1, _sz(4.6)),
                  Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if flows:
            story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(7))])
            story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Professional Summary", [Paragraph(_esc_pdf(p), st["body"])
                                     for p in data["summary"].split("\n") if p.strip()])

    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(6.5)))
            # One flat line — no tables, no columns; the whole heading reads as
            # a single string to a parser.
            head = " — ".join(x for x in (title, company) if x)
            tail = " | ".join(x for x in (dates, place) if x)
            out.append(Paragraph(_esc_pdf(head + (f" | {tail}" if tail else "")), st["entry"]))
            for b in e.get("bullets", []):
                out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                out.append(Spacer(1, _sz(1.2)))
        return out

    sec("Professional Experience", entries(data.get("experience", "")))
    sec("Education", entries(data.get("education", "")))

    skills = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        skills.append(Paragraph(
            f'<font name="{bold}">{_esc_pdf(label)}:</font> {_esc_pdf(value)}' if label else _esc_pdf(value),
            st["body"]))
    sec("Technical Skills", skills)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(
            f'<font name="{bold}">{_esc_pdf(n)}:</font> {_esc_pdf(d)}' if d else f'<font name="{bold}">{_esc_pdf(n)}</font>',
            st["bullet"], bulletText="•"))
        proj.append(Spacer(1, _sz(1.6)))
    sec("Projects", proj)

    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            sec(label, [f for it in items
                        for f in (Paragraph(_esc_pdf(it), st["bullet"], bulletText="•"), Spacer(1, _sz(1.6)))])

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            head = " — ".join(x for x in (it.get("heading"), it.get("subheading")) if x)
            if head or it.get("meta"):
                flows.append(Paragraph(_esc_pdf(head + (f" | {it['meta']}" if it.get("meta") else "")), st["entry"]))
            if it.get("text"):
                flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 08 — BOLD SIDEBAR
# ---------------------------------------------------------------------------
#   pale #EEF1F4 panel 9.8 -> 182.1, full bleed, with a crimson initials disc
#   sidebar heads 7.5 bold #D62828 caps | labels 6.3 bold | values 6.3 #555
#   main column 199.5 -> 553.8; each heading carries a 2.4pt crimson bar
#   name 18.4 bold #111 | role 9.2 bold crimson
#   entry 7.5 bold | employer 6.9 bold crimson | dates 6.3 #888 right
# ===========================================================================
BS_PANEL = colors.HexColor("#EEF1F4")
BS_RED = colors.HexColor("#D62828")
BS_INK = colors.HexColor("#232323")
BS_DARK = colors.HexColor("#111111")
BS_MUTED = colors.HexColor("#555555")
BS_PANEL_W = 182.1
BS_SIDE_X = 35.9
BS_SIDE_W = 128.5
BS_MAIN_X = 199.5
BS_MAIN_W = 354.3
BS_BAR_W = 2.4


def _bs_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, _it = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "side_h": S("bs_side_h", fontName=bold, fontSize=_sz(7.5), leading=_sz(9.8), textColor=acc),
        "side_lab": S("bs_side_lab", fontName=bold, fontSize=_sz(6.3), leading=_sz(8.6), textColor=BS_INK),
        "side_val": S("bs_side_val", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.6), textColor=BS_MUTED),
        "side_line": S("bs_side_line", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.8), textColor=BS_INK),
        "name": S("bs_name", fontName=bold, fontSize=_sz(18.4), leading=_sz(21.6), textColor=BS_DARK),
        "role": S("bs_role", fontName=bold, fontSize=_sz(9.2), leading=_sz(11.6), textColor=acc),
        "sec": S("bs_sec", fontName=bold, fontSize=_sz(9.8), leading=_sz(12), textColor=BS_DARK,
                 leftIndent=7.2, keepWithNext=1),
        "entry": S("bs_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10), textColor=BS_INK, keepWithNext=1),
        "dates": S("bs_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10), textColor=colors.HexColor("#888888")),
        "employer": S("bs_emp", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=acc),
        "body": S("bs_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=BS_INK),
        "bullet": S("bs_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=BS_INK,
                    leftIndent=8.7, bulletIndent=_sz(0.4), bulletFontName=reg, bulletFontSize=_sz(6)),
    }


class _AccentBarHead(Flowable):
    """Section heading with a short accent bar sitting in its left margin."""

    def __init__(self, text, font, size, leading, colour, bar_colour, bar_w=2.4, gap=7.2):
        Flowable.__init__(self)
        self.text, self.font, self.size, self.leading = text, font, size, leading
        self.colour, self.bar_colour, self.bar_w, self.gap = colour, bar_colour, bar_w, gap

    def wrap(self, availWidth, availHeight):
        return availWidth, self.leading

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(self.bar_colour)
        c.rect(0, 0.5, self.bar_w, self.leading - 1, stroke=0, fill=1)
        c.setFillColor(self.colour)
        c.setFont(self.font, self.size)
        c.drawString(self.gap, self.leading - self.size * 0.94, self.text)
        c.restoreState()


def _initials(name: str) -> str:
    parts = [p for p in str(name or "").split() if p]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


def build_bold_sidebar(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else BS_RED
    st = _bs_styles(acc)
    reg, bold, _it = _fonts()

    def paint(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(BS_PANEL)
        canvas.rect(0, 0, BS_PANEL_W, TPL_PAGE[1], stroke=0, fill=1)
        if doc.page == 1:
            d = 40.3
            cx, cy = BS_SIDE_X + d / 2, TPL_PAGE[1] - 48.9 - d / 2
            canvas.setFillColor(acc)
            canvas.circle(cx, cy, d / 2, stroke=0, fill=1)
            canvas.setFillColor(colors.white)
            canvas.setFont(bold, _sz(16.7))
            t = _initials(data.get("full_name"))
            canvas.drawCentredString(cx, cy - _sz(16.7) * 0.35, t)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    top, bottom = 97.0, TPL_MIN_MARGIN
    side = Frame(BS_SIDE_X, bottom, BS_SIDE_W, TPL_PAGE[1] - top - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="side")
    main = Frame(BS_MAIN_X, bottom, BS_MAIN_W, TPL_PAGE[1] - 48 - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="main")
    cont = Frame(BS_MAIN_X, bottom, BS_MAIN_W, TPL_PAGE[1] - 34 - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="cont")
    doc.addPageTemplates([
        PageTemplate(id="cols", frames=[side, main], onPage=paint),
        PageTemplate(id="cont", frames=[cont], onPage=paint),
    ])

    story = [NextPageTemplate("cont")]

    def side_sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(9)), Paragraph(_esc_pdf(title).upper(), st["side_h"]), Spacer(1, _sz(4.6))])
        story.extend(flows)

    contact = [c for c in (data.get("phone"), data.get("email"), data.get("location"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    side_sec("Contact", [f for c in contact
                         for f in (Paragraph(_esc_pdf(c), st["side_line"]), Spacer(1, _sz(1.4)))])
    sk = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        if label:
            sk += [Paragraph(_esc_pdf(label), st["side_lab"]), Spacer(1, _sz(0.8))]
        sk += [Paragraph(_esc_pdf(value), st["side_val"]), Spacer(1, _sz(3.6))]
    side_sec("Skills", sk)

    ed = []
    for e in parse_entries(data.get("education", "")):
        t, comp, dt, pl = _tpl_entry(e)
        ed += [Paragraph(_esc_pdf(t), st["side_lab"])]
        detail = ", ".join(x for x in (comp or pl, dt) if x)
        if detail:
            ed.append(Paragraph(_esc_pdf(detail), st["side_val"]))
        ed.append(Spacer(1, _sz(3.6)))
    side_sec("Education", ed)
    side_sec("Certifications", [f for c in _lines(data.get("certifications", ""))
                                for f in (Paragraph(_esc_pdf(c), st["side_val"]), Spacer(1, _sz(2.6)))])

    story.append(FrameBreak())
    story += [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.2)), Paragraph(_esc_pdf(data["title"]), st["role"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)),
                      _AccentBarHead(str(title), bold, _sz(9.8), _sz(12), BS_DARK, acc, BS_BAR_W),
                      Spacer(1, _sz(7.6))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Profile", [Paragraph(_esc_pdf(p), st["body"]) for p in data["summary"].split("\n") if p.strip()])

    exp = []
    for i, e in enumerate(parse_entries(data.get("experience", ""))):
        t, comp, dt, pl = _tpl_entry(e)
        if i:
            exp.append(Spacer(1, _sz(6.6)))
        exp.append(_tpl_row(_esc_pdf(t), _esc_pdf(dt), st["entry"], st["dates"], BS_MAIN_W))
        emp = " &middot; ".join(_esc_pdf(x) for x in (comp, pl) if x)
        if emp:
            exp.append(Paragraph(emp, st["employer"]))
        if e.get("bullets"):
            exp.append(Spacer(1, _sz(2.2)))
            for b in e["bullets"]:
                exp.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                exp.append(Spacer(1, _sz(1.3)))
    sec("Experience", exp)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(f'<font name="{bold}">{_esc_pdf(n)}</font>', st["body"]))
        if d:
            proj.append(Paragraph(_esc_pdf(d), st["side_val"]))
        proj.append(Spacer(1, _sz(3.2)))
    sec("Projects", proj)
    sec("Publications", [f for p in _lines(data.get("publications", ""))
                         for f in (Paragraph(_esc_pdf(p), st["body"]), Spacer(1, _sz(2.4)))])
    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], BS_MAIN_W))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["employer"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 09 — TIMELINE
# ---------------------------------------------------------------------------
#   Experience and education hang off a vertical rail with a ringed dot per
#   entry, drawn by the flowables themselves so the rail always matches the
#   real height of the block (and splits correctly across pages).
#     rail x 16.7 (1.1 wide) | dot outer 9.2 white, inner 6.9 accent
#     entries indent to 31.6, bullets to 40.9
# ===========================================================================
TL_DEEP = colors.HexColor("#143642")
TL_ACC = colors.HexColor("#4F6D7A")
TL_INK = colors.HexColor("#2C2C2C")
TL_RAIL_X = 2.3          # from the text margin
TL_ENTRY_INDENT = 17.2


class _TimelineEntry(Flowable):
    """Wraps an entry's flowables, drawing the rail segment and marker dot."""

    def __init__(self, flows, rail_x, accent, dot_r=3.5, ring_r=4.6, last=False):
        Flowable.__init__(self)
        self.flows, self.rail_x, self.accent = flows, rail_x, accent
        self.dot_r, self.ring_r, self.last = dot_r, ring_r, last
        self._h = 0

    def wrap(self, availWidth, availHeight):
        self._w = availWidth
        h = 0
        for f in self.flows:
            fw, fh = f.wrap(availWidth, availHeight)
            h += fh + getattr(f, "getSpaceAfter", lambda: 0)()
        self._h = h
        return availWidth, h

    def draw(self):
        c = self.canv
        c.saveState()
        # rail
        c.setFillColor(self.accent)
        c.rect(self.rail_x - 0.55, 0 if not self.last else self._h - 12, 1.1,
               self._h if not self.last else 12, stroke=0, fill=1)
        # marker: white ring with an accent core, sitting on the first line
        cy = self._h - 6.5
        c.setFillColor(colors.white)
        c.circle(self.rail_x, cy, self.ring_r, stroke=0, fill=1)
        c.setFillColor(self.accent)
        c.circle(self.rail_x, cy, self.dot_r, stroke=0, fill=1)
        c.restoreState()
        y = self._h
        for f in self.flows:
            _fw, fh = f.wrap(self._w, self._h)
            y -= fh
            f.drawOn(c, 0, y)
            y -= getattr(f, "getSpaceAfter", lambda: 0)()


def _tl_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, _it = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("tl_name", fontName=bold, fontSize=_sz(18.4), leading=_sz(21.6), textColor=TL_DEEP),
        "role": S("tl_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("tl_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9), textColor=colors.HexColor("#666666")),
        "sec": S("tl_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=TL_DEEP, keepWithNext=1),
        "entry": S("tl_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10), textColor=TL_DEEP,
                   leftIndent=TL_ENTRY_INDENT, keepWithNext=1),
        "dates": S("tl_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10), textColor=colors.HexColor("#888888")),
        "meta": S("tl_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=acc, leftIndent=TL_ENTRY_INDENT),
        "body": S("tl_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.2), textColor=TL_INK),
        "bullet": S("tl_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.2), textColor=TL_INK,
                    leftIndent=26.5, bulletIndent=TL_ENTRY_INDENT + 0.5,
                    bulletFontName=reg, bulletFontSize=_sz(6)),
        "skill_l": S("tl_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=TL_DEEP),
        "skill_v": S("tl_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=TL_INK),
    }


def build_timeline(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else TL_ACC
    st = _tl_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = [c for c in (data.get("location"), data.get("phone"), data.get("email"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph(" &bull; ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if flows:
            story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]), Spacer(1, _sz(8))])
            story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Summary", [Paragraph(_esc_pdf(p), st["body"]) for p in data["summary"].split("\n") if p.strip()])

    def rail_entries(text):
        entries = parse_entries(text)
        out = []
        for i, e in enumerate(entries):
            t, comp, dt, pl = _tpl_entry(e)
            inner = [_tpl_row(_esc_pdf(t), _esc_pdf(dt), st["entry"], st["dates"], width)]
            meta = " &middot; ".join(_esc_pdf(x) for x in (comp, pl) if x)
            if meta:
                inner.append(Paragraph(meta, st["meta"]))
            for b in e.get("bullets", []):
                inner.append(Spacer(1, _sz(1.3)))
                inner.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
            inner.append(Spacer(1, _sz(7)))
            out.append(_TimelineEntry(inner, TL_RAIL_X, acc, last=(i == len(entries) - 1)))
        return out

    sec("Experience", rail_entries(data.get("experience", "")))
    sec("Education", rail_entries(data.get("education", "")))

    rows = _tpl_named_lines(data.get("skills", ""))
    if rows:
        lw = 96
        t = Table([[Paragraph(_esc_pdf(a), st["skill_l"]), Paragraph(_esc_pdf(b), st["skill_v"])] for a, b in rows],
                  colWidths=[lw, width - lw])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 6),
            ("RIGHTPADDING", (1, 0), (1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1.4), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.4),
        ]))
        sec("Skills", [t])

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(f'<font name="{bold}">{_esc_pdf(n)}</font>' + (f" &mdash; {_esc_pdf(d)}" if d else ""),
                              st["body"]))
        proj.append(Spacer(1, _sz(2.6)))
    sec("Projects", proj)
    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            sec(label, [f for it in items for f in (Paragraph(_esc_pdf(it), st["body"]), Spacer(1, _sz(2.4)))])
    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], width))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 10 — INFOGRAPHIC
# ---------------------------------------------------------------------------
#   dark #2B2D42 panel 9.8 -> 205.1 with proficiency bars: a #454A63 track
#   152pt wide, filled in #EF233C. Bar length comes from how many items a
#   skill line lists, which is the only honest signal the form data carries —
#   no invented percentages.
#   main column 222.5 -> 553.8; Title-Case headings over a short red underline
# ===========================================================================
IG_PANEL = colors.HexColor("#2B2D42")
IG_RED = colors.HexColor("#EF233C")
IG_TRACK = colors.HexColor("#454A63")
IG_LIGHT = colors.HexColor("#EDF2F4")
IG_SIDE_TEXT = colors.HexColor("#D8DEE9")
IG_INK = colors.HexColor("#2C2C2C")
IG_PANEL_W = 205.1
IG_SIDE_X = 35.9
IG_SIDE_W = 152.1
IG_MAIN_X = 222.5
IG_MAIN_W = 331.3


class _SkillBar(Flowable):
    """Label above a track/fill pair — the sidebar's proficiency meter."""

    def __init__(self, label, ratio, width, font, size, track, fill, text_colour,
                 bar_h=3.5, gap=3.0):
        Flowable.__init__(self)
        self.label, self.ratio, self.w = label, max(0.12, min(1.0, ratio)), width
        self.font, self.size = font, size
        self.track, self.fill, self.text_colour = track, fill, text_colour
        self.bar_h, self.gap = bar_h, gap

    def wrap(self, availWidth, availHeight):
        self.w = availWidth
        return availWidth, self.size + self.gap + self.bar_h

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(self.text_colour)
        c.setFont(self.font, self.size)
        c.drawString(0, self.bar_h + self.gap + self.size * 0.06, self.label)
        c.setFillColor(self.track)
        c.roundRect(0, 0, self.w, self.bar_h, self.bar_h / 2, stroke=0, fill=1)
        c.setFillColor(self.fill)
        c.roundRect(0, 0, max(self.bar_h, self.w * self.ratio), self.bar_h, self.bar_h / 2, stroke=0, fill=1)
        c.restoreState()


class _UnderlineHead(Flowable):
    """Title-case heading with a short accent underline the width of the text."""

    def __init__(self, text, font, size, leading, colour, bar_colour, bar_h=1.7, gap=4.0):
        Flowable.__init__(self)
        self.text, self.font, self.size, self.leading = text, font, size, leading
        self.colour, self.bar_colour, self.bar_h, self.gap = colour, bar_colour, bar_h, gap

    def wrap(self, availWidth, availHeight):
        return availWidth, self.leading + self.gap + self.bar_h

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(self.colour)
        c.setFont(self.font, self.size)
        c.drawString(0, self.bar_h + self.gap + self.leading - self.size * 0.94, self.text)
        w = c.stringWidth(self.text, self.font, self.size)
        c.setFillColor(self.bar_colour)
        c.rect(0, 0, w, self.bar_h, stroke=0, fill=1)
        c.restoreState()


def _ig_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, _it = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("ig_name", fontName=bold, fontSize=_sz(15.6), leading=_sz(18.4), textColor=IG_LIGHT),
        "role": S("ig_role", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.4), textColor=acc),
        "side_h": S("ig_side_h", fontName=bold, fontSize=_sz(7.5), leading=_sz(9.8), textColor=acc),
        "side_line": S("ig_side_line", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.8), textColor=IG_SIDE_TEXT),
        "side_lab": S("ig_side_lab", fontName=bold, fontSize=_sz(6.3), leading=_sz(8.6), textColor=IG_LIGHT),
        "entry": S("ig_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10), textColor=IG_INK, keepWithNext=1),
        "dates": S("ig_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10), textColor=colors.HexColor("#888888")),
        "employer": S("ig_emp", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=acc),
        "body": S("ig_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=IG_INK),
        "bullet": S("ig_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(9.8), textColor=IG_INK,
                    leftIndent=8.7, bulletIndent=_sz(0.4), bulletFontName=reg, bulletFontSize=_sz(6)),
    }


def build_infographic(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else IG_RED
    st = _ig_styles(acc)
    reg, bold, _it = _fonts()

    def paint(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(IG_PANEL)
        canvas.rect(0, 0, IG_PANEL_W, TPL_PAGE[1], stroke=0, fill=1)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    top, bottom = 50.0, TPL_MIN_MARGIN
    side = Frame(IG_SIDE_X, bottom, IG_SIDE_W, TPL_PAGE[1] - top - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="side")
    main = Frame(IG_MAIN_X, bottom, IG_MAIN_W, TPL_PAGE[1] - 58 - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="main")
    cont = Frame(IG_MAIN_X, bottom, IG_MAIN_W, TPL_PAGE[1] - 34 - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="cont")
    doc.addPageTemplates([
        PageTemplate(id="cols", frames=[side, main], onPage=paint),
        PageTemplate(id="cont", frames=[cont], onPage=paint),
    ])

    story = [NextPageTemplate("cont"),
             Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.2)), Paragraph(_esc_pdf(data["title"]), st["role"])]

    def side_sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(9)), Paragraph(_esc_pdf(title).upper(), st["side_h"]), Spacer(1, _sz(4.8))])
        story.extend(flows)

    contact = [c for c in (data.get("phone"), data.get("email"), data.get("location"),
                           data.get("linkedin"), data.get("website")) if c and c.strip()]
    side_sec("Contact", [f for c in contact
                         for f in (Paragraph(_esc_pdf(c), st["side_line"]), Spacer(1, _sz(1.2)))])

    rows = _tpl_named_lines(data.get("skills", ""))
    if rows:
        counts = [max(1, len([i for i in v.split(",") if i.strip()])) for _l, v in rows]
        top_n = max(counts)
        bars = []
        for (label, value), n in zip(rows, counts):
            bars.append(_SkillBar(label or value[:28], n / top_n, IG_SIDE_W, bold, _sz(6.3),
                                  IG_TRACK, acc, IG_LIGHT))
            bars.append(Spacer(1, _sz(6.2)))
        side_sec("Skill Focus", bars)

    ed = []
    for e in parse_entries(data.get("education", "")):
        t, comp, dt, pl = _tpl_entry(e)
        ed.append(Paragraph(_esc_pdf(t), st["side_lab"]))
        detail = ", ".join(x for x in (comp or pl, dt) if x)
        if detail:
            ed.append(Paragraph(_esc_pdf(detail), st["side_line"]))
        ed.append(Spacer(1, _sz(3.6)))
    side_sec("Education", ed)
    side_sec("Certifications", [f for c in _lines(data.get("certifications", ""))
                                for f in (Paragraph(_esc_pdf(c), st["side_line"]), Spacer(1, _sz(2.6)))])

    story.append(FrameBreak())

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)),
                      _UnderlineHead(str(title), bold, _sz(9.2), _sz(11.4), IG_PANEL, acc),
                      Spacer(1, _sz(8.4))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        sec("Summary", [Paragraph(_esc_pdf(p), st["body"]) for p in data["summary"].split("\n") if p.strip()])

    exp = []
    for i, e in enumerate(parse_entries(data.get("experience", ""))):
        t, comp, dt, pl = _tpl_entry(e)
        if i:
            exp.append(Spacer(1, _sz(6.6)))
        exp.append(_tpl_row(_esc_pdf(t), _esc_pdf(dt), st["entry"], st["dates"], IG_MAIN_W))
        emp = " &middot; ".join(_esc_pdf(x) for x in (comp, pl) if x)
        if emp:
            exp.append(Paragraph(emp, st["employer"]))
        if e.get("bullets"):
            exp.append(Spacer(1, _sz(2.2)))
            for b in e["bullets"]:
                exp.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                exp.append(Spacer(1, _sz(1.3)))
    sec("Experience", exp)

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(f'<font name="{bold}">{_esc_pdf(n)}</font>', st["body"]))
        if d:
            proj.append(Paragraph(_esc_pdf(d), st["dates"]))
        proj.append(Spacer(1, _sz(3.2)))
    sec("Projects", proj)
    sec("Publications", [f for p in _lines(data.get("publications", ""))
                         for f in (Paragraph(_esc_pdf(p), st["body"]), Spacer(1, _sz(2.4)))])
    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["dates"], IG_MAIN_W))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["employer"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# 11 — CORPORATE LETTER  (US Letter, Arial)
# ---------------------------------------------------------------------------
#   The one layout here on US Letter rather than A4, and the only one built
#   around a centred masthead: 17pt caps name, role and contact centred under
#   it, then full-width ruled section headings. Summary reads as bullets and
#   skills as bold "Label: value" lines. This is the shape a recruiter in the
#   US or a Word-based ATS sees most often.
#     margins 45 / 44.5 | name 17 bold caps | heads 11 bold caps + rule
#     body 10 | bullets indented 8
# ===========================================================================
CL_PAGE = LETTER
CL_MARGIN = 45.0
CL_INK = colors.black
CL_MUTED = colors.HexColor("#404040")


def _cl_styles(acc):
    _set_type_base(10.0)   # the body size this design was drawn at
    reg, bold, _it = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("cl_name", fontName=bold, fontSize=_sz(17), leading=_sz(20), alignment=TA_CENTER, textColor=CL_INK),
        "role": S("cl_role", fontName=reg, fontSize=_sz(11.5), leading=_sz(14), alignment=TA_CENTER, textColor=CL_MUTED),
        "contact": S("cl_contact", fontName=reg, fontSize=_sz(9), leading=_sz(12), alignment=TA_CENTER, textColor=CL_MUTED),
        "sec": S("cl_sec", fontName=bold, fontSize=_sz(11), leading=_sz(13.4), textColor=acc, keepWithNext=1),
        "entry": S("cl_entry", fontName=bold, fontSize=_sz(10.6), leading=_sz(13), textColor=CL_INK, keepWithNext=1),
        "meta": S("cl_meta", fontName=reg, fontSize=_sz(9.5), leading=_sz(12), textColor=CL_MUTED),
        "body": S("cl_body", fontName=reg, fontSize=_sz(10), leading=_sz(13.4), textColor=CL_INK),
        "bullet": S("cl_bullet", fontName=reg, fontSize=_sz(10), leading=_sz(13.4), textColor=CL_INK,
                    leftIndent=18, bulletIndent=8, bulletFontName=reg, bulletFontSize=_sz(8)),
    }


def build_corporate_letter(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else CL_INK
    st = _cl_styles(acc)
    reg, bold, _it = _fonts()
    width = CL_PAGE[0] - 2 * CL_MARGIN
    doc = BaseDocTemplate(output_path, pagesize=CL_PAGE,
                          leftMargin=CL_MARGIN, rightMargin=CL_MARGIN, topMargin=38, bottomMargin=40,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    doc.addPageTemplates([PageTemplate(id="body", frames=[
        Frame(CL_MARGIN, 40, width, CL_PAGE[1] - 78,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="f")])])

    story = [Paragraph(_esc_pdf(data.get("full_name", "")).upper(), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    line1 = [c for c in (data.get("location"), data.get("phone"), data.get("email")) if c and c.strip()]
    line2 = [c for c in (data.get("linkedin"), data.get("website")) if c and c.strip()]
    for group in (line1, line2):
        if group:
            story += [Spacer(1, _sz(3)), Paragraph(" | ".join(_esc_pdf(c) for c in group), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(title).upper(), st["sec"]), Spacer(1, _sz(2.4)),
                      HRFlowable(width="100%", thickness=0.72, color=acc, spaceBefore=0, spaceAfter=0),
                      Spacer(1, _sz(8))])
        story.extend(flows)

    if (data.get("summary") or "").strip():
        # The source states the summary as bullet points rather than a block.
        bits = [p.strip() for p in data["summary"].split("\n") if p.strip()]
        if len(bits) == 1:
            bits = [s.strip() + "." for s in bits[0].split(". ") if s.strip()]
        sec("Professional Summary",
            [f for b in bits for f in (Paragraph(_esc_pdf(b.rstrip(".")) + ".", st["bullet"], bulletText="•"),
                                       Spacer(1, _sz(1.6)))])

    skills = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        skills.append(Paragraph(
            f'<font name="{bold}">{_esc_pdf(label)}:</font> {_esc_pdf(value)}' if label else _esc_pdf(value),
            st["body"]))
        skills.append(Spacer(1, _sz(2)))
    sec("Technical Skills", skills)

    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            t, comp, dt, pl = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(8)))
            out.append(_tpl_row(_esc_pdf(t), _esc_pdf(dt), st["entry"], st["meta"], width, split=0.68))
            meta = ", ".join(_esc_pdf(x) for x in (comp, pl) if x)
            if meta:
                out.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                out.append(Spacer(1, _sz(2.4)))
                for b in e["bullets"]:
                    out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    out.append(Spacer(1, _sz(1.6)))
        return out

    sec("Professional Experience", entries(data.get("experience", "")))
    sec("Education", entries(data.get("education", "")))

    proj = []
    for n, d in _tpl_project_lines(data.get("projects", "")):
        proj.append(Paragraph(
            f'<font name="{bold}">{_esc_pdf(n)}:</font> {_esc_pdf(d)}' if d else f'<font name="{bold}">{_esc_pdf(n)}</font>',
            st["bullet"], bulletText="•"))
        proj.append(Spacer(1, _sz(2)))
    sec("Projects", proj)
    for key, label in (("publications", "Publications"), ("certifications", "Certifications")):
        items = _lines(data.get(key, ""))
        if items:
            sec(label, [f for it in items
                        for f in (Paragraph(_esc_pdf(it), st["bullet"], bulletText="•"), Spacer(1, _sz(2)))])
    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        flows = []
        for it in (cs.get("items") or []):
            if not isinstance(it, dict):
                continue
            if it.get("heading"):
                flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                      st["entry"], st["meta"], width, split=0.68))
            if it.get("subheading"):
                flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
            for b in (it.get("bullets") or []):
                flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        sec(cs.get("title") or "Additional", flows)

    doc.build(story)


# ===========================================================================
# SHARED SCAFFOLDING FOR THE SECOND BATCH (11 – 19)
# ---------------------------------------------------------------------------
# The nine templates below differ in their furniture — banners, rules, chips,
# cards — but they agree on how the *content* is laid out: an entry is a bold
# title with dates flush right, then a meta line, then bullets; skills are
# "Label: values" rows; publications and certifications are plain lines.
# Repeating that plumbing nine times is how the earlier templates drifted out
# of sync with each other, so here each template supplies only its own styles,
# header and section emitter, and hands them to _tpl_compose(), overriding the
# pieces that are genuinely part of its design.
#
# Every number in the per-template comment blocks was measured off that
# template's source PDF, which is why they are specific rather than tidy.
# ===========================================================================

_TPL_SECTION_LABELS = {
    "summary": "Summary", "experience": "Experience", "education": "Education",
    "skills": "Skills", "projects": "Projects", "publications": "Publications",
    "certifications": "Certifications",
}
_TPL_SECTION_ORDER = ("summary", "experience", "education", "skills", "projects",
                      "publications", "certifications")


def _tpl_contact(data, keys=("location", "phone", "email", "linkedin", "website")):
    """The contact bits a header shows, in order, skipping anything blank."""
    return [str(data[k]).strip() for k in keys if data.get(k) and str(data[k]).strip()]


def _tpl_entry_flows(text, st, width, *, split=0.72, meta_join=" &middot; ",
                     gap=7.0, bullet_gap=1.4, meta_gap=0.0):
    """Role/dates row, meta line, bullets — the shape every template shares."""
    out = []
    for i, e in enumerate(parse_entries(text)):
        title, company, dates, place = _tpl_entry(e)
        if i:
            out.append(Spacer(1, _sz(gap)))
        out.append(_tpl_row(_esc_pdf(title), _esc_pdf(dates),
                            st["entry"], st["dates"], width, split))
        meta = meta_join.join(_esc_pdf(x) for x in (company, place) if x)
        if meta:
            if meta_gap:
                out.append(Spacer(1, _sz(meta_gap)))
            out.append(Paragraph(meta, st["meta"]))
        if e.get("bullets"):
            out.append(Spacer(1, _sz(2.2)))
            for b in e["bullets"]:
                out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                out.append(Spacer(1, _sz(bullet_gap)))
    return out


def _tpl_skill_rows(text, st, width, label_w=95.0, pad=1.4):
    """Skills as a two-column table: bold label, then its values."""
    rows = _tpl_named_lines(text)
    if not rows:
        return []
    t = Table([[Paragraph(_esc_pdf(a), st["skill_l"]), Paragraph(_esc_pdf(b), st["skill_v"])]
               for a, b in rows], colWidths=[label_w, width - label_w])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 6),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return [t]


def _split_skill_list(value: str) -> list[str]:
    """Split a comma-separated skill list, ignoring commas inside brackets.

    "AWS (Redshift, S3, Glue)" is one skill, not three. A plain split on ","
    tore it into "AWS (Redshift", "S3" and "Glue)" — three chips, two of them
    carrying half a bracket. Depth counting keeps any parenthesised aside with
    the skill it belongs to.
    """
    out, buf, depth = [], [], 0
    for ch in value or "":
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [s.strip() for s in out if s.strip()]


def _tpl_chip_items(text):
    """Skills flattened to individual chip labels, losing the group names."""
    items = []
    for _label, value in _tpl_named_lines(text):
        items += _split_skill_list(value)
    return items


def _tpl_skill_grid(text, st, width, cols=2, gutter=18.0, label_w=78.0):
    """Skills as a grid of label/value pairs — two groups per line."""
    rows = _tpl_named_lines(text)
    if not rows:
        return []
    col_w = (width - gutter * (cols - 1)) / cols

    def cell(pair):
        if pair is None:
            return ""
        label, value = pair
        inner = Table([[Paragraph(_esc_pdf(label), st["skill_l"])],
                       [Paragraph(_esc_pdf(value), st["skill_v"])]], colWidths=[col_w])
        inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (0, 0), 1.2),
            ("BOTTOMPADDING", (0, 1), (0, 1), 0),
        ]))
        return inner

    # A gutter is a real (empty) column between each pair of content columns.
    widths = [col_w] + [gutter, col_w] * (cols - 1)
    padded = rows + [None] * ((-len(rows)) % cols)
    body = []
    for i in range(0, len(padded), cols):
        row = []
        for n, pair in enumerate(padded[i:i + cols]):
            if n:
                row.append("")
            row.append(cell(pair))
        body.append(row)
    t = Table(body, colWidths=widths)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return [t]


def _tpl_pairs(data, spec):
    """[(label, data-key)] -> [(label, value)] for whichever fields are filled."""
    out = []
    for label, key in spec:
        value = (data.get(key) or "").strip() if isinstance(data.get(key), str) else data.get(key)
        if value:
            out.append((label, str(value)))
    return out


def _tpl_pair_rows(pairs, st, width, label_w=110.0, pad=1.6, rule=None):
    """Personal-details / languages block: label column, value column."""
    if not pairs:
        return []
    t = Table([[Paragraph(_esc_pdf(a), st["skill_l"]), Paragraph(_esc_pdf(b), st["skill_v"])]
               for a, b in pairs], colWidths=[label_w, width - label_w])
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 6),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]
    if rule is not None:
        style.append(("LINEBELOW", (0, 0), (-1, -2), 0.4, rule))
    t.setStyle(TableStyle(style))
    return [t]


class _TplPhoto(Flowable):
    """The customer's photo, cropped to a circle.

    Résumés are stored as text, so for years there was no image to place. Now
    that an account can carry a photo, the templates that hold a picture slot
    draw the real thing — cover-cropped rather than squashed, because a CV photo
    stretched to fit is worse than no photo at all.
    """

    def __init__(self, path, size=54.0, ring=None):
        Flowable.__init__(self)
        self.path, self.size, self.ring = path, size, ring

    def wrap(self, availWidth, availHeight):
        return self.size, self.size

    def draw(self):
        from reportlab.lib.utils import ImageReader
        c = self.canv
        s = self.size
        try:
            img = ImageReader(self.path)
            iw, ih = img.getSize()
        except Exception:
            return                      # unreadable file: leave the space empty
        # Cover crop: scale so the shorter side fills the circle, centre the rest.
        scale = max(s / iw, s / ih)
        w, h = iw * scale, ih * scale
        c.saveState()
        p = c.beginPath()
        p.circle(s / 2.0, s / 2.0, s / 2.0)
        c.clipPath(p, stroke=0, fill=0)
        c.drawImage(img, (s - w) / 2.0, (s - h) / 2.0, width=w, height=h, mask="auto")
        c.restoreState()
        if self.ring is not None:
            c.setStrokeColor(self.ring)
            c.setLineWidth(1.0)
            c.circle(s / 2.0, s / 2.0, s / 2.0 - 0.5, stroke=1, fill=0)


def _tpl_avatar(data, size=54.0, bg=None, fg=colors.white):
    """The photo slot: the person's picture if they have one, initials if not.

    Falling back to initials rather than a grey silhouette matters — these are
    the markets (EU, DE, IN, Gulf, JP) where a CV without a picture looks
    unfinished, and an initials disc still reads as deliberate.
    """
    path = (data.get("photo_path") or "").strip()
    if path and os.path.exists(path):
        return _TplPhoto(path, size=size, ring=colors.HexColor("#00000022"))
    initials = _tpl_initials(data) or "?"
    return _avatar_drawing(initials, size=size, bg=bg or _acc(), fg=fg)


def _tpl_signature_row(data, st, width, date_label="Date", sign_label="Signature"):
    """Place-and-date over a signature line — expected in DE, IN and JP CVs."""
    left = Paragraph(f"{_esc_pdf(date_label)}: ______________________", st["body"])
    right = Paragraph(f"{_esc_pdf(sign_label)}: ______________________", st["body"])
    t = Table([[left, right]], colWidths=[width * 0.5, width * 0.5])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    return t


def _tpl_marker(entity, color=None):
    """Markup for a decorative heading marker, in a font that actually has it.

    A diamond or triangle is not in the base-14 fonts (nor in Lato), where it
    silently renders as a null glyph. DejaVu ships with the app and does have
    them, so the marker — and only the marker — is set in DejaVu.
    """
    attrs = ' name="DejaVuSans-Bold"' if _REG.get("DejaVuSans") else ""
    if not attrs:
        entity = "&bull;"
    if color is not None:
        attrs += f' color="#{color.hexval()[2:]}"'
    return f"<font{attrs}>{entity}</font>"


def _tpl_bar_block(flows, width, color, thickness=2.0, pad=8.0, bg=None):
    """Wrap an entry in an accent bar down its left edge (no card fill)."""
    t = Table([[flows]], colWidths=[width], splitInRow=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBEFORE", (0, 0), (0, -1), thickness, color),
        ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]
    if bg is not None:
        style.append(("BACKGROUND", (0, 0), (-1, -1), bg))
    t.setStyle(TableStyle(style))
    return t


def _tpl_paper_card(flows, width, border, shadow, bg=colors.white, pad=8.0, offset=2.2):
    """A white card with a hairline border and an offset shadow behind it.

    The shadow is the outer table's own background showing through on the right
    and bottom, which is the only way to fake an offset without a second draw
    pass — TableStyle has no notion of an offset fill.
    """
    inner = Table([[flows]], colWidths=[width - offset], splitInRow=1)
    inner.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.5, border),
        ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad * 0.75), ("BOTTOMPADDING", (0, 0), (-1, -1), pad * 0.75),
    ]))
    outer = Table([[inner]], colWidths=[width], splitInRow=1)
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), shadow),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), offset),
    ]))
    return outer


def _tpl_dash_lines(pairs, st, bold, gap=2.4, key="item", sep=" &mdash; "):
    """'Name — description' lines with the name in bold."""
    out = []
    for name, detail in pairs:
        html = f'<font name="{bold}">{_esc_pdf(name)}</font>'
        if detail:
            html += sep + _esc_pdf(detail)
        out.append(Paragraph(html, st[key]))
        out.append(Spacer(1, _sz(gap)))
    return out


def _tpl_plain_lines(items, st, gap=2.2, key="item"):
    out = []
    for it in items:
        out.append(Paragraph(_esc_pdf(it), st[key]))
        out.append(Spacer(1, _sz(gap)))
    return out


def _tpl_custom_flows(cs, st, width):
    """A customer-defined section's items, in the template's own styles.

    Kept as its own function because a template that doesn't route everything
    through _tpl_compose (the rirekisho, for one) still has to render these —
    a section the customer typed must never silently vanish from the PDF.
    """
    flows = []
    for it in (cs.get("items") or []):
        if not isinstance(it, dict):
            continue
        if it.get("heading"):
            flows.append(_tpl_row(_esc_pdf(it["heading"]), _esc_pdf(it.get("meta", "")),
                                  st["entry"], st["dates"], width))
        if it.get("subheading"):
            flows.append(Paragraph(_esc_pdf(it["subheading"]), st["meta"]))
        if it.get("text"):
            flows.append(Paragraph(_esc_pdf(it["text"]), st["body"]))
        for b in (it.get("bullets") or []):
            flows.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
    return flows


def _tpl_compose(data, st, width, sec, bold, *, labels=None, order=None,
                 entries=None, skills=None, projects=None):
    """Emit every content section through the template's own `sec(title, flows)`.

    `entries`, `skills` and `projects` are hooks so a template can render those
    three differently (cards, chips, columns) without restating the rest.
    """
    L = dict(_TPL_SECTION_LABELS, **(labels or {}))
    entries = entries or (lambda text: _tpl_entry_flows(text, st, width))
    skills = skills or (lambda text: _tpl_skill_rows(text, st, width))
    projects = projects or (lambda text: _tpl_dash_lines(_tpl_project_lines(text), st, bold))

    for key in (order or _TPL_SECTION_ORDER):
        if key == "summary":
            summary = (data.get("summary") or "").strip()
            if summary:
                sec(L[key], [Paragraph(_esc_pdf(p), st["body"])
                             for p in summary.split("\n") if p.strip()])
        elif key in ("experience", "education"):
            sec(L[key], entries(data.get(key, "")))
        elif key == "skills":
            sec(L[key], skills(data.get("skills", "")))
        elif key == "projects":
            sec(L[key], projects(data.get("projects", "")))
        else:
            sec(L[key], _tpl_plain_lines(_lines(data.get(key, "")), st))

    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        sec(cs.get("title") or "Additional", _tpl_custom_flows(cs, st, width))


class _TplRule(Flowable):
    """A rule of a stated colour and thickness, optionally only part-width.

    HRFlowable can do this, but it reserves leading above and below that the
    measured designs don't have — these rules sit tight under their heading.
    """

    def __init__(self, width, color, thickness=0.6, frac=1.0):
        Flowable.__init__(self)
        self.avail, self.color, self.thickness, self.frac = width, color, thickness, frac

    def wrap(self, availWidth, availHeight):
        self.avail = availWidth
        return availWidth, self.thickness

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.avail * self.frac, self.thickness, stroke=0, fill=1)


class _TplTextRule(Flowable):
    """A short rule as wide as the heading text above it (magazine underlines)."""

    def __init__(self, text, font, size, color, thickness=1.6, extra=6.0):
        Flowable.__init__(self)
        self.w = _pdfmetrics.stringWidth(text, font, size) + extra
        self.color, self.thickness = color, thickness

    def wrap(self, availWidth, availHeight):
        return min(self.w, availWidth), self.thickness

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.w, self.thickness, stroke=0, fill=1)


# ===========================================================================
# 11 — COMPACT ONE-PAGE
# ---------------------------------------------------------------------------
#   A4, margins 14.4pt, ink #111111, no colour anywhere
#   header centred on one line: "Name — Title" 11.5pt bold, contact 5.8pt #333
#   section head 6.9pt bold caps over a full-width 0.9pt #333333 rule
#   body 6.3pt / 8.1 leading — everything is tightened to buy vertical space
#   entry collapses to a single bold line: "Role, Company (Dates)"
#   bullets 6.3pt indented 8pt, 1.1pt between them
#   skills as 6.3pt "Label: values" lines, label bold, no table gutter
# ===========================================================================
CO_INK = colors.HexColor("#111111")
CO_RULE = colors.HexColor("#333333")
CO_META = colors.HexColor("#333333")


def _co_styles():
    _set_type_base(6.3)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("co_name", fontName=bold, fontSize=_sz(11.5), leading=_sz(13.6),
                  textColor=CO_INK, alignment=TA_CENTER),
        "contact": S("co_contact", fontName=reg, fontSize=_sz(5.8), leading=_sz(7.8),
                     textColor=CO_META, alignment=TA_CENTER),
        "sec": S("co_sec", fontName=bold, fontSize=_sz(6.9), leading=_sz(8.4),
                 textColor=CO_INK, keepWithNext=1),
        "entry": S("co_entry", fontName=bold, fontSize=_sz(6.3), leading=_sz(8.4),
                   textColor=CO_INK, keepWithNext=1),
        "dates": S("co_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.4), textColor=CO_META),
        "meta": S("co_meta", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.1),
                  textColor=colors.HexColor("#555555")),
        "body": S("co_body", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.1), textColor=CO_INK),
        "bullet": S("co_bullet", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.1), textColor=CO_INK,
                    leftIndent=8.0, bulletIndent=_sz(0.4), bulletFontName=reg, bulletFontSize=_sz(5)),
        "skill_l": S("co_sk_l", fontName=bold, fontSize=_sz(6.3), leading=_sz(8.4), textColor=CO_INK),
        "skill_v": S("co_sk_v", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.4), textColor=CO_INK),
        "item": S("co_item", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.1), textColor=CO_INK),
    }


def build_compact_onepage(data: dict, output_path: str):
    st = _co_styles()
    reg, bold, _it = _fonts()
    rule_color = _acc() if data.get("accent_color") else CO_RULE
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=16)

    headline = _esc_pdf(data.get("full_name", ""))
    if data.get("title"):
        headline += " &mdash; " + _esc_pdf(data["title"])
    story = [Paragraph(headline, st["name"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(2.6)),
                  Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(6)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.6)), _TplRule(width, rule_color, 0.9), Spacer(1, _sz(3.4))])
        story.extend(flows)

    def entries(text):
        """One bold line per role — the densest thing that still reads."""
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(4.4)))
            head = ", ".join(_esc_pdf(x) for x in (title, company, place) if x)
            if dates:
                head += f" ({_esc_pdf(dates)})"
            out.append(Paragraph(head, st["entry"]))
            for b in e.get("bullets", []):
                out.append(Spacer(1, _sz(1.1)))
                out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
        return out

    def skills(text):
        rows = _tpl_named_lines(text)
        return [Paragraph(
            (f'<font name="{bold}">{_esc_pdf(a)}:</font> ' if a else "") + _esc_pdf(b),
            st["body"]) for a, b in rows]

    _tpl_compose(data, st, width, sec, bold, entries=entries, skills=skills)
    doc.build(story)


# ===========================================================================
# 12 — ELEGANT BANNER
# ---------------------------------------------------------------------------
#   serif throughout, margins 49pt — the widest of the set
#   full-bleed navy #1A1A2E banner 116pt tall, closed by a 3pt gold #C9A24B rule
#   name 19pt serif white centred, role 8.6pt gold caps, contact 6.9pt #DDDDDD
#   section heads 8.6pt serif bold caps navy over a full-width gold hairline
#   body 7.5pt / 10.4, meta italic #555555, dates italic #777777
# ===========================================================================
EB_NAVY = colors.HexColor("#1A1A2E")
EB_GOLD = colors.HexColor("#C9A24B")
EB_INK = colors.HexColor("#242424")
EB_BANNER_TEXT = colors.HexColor("#DDDDDD")
EB_MARGIN = 49.0
EB_BAND_H = 116.0


def _eb_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("eb_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=EB_NAVY, keepWithNext=1),
        "entry": S("eb_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4),
                   textColor=EB_INK, keepWithNext=1),
        "dates": S("eb_dates", fontName=ital, fontSize=_sz(6.9), leading=_sz(10.4),
                   textColor=colors.HexColor("#777777")),
        "meta": S("eb_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#555555")),
        "body": S("eb_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=EB_INK),
        "bullet": S("eb_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=EB_INK,
                    leftIndent=10.4, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("eb_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=EB_INK),
        "skill_v": S("eb_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=EB_INK),
        "item": S("eb_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=EB_INK),
    }


def build_elegant_banner(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else EB_GOLD
    st = _eb_styles(acc)
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * EB_MARGIN

    def paint_banner(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(EB_NAVY)
        canvas.rect(0, TPL_PAGE[1] - EB_BAND_H, TPL_PAGE[0], EB_BAND_H, stroke=0, fill=1)
        canvas.setFillColor(acc)
        canvas.rect(0, TPL_PAGE[1] - EB_BAND_H, TPL_PAGE[0], 3.0, stroke=0, fill=1)
        cx = TPL_PAGE[0] / 2.0
        canvas.setFillColor(colors.white)
        canvas.setFont(bold, _sz(19))
        canvas.drawCentredString(cx, TPL_PAGE[1] - 54, data.get("full_name", ""))
        if data.get("title"):
            canvas.setFillColor(acc)
            canvas.setFont(reg, _sz(8.6))
            canvas.drawCentredString(cx, TPL_PAGE[1] - 76, str(data["title"]).upper())
        contact = _tpl_contact(data)
        if contact:
            canvas.setFillColor(EB_BANNER_TEXT)
            canvas.setFont(reg, _sz(6.9))
            # Two centred lines if one would run past the banner's inner width.
            line = "   |   ".join(contact)
            if _pdfmetrics.stringWidth(line, reg, _sz(6.9)) > TPL_PAGE[0] - 2 * EB_MARGIN:
                half = (len(contact) + 1) // 2
                canvas.drawCentredString(cx, TPL_PAGE[1] - 92, "   |   ".join(contact[:half]))
                canvas.drawCentredString(cx, TPL_PAGE[1] - 101, "   |   ".join(contact[half:]))
            else:
                canvas.drawCentredString(cx, TPL_PAGE[1] - 95, line)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(EB_MARGIN, 40, width, TPL_PAGE[1] - EB_BAND_H - 24 - 40,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(EB_MARGIN, 40, width, TPL_PAGE[1] - 44 - 40,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_banner),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.2)), _TplRule(width, acc, 0.7), Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold)
    doc.build(story)


# ===========================================================================
# 13 — NEWSPAPER COLUMNS
# ---------------------------------------------------------------------------
#   serif, margins 14.4pt, ink #111111 — an editorial masthead, no colour
#   masthead opens with a 2pt + 0.8pt rule pair, then the name 21.3pt serif
#   bold centred, role 8.1pt caps, contact 6.3pt #444444, then the pair again
#   section heads 8.1pt serif bold caps over a full-width 0.7pt rule
#   body 7.5pt / 10.4, meta 6.9pt italic #444444
# ===========================================================================
NC_INK = colors.HexColor("#111111")
NC_META = colors.HexColor("#444444")


def _nc_styles():
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("nc_name", fontName=bold, fontSize=_sz(21.3), leading=_sz(24.6),
                  textColor=NC_INK, alignment=TA_CENTER),
        "role": S("nc_role", fontName=reg, fontSize=_sz(8.1), leading=_sz(10.4),
                  textColor=NC_INK, alignment=TA_CENTER),
        "contact": S("nc_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.6),
                     textColor=NC_META, alignment=TA_CENTER),
        "sec": S("nc_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2),
                 textColor=NC_INK, keepWithNext=1),
        "entry": S("nc_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4),
                   textColor=NC_INK, keepWithNext=1),
        "dates": S("nc_dates", fontName=ital, fontSize=_sz(6.9), leading=_sz(10.4), textColor=NC_META),
        "meta": S("nc_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6), textColor=NC_META),
        "body": S("nc_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=NC_INK),
        "bullet": S("nc_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=NC_INK,
                    leftIndent=10.0, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("nc_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=NC_INK),
        "skill_v": S("nc_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=NC_INK),
        "item": S("nc_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=NC_INK),
    }


def build_newspaper_columns(data: dict, output_path: str):
    st = _nc_styles()
    reg, bold, _it = _fonts()
    ink = _acc() if data.get("accent_color") else NC_INK
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=14.4)

    def masthead_rules():
        return [_TplRule(width, ink, 2.0), Spacer(1, 1.0), _TplRule(width, ink, 0.8)]

    story = masthead_rules() + [Spacer(1, _sz(8)),
                                Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(str(data["title"]).upper()), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("   &middot;   ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(7))] + masthead_rules()

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, ink, 0.7), Spacer(1, _sz(5.6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold)
    doc.build(story)


# ===========================================================================
# 14 — SWISS GRID
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, red accent #D7263D on an otherwise mono page
#   name 23.1pt bold caps left, tracked +0.6pt | role 8.6pt bold caps red
#   a single 0.6pt #111111 hairline closes the header, contact 6.3pt #444 below
#   section heads 7.5pt bold caps red, tracked +0.9pt, no rule
#   entry 7.5pt bold, dates 6.3pt #888888 right, meta 6.9pt #555555
# ===========================================================================
SG_RED = colors.HexColor("#D7263D")
SG_INK = colors.HexColor("#111111")
SG_META = colors.HexColor("#444444")


def _sg_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "contact": S("sg_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.6), textColor=SG_META),
        "entry": S("sg_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4),
                   textColor=SG_INK, keepWithNext=1),
        "dates": S("sg_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10.4),
                   textColor=colors.HexColor("#888888")),
        "meta": S("sg_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#555555")),
        "body": S("sg_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SG_INK),
        "bullet": S("sg_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SG_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("sg_sk_l", fontName=bold, fontSize=_sz(6.3), leading=_sz(9.4),
                     textColor=colors.HexColor("#888888")),
        "skill_v": S("sg_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=SG_INK),
        "item": S("sg_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SG_INK),
    }


def build_swiss_grid(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else SG_RED
    st = _sg_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [_HCTracked(str(data.get("full_name", "")).upper(), bold, _sz(23.1), _sz(26),
                        tracking=_sz(0.6), color=SG_INK)]
    if data.get("title"):
        story += [Spacer(1, _sz(6)),
                  _HCTracked(str(data["title"]).upper(), bold, _sz(8.6), _sz(10.6),
                             tracking=_sz(1.2), color=acc)]
    story += [Spacer(1, _sz(8)), _TplRule(width, SG_INK, 0.6), Spacer(1, _sz(6))]
    contact = _tpl_contact(data)
    if contact:
        story.append(Paragraph("  &mdash;  ".join(_esc_pdf(c) for c in contact), st["contact"]))

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)),
                      _HCTracked(_esc_pdf(title).upper(), bold, _sz(7.5), _sz(9.4),
                                 tracking=_sz(0.9), color=acc),
                      Spacer(1, _sz(8))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=110))
    doc.build(story)


# ===========================================================================
# 15 — PASTEL SOFT
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, plum ink #6B4E71 over a pink #F2B5D4 accent
#   name 19pt bold plum | role 8.6pt bold #A1789E | contact 6.3pt #888888
#   section heads 8.6pt bold: a pink diamond, then the label in plum, title case
#   experience and education entries sit on pale pink cards with a pink left bar
#   skills render as rounded chips, plum text on a pale pink fill
#   body 7.5pt / 10.4 #3D3D3D
# ===========================================================================
PS_PINK = colors.HexColor("#F2B5D4")
PS_PLUM = colors.HexColor("#6B4E71")
PS_MAUVE = colors.HexColor("#A1789E")
PS_CARD = colors.HexColor("#FCF3F8")
PS_BODY = colors.HexColor("#3D3D3D")


def _ps_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("ps_name", fontName=bold, fontSize=_sz(19), leading=_sz(22), textColor=PS_PLUM),
        "role": S("ps_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=PS_MAUVE),
        "contact": S("ps_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.6),
                     textColor=colors.HexColor("#888888")),
        "sec": S("ps_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=PS_PLUM, keepWithNext=1),
        "entry": S("ps_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.2),
                   textColor=PS_PLUM, keepWithNext=1),
        "dates": S("ps_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10.2), textColor=PS_MAUVE),
        "meta": S("ps_meta", fontName=reg, fontSize=_sz(6.3), leading=_sz(9), textColor=PS_MAUVE),
        "body": S("ps_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=PS_BODY),
        "bullet": S("ps_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=PS_BODY,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("ps_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=PS_PLUM),
        "skill_v": S("ps_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=PS_BODY),
        "item": S("ps_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=PS_BODY),
    }


def _ps_card(flows, width, accent, pad=7.0):
    """One entry on a pale card with an accent bar down its left edge.

    splitInRow lets a card that runs past the page break carry on overleaf
    instead of being pushed whole onto the next page (or overflowing it).
    """
    t = Table([[flows]], colWidths=[width], splitInRow=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), PS_CARD),
        ("LINEBEFORE", (0, 0), (0, -1), 2.0, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), pad + 3), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]
    t.setStyle(TableStyle(style))
    return t


def build_pastel_soft(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else PS_PINK
    st = _ps_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("  &bull;  ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        # Diamond marker in the accent, label in plum — a two-colour heading.
        head = f"{_tpl_marker('&#9670;', acc)}  {_esc_pdf(title)}"
        story.extend([Spacer(1, _sz(12)), Paragraph(head, st["sec"]), Spacer(1, _sz(7))])
        story.extend(flows)

    card_w = width - 4  # the accent bar and padding live inside the card
    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            inner = [_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"],
                              card_w - 20)]
            meta = " &middot; ".join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                inner.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                inner.append(Spacer(1, _sz(2.6)))
                for b in e["bullets"]:
                    inner.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    inner.append(Spacer(1, _sz(1.4)))
            if i:
                out.append(Spacer(1, _sz(6)))
            out.append(_ps_card(inner, width, acc))
        return out

    def skills(text):
        chips = _tpl_chip_items(text)
        if not chips:
            return []
        return [_CCChips(chips, width, reg, _sz(6.3), bg=PS_CARD, fg=PS_PLUM,
                         pad_x=5.4, pad_y=3.4, gap=3.0, line_gap=3.4)]

    _tpl_compose(data, st, width, sec, bold, entries=entries, skills=skills)
    doc.build(story)


# ===========================================================================
# 16 — CORPORATE BLUE
# ---------------------------------------------------------------------------
#   sans, margins 14.1pt, navy #003366 — the most conservative of this batch
#   full-bleed navy band 58pt tall: name 15.9pt bold white, role 8.1pt #B8CBE0,
#   contact 5.9pt #D6E2F0 (the source PDF clipped its own band; this keeps the
#   same proportions but leaves the header legible)
#   section heads 8.1pt bold caps navy over a full-width 1.2pt navy rule
#   body 7.0pt / 9.7 #1C1C1C, dates 6.5pt #333333 flush right
#   labels read "Professional Summary / Experience", "Selected Projects"
# ===========================================================================
CB_NAVY = colors.HexColor("#003366")
CB_BAND_TITLE = colors.HexColor("#B8CBE0")
CB_BAND_TEXT = colors.HexColor("#D6E2F0")
CB_INK = colors.HexColor("#1C1C1C")
CB_MARGIN = 36.0        # the shared margin floor; it builds its own document
CB_BAND_H = 58.0


def _cb_styles(acc):
    _set_type_base(7.0)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("cb_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2),
                 textColor=acc, keepWithNext=1),
        "entry": S("cb_entry", fontName=bold, fontSize=_sz(7.0), leading=_sz(9.7),
                   textColor=CB_INK, keepWithNext=1),
        "dates": S("cb_dates", fontName=reg, fontSize=_sz(6.5), leading=_sz(9.7),
                   textColor=colors.HexColor("#333333")),
        "meta": S("cb_meta", fontName=reg, fontSize=_sz(6.5), leading=_sz(9),
                  textColor=colors.HexColor("#333333")),
        "body": S("cb_body", fontName=reg, fontSize=_sz(7.0), leading=_sz(9.7), textColor=CB_INK),
        "bullet": S("cb_bullet", fontName=reg, fontSize=_sz(7.0), leading=_sz(9.7), textColor=CB_INK,
                    leftIndent=9.2, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("cb_sk_l", fontName=bold, fontSize=_sz(6.5), leading=_sz(9.2), textColor=acc),
        "skill_v": S("cb_sk_v", fontName=reg, fontSize=_sz(6.5), leading=_sz(9.2), textColor=CB_INK),
        "item": S("cb_item", fontName=reg, fontSize=_sz(7.0), leading=_sz(9.7), textColor=CB_INK),
    }


def build_corporate_blue(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else CB_NAVY
    st = _cb_styles(acc)
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * CB_MARGIN

    # The band is painted full-bleed, but the type inside it observes the same
    # top margin as the rest of the document: at a fixed 58pt the name's cap
    # height sat 11pt from the paper edge on the larger presets. Both the band
    # and the baselines inside it are therefore measured from the type, so the
    # header keeps its proportions across all four sizes.
    name_pt, title_pt, contact_pt = _sz(15.9), _sz(8.1), _sz(5.9)
    name_base = CB_MARGIN + name_pt * 0.74           # cap height below the margin
    title_base = name_base + title_pt * 1.55 if data.get("title") else name_base
    contact_base = title_base + contact_pt * 1.9
    contact_lines = _tpl_contact_line_count(_tpl_contact(data), reg, contact_pt, width)
    band_h = max(CB_BAND_H,
                 contact_base + (contact_lines - 1) * contact_pt * 1.45 + contact_pt * 1.4)

    def paint_band(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(acc)
        canvas.rect(0, TPL_PAGE[1] - band_h, TPL_PAGE[0], band_h, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        _tpl_draw_fit(canvas, data.get("full_name", ""), CB_MARGIN,
                      TPL_PAGE[1] - name_base, width, bold, name_pt)
        if data.get("title"):
            canvas.setFillColor(CB_BAND_TITLE)
            _tpl_draw_fit(canvas, str(data["title"]), CB_MARGIN,
                          TPL_PAGE[1] - title_base, width, reg, title_pt)
        contact = _tpl_contact(data)
        if contact:
            canvas.setFillColor(CB_BAND_TEXT)
            canvas.setFont(reg, contact_pt)
            _tpl_draw_contact(canvas, contact, CB_MARGIN, TPL_PAGE[1] - contact_base,
                              width, reg, contact_pt)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(CB_MARGIN, CB_MARGIN, width, TPL_PAGE[1] - band_h - 16 - CB_MARGIN,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(CB_MARGIN, CB_MARGIN, width, TPL_PAGE[1] - CB_MARGIN - CB_MARGIN,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_band),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(10)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.0)), _TplRule(width, acc, 1.2), Spacer(1, _sz(5.4))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Professional Summary",
                         "experience": "Professional Experience",
                         "skills": "Technical Skills",
                         "projects": "Selected Projects"},
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=104))
    doc.build(story)


# ===========================================================================
# 17 — DIAGONAL SPLIT
# ---------------------------------------------------------------------------
#   sans, margins 49pt, teal pair #0A4D68 (deep) and #088395 (light)
#   140pt banner: the deep tone with a light wedge cut diagonally across its
#   right half, name 20.7pt bold white, role 9.2pt bold #C4F1FF,
#   contact 6.9pt #D9F4FF
#   section heads 8.6pt bold caps light teal over a short bar as wide as the label
#   skills render as chips, deep teal on #EAF8FF; body 7.5pt / 10.4 #262626
# ===========================================================================
DS_DEEP = colors.HexColor("#0A4D68")
DS_LIGHT = colors.HexColor("#088395")
DS_TITLE = colors.HexColor("#C4F1FF")
DS_BAND_TEXT = colors.HexColor("#D9F4FF")
DS_CHIP = colors.HexColor("#EAF8FF")
DS_INK = colors.HexColor("#262626")
DS_MARGIN = 49.0
DS_BAND_H = 140.0


def _ds_styles(deep, light):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("ds_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=light, keepWithNext=1),
        "entry": S("ds_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.2),
                   textColor=deep, keepWithNext=1),
        "dates": S("ds_dates", fontName=bold, fontSize=_sz(6.9), leading=_sz(10.2), textColor=light),
        "meta": S("ds_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4),
                  textColor=colors.HexColor("#555555")),
        "body": S("ds_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=DS_INK),
        "bullet": S("ds_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=DS_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("ds_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=deep),
        "skill_v": S("ds_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=DS_INK),
        "item": S("ds_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=DS_INK),
    }


def build_diagonal_split(data: dict, output_path: str):
    deep = _acc() if data.get("accent_color") else DS_DEEP
    light = DS_LIGHT if not data.get("accent_color") else _acc()
    st = _ds_styles(deep, light)
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * DS_MARGIN

    def paint_band(canvas, doc):
        canvas.saveState()
        top, bottom = TPL_PAGE[1], TPL_PAGE[1] - DS_BAND_H
        canvas.setFillColor(deep)
        canvas.rect(0, bottom, TPL_PAGE[0], DS_BAND_H, stroke=0, fill=1)
        # The split: a lighter wedge whose leading edge runs from 45% of the
        # width at the top of the band to 68% at its base.
        p = canvas.beginPath()
        p.moveTo(TPL_PAGE[0] * 0.45, top)
        p.lineTo(TPL_PAGE[0], top)
        p.lineTo(TPL_PAGE[0], bottom)
        p.lineTo(TPL_PAGE[0] * 0.68, bottom)
        p.close()
        canvas.setFillColor(light)
        canvas.drawPath(p, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        _tpl_draw_fit(canvas, data.get("full_name", ""), DS_MARGIN, top - 72,
                      width, bold, _sz(20.7))
        if data.get("title"):
            canvas.setFillColor(DS_TITLE)
            _tpl_draw_fit(canvas, str(data["title"]), DS_MARGIN, top - 90,
                          width, bold, _sz(9.2))
        contact = _tpl_contact(data)
        if contact:
            canvas.setFillColor(DS_BAND_TEXT)
            canvas.setFont(reg, _sz(6.9))
            _tpl_draw_contact(canvas, contact, DS_MARGIN, top - 106, width, reg, _sz(6.9))
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(DS_MARGIN, 36, width, TPL_PAGE[1] - DS_BAND_H - 26 - 36,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(DS_MARGIN, 36, width, TPL_PAGE[1] - 40 - 36,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_band),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        label = _esc_pdf(title).upper()
        story.extend([Spacer(1, _sz(12)), Paragraph(label, st["sec"]), Spacer(1, _sz(2.4)),
                      _TplTextRule(str(title).upper(), bold, _sz(8.6), light, thickness=2.0),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    def skills(text):
        chips = _tpl_chip_items(text)
        if not chips:
            return []
        return [_CCChips(chips, width, reg, _sz(6.3), bg=DS_CHIP, fg=deep,
                         pad_x=5.2, pad_y=3.2, gap=2.8, line_gap=3.2)]

    _tpl_compose(data, st, width, sec, bold, skills=skills)
    doc.build(story)


# ===========================================================================
# 18 — MAGAZINE EDITORIAL
# ---------------------------------------------------------------------------
#   full-bleed yellow #F4C430 banner 124pt tall, margins 49pt
#   "CURRICULUM VITAE" kicker 6.9pt sans bold caps tracked +1.2pt, then the
#   name 34pt serif bold, role 8.6pt sans bold caps, contact 6.3pt sans —
#   all in ink #1A1A1A on the yellow
#   section heads 8.1pt sans bold caps over a 1.6pt yellow rule cut to the
#   width of the label; body is serif 7.5pt / 10.4 for the editorial feel
#   skills are reversed chips: yellow text on ink
# ===========================================================================
ME_YELLOW = colors.HexColor("#F4C430")
ME_INK = colors.HexColor("#1A1A1A")
ME_MARGIN = 49.0
ME_BAND_H = 124.0
ME_SANS = "Helvetica"
ME_SANS_BOLD = "Helvetica-Bold"


def _me_styles():
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("me_sec", fontName=ME_SANS_BOLD, fontSize=_sz(8.1), leading=_sz(10.2),
                 textColor=ME_INK, keepWithNext=1),
        "entry": S("me_entry", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.8),
                   textColor=ME_INK, keepWithNext=1),
        "dates": S("me_dates", fontName=ME_SANS, fontSize=_sz(6.3), leading=_sz(10.8),
                   textColor=colors.HexColor("#666666")),
        "meta": S("me_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#555555")),
        "body": S("me_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=ME_INK),
        "bullet": S("me_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=ME_INK,
                    leftIndent=10.4, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("me_sk_l", fontName=ME_SANS_BOLD, fontSize=_sz(6.3), leading=_sz(9.4),
                     textColor=ME_INK),
        "skill_v": S("me_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=ME_INK),
        "item": S("me_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=ME_INK),
    }


def build_magazine_editorial(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else ME_YELLOW
    st = _me_styles()
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * ME_MARGIN

    def paint_banner(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(acc)
        canvas.rect(0, TPL_PAGE[1] - ME_BAND_H, TPL_PAGE[0], ME_BAND_H, stroke=0, fill=1)
        top = TPL_PAGE[1]
        canvas.setFillColor(ME_INK)
        # The masthead used to open with a "CURRICULUM VITAE" kicker. A résumé
        # announcing that it is a résumé tells the reader nothing they don't
        # already know, and it cost the band 20pt that the name, role and
        # contact line needed — which is why they were colliding.
        #
        # A masthead, not a poster: 24pt against a 7.5pt design body keeps the
        # name inside the professional range at all four presets once damping
        # is applied. At 34 it reached 42pt on the largest preset.
        _tpl_draw_fit(canvas, data.get("full_name", ""), ME_MARGIN, top - 62,
                      width, bold, _sz(24))
        # Baselines are now spaced by the type they carry rather than by fixed
        # offsets: 24pt of name needs more than the 16pt it was given, so the
        # role sat inside the name's descenders.
        y = top - 62 - _sz(15)
        if data.get("title"):
            _tpl_draw_fit(canvas, str(data["title"]).upper(), ME_MARGIN, y,
                          width, ME_SANS_BOLD, _sz(8.6))
            y -= _sz(13)
        contact = _tpl_contact(data)
        if contact:
            canvas.setFont(ME_SANS, _sz(6.3))
            _tpl_draw_contact(canvas, contact, ME_MARGIN, y, width,
                              ME_SANS, _sz(6.3), sep="   ·   ")
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(ME_MARGIN, 40, width, TPL_PAGE[1] - ME_BAND_H - 30 - 40,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(ME_MARGIN, 40, width, TPL_PAGE[1] - 44 - 40,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_banner),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        label = str(title).upper()
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(label), st["sec"]), Spacer(1, _sz(2.6)),
                      _TplTextRule(label, ME_SANS_BOLD, _sz(8.1), acc, thickness=1.6),
                      Spacer(1, _sz(7))])
        story.extend(flows)

    def skills(text):
        chips = _tpl_chip_items(text)
        if not chips:
            return []
        return [_CCChips(chips, width, ME_SANS_BOLD, _sz(6.3), bg=ME_INK, fg=acc,
                         pad_x=5.0, pad_y=3.2, gap=2.4, line_gap=3.0)]

    _tpl_compose(data, st, width, sec, bold, skills=skills)
    doc.build(story)


# ===========================================================================
# 19 — ACADEMIC CV
# ---------------------------------------------------------------------------
#   serif, pure black on white, A4, margins 14.4pt — no colour by design
#   name 13.8pt serif bold centred, contact 7.5pt centred, em-dash separated
#   section heads 8.6pt serif bold caps over a full-width 0.6pt black rule
#   body 8.1pt / 12.1 — the largest body size of the batch, for reading length
#   publications sit directly after the summary, as an academic CV expects, and
#   the summary and skills headings carry research wording
# ===========================================================================
AC_INK = colors.HexColor("#000000")
AC_ORDER = ("summary", "publications", "experience", "education", "skills",
            "projects", "certifications")


def _ac_styles():
    _set_type_base(8.1)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("ac_name", fontName=bold, fontSize=_sz(13.8), leading=_sz(16.4),
                  textColor=AC_INK, alignment=TA_CENTER),
        "contact": S("ac_contact", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.2),
                     textColor=AC_INK, alignment=TA_CENTER),
        "sec": S("ac_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=AC_INK, keepWithNext=1),
        "entry": S("ac_entry", fontName=bold, fontSize=_sz(8.1), leading=_sz(11.4),
                   textColor=AC_INK, keepWithNext=1),
        "dates": S("ac_dates", fontName=ital, fontSize=_sz(8.1), leading=_sz(11.4), textColor=AC_INK),
        "meta": S("ac_meta", fontName=ital, fontSize=_sz(7.5), leading=_sz(10.4), textColor=AC_INK),
        "body": S("ac_body", fontName=reg, fontSize=_sz(8.1), leading=_sz(12.1), textColor=AC_INK),
        "bullet": S("ac_bullet", fontName=reg, fontSize=_sz(8.1), leading=_sz(12.1), textColor=AC_INK,
                    leftIndent=10.4, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(6)),
        "skill_l": S("ac_sk_l", fontName=bold, fontSize=_sz(8.1), leading=_sz(11.4), textColor=AC_INK),
        "skill_v": S("ac_sk_v", fontName=reg, fontSize=_sz(8.1), leading=_sz(11.4), textColor=AC_INK),
        "item": S("ac_item", fontName=reg, fontSize=_sz(8.1), leading=_sz(12.1),
                  textColor=AC_INK, leftIndent=10.4),
    }


def build_academic_cv(data: dict, output_path: str):
    st = _ac_styles()
    reg, bold, _it = _fonts()
    rule = _acc() if data.get("accent_color") else AC_INK
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    contact = _tpl_contact(data)
    if data.get("title"):
        contact.insert(0, str(data["title"]))
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &mdash; ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.0)), _TplRule(width, rule, 0.6), Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold, order=AC_ORDER,
                 labels={"summary": "Research & Professional Summary",
                         "experience": "Professional Experience",
                         "skills": "Technical & Research Skills"},
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=130))
    doc.build(story)


# ===========================================================================
# 20 — SCANDINAVIAN CLEAN
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, sage #7A9E7E on near-white — the airiest layout here
#   name 17.9pt regular (never bold) #1C1C1C | role 8.6pt bold sage
#   contact 6.3pt #888888, closed by a single #E0E0E0 hairline
#   section heads 8.1pt bold sage, title case, no rules, 14pt of air above
#   body 7.5pt / 11.4 #333333 — leading is where the calm comes from
# ===========================================================================
SC_SAGE = colors.HexColor("#7A9E7E")
SC_NAME = colors.HexColor("#1C1C1C")
SC_BODY = colors.HexColor("#333333")
SC_FAINT = colors.HexColor("#888888")
SC_HAIR = colors.HexColor("#E0E0E0")


def _sc_styles(acc, light):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("sc_name", fontName=light, fontSize=_sz(17.9), leading=_sz(21), textColor=SC_NAME),
        "role": S("sc_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("sc_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2), textColor=SC_FAINT),
        "sec": S("sc_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=acc, keepWithNext=1),
        "entry": S("sc_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.6),
                   textColor=colors.HexColor("#1C1C1C"), keepWithNext=1),
        "dates": S("sc_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.6),
                   textColor=colors.HexColor("#999999")),
        "meta": S("sc_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#777777")),
        "body": S("sc_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(11.4), textColor=SC_BODY),
        "bullet": S("sc_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(11.4), textColor=SC_BODY,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("sc_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.8), textColor=SC_BODY),
        "skill_v": S("sc_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8), textColor=SC_BODY),
        "item": S("sc_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(11.4), textColor=SC_BODY),
    }


def build_scandinavian_clean(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else SC_SAGE
    reg, bold, _it = _fonts()
    light = "Helvetica" if reg == "Helvetica" else reg
    st = _sc_styles(acc, light)
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(4.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5.6)),
                  Paragraph("  &middot;  ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(8)), _TplRule(width, SC_HAIR, 0.6)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(14)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(9))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=110, pad=1.8))
    doc.build(story)


# ===========================================================================
# 21 — BORDERED CLASSIC
# ---------------------------------------------------------------------------
#   serif, a 0.9pt #333333 border inset 14pt on every page, content inset 46pt
#   name 16.1pt bold #222222 centred | role 8.6pt #555555 | contact 6.9pt #444
#   header closed by a 1.4pt dark rule; section heads 8.6pt bold caps over a
#   0.6pt #999999 hairline; body 7.5pt / 10.6
# ===========================================================================
BC_INK = colors.HexColor("#222222")
BC_HAIR = colors.HexColor("#999999")
BC_BORDER_INSET = 14.0
BC_MARGIN = 46.0


def _bc_styles():
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("bc_name", fontName=bold, fontSize=_sz(16.1), leading=_sz(19),
                  textColor=BC_INK, alignment=TA_CENTER),
        "role": S("bc_role", fontName=reg, fontSize=_sz(8.6), leading=_sz(10.8),
                  textColor=colors.HexColor("#555555"), alignment=TA_CENTER),
        "contact": S("bc_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8),
                     textColor=colors.HexColor("#444444"), alignment=TA_CENTER),
        "sec": S("bc_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=BC_INK, keepWithNext=1),
        "entry": S("bc_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.6),
                   textColor=BC_INK, keepWithNext=1),
        "dates": S("bc_dates", fontName=ital, fontSize=_sz(7.5), leading=_sz(10.6),
                   textColor=colors.HexColor("#555555")),
        "meta": S("bc_meta", fontName=ital, fontSize=_sz(7.5), leading=_sz(10.2),
                  textColor=colors.HexColor("#555555")),
        "body": S("bc_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6),
                  textColor=colors.HexColor("#212121")),
        "bullet": S("bc_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6),
                    textColor=colors.HexColor("#212121"),
                    leftIndent=10.4, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("bc_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.8), textColor=BC_INK),
        "skill_v": S("bc_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8),
                     textColor=colors.HexColor("#212121")),
        "item": S("bc_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6),
                  textColor=colors.HexColor("#212121")),
    }


def build_bordered_classic(data: dict, output_path: str):
    st = _bc_styles()
    reg, bold, _it = _fonts()
    frame_color = _acc() if data.get("accent_color") else colors.HexColor("#333333")
    width = TPL_PAGE[0] - 2 * BC_MARGIN

    def paint_border(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(frame_color)
        canvas.setLineWidth(0.9)
        canvas.rect(BC_BORDER_INSET, BC_BORDER_INSET,
                    TPL_PAGE[0] - 2 * BC_BORDER_INSET, TPL_PAGE[1] - 2 * BC_BORDER_INSET,
                    stroke=1, fill=0)
        canvas.restoreState()

    doc = _tpl_doc(output_path, data, BC_MARGIN, top_margin=32, on_page=paint_border)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(7)), _TplRule(width, frame_color, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.0)), _TplRule(width, BC_HAIR, 0.6), Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold)
    doc.build(story)


# ===========================================================================
# 22 — GRADIENT MODERN
# ---------------------------------------------------------------------------
#   sans, margins 49pt, a 114pt gradient banner from #6A5AE0 to #4568DC
#   name 19pt bold white | role 8.6pt #D6D9F5 | contact 6.3pt #C6CBEF
#   (the source PDF dropped its own role and contact out of the banner; they
#   are kept here, lightened rather than hidden)
#   section heads 8.6pt bold caps #4568DC, no rule
#   skills sit in a two-column grid, which is what makes this one read modern
#   body 7.5pt / 10.6 #2A2A2A
# ===========================================================================
GM_FROM = colors.HexColor("#6A5AE0")
GM_TO = colors.HexColor("#4568DC")
GM_ROLE = colors.HexColor("#E4E7FA")
GM_BAND_TEXT = colors.HexColor("#DCE0F7")
GM_INK = colors.HexColor("#2A2A2A")
GM_MARGIN = 49.0
GM_BAND_H = 114.0


def _gm_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "sec": S("gm_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=acc, keepWithNext=1),
        "entry": S("gm_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4),
                   textColor=colors.HexColor("#1F1F1F"), keepWithNext=1),
        "dates": S("gm_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10.4),
                   textColor=colors.HexColor("#999999")),
        "meta": S("gm_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#666666")),
        "body": S("gm_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GM_INK),
        "bullet": S("gm_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GM_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("gm_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=acc),
        "skill_v": S("gm_sk_v", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.8),
                     textColor=colors.HexColor("#555555")),
        "item": S("gm_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GM_INK),
    }


def build_gradient_modern(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else GM_TO
    start = GM_FROM if not data.get("accent_color") else _acc()
    st = _gm_styles(acc)
    reg, bold, _it = _fonts()
    width = TPL_PAGE[0] - 2 * GM_MARGIN

    def paint_band(canvas, doc):
        canvas.saveState()
        # Thin vertical strips stepping between the two tones — the canvas has
        # no gradient primitive, so the wash is drawn by hand.
        steps = 140
        w = TPL_PAGE[0] / steps
        for i in range(steps):
            t = i / (steps - 1)
            canvas.setFillColorRGB(start.red + (acc.red - start.red) * t,
                                   start.green + (acc.green - start.green) * t,
                                   start.blue + (acc.blue - start.blue) * t)
            canvas.rect(i * w, TPL_PAGE[1] - GM_BAND_H, w + 0.7, GM_BAND_H, stroke=0, fill=1)
        top = TPL_PAGE[1]
        canvas.setFillColor(colors.white)
        canvas.setFont(bold, _sz(19))
        canvas.drawString(GM_MARGIN, top - 54, data.get("full_name", ""))
        if data.get("title"):
            canvas.setFillColor(GM_ROLE)
            canvas.setFont(reg, _sz(8.6))
            canvas.drawString(GM_MARGIN, top - 70, str(data["title"]))
        contact = _tpl_contact(data)
        if contact:
            canvas.setFillColor(GM_BAND_TEXT)
            canvas.setFont(reg, _sz(6.3))
            line = "   |   ".join(contact)
            if _pdfmetrics.stringWidth(line, reg, _sz(6.3)) > width:
                half = (len(contact) + 1) // 2
                canvas.drawString(GM_MARGIN, top - 86, "   |   ".join(contact[:half]))
                canvas.drawString(GM_MARGIN, top - 95, "   |   ".join(contact[half:]))
            else:
                canvas.drawString(GM_MARGIN, top - 88, line)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(GM_MARGIN, 38, width, TPL_PAGE[1] - GM_BAND_H - 26 - 38,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(GM_MARGIN, 38, width, TPL_PAGE[1] - 42 - 38,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_band),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest")]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(7))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_grid(text, st, width, cols=2))
    doc.build(story)


# ===========================================================================
# 23 — LEFT-RULE WATERMARK
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, crimson #E94560 accent on ink #16161D
#   a 3pt accent rule stands to the left of the header, which is indented to
#   24.2pt to clear it; the initials are set 46pt in #F0F0F0 behind the header
#   name 18.4pt bold | role 8.6pt bold accent | contact 6.3pt #777777
#   section heads 8.6pt bold caps ink, dates 6.9pt bold accent flush right
#   body 7.5pt / 10.8 #2B2B2B
# ===========================================================================
LW_ACCENT = colors.HexColor("#E94560")
LW_INK = colors.HexColor("#16161D")
LW_BODY = colors.HexColor("#2B2B2B")
LW_WATERMARK = colors.HexColor("#F0F0F0")
LW_INDENT = 9.8


def _lw_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("lw_name", fontName=bold, fontSize=_sz(18.4), leading=_sz(21.6),
                  textColor=LW_INK, leftIndent=LW_INDENT),
        "role": S("lw_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                  textColor=acc, leftIndent=LW_INDENT),
        "contact": S("lw_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2),
                     textColor=colors.HexColor("#777777"), leftIndent=LW_INDENT),
        "sec": S("lw_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8),
                 textColor=LW_INK, keepWithNext=1),
        "entry": S("lw_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.8),
                   textColor=LW_INK, keepWithNext=1),
        "dates": S("lw_dates", fontName=bold, fontSize=_sz(6.9), leading=_sz(10.8), textColor=acc),
        "meta": S("lw_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#666666")),
        "body": S("lw_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=LW_BODY),
        "bullet": S("lw_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=LW_BODY,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("lw_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=LW_INK),
        "skill_v": S("lw_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=LW_BODY),
        "item": S("lw_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=LW_BODY),
    }


def _tpl_initials(data, limit=2):
    """Initials for a watermark / monogram, e.g. "Dheeraj Gudi" -> "DG"."""
    explicit = (data.get("photo_initials") or "").strip()
    if explicit:
        return explicit.upper()[:limit]
    parts = [p for p in str(data.get("full_name", "")).split() if p]
    return "".join(p[0] for p in parts[:limit]).upper()


def build_leftrule_watermark(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else LW_ACCENT
    st = _lw_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)

    def paint_furniture(canvas, doc):
        canvas.saveState()
        # Accent rule beside the header, then the initials set very pale behind
        # it — drawn first so any header text sits over them.
        canvas.setFillColor(acc)
        canvas.rect(margin, TPL_PAGE[1] - 55, 3.0, 27.0, stroke=0, fill=1)
        initials = _tpl_initials(data)
        if initials:
            canvas.setFillColor(LW_WATERMARK)
            canvas.setFont(bold, _sz(46.1))
            canvas.drawRightString(TPL_PAGE[0] - margin, TPL_PAGE[1] - 62, initials)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(margin, TPL_MIN_MARGIN, width, TPL_PAGE[1] - 30 - TPL_MIN_MARGIN,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(margin, TPL_MIN_MARGIN, width, TPL_PAGE[1] - TPL_MIN_MARGIN * 2,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_furniture),
                          PageTemplate(id="rest", frames=[rest])])
    story = [NextPageTemplate("rest"),
             Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(4.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5.6)),
                  Paragraph("  &bull;  ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(8))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold)
    doc.build(story)


# ===========================================================================
# 24 — CONSULTING PREMIUM
# ---------------------------------------------------------------------------
#   serif, margins 14.4pt, navy #002349 — a split header, which is the whole
#   idea: name and role hard left, contact stacked flush right beside it
#   name 15.6pt bold navy | role 8.1pt #555555 | contact 6.3pt #444444
#   header closed by a 2pt navy rule; section heads 8.1pt bold caps navy over a
#   0.6pt #CCCCCC hairline; body 7.5pt / 10.4; labels read like a CV deck
# ===========================================================================
CP_NAVY = colors.HexColor("#002349")
CP_INK = colors.HexColor("#1A1A1A")
CP_HAIR = colors.HexColor("#CCCCCC")


def _cp_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("cp_name", fontName=bold, fontSize=_sz(15.6), leading=_sz(18.4), textColor=acc),
        "role": S("cp_role", fontName=reg, fontSize=_sz(8.1), leading=_sz(10.4),
                  textColor=colors.HexColor("#555555")),
        "contact": S("cp_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(8.6),
                     textColor=colors.HexColor("#444444"), alignment=TA_RIGHT),
        "sec": S("cp_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=acc, keepWithNext=1),
        "entry": S("cp_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4),
                   textColor=CP_INK, keepWithNext=1),
        "dates": S("cp_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.4),
                   textColor=colors.HexColor("#666666")),
        "meta": S("cp_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6),
                  textColor=colors.HexColor("#444444")),
        "body": S("cp_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=CP_INK),
        "bullet": S("cp_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=CP_INK,
                    leftIndent=10.4, bulletIndent=_sz(1.0), bulletFontName=reg, bulletFontSize=_sz(5.6)),
        "skill_l": S("cp_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=CP_INK),
        "skill_v": S("cp_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=CP_INK),
        "item": S("cp_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=CP_INK),
    }


def build_consulting_premium(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else CP_NAVY
    st = _cp_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=16)

    left = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        left += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    # Contact stacks on the right, two bits per line, so it stays a tidy block
    # against the name however many details the customer has filled in.
    right = []
    for i in range(0, len(contact), 2):
        right.append(Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact[i:i + 2]), st["contact"]))
    head = Table([[left, right or ""]], colWidths=[width * 0.52, width * 0.48])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (0, 0), "TOP"), ("VALIGN", (1, 0), (1, 0), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [head, Spacer(1, _sz(7)), _TplRule(width, acc, 2.0)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.0)), _TplRule(width, CP_HAIR, 0.6), Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Profile", "experience": "Professional Experience",
                         "skills": "Core Skills", "projects": "Selected Projects"})
    doc.build(story)


# ===========================================================================
# 25 — TECH CLEAN COLORFUL
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, Google-ish blue #4285F4 and greys #202124 / #5F6368
#   four accent dots of fading strength sit above the name
#   name 17.9pt regular | role 8.6pt #5F6368 | contact 6.3pt #5F6368
#   section heads 8.1pt bold blue, title case, no rules at all
#   entries read "Role @ Company" on one line, dates 6.9pt grey flush right
#   body 7.5pt / 10.8 #202124
# ===========================================================================
TC_BLUE = colors.HexColor("#4285F4")
TC_INK = colors.HexColor("#202124")
TC_GREY = colors.HexColor("#5F6368")


def _tc_styles(acc, light):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("tc_name", fontName=light, fontSize=_sz(17.9), leading=_sz(21), textColor=TC_INK),
        "role": S("tc_role", fontName=reg, fontSize=_sz(8.6), leading=_sz(10.8), textColor=TC_GREY),
        "contact": S("tc_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2), textColor=TC_GREY),
        "sec": S("tc_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=acc, keepWithNext=1),
        "entry": S("tc_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.8),
                   textColor=TC_INK, keepWithNext=1),
        "dates": S("tc_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.8), textColor=TC_GREY),
        "meta": S("tc_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=TC_GREY),
        "body": S("tc_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=TC_INK),
        "bullet": S("tc_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=TC_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("tc_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.6), textColor=TC_INK),
        "skill_v": S("tc_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=TC_INK),
        "item": S("tc_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.8), textColor=TC_INK),
    }


class _TCDots(Flowable):
    """Four dots in the accent, each a step paler than the last."""

    def __init__(self, color, r=2.6, gap=8.0, n=4):
        Flowable.__init__(self)
        self.color, self.r, self.gap, self.n = color, r, gap, n

    def wrap(self, availWidth, availHeight):
        return availWidth, self.r * 2

    def draw(self):
        c = self.canv
        for i in range(self.n):
            t = i / max(1, self.n - 1) * 0.62
            c.setFillColorRGB(self.color.red + (1 - self.color.red) * t,
                              self.color.green + (1 - self.color.green) * t,
                              self.color.blue + (1 - self.color.blue) * t)
            c.circle(self.r + i * self.gap, self.r, self.r, stroke=0, fill=1)


def build_tech_clean_colorful(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else TC_BLUE
    reg, bold, _it = _fonts()
    light = "Helvetica" if reg == "Helvetica" else reg
    st = _tc_styles(acc, light)
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [_TCDots(acc), Spacer(1, _sz(9)),
             Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(4.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5.6)),
                  Paragraph("  &bull;  ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(8))])
        story.extend(flows)

    def entries(text):
        """Role and company share the title line, joined by an @."""
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            if i:
                out.append(Spacer(1, _sz(7)))
            head = _esc_pdf(title)
            if company:
                head += (f'<font name="{reg}" color="#{TC_GREY.hexval()[2:]}"> @ '
                         f'{_esc_pdf(company)}</font>')
            out.append(_tpl_row(head, _esc_pdf(dates), st["entry"], st["dates"], width, 0.74))
            if place:
                out.append(Paragraph(_esc_pdf(place), st["meta"]))
            if e.get("bullets"):
                out.append(Spacer(1, _sz(2.2)))
                for b in e["bullets"]:
                    out.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    out.append(Spacer(1, _sz(1.4)))
        return out

    _tpl_compose(data, st, width, sec, bold, entries=entries,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=110))
    doc.build(story)


# ===========================================================================
# 26 — FINANCE FORMAL
# ---------------------------------------------------------------------------
#   serif, margins 14.4pt, ink #101820 only — no colour, nothing decorative
#   name 13.8pt bold caps centred, tracked +1.1pt | contact 6.9pt #333 centred
#   header closed by a 1.4pt rule; section heads 8.1pt bold caps over a 0.6pt
#   rule; body 6.9pt / 9.4 — deliberately dense, conservative and printable
#   dates are bold rather than coloured, as a finance CV tends to be
# ===========================================================================
FF_INK = colors.HexColor("#101820")


def _ff_styles():
    _set_type_base(6.9)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "contact": S("ff_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                     textColor=colors.HexColor("#333333"), alignment=TA_CENTER),
        "sec": S("ff_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=FF_INK, keepWithNext=1),
        "entry": S("ff_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.2), textColor=FF_INK, keepWithNext=1),
        "dates": S("ff_dates", fontName=bold, fontSize=_sz(6.9), leading=_sz(10.2), textColor=FF_INK),
        "meta": S("ff_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK),
        "body": S("ff_body", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK),
        "bullet": S("ff_bullet", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.8), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("ff_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK),
        "skill_v": S("ff_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK),
        "item": S("ff_item", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=FF_INK),
    }


def build_finance_formal(data: dict, output_path: str):
    st = _ff_styles()
    reg, bold, _it = _fonts()
    rule = _acc() if data.get("accent_color") else FF_INK
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=16)

    story = [_HCTracked(str(data.get("full_name", "")).upper(), bold, _sz(13.8), _sz(16.4),
                        tracking=_sz(1.1), align="center", color=FF_INK)]
    contact = _tpl_contact(data)
    if data.get("title"):
        contact.insert(0, str(data["title"]))
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("   |   ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, rule, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(9)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, rule, 0.6), Spacer(1, _sz(5))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Profile", "experience": "Professional Experience",
                         "projects": "Selected Projects"},
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118, pad=1.0))
    doc.build(story)


# ===========================================================================
# 27 — STARTUP ENERGETIC
# ---------------------------------------------------------------------------
#   geometric sans (Lato stands in for the source's Poppins), margins 14.4pt
#   violet #6C5CE7 accent, amber #FFEAA7 rules
#   name 19pt bold #111111 | role 8.6pt bold violet | contact 6.3pt #666666
#   section heads 8.6pt bold violet with a small triangular marker
#   every entry gets a 2pt amber bar down its left edge
#   skills are chips, violet on #EFEDFF; body 7.5pt / 10.4 #1E1E1E
# ===========================================================================
SE_VIOLET = colors.HexColor("#6C5CE7")
SE_AMBER = colors.HexColor("#FFEAA7")
SE_CHIP = colors.HexColor("#EFEDFF")
SE_INK = colors.HexColor("#1E1E1E")


def _se_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("se_name", fontName=bold, fontSize=_sz(19), leading=_sz(22),
                  textColor=colors.HexColor("#111111")),
        "role": S("se_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("se_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2),
                     textColor=colors.HexColor("#666666")),
        "sec": S("se_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc, keepWithNext=1),
        "entry": S("se_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SE_INK, keepWithNext=1),
        "dates": S("se_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10.4),
                   textColor=colors.HexColor("#999999")),
        "meta": S("se_meta", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2),
                  textColor=colors.HexColor("#777777")),
        "body": S("se_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SE_INK),
        "bullet": S("se_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SE_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("se_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.4), textColor=acc),
        "skill_v": S("se_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.4), textColor=SE_INK),
        "item": S("se_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4), textColor=SE_INK),
    }


def build_startup_energetic(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else SE_VIOLET
    st = _se_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("  &bull;  ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)),
                      Paragraph(f"{_tpl_marker('&#9656;')}  {_esc_pdf(title)}", st["sec"]),
                      Spacer(1, _sz(7))])
        story.extend(flows)

    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            inner = [_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], width - 12)]
            meta = " &middot; ".join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                inner.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                inner.append(Spacer(1, _sz(2.4)))
                for b in e["bullets"]:
                    inner.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    inner.append(Spacer(1, _sz(1.4)))
            if i:
                out.append(Spacer(1, _sz(6)))
            out.append(_tpl_bar_block(inner, width, SE_AMBER, thickness=2.0, pad=9.0))
        return out

    def skills(text):
        chips = _tpl_chip_items(text)
        if not chips:
            return []
        return [_CCChips(chips, width, reg, _sz(6.3), bg=SE_CHIP, fg=acc,
                         pad_x=5.4, pad_y=3.4, gap=3.0, line_gap=3.4)]

    _tpl_compose(data, st, width, sec, bold, entries=entries, skills=skills)
    doc.build(story)


# ===========================================================================
# 28 — GOVERNMENT FORMAL
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, GOV.UK-ish palette: blue #005EA5, ink #0B0C0C,
#   grey #B1B4B6 rules, secondary #505A5F
#   name 14.4pt bold ink | role 8.6pt bold blue | contact 6.9pt #333333
#   a 3pt blue rule closes the header; section heads 8.6pt bold blue, title
#   case, over a 0.6pt grey hairline
#   public-sector wording: Personal Statement, Employment History,
#   Education & Qualifications, Skills & Competencies, Additional Projects
# ===========================================================================
GF_BLUE = colors.HexColor("#005EA5")
GF_INK = colors.HexColor("#0B0C0C")
GF_RULE = colors.HexColor("#B1B4B6")
GF_SECOND = colors.HexColor("#505A5F")


def _gf_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("gf_name", fontName=bold, fontSize=_sz(14.4), leading=_sz(17.4), textColor=GF_INK),
        "role": S("gf_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("gf_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8),
                     textColor=colors.HexColor("#333333")),
        "sec": S("gf_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc, keepWithNext=1),
        "entry": S("gf_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GF_INK, keepWithNext=1),
        "dates": S("gf_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.6), textColor=GF_SECOND),
        "meta": S("gf_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8), textColor=GF_SECOND),
        "body": S("gf_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GF_INK),
        "bullet": S("gf_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GF_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("gf_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.8), textColor=GF_INK),
        "skill_v": S("gf_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8), textColor=GF_INK),
        "item": S("gf_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.6), textColor=GF_INK),
    }


def build_government_formal(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else GF_BLUE
    st = _gf_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("   |   ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(7)), _TplRule(width, acc, 3.0)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title), st["sec"]),
                      Spacer(1, _sz(2.2)), _TplRule(width, GF_RULE, 0.6), Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Personal Statement", "experience": "Employment History",
                         "education": "Education & Qualifications",
                         "skills": "Skills & Competencies", "projects": "Additional Projects"},
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118))
    doc.build(story)


# ===========================================================================
# 29 — LAYERED PAPER CARD
# ---------------------------------------------------------------------------
#   sans on an off-white #FAFAF8 page, margins 14.4pt
#   slate #2F3E46 ink with a green #52796F role and #84A98C card borders
#   name 18.4pt bold slate | role 8.6pt bold green | contact 6.3pt #777777
#   section heads 8.1pt bold caps slate
#   entries and individual skill rows each sit on their own white card, with a
#   2.2pt shadow offset behind it — the "layered paper" the name promises
# ===========================================================================
LP_PAGE_BG = colors.HexColor("#FAFAF8")
LP_SLATE = colors.HexColor("#2F3E46")
LP_GREEN = colors.HexColor("#52796F")
LP_BORDER = colors.HexColor("#84A98C")
LP_SHADOW = colors.HexColor("#E6E6E0")


def _lp_styles(acc):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("lp_name", fontName=bold, fontSize=_sz(18.4), leading=_sz(21.6), textColor=LP_SLATE),
        "role": S("lp_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "contact": S("lp_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2),
                     textColor=colors.HexColor("#777777")),
        "sec": S("lp_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=LP_SLATE, keepWithNext=1),
        "entry": S("lp_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.4), textColor=LP_SLATE, keepWithNext=1),
        "dates": S("lp_dates", fontName=reg, fontSize=_sz(6.3), leading=_sz(10.4),
                   textColor=colors.HexColor("#999999")),
        "meta": S("lp_meta", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2),
                  textColor=colors.HexColor("#777777")),
        "body": S("lp_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4),
                  textColor=colors.HexColor("#333333")),
        "bullet": S("lp_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4),
                    textColor=colors.HexColor("#333333"),
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("lp_sk_l", fontName=bold, fontSize=_sz(6.3), leading=_sz(9.0), textColor=acc),
        "skill_v": S("lp_sk_v", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.0),
                     textColor=colors.HexColor("#333333")),
        "item": S("lp_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(10.4),
                  textColor=colors.HexColor("#333333")),
    }


def build_layered_papercard(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else LP_GREEN
    st = _lp_styles(acc)
    reg, bold, _it = _fonts()
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)

    def paint_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(LP_PAGE_BG)
        canvas.rect(0, 0, TPL_PAGE[0], TPL_PAGE[1], stroke=0, fill=1)
        canvas.restoreState()

    doc = _tpl_doc(output_path, data, margin, top_margin=18, on_page=paint_page)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("  &bull;  ".join(_esc_pdf(c) for c in contact), st["contact"])]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(7))])
        story.extend(flows)

    def card(flows):
        return _tpl_paper_card(flows, width, LP_BORDER, LP_SHADOW)

    def entries(text):
        out = []
        for i, e in enumerate(parse_entries(text)):
            title, company, dates, place = _tpl_entry(e)
            inner = [_tpl_row(_esc_pdf(title), _esc_pdf(dates), st["entry"], st["dates"], width - 22)]
            meta = " &middot; ".join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                inner.append(Paragraph(meta, st["meta"]))
            if e.get("bullets"):
                inner.append(Spacer(1, _sz(2.4)))
                for b in e["bullets"]:
                    inner.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
                    inner.append(Spacer(1, _sz(1.4)))
            if i:
                out.append(Spacer(1, _sz(6)))
            out.append(card(inner))
        return out

    def skills(text):
        rows = _tpl_named_lines(text)
        out = []
        for i, (label, value) in enumerate(rows):
            if i:
                out.append(Spacer(1, _sz(4)))
            inner = []
            if label:
                inner.append(Paragraph(_esc_pdf(label), st["skill_l"]))
            inner.append(Paragraph(_esc_pdf(value), st["skill_v"]))
            out.append(card(inner))
        return out

    _tpl_compose(data, st, width, sec, bold, entries=entries, skills=skills)
    doc.build(story)


# ===========================================================================
# 30 — ICE NORDIC
# ---------------------------------------------------------------------------
#   sans, margins 14.4pt, cool blues: #0D47A1 heads, #5C8FC4 role and dates,
#   #8298AB contact, ink #263238, a #DBE7F2 hairline under the header
#   name 19pt light #0D47A1 | role 8.6pt caps #5C8FC4 tracked +1.2pt
#   section heads 8.1pt bold #0D47A1, title case, no rules
#   body 7.5pt / 11 — spacing close to Scandinavian Clean, colder palette
# ===========================================================================
IN_DEEP = colors.HexColor("#0D47A1")
IN_MID = colors.HexColor("#5C8FC4")
IN_FAINT = colors.HexColor("#8298AB")
IN_HAIR = colors.HexColor("#DBE7F2")
IN_INK = colors.HexColor("#263238")


def _in_styles(acc, light):
    _set_type_base(7.5)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "name": S("in_name", fontName=light, fontSize=_sz(19), leading=_sz(22), textColor=acc),
        "contact": S("in_contact", fontName=reg, fontSize=_sz(6.3), leading=_sz(9.2), textColor=IN_FAINT),
        "sec": S("in_sec", fontName=bold, fontSize=_sz(8.1), leading=_sz(10.2), textColor=acc, keepWithNext=1),
        "entry": S("in_entry", fontName=bold, fontSize=_sz(7.5), leading=_sz(10.6), textColor=IN_INK, keepWithNext=1),
        "dates": S("in_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(10.6), textColor=IN_MID),
        "meta": S("in_meta", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=IN_MID),
        "body": S("in_body", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=IN_INK),
        "bullet": S("in_bullet", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=IN_INK,
                    leftIndent=9.6, bulletIndent=_sz(0.6), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("in_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.8), textColor=IN_INK),
        "skill_v": S("in_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8), textColor=IN_INK),
        "item": S("in_item", fontName=reg, fontSize=_sz(7.5), leading=_sz(11), textColor=IN_INK),
    }


def build_ice_nordic(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else IN_DEEP
    reg, bold, _it = _fonts()
    light = "Helvetica" if reg == "Helvetica" else reg
    st = _in_styles(acc, light)
    margin = 14.4
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=18)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(5)),
                  _HCTracked(str(data["title"]).upper(), reg, _sz(8.6), _sz(10.8),
                             tracking=_sz(1.2), color=IN_MID)]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5.6)),
                  Paragraph("  &middot;  ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(8)), _TplRule(width, IN_HAIR, 0.8)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(8))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=110, pad=1.6))
    doc.build(story)


# ===========================================================================
# REGIONAL MARKET STANDARDS (31 – 38)
# ---------------------------------------------------------------------------
# The eight formats that dominate hiring in the world's biggest job markets.
# These are not restyled versions of each other: what changes is which sections
# exist, what they are called, and what personal information is expected —
# a photo and date of birth are normal in Germany and illegal to ask for in the
# US, a Gulf CV leads on visa status, a Japanese rirekisho is a ruled grid.
# Any field the customer hasn't filled in is simply left out.
# ===========================================================================


def _reg_styles(acc, ink, *, serif=False, body=7.5, lead=10.6):
    """Shared style set for the regional templates.

    They differ in structure rather than typography, so one parameterised set
    keeps them consistent — each builder passes its accent, ink and body size.
    """
    _set_type_base(body)   # the body size this design was drawn at
    reg, bold, ital = _fonts()
    if serif and reg == ital:
        ital = "Times-Italic"
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    grey = colors.HexColor("#555555")
    return {
        "name": S("rg_name", fontName=bold, fontSize=_sz(16.6), leading=_sz(19.6), textColor=ink),
        "name_c": S("rg_name_c", fontName=bold, fontSize=_sz(16.6), leading=_sz(19.6),
                    textColor=ink, alignment=TA_CENTER),
        "role": S("rg_role", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc),
        "role_c": S("rg_role_c", fontName=reg, fontSize=_sz(8.6), leading=_sz(10.8),
                    textColor=grey, alignment=TA_CENTER),
        "contact": S("rg_contact", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6), textColor=grey),
        "contact_c": S("rg_contact_c", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.6),
                       textColor=grey, alignment=TA_CENTER),
        "sec": S("rg_sec", fontName=bold, fontSize=_sz(8.6), leading=_sz(10.8), textColor=acc, keepWithNext=1),
        "entry": S("rg_entry", fontName=bold, fontSize=_sz(body), leading=_sz(lead), textColor=ink, keepWithNext=1),
        "dates": S("rg_dates", fontName=reg, fontSize=_sz(6.9), leading=_sz(lead), textColor=grey),
        "meta": S("rg_meta", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6), textColor=grey),
        "body": S("rg_body", fontName=reg, fontSize=_sz(body), leading=_sz(lead), textColor=ink),
        "bullet": S("rg_bullet", fontName=reg, fontSize=_sz(body), leading=_sz(lead), textColor=ink,
                    leftIndent=9.8, bulletIndent=_sz(0.8), bulletFontName=reg, bulletFontSize=_sz(5.2)),
        "skill_l": S("rg_sk_l", fontName=bold, fontSize=_sz(6.9), leading=_sz(9.8), textColor=ink),
        "skill_v": S("rg_sk_v", fontName=reg, fontSize=_sz(6.9), leading=_sz(9.8), textColor=ink),
        "item": S("rg_item", fontName=reg, fontSize=_sz(body), leading=_sz(lead), textColor=ink),
        "note": S("rg_note", fontName=ital, fontSize=_sz(6.9), leading=_sz(9.6), textColor=grey),
    }


# ===========================================================================
# 31 — US CHRONOLOGICAL
# ---------------------------------------------------------------------------
#   US Letter (not A4), margins 40pt, navy #1F3864 on black text
#   centred name 16.6pt bold, one contact line, ruled caps headings
#   no photo, no date of birth, no marital status — all of that is either
#   unlawful to ask for or an instant filter in the US market
#   sections: Summary, Core Competencies, Professional Experience, Education
# ===========================================================================
UC_NAVY = colors.HexColor("#1F3864")


def build_us_chronological(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else UC_NAVY
    st = _reg_styles(acc, colors.HexColor("#111111"))
    reg, bold, _it = _fonts()
    margin = 40.0
    # A4, not Letter. The US market prefers Letter, but a résumé that arrives on
    # the wrong paper prints with a shifted margin or a scaled page, and every
    # other template here is A4 — one paper size across the catalogue is worth
    # more than matching a regional default.
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=36)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name_c"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role_c"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact_c"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.2)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(10)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#BBBBBB"), 0.5),
                      Spacer(1, _sz(5.4))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Professional Summary", "skills": "Core Competencies",
                         "experience": "Professional Experience"},
                 order=("summary", "skills", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=120))
    doc.build(story)


# ===========================================================================
# 32 — UK CV
# ---------------------------------------------------------------------------
#   A4, margins 42pt, teal-navy #1F4E5F — the standard British two-page CV
#   "Curriculum Vitae" kicker, then name 16.6pt bold left
#   British section names: Personal Statement, Key Skills, Employment History,
#   Education & Qualifications — and it closes on a references line, which UK
#   employers still expect and US resumes never carry
# ===========================================================================
UK_ACCENT = colors.HexColor("#1F4E5F")


def build_uk_cv(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else UK_ACCENT
    st = _reg_styles(acc, colors.HexColor("#1A1A1A"))
    reg, bold, _it = _fonts()
    margin = 42.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=38)

    story = [_HCTracked("CURRICULUM VITAE", bold, _sz(6.9), _sz(9),
                        tracking=_sz(1.4), color=acc),
             Spacer(1, _sz(5)),
             Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.0)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#D5DBDE"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Personal Statement", "skills": "Key Skills",
                         "experience": "Employment History",
                         "education": "Education & Qualifications"},
                 order=("summary", "skills", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=120))

    extras = _tpl_pairs(data, [("Languages", "languages"),
                               ("Driving licence", "driving_license")])
    sec("Additional Information", _tpl_pair_rows(extras, st, width, label_w=110))
    note = (data.get("references_note") or "").strip() or "References available on request."
    sec("References", [Paragraph(_esc_pdf(note), st["note"])])
    doc.build(story)


# ===========================================================================
# 33 — EUROPASS-STYLE CV
# ---------------------------------------------------------------------------
#   A4, Europass blue #0E4194, margins 40pt
#   every section is a row: its title in a 118pt label column on the left, the
#   content on the right — the shape EU application portals are built around
#   carries the photo (initials disc), a Personal Information block with date of
#   birth and nationality, and a Languages block, none of which a US resume has
# ===========================================================================
EP_BLUE = colors.HexColor("#0E4194")
EP_LABEL_W = 118.0


def build_europass_cv(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else EP_BLUE
    st = _reg_styles(acc, colors.HexColor("#1A1A1A"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    content_w = width - EP_LABEL_W - 12
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    head_right = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        head_right += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        head_right += [Spacer(1, _sz(4)),
                       Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    head = Table([[_tpl_avatar(data, size=58.0, bg=acc), head_right]],
                 colWidths=[74, width - 74])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [head, Spacer(1, _sz(8)), _TplRule(width, acc, 1.2)]

    def sec(title, flows):
        """Section title in the left label column, content on the right."""
        if not flows:
            return
        row = Table([[Paragraph(_esc_pdf(title).upper(), st["sec"]), flows]],
                    colWidths=[EP_LABEL_W, width - EP_LABEL_W], splitInRow=1)
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#D8DEE9")),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 12),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(row)

    personal = _tpl_pairs(data, [("Date of birth", "date_of_birth"),
                                 ("Nationality", "nationality"),
                                 ("Gender", "gender"),
                                 ("Driving licence", "driving_license")])
    sec("Personal information", _tpl_pair_rows(personal, st, content_w, label_w=96))

    _tpl_compose(data, st, content_w, sec, bold,
                 labels={"summary": "Personal statement", "experience": "Work experience",
                         "education": "Education and training",
                         "skills": "Skills and competences"},
                 order=("summary", "experience", "education", "skills", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, content_w, label_w=104))

    langs = _lines(data.get("languages", ""))
    if langs:
        sec("Languages", [Paragraph(_esc_pdf(l), st["body"]) for l in langs])
    doc.build(story)


# ===========================================================================
# 34 — GERMAN LEBENSLAUF
# ---------------------------------------------------------------------------
#   A4, slate #2C3E50, margins 44pt — the tabular Lebenslauf German recruiters
#   read: a 104pt date column on the left, content on the right, every entry
#   lined up on the same grid
#   photo top right and a Persönliche Daten block are conventional here, and it
#   closes with a place-and-date signature line
# ===========================================================================
LL_SLATE = colors.HexColor("#2C3E50")
LL_DATE_W = 104.0


# ===========================================================================
# 35 — INDIAN RESUME
# ---------------------------------------------------------------------------
#   A4, blue #1F618D, margins 40pt — the format Indian employers expect
#   centred header with a photo disc, then Career Objective
#   education is placed above experience (graded qualifications lead here), and
#   it carries a Personal Details block and a signed Declaration, both standard
#   in India and both absent from a US or UK resume
# ===========================================================================
IR_BLUE = colors.HexColor("#1F618D")


def build_india_resume(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else IR_BLUE
    st = _reg_styles(acc, colors.HexColor("#1A1A1A"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    centre = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name_c"])]
    if data.get("title"):
        centre += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role_c"])]
    contact = _tpl_contact(data)
    if contact:
        centre += [Spacer(1, _sz(4)),
                   Paragraph(" | ".join(_esc_pdf(c) for c in contact), st["contact_c"])]
    head = Table([[_tpl_avatar(data, size=58.0, bg=acc), centre]], colWidths=[74, width - 74])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [head, Spacer(1, _sz(8)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#D6DBDF"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Career Objective", "education": "Academic Qualifications",
                         "skills": "Technical Skills", "experience": "Work Experience"},
                 order=("summary", "education", "skills", "experience", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118))

    personal = _tpl_pairs(data, [("Father's Name", "father_name"),
                                 ("Date of Birth", "date_of_birth"),
                                 ("Nationality", "nationality"),
                                 ("Gender", "gender"),
                                 ("Marital Status", "marital_status"),
                                 ("Languages Known", "languages"),
                                 ("Passport", "passport_status"),
                                 ("Notice Period", "notice_period")])
    sec("Personal Details", _tpl_pair_rows(personal, st, width, label_w=118))

    declaration = (data.get("declaration") or "").strip() or (
        "I hereby declare that the above information is true to the best of my "
        "knowledge and belief.")
    sec("Declaration", [Paragraph(_esc_pdf(declaration), st["body"]),
                        Spacer(1, _sz(16)),
                        _tpl_signature_row(data, st, width,
                                           sign_label=f"Signature ({data.get('full_name', '')})")])
    doc.build(story)


# ===========================================================================
# 36 — CANADIAN RESUME
# ---------------------------------------------------------------------------
#   US Letter (Canada uses Letter, not A4), maple red #A6192E, margins 40pt
#   section labels sit in a solid pill rather than on a rule — the one piece of
#   decoration in an otherwise plain document
#   no photo and no personal details, same as the US, but it does close on a
#   references line, which Canadian employers commonly ask for
# ===========================================================================
CA_RED = colors.HexColor("#A6192E")


class _TplPill(Flowable):
    """A section label reversed out of a solid rounded block."""

    def __init__(self, text, font, size, bg, fg=colors.white, pad_x=8.0, pad_y=3.4):
        Flowable.__init__(self)
        self.text, self.font, self.size = text, font, size
        self.bg, self.fg = bg, fg
        self.pad_x, self.pad_y = pad_x, pad_y
        self.w = _pdfmetrics.stringWidth(text, font, size) + pad_x * 2
        self.h = size + pad_y * 2

    def wrap(self, availWidth, availHeight):
        return min(self.w, availWidth), self.h

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.roundRect(0, 0, self.w, self.h, 2.4, stroke=0, fill=1)
        c.setFillColor(self.fg)
        c.setFont(self.font, self.size)
        c.drawString(self.pad_x, self.pad_y + self.size * 0.22, self.text)


def build_canadian_resume(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else CA_RED
    st = _reg_styles(acc, colors.HexColor("#141414"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * margin       # A4, like every other template
    doc = _tpl_doc(output_path, data, margin, top_margin=36)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.6)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)),
                      _TplPill(str(title).upper(), bold, _sz(7.2), acc),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Profile", "skills": "Skills & Competencies",
                         "experience": "Professional Experience"},
                 order=("summary", "skills", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=124))
    note = (data.get("references_note") or "").strip() or "References available on request."
    sec("References", [Paragraph(_esc_pdf(note), st["note"])])
    doc.build(story)


# ===========================================================================
# 37 — MIDDLE EAST / GULF CV
# ---------------------------------------------------------------------------
#   A4, teal #0F766E, margins 40pt
#   photo disc top right, and — the point of this format — visa status,
#   nationality and notice period are surfaced at the very top, because Gulf
#   recruiters screen on work eligibility before they read the experience
#   sections: Objective, Personal Details, Experience, Education, Skills
# ===========================================================================
GC_TEAL = colors.HexColor("#0F766E")


def build_gulf_cv(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else GC_TEAL
    st = _reg_styles(acc, colors.HexColor("#14211F"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    left = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        left += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        left += [Spacer(1, _sz(4)),
                 Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    head = Table([[left, _tpl_avatar(data, size=58.0, bg=acc)]], colWidths=[width - 74, 74])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [head, Spacer(1, _sz(8)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#D3E0DE"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    eligibility = _tpl_pairs(data, [("Nationality", "nationality"),
                                    ("Visa status", "visa_status"),
                                    ("Passport", "passport_status"),
                                    ("Date of birth", "date_of_birth"),
                                    ("Marital status", "marital_status"),
                                    ("Driving licence", "driving_license"),
                                    ("Languages", "languages"),
                                    ("Notice period", "notice_period"),
                                    ("Expected salary", "expected_salary")])

    def after_summary():
        sec("Personal Details", _tpl_pair_rows(eligibility, st, width, label_w=118,
                                               rule=colors.HexColor("#E6EFED")))

    summary = (data.get("summary") or "").strip()
    if summary:
        sec("Career Objective", [Paragraph(_esc_pdf(p), st["body"])
                                 for p in summary.split("\n") if p.strip()])
    after_summary()
    _tpl_compose(data, st, width, sec, bold,
                 labels={"experience": "Professional Experience", "skills": "Skills"},
                 order=("experience", "education", "skills", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118))
    doc.build(story)


# ===========================================================================
# 38 — RULED FORM
# ---------------------------------------------------------------------------
#   A4, margins 40pt, hairline #444444 grid — a form rather than a document
#   nothing here is styling for its own sake: it is a grid, so the header is a
#   boxed table with a photo cell, history is a year/month/detail table, and
#   qualifications and a personal-statement box close it
#   headings are English only. They used to carry a romanised Japanese term
#   beside each one, which doubled every label's width and put a second
#   language in front of readers who had not asked for one; the ruled form
#   itself is what this template is for, and that is unchanged.
# ===========================================================================
JP_INK = colors.HexColor("#1A1A1A")
JP_GRID = colors.HexColor("#555555")


def _jp_box(rows, widths, st, grid=JP_GRID, pad=5.0, header_bg=None):
    t = Table(rows, colWidths=widths, splitInRow=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, grid),
        ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad * 0.7), ("BOTTOMPADDING", (0, 0), (-1, -1), pad * 0.7),
    ]
    if header_bg is not None:
        style.append(("BACKGROUND", (0, 0), (-1, 0), header_bg))
    t.setStyle(TableStyle(style))
    return t


def build_japan_rirekisho(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else JP_INK
    st = _reg_styles(acc, JP_INK, body=7.5, lead=10.4)
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=36)

    # No kicker. It carried the romanised form name and announced the document
    # as a "curriculum vitae" — two things the reader neither needs nor asked
    # for. The identity grid below is a strong enough opening on its own.
    story = []

    # Identity box: labelled rows on the left, photo cell on the right.
    ident_rows = []
    for label, value in ([("Name", data.get("full_name", "")),
                          ("Role", data.get("title", ""))]
                         + _tpl_pairs(data, [("Date of birth", "date_of_birth"),
                                             ("Nationality", "nationality"),
                                             ("Address", "location"),
                                             ("Phone", "phone"),
                                             ("Email", "email")])):
        if not value:
            continue
        # The name is the one field in the identity grid that reads as a heading.
        # It was set in the same 6.9pt caption face as every other cell, which
        # made it *smaller* than the résumé's own body text — the only template
        # in the catalogue where that was true.
        value_style = st["entry"] if label == "Name" else st["skill_v"]
        ident_rows.append([Paragraph(_esc_pdf(label), st["skill_l"]),
                           Paragraph(_esc_pdf(value), value_style)])
    photo_w = 72.0
    ident = _jp_box(ident_rows, [124.0, width - photo_w - 124.0 - 6], st) if ident_rows else ""
    photo = _jp_box([[_tpl_avatar(data, size=52.0, bg=acc)]], [photo_w], st)
    head = Table([[ident, photo]], colWidths=[width - photo_w - 6, photo_w + 6], splitInRow=1)
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 6),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(head)

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(4))])
        story.extend(flows)

    def history_box(label, text):
        """Year/month column, then the entry — the rirekisho history grid."""
        rows = [[Paragraph(_esc_pdf("Date"), st["skill_l"]),
                 Paragraph(_esc_pdf(label), st["skill_l"])]]
        for e in parse_entries(text):
            title, company, dates, place = _tpl_entry(e)
            detail = [Paragraph(_esc_pdf(title), st["entry"])]
            meta = " &middot; ".join(_esc_pdf(x) for x in (company, place) if x)
            if meta:
                detail.append(Paragraph(meta, st["meta"]))
            for b in e.get("bullets", []):
                detail.append(Paragraph(_esc_pdf(b), st["bullet"], bulletText="•"))
            rows.append([Paragraph(_esc_pdf(dates), st["dates"]), detail])
        if len(rows) == 1:
            return []
        return [_jp_box(rows, [96.0, width - 96.0], st, header_bg=colors.HexColor("#F2F2F2"))]

    sec("Education", history_box("Education", data.get("education", "")))
    sec("Work History", history_box("Work history", data.get("experience", "")))

    quals = _lines(data.get("certifications", "")) + _lines(data.get("languages", ""))
    if quals:
        rows = [[Paragraph(_esc_pdf("Licences & qualifications"), st["skill_l"])]]
        rows += [[Paragraph(_esc_pdf(q), st["body"])] for q in quals]
        sec("Licences & Qualifications",
            [_jp_box(rows, [width], st, header_bg=colors.HexColor("#F2F2F2"))])

    appeal = [p for p in (data.get("summary") or "").split("\n") if p.strip()]
    skills = _tpl_named_lines(data.get("skills", ""))
    if skills:
        appeal.append("Skills: " + "; ".join(
            f"{a}: {b}" if a else b for a, b in skills))
    if appeal:
        sec("Personal Statement",
            [_jp_box([[[Paragraph(_esc_pdf(p), st["body"]) for p in appeal]]], [width], st)])

    projects = _tpl_project_lines(data.get("projects", ""))
    if projects:
        sec("Projects", _tpl_dash_lines(projects, st, bold))
    # The rirekisho is a fixed form, so these don't have a box of their own in
    # the original — but they are the customer's content and must still print.
    sec("Publications", _tpl_plain_lines(_lines(data.get("publications", "")), st))
    for cs in (data.get("custom_sections") or []):
        if not isinstance(cs, dict):
            continue
        sec(cs.get("title") or "Additional", _tpl_custom_flows(cs, st, width))
    story += [Spacer(1, _sz(14)), _tpl_signature_row(data, st, width,
                                                     date_label="Date",
                                                     sign_label="Signature")]
    doc.build(story)


# ===========================================================================
# MODERN ARCHETYPES (39 – 45)
# ---------------------------------------------------------------------------
# The seven layouts recruiters see most often, and they differ by *structure*
# rather than decoration: which sections lead, and what gets promoted to the
# top of the page. A functional CV leads on competencies because it is hiding a
# gap; a graduate CV leads on education because there is no experience yet.
# ===========================================================================


def _tpl_first_bullets(data, limit=5, per_role=1):
    """Achievement lines lifted out of the roles, each with where it came from.

    `per_role=1` gives a highlights block that summarises a résumé whose roles
    also print in full below. `per_role=None` takes every bullet, which is what
    the functional layout needs — there the roles print as one line each, so
    anything not lifted here would be dropped from the document entirely.
    """
    out = []
    for e in parse_entries(data.get("experience", "")):
        bullets = e.get("bullets") or []
        if not bullets:
            continue
        title, company, _dates, _place = _tpl_entry(e)
        source = " &middot; ".join(_esc_pdf(x) for x in (title, company) if x)
        for b in (bullets if per_role is None else bullets[:per_role]):
            out.append((b, source))
        if limit and per_role is not None and len(out) >= limit:
            break
    return out[:limit] if (limit and per_role is not None) else out


# ===========================================================================
# 39 — HYBRID (COMBINATION)
# ---------------------------------------------------------------------------
#   A4, blue #2563EB, margins 40pt — the format most recruiters now prefer
#   a summary, then a full-width Areas of Expertise band of skill groups, and
#   only then reverse-chronological experience: skills are proven by the roles
#   underneath rather than replacing them
#   heads 8.6pt bold caps blue over a hairline, body 7.5pt / 10.6
# ===========================================================================
HY_BLUE = colors.HexColor("#2563EB")


def build_hybrid_combination(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else HY_BLUE
    st = _reg_styles(acc, colors.HexColor("#111827"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#DBE3F1"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Professional Summary", "skills": "Areas of Expertise",
                         "experience": "Professional Experience"},
                 order=("summary", "skills", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_grid(text, st, width, cols=2))
    doc.build(story)


# ===========================================================================
# 40 — FUNCTIONAL (SKILLS-FIRST)
# ---------------------------------------------------------------------------
#   A4, violet #6D28D9, margins 40pt
#   competencies and achievements carry the page; employment history is reduced
#   to one line per role at the bottom. This is the layout for a career change
#   or a gap in dates, where a chronological read works against you.
#   Headings are marked by a solid accent square rather than a rule — with four
#   structural archetypes in the catalogue (hybrid, functional, achievement-led,
#   graduate) they need to be told apart at thumbnail size, not just read.
# ===========================================================================
FN_VIOLET = colors.HexColor("#6D28D9")


def build_functional_skills(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else FN_VIOLET
    st = _reg_styles(acc, colors.HexColor("#1F1235"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        head = f'<font color="#{acc.hexval()[2:]}">&#9632;</font>  {_esc_pdf(title).upper()}'
        story.extend([Spacer(1, _sz(11)), Paragraph(head, st["sec"]), Spacer(1, _sz(6))])
        story.extend(flows)

    summary = (data.get("summary") or "").strip()
    if summary:
        sec("Profile", [Paragraph(_esc_pdf(p), st["body"]) for p in summary.split("\n") if p.strip()])

    # Competencies as themed blocks: the group name leads, its skills follow.
    blocks = []
    for label, value in _tpl_named_lines(data.get("skills", "")):
        if label:
            blocks.append(Paragraph(_esc_pdf(label), st["entry"]))
        blocks.append(Paragraph(_esc_pdf(value), st["body"]))
        blocks.append(Spacer(1, _sz(4.4)))
    sec("Core Competencies", blocks)

    # Every bullet, attributed — the roles below print as single lines, so this
    # block is the only place the detail appears.
    highlights = _tpl_first_bullets(data, limit=None, per_role=None)
    sec("Achievements",
        [f for text, source in highlights
         for f in (Paragraph(f"{_esc_pdf(text)} <font size=\"6\">({source})</font>",
                             st["bullet"], bulletText="•"), Spacer(1, _sz(1.8)))])

    # Employment reduced to one line per role — dates present, detail omitted.
    roles = []
    for e in parse_entries(data.get("experience", "")):
        title, company, dates, place = _tpl_entry(e)
        left = ", ".join(_esc_pdf(x) for x in (title, company, place) if x)
        roles.append(_tpl_row(left, _esc_pdf(dates), st["body"], st["dates"], width, 0.76))
        roles.append(Spacer(1, _sz(2.6)))
    sec("Employment History", roles)

    _tpl_compose(data, st, width, sec, bold,
                 order=("education", "projects", "certifications", "publications"))
    doc.build(story)


# ===========================================================================
# 41 — PROFILE STYLE
# ---------------------------------------------------------------------------
#   A4, LinkedIn blue #0A66C2, margins 40pt
#   avatar disc beside the name and a headline underneath, exactly like an
#   online profile — the format candidates recognise from their own page
#   experience shows "Company · Dates" under the role, skills render as chips
# ===========================================================================
PF_BLUE = colors.HexColor("#0A66C2")
PF_CHIP = colors.HexColor("#EAF1FB")


def build_profile_style(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else PF_BLUE
    st = _reg_styles(acc, colors.HexColor("#191919"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    right = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        right += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        right += [Spacer(1, _sz(4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    head = Table([[_tpl_avatar(data, size=62.0, bg=acc), right]], colWidths=[78, width - 78])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [head, Spacer(1, _sz(9)), _TplRule(width, colors.HexColor("#DDDDDD"), 0.8)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(12)), Paragraph(_esc_pdf(title), st["sec"]), Spacer(1, _sz(6)),
                      _TplRule(width, colors.HexColor("#E8EEF6"), 0.6), Spacer(1, _sz(6))])
        story.extend(flows)

    def skills(text):
        chips = _tpl_chip_items(text)
        if not chips:
            return []
        return [_CCChips(chips, width, reg, _sz(6.3), bg=PF_CHIP, fg=acc,
                         pad_x=5.4, pad_y=3.4, gap=3.0, line_gap=3.4)]

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "About", "skills": "Skills", "experience": "Experience"},
                 skills=skills)
    doc.build(story)


# ===========================================================================
# 42 — PHOTO HEADER
# ===========================================================================
#   A4, slate #334155, margins 40pt
#   a 96pt tinted header band with the photo disc, name, role and contact set
#   inside it — the norm across continental Europe and Latin America, where a
#   CV without a photo looks unfinished
#   heads 8.6pt bold caps slate over a hairline; body 7.5pt / 10.6
# ===========================================================================
PH_SLATE = colors.HexColor("#334155")
PH_BAND = colors.HexColor("#F1F5F9")
PH_BAND_H = 96.0


def build_photo_header(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else PH_SLATE
    st = _reg_styles(acc, colors.HexColor("#0F172A"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)

    def paint_band(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PH_BAND)
        canvas.rect(0, TPL_PAGE[1] - PH_BAND_H, TPL_PAGE[0], PH_BAND_H, stroke=0, fill=1)
        canvas.setFillColor(acc)
        canvas.rect(0, TPL_PAGE[1] - PH_BAND_H, TPL_PAGE[0], 2.4, stroke=0, fill=1)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(margin, 34, width, TPL_PAGE[1] - PH_BAND_H - 18 - 34,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(margin, 34, width, TPL_PAGE[1] - 36 - 34,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint_band),
                          PageTemplate(id="rest", frames=[rest])])

    # The header sits in the band, so it is part of the story rather than the
    # canvas — that way a long name still wraps instead of running off the page.
    right = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        right += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        right += [Spacer(1, _sz(4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    head = Table([[_tpl_avatar(data, size=60.0, bg=acc), right]], colWidths=[76, width - 76])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [NextPageTemplate("rest"), head, Spacer(1, _sz(14))]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(10)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#DDE3EA"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=120))
    details = _tpl_pairs(data, [("Date of birth", "date_of_birth"),
                                ("Nationality", "nationality"),
                                ("Languages", "languages"),
                                ("Driving licence", "driving_license")])
    sec("Personal Details", _tpl_pair_rows(details, st, width, label_w=120))
    doc.build(story)


# ===========================================================================
# 43 — ACHIEVEMENT FOCUSED
# ---------------------------------------------------------------------------
#   A4, amber #B45309, margins 40pt
#   a Key Achievements block promotes the opening bullet of each role to the
#   top of the page, where a recruiter's first fifteen seconds go, and each
#   role's own bullets then read as results
#   heads 8.6pt bold caps amber over a hairline; body 7.5pt / 10.6
# ===========================================================================
AF_AMBER = colors.HexColor("#B45309")


def build_achievement_focused(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else AF_AMBER
    st = _reg_styles(acc, colors.HexColor("#1C1917"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#EEDFCB"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    summary = (data.get("summary") or "").strip()
    if summary:
        sec("Profile", [Paragraph(_esc_pdf(p), st["body"]) for p in summary.split("\n") if p.strip()])

    highlights = _tpl_first_bullets(data, limit=5)
    if highlights:
        flows = []
        for text, source in highlights:
            flows.append(_tpl_bar_block([Paragraph(_esc_pdf(text), st["body"]),
                                         Paragraph(source, st["meta"])],
                                        width, acc, thickness=2.0, pad=8.0))
            flows.append(Spacer(1, _sz(4.4)))
        sec("Key Achievements", flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"experience": "Professional Experience", "skills": "Skills"},
                 order=("experience", "skills", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=120))
    doc.build(story)


# ===========================================================================
# 44 — GRADUATE / ENTRY-LEVEL
# ---------------------------------------------------------------------------
#   A4, cyan #0E7490, margins 40pt
#   education leads, then projects, then whatever experience exists — the right
#   order when the degree is the strongest thing on the page
#   internships and part-time work are still listed under Experience, and
#   certifications sit near the top rather than as an afterthought
# ===========================================================================
GR_CYAN = colors.HexColor("#0E7490")


def build_graduate_entry(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else GR_CYAN
    st = _reg_styles(acc, colors.HexColor("#0F172A"))
    reg, bold, _it = _fonts()
    margin = 40.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=34)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(4.4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    story += [Spacer(1, _sz(6)), _TplRule(width, acc, 1.4)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(1.8)), _TplRule(width, colors.HexColor("#D3E6EA"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Career Objective", "skills": "Technical Skills",
                         "projects": "Academic & Personal Projects",
                         "experience": "Experience & Internships"},
                 order=("summary", "education", "projects", "skills", "experience",
                        "certifications", "publications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118))
    extras = _tpl_pairs(data, [("Languages", "languages"),
                               ("Driving licence", "driving_license"),
                               ("Availability", "notice_period")])
    sec("Additional Information", _tpl_pair_rows(extras, st, width, label_w=118))
    doc.build(story)


# ===========================================================================
# 45 — EXECUTIVE TWO-PAGE
# ---------------------------------------------------------------------------
#   A4, navy #14213D, margins 54pt — the widest margins in the catalogue
#   serif by default, larger body type, and an Executive Summary followed by
#   Career Highlights: a board-level CV is expected to run to two pages, so it
#   is set to be read rather than squeezed
# ===========================================================================
EX_NAVY = colors.HexColor("#14213D")


def build_executive_twopage(data: dict, output_path: str):
    acc = _acc() if data.get("accent_color") else EX_NAVY
    st = _reg_styles(acc, colors.HexColor("#141414"), serif=True, body=8.1, lead=11.8)
    reg, bold, _it = _fonts()
    margin = 54.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=48)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name_c"])]
    if data.get("title"):
        story += [Spacer(1, _sz(3.4)), Paragraph(_esc_pdf(data["title"]), st["role_c"])]
    contact = _tpl_contact(data)
    if contact:
        story += [Spacer(1, _sz(5)),
                  Paragraph("   |   ".join(_esc_pdf(c) for c in contact), st["contact_c"])]
    story += [Spacer(1, _sz(8)), _TplRule(width, acc, 1.6), Spacer(1, 1.2),
              _TplRule(width, acc, 0.5)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(13)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2.2)), _TplRule(width, colors.HexColor("#C8CEDA"), 0.6),
                      Spacer(1, _sz(7))])
        story.extend(flows)

    summary = (data.get("summary") or "").strip()
    if summary:
        sec("Executive Summary", [Paragraph(_esc_pdf(p), st["body"])
                                  for p in summary.split("\n") if p.strip()])

    highlights = _tpl_first_bullets(data, limit=5)
    sec("Career Highlights",
        [f for text, source in highlights
         for f in (Paragraph(f"{_esc_pdf(text)} <font size=\"6.5\">({source})</font>",
                             st["bullet"], bulletText="•"), Spacer(1, _sz(2.2)))])

    _tpl_compose(data, st, width, sec, bold,
                 labels={"experience": "Professional Experience",
                         "skills": "Leadership & Expertise",
                         "projects": "Selected Engagements"},
                 order=("experience", "skills", "education", "projects",
                        "publications", "certifications"),
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=130))
    doc.build(story)


# ===========================================================================
# PHOTO-LED DESIGNS (46 – 48)
# ---------------------------------------------------------------------------
# The picture-carrying templates so far treat the photo as a detail the market
# happens to require. These three are built around it: the photo is the first
# thing the layout is arranged for, not a slot bolted onto a text CV. All three
# fall back to an initials disc when no photo has been uploaded, so they never
# render as a hole in the page.
# ===========================================================================
PS_PANEL = colors.HexColor("#1B2A38")
PS_PANEL_W = 196.0


def build_photo_sidebar(data: dict, output_path: str):
    """Full-height dark panel: portrait at the top, contact and skills beneath.

    The photo is 108pt — large enough to read as a portrait rather than a stamp,
    which is the point of choosing this template at all.
    """
    acc = _acc() if data.get("accent_color") else colors.HexColor("#4FD1C5")
    st = _reg_styles(acc, colors.HexColor("#1F2933"))
    reg, bold, _it = _fonts()
    side_st = _ts_styles(acc)

    def paint(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PS_PANEL)
        canvas.rect(0, 0, PS_PANEL_W, TPL_PAGE[1], stroke=0, fill=1)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    # The dark panel bleeds to the paper edge, but the text inside it keeps the
    # same margin as the rest of the document — it was inset 28pt, which put the
    # sidebar headings closer to the trim than any other template allows.
    top = bottom = TPL_MIN_MARGIN
    side = Frame(TPL_MIN_MARGIN, bottom, PS_PANEL_W - 2 * TPL_MIN_MARGIN,
                 TPL_PAGE[1] - top - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="side")
    main = Frame(PS_PANEL_W + 26, bottom, TPL_PAGE[0] - PS_PANEL_W - 26 - TPL_MIN_MARGIN,
                 TPL_PAGE[1] - top - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="main")
    rest = Frame(PS_PANEL_W + 26, bottom, TPL_PAGE[0] - PS_PANEL_W - 26 - 34,
                 TPL_PAGE[1] - 34 - bottom,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[side, main], onPage=paint),
                          PageTemplate(id="rest", frames=[rest], onPage=paint)])
    width = TPL_PAGE[0] - PS_PANEL_W - 60

    story = [NextPageTemplate("rest"), _tpl_avatar(data, size=108.0, bg=acc), Spacer(1, _sz(12))]
    contact = _tpl_contact(data)
    if contact:
        story.append(Paragraph("CONTACT", side_st["side_h"]))
        story.append(Spacer(1, _sz(4)))
        for c in contact:
            story.append(Paragraph(_esc_pdf(c), side_st["side_val"]))
            story.append(Spacer(1, _sz(1.6)))
    rows = _tpl_named_lines(data.get("skills", ""))
    if rows:
        story += [Spacer(1, _sz(10)), Paragraph("SKILLS", side_st["side_h"]), Spacer(1, _sz(4))]
        for label, value in rows:
            if label:
                story.append(Paragraph(_esc_pdf(label), side_st["side_lab"]))
            story.append(Paragraph(_esc_pdf(value), side_st["side_val"]))
            story.append(Spacer(1, _sz(3)))
    langs = _lines(data.get("languages", ""))
    if langs:
        story += [Spacer(1, _sz(10)), Paragraph("LANGUAGES", side_st["side_h"]), Spacer(1, _sz(4))]
        for l in langs:
            story.append(Paragraph(_esc_pdf(l), side_st["side_val"]))
            story.append(Spacer(1, _sz(1.6)))
    story.append(FrameBreak())

    story += [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        story += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    story += [Spacer(1, _sz(7)), _TplRule(width, acc, 1.6)]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(11)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2)), _TplRule(width, colors.HexColor("#E3E8EC"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 order=("summary", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda _t: [])          # skills live in the panel
    doc.build(story)


def build_photo_banner(data: dict, output_path: str):
    """Portrait beside a tinted banner: the photo and the name share the header.

    Common across continental Europe and Latin America, where a CV without a
    face reads as incomplete.
    """
    acc = _acc() if data.get("accent_color") else colors.HexColor("#2F4858")
    st = _reg_styles(acc, colors.HexColor("#1A222B"))
    reg, bold, _it = _fonts()
    margin, band_h = 40.0, 132.0
    width = TPL_PAGE[0] - 2 * max(margin, TPL_MIN_MARGIN)

    def paint(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#EDF1F4"))
        canvas.rect(0, TPL_PAGE[1] - band_h, TPL_PAGE[0], band_h, stroke=0, fill=1)
        canvas.setFillColor(acc)
        canvas.rect(0, TPL_PAGE[1] - band_h, TPL_PAGE[0], 3.0, stroke=0, fill=1)
        canvas.restoreState()

    doc = BaseDocTemplate(output_path, pagesize=TPL_PAGE,
                          title=data.get("full_name", "Resume"), author=data.get("full_name", ""))
    first = Frame(margin, 34, width, TPL_PAGE[1] - band_h - 20 - 34,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="first")
    rest = Frame(margin, 34, width, TPL_PAGE[1] - 40 - 34,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="rest")
    doc.addPageTemplates([PageTemplate(id="first", frames=[first], onPage=paint),
                          PageTemplate(id="rest", frames=[rest])])

    right = [Paragraph(_esc_pdf(data.get("full_name", "")), st["name"])]
    if data.get("title"):
        right += [Spacer(1, _sz(2.6)), Paragraph(_esc_pdf(data["title"]), st["role"])]
    contact = _tpl_contact(data)
    if contact:
        right += [Spacer(1, _sz(4)),
                  Paragraph(" &middot; ".join(_esc_pdf(c) for c in contact), st["contact"])]
    head = Table([[_tpl_avatar(data, size=86.0, bg=acc), right]], colWidths=[104, width - 104])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [NextPageTemplate("rest"), head, Spacer(1, _sz(16))]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(10)), Paragraph(_esc_pdf(title).upper(), st["sec"]),
                      Spacer(1, _sz(2)), _TplRule(width, colors.HexColor("#DBE2E7"), 0.6),
                      Spacer(1, _sz(6))])
        story.extend(flows)

    _tpl_compose(data, st, width, sec, bold,
                 skills=lambda text: _tpl_skill_rows(text, st, width, label_w=118))
    details = _tpl_pairs(data, [("Date of birth", "date_of_birth"),
                                ("Nationality", "nationality"),
                                ("Languages", "languages"),
                                ("Driving licence", "driving_license")])
    sec("Personal Details", _tpl_pair_rows(details, st, width, label_w=118))
    doc.build(story)


# ===========================================================================
# 49 — CENTRED SERIF (BANDED SECTIONS)
# ---------------------------------------------------------------------------
#   US Letter, margins 50pt, Times serif throughout, ink #111111, no colour
#   name 20pt bold caps centred, role 11pt bold centred, location 9.5pt centred
#   a contact strip bracketed by two full-width hairlines, phone flush left and
#   email flush right, with a Nationality row beneath
#   section heads 11.5pt bold caps centred on a full-width 10% grey band, each
#   underlined to the width of its own text
#   skills run down two columns instead of the label/value grid the other
#   templates use, which is what lets a long stack fit without a second page
# ===========================================================================
CSB_BAND = colors.HexColor("#E6E6E6")
CSB_INK = colors.HexColor("#111111")


class _CsbBandHead(Flowable):
    """A centred caps heading on a full-width grey band, underlined to the
    width of its own text.

    Band, text and rule are one flowable rather than three so a page break can
    never land between them and leave a bare band at the foot of a page.
    """

    def __init__(self, text, font, size, width, band=CSB_BAND, ink=CSB_INK):
        Flowable.__init__(self)
        self.text, self.font, self.size = text, font, size
        self.avail, self.band, self.ink = width, band, ink
        self.h = size * 1.9

    def wrap(self, availWidth, availHeight):
        self.avail = availWidth
        return availWidth, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(self.band)
        c.rect(0, 0, self.avail, self.h, stroke=0, fill=1)
        tw = _pdfmetrics.stringWidth(self.text, self.font, self.size)
        x = max(0.0, (self.avail - tw) / 2.0)
        y = (self.h - self.size) / 2.0 + self.size * 0.22
        c.setFillColor(self.ink)
        c.setFont(self.font, self.size)
        c.drawString(x, y, self.text)
        c.setStrokeColor(self.ink)
        c.setLineWidth(0.7)
        c.line(x - 2, y - 2.6, x + tw + 2, y - 2.6)


def _csb_two_col(text, st, width, gap=18.0):
    """Skills as two balanced columns of plain lines.

    The category labels the builder stores (`Python: pandas, numpy`) are kept
    whole — splitting a label from its items across a column boundary reads as
    two unrelated fragments.
    """
    items = []
    for line in _lines(text):
        line = line.strip()
        if line:
            items.append(line)
    if not items:
        return []
    half = (len(items) + 1) // 2
    col_w = (width - gap) / 2.0
    mk = lambda part: [Paragraph(_esc_pdf(i), st["item"]) for i in part]
    tbl = Table([[mk(items[:half]), mk(items[half:])]], colWidths=[col_w, col_w])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), gap),
        ("LEFTPADDING", (1, 0), (1, 0), 0), ("RIGHTPADDING", (1, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [tbl]


def build_centred_serif(data: dict, output_path: str):
    ink = CSB_INK
    st = _reg_styles(_acc() if data.get("accent_color") else ink, ink,
                     serif=True, body=9.0, lead=12.2)
    reg, bold, _it = _fonts()
    margin = 50.0
    width = LETTER[0] - 2 * max(margin, TPL_MIN_MARGIN)
    doc = _tpl_doc(output_path, data, margin, top_margin=30, page=LETTER)

    base = getSampleStyleSheet()["Normal"]
    S = lambda n, **kw: ParagraphStyle(n, **{"parent": base, **kw})
    grey = colors.HexColor("#444444")
    name_st = S("csb_name", fontName=bold, fontSize=_sz(19.0), leading=_sz(22.0),
                textColor=ink, alignment=TA_CENTER)
    role_st = S("csb_role", fontName=bold, fontSize=_sz(10.6), leading=_sz(13.0),
                textColor=ink, alignment=TA_CENTER)
    loc_st = S("csb_loc", fontName=reg, fontSize=_sz(9.0), leading=_sz(11.6),
               textColor=grey, alignment=TA_CENTER)
    strip_l = S("csb_strip_l", fontName=bold, fontSize=_sz(9.2), leading=_sz(11.6), textColor=ink)
    strip_r = S("csb_strip_r", parent=strip_l, alignment=TA_RIGHT)

    story = [Paragraph(_esc_pdf(data.get("full_name", "")).upper(), name_st)]
    if (data.get("title") or "").strip():
        story += [Spacer(1, _sz(3.0)), Paragraph(_esc_pdf(data["title"]), role_st)]
    if (data.get("location") or "").strip():
        story += [Spacer(1, _sz(3.0)), Paragraph(_esc_pdf(data["location"]), loc_st)]

    # The contact strip: one hairline, phone hard left and email hard right on
    # a single row, one hairline. An empty side collapses rather than leaving a
    # lopsided gap, so a résumé with only an email still reads as centred.
    phone = _esc_pdf((data.get("phone") or "").strip())
    email = _esc_pdf((data.get("email") or "").strip())
    if phone or email:
        if phone and email:
            row = Table([[Paragraph(phone, strip_l), Paragraph(email, strip_r)]],
                        colWidths=[width / 2.0, width / 2.0])
        else:
            row = Table([[Paragraph(phone or email,
                                    S("csb_strip_c", parent=strip_l, alignment=TA_CENTER))]],
                        colWidths=[width])
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story += [Spacer(1, _sz(8.0)), _TplRule(width, ink, 0.8), Spacer(1, _sz(5.0)),
                  row, Spacer(1, _sz(5.0)), _TplRule(width, ink, 0.8)]

    extras = _tpl_pairs(data, [("Nationality", "nationality"), ("Languages", "languages")])
    if extras:
        story += [Spacer(1, _sz(5.0))]
        story += _tpl_pair_rows(extras, st, width, label_w=96)

    links = [c for c in _tpl_contact(data, keys=("linkedin", "website")) if c]

    def sec(title, flows):
        if not flows:
            return
        story.extend([Spacer(1, _sz(10.0)),
                      _CsbBandHead(_esc_pdf(title).upper(), bold, _sz(10.6), width),
                      Spacer(1, _sz(6.0))])
        story.extend(flows)

    if links:
        sec("Links", [Paragraph(" &middot; ".join(_esc_pdf(l) for l in links),
                                S("csb_links", parent=st["body"], alignment=TA_CENTER))])

    _tpl_compose(data, st, width, sec, bold,
                 labels={"summary": "Profile", "skills": "Technical Skills",
                         "experience": "Professional Experience"},
                 order=("summary", "skills", "experience", "education", "projects",
                        "certifications", "publications"),
                 skills=lambda text: _csb_two_col(text, st, width))
    doc.build(story)


# ---------------------------------------------------------------------------
# Legacy template catalogue.
#
# The Design tab is being rebuilt one template at a time, so nothing in here is
# advertised any more — but the builders are all still wired up and working.
# ACTIVE_TEMPLATES below is the only thing the API exposes; move an entry from
# here into that dict to bring it back.
# ---------------------------------------------------------------------------
LEGACY_TEMPLATES = {
    "classic_professional": {
        "name": "Classic Professional",
        "description": "Clean single-column layout with bold section headers — matches a traditional, ATS-safe resume structure.",
        "builder": build_classic_professional,
    },
    "modern_two_column": {
        "name": "Modern Two-Column",
        "description": "Shaded sidebar for contact/skills/education, main column for summary/experience/projects.",
        "builder": build_modern_two_column,
    },
    "us_resume": {
        "name": "Standard Resume (US / UK / Australia / Singapore)",
        "description": "Single-column, left-aligned header, no photo/DOB — the standard format across the US, UK, Australia/NZ, and Singapore/APAC. Optional expected salary, notice period, and references fields.",
        "builder": build_us_resume,
    },
    "europe_cv": {
        "name": "European (Europass-style) CV",
        "description": "Continental-Europe format: photo, Personal Details block, and a Languages table in a shaded sidebar layout.",
        "builder": build_europe_cv,
    },
    "india_cv": {
        "name": "Indian Resume",
        "description": "India-market format: centered photo header, Personal Details block, and a signed Declaration.",
        "builder": build_india_cv,
    },
    "canada_resume": {
        "name": "Canadian Resume",
        "description": "Canada-market format: bold navy underline header, pill-style section labels, single column, no photo.",
        "builder": build_canada_resume,
    },
    "executive_sidebar": {
        "name": "Executive Sidebar",
        "description": "Dark navy panel on the right for achievements, skills and courses; experience leads on the left. Built for senior roles where wins matter as much as history.",
        "builder": build_executive_sidebar,
    },
    "teal_sidebar": {
        "name": "Teal Sidebar",
        "description": "Deep-teal panel on the left so achievements read first, with a calmer palette than the navy variant.",
        "builder": build_teal_sidebar,
    },
    "header_band": {
        "name": "Header Band",
        "description": "Full-width dark header with the name reversed out of it, then a conventional two-column body. High contrast up top without colouring the whole page.",
        "builder": build_header_band,
    },
    "centered_minimal": {
        "name": "Centered Minimal",
        "description": "Centred name, hairline rules, generous spacing, single column. The most conservative layout here and the safest for strict ATS parsers.",
        "builder": build_centered_minimal,
    },
    "tinted_sidebar": {
        "name": "Tinted Sidebar",
        "description": "Light tinted sidebar instead of a dark panel — softer on screen and prints cleanly in mono, where a dark block becomes a grey slab.",
        "builder": build_tinted_sidebar,
    },
    "compact_dense": {
        "name": "Compact",
        "description": "Tighter margins and leading for a long history that still needs to fit one page. Same sections, less air.",
        "builder": build_compact_dense,
    },
    "middle_east_cv": {
        "name": "Middle East / Gulf CV",
        "description": "Gulf-region format: photo header, Personal Details (nationality, visa status) surfaced up top as expected there.",
        "builder": build_middle_east_cv,
    },
}


def build_resume_pdf(template_id: str, data: dict, output_path: str):
    # Resumes saved before the Design tab was rebuilt still point at templates
    # that are no longer listed — resolve() finds them in the legacy catalogue
    # so regenerating an old PDF keeps working.
    _tid, template = resolve_template(template_id)
    if not template:
        raise ValueError(f"Unknown template_id: {template_id}")
    preset = template.get("_preset")
    # The customer's colour / font / size choices override the template's
    # own defaults; a preset supplies defaults when the customer hasn't set one.
    _set_theme(
        accent=data.get("accent_color") or (preset.get("accent") if preset else template.get("accent")),
        font_family=(data.get("font_family")
                     or (preset.get("font") if preset else None)
                     or template.get("font")),
        font_size=data.get("font_size"),
    )
    try:
        if preset:
            if preset.get("family") == "sidebar":
                build_sidebar_generic(data, output_path, preset)
            else:
                build_generic(data, output_path, preset)
        else:
            template["builder"](data, output_path)
    finally:
        _reset_theme()


def build_plain_text(data: dict) -> str:
    """Assemble a plain-text version of the resume straight from the form
    data — used for ATS matching so scoring isn't at the mercy of PDF text
    extraction quality."""
    parts = [data.get("full_name", ""), data.get("title", "") or ""]
    parts += [b for b in [data.get("location"), data.get("phone"), data.get("email"),
                           data.get("linkedin"), data.get("website")] if b]
    parts.append(data.get("summary", "") or "")
    parts.append(data.get("skills", "") or "")

    for section in ("experience", "education", "projects"):
        for entry in parse_entries(data.get(section, "")):
            parts.append(" ".join(entry["parts"]))
            parts.extend(entry["bullets"])

    parts.extend(_lines(data.get("publications", "")))
    parts.extend(_lines(data.get("certifications", "")))
    parts.extend(_lines(data.get("languages", "")))
    for sec in (data.get("custom_sections") or []):
        if not isinstance(sec, dict):
            continue
        parts.append(sec.get("title", "") or "")
        for it in (sec.get("items") or []):
            if not isinstance(it, dict):
                continue
            parts += [it.get("heading", ""), it.get("subheading", ""), it.get("text", "")]
            parts += [str(b) for b in (it.get("bullets") or [])]
    parts += [b for b in [data.get("nationality"), data.get("driving_license"), data.get("visa_status"),
                           data.get("expected_salary"), data.get("notice_period"), data.get("passport_status")] if b]
    return "\n".join(p for p in parts if p)


# ===========================================================================
# PARAMETRIC ENGINE — renders the 29 uploaded formats as presets over a few
# layout families, and honours the per-resume theme (accent / font / size)
# plus user-defined custom sections. One code path, many looks.
# ===========================================================================
from reportlab.pdfbase.pdfmetrics import stringWidth


def _entry_row(left_text, right_text, styles, total_width):
    date_col = min(1.6 * inch, total_width * 0.28)
    row = Table([[Paragraph(left_text, styles["entry_title"]),
                  Paragraph(right_text or "", styles["entry_date"])]],
                colWidths=[total_width - date_col, date_col])
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return row


def _section_styled(title, flowables, styles, style="rule", total_width=6.9 * inch):
    """Section header in one of several visual treatments, all theme-accent
    aware: rule (caps + full underline), plain (caps only), bar (caps + short
    accent underline), band (white caps reversed out of an accent bar),
    diamond (◆ caps)."""
    if not flowables:
        return []
    acc = _acc()
    if style == "band":
        cell = Paragraph(f'<font color="white">{title.upper()}</font>', styles["heading"])
        band = Table([[cell]], colWidths=[total_width])
        band.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), acc),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return [Spacer(1, 6), band, Spacer(1, 5), *flowables]
    if style == "bar":
        return [Paragraph(title.upper(), styles["heading"]),
                HRFlowable(width=46, thickness=2.4, color=acc, spaceAfter=5, spaceBefore=1), *flowables]
    if style == "diamond":
        return [Paragraph(f'<font color="#{acc.hexval()[2:]}">\u25c6</font> {title.upper()}', styles["heading"]),
                Spacer(1, 3), *flowables]
    if style == "plain":
        return [Paragraph(title.upper(), styles["heading"]),
                HRFlowable(width="100%", thickness=0.4, color=LIGHT_RULE, spaceAfter=5), *flowables]
    # rule (default)
    return [Paragraph(title.upper(), styles["heading"]),
            HRFlowable(width="100%", thickness=0.75, color=acc, spaceAfter=5), *flowables]


def _chips_flowables(skills_text, styles, total_width):
    """Skills rendered as tag chips (tinted accent boxes), wrapped into rows.
    reportlab has no rounded rects in flowables, so these are square-cornered
    tinted cells — but they read as tags and clearly separate the 'creative'
    templates from the 'category list' ones."""
    items = []
    for line in _lines(skills_text):
        part = line.split(":", 1)[1] if ":" in line else line
        items += [s.strip() for s in part.split(",") if s.strip()]
    if not items:
        return []
    acc = _acc()
    reg = _fonts()[0]
    fs = _sz(8.3)
    padx = 7
    gap = 5
    rows, roww = [[]], 0.0
    for it in items:
        w = stringWidth(it, reg, fs) + padx * 2
        if roww + w + gap > total_width and rows[-1]:
            rows.append([]); roww = 0.0
        rows[-1].append((it, w)); roww += w + gap
    out = []
    chip_style = ParagraphStyle("chip", fontName=reg, fontSize=fs, leading=fs + 3,
                                textColor=acc, alignment=TA_CENTER)
    for row in rows:
        cells = [Paragraph(it, chip_style) for it, _ in row]
        widths = [w for _, w in row]
        t = Table([cells], colWidths=widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.Color(acc.red, acc.green, acc.blue, alpha=0.12)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), padx), ("RIGHTPADDING", (0, 0), (-1, -1), padx),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        # spacing between chips: fake it with a wrapper table that inserts gaps
        out.append(t)
        out.append(Spacer(1, gap - 1))
    return out


def _custom_sections_flowables(data, styles, total_width, sec_style="rule"):
    """User-defined sections (title + items with heading/meta/subheading/
    bullets/text). Lets the customer add anything the fixed sections don't
    cover — 'Volunteering', 'Awards', 'Speaking', etc."""
    out = []
    for sec in (data.get("custom_sections") or []):
        if not isinstance(sec, dict):
            continue
        title = (sec.get("title") or "").strip()
        items = sec.get("items") or []
        flow = []
        for it in items:
            if not isinstance(it, dict):
                continue
            heading = (it.get("heading") or "").strip()
            meta = (it.get("meta") or "").strip()
            subheading = (it.get("subheading") or "").strip()
            text = (it.get("text") or "").strip()
            bullets = [b for b in (it.get("bullets") or []) if str(b).strip()]
            if heading or meta:
                flow.append(_entry_row(heading, meta, styles, total_width))
            if subheading:
                flow.append(Paragraph(subheading, styles["entry_sub"]))
            if text:
                flow.append(Paragraph(text, styles["body"]))
            if bullets:
                flow += _bullets(bullets, styles)
            if heading or subheading or text or bullets:
                flow.append(Spacer(1, 4))
        if title and flow:
            out += _section_styled(title, flow, styles, sec_style, total_width)
    return out


def _generic_header(data, styles, header_style, total_width):
    acc = _acc()
    reg, bold, ital = _fonts()
    name = data.get("full_name", "") or ""
    title = data.get("title", "") or ""
    contact_bits = [b for b in [data.get("location"), data.get("phone"), data.get("email")] if b]
    link_bits = [b for b in [data.get("linkedin"), data.get("website")] if b]
    all_contact = " &nbsp;|&nbsp; ".join(contact_bits + link_bits)

    if header_style == "band":
        nm = Paragraph(f'<font color="white">{name}</font>',
                       ParagraphStyle("bn", fontName=bold, fontSize=_sz(20), leading=_sz(24), textColor=colors.white))
        tt = Paragraph(f'<font color="#EDEDF5">{title}</font>',
                       ParagraphStyle("bt", fontName=reg, fontSize=_sz(10.5), leading=_sz(13), textColor=colors.white)) if title else None
        cc = Paragraph(f'<font color="#F0F0F8">{" • ".join(contact_bits + link_bits)}</font>',
                       ParagraphStyle("bc", fontName=reg, fontSize=_sz(8.2), leading=_sz(11), textColor=colors.white))
        inner = [x for x in [nm, tt, cc] if x]
        band = Table([[inner]], colWidths=[total_width])
        band.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), acc),
            ("LEFTPADDING", (0, 0), (-1, -1), 18), ("RIGHTPADDING", (0, 0), (-1, -1), 18),
            ("TOPPADDING", (0, 0), (-1, -1), 16), ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
        ]))
        return [band, Spacer(1, 10)]

    if header_style == "split":
        left = [Paragraph(name, styles["name"])]
        if title:
            left.append(Paragraph(title, styles["title"]))
        right_style = ParagraphStyle("rc", parent=styles["contact"], alignment=TA_RIGHT)
        right = [Paragraph(c, right_style) for c in (contact_bits + link_bits)]
        t = Table([[left, right]], colWidths=[total_width * 0.58, total_width * 0.42])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [t, HRFlowable(width="100%", thickness=1, color=acc, spaceBefore=6, spaceAfter=8)]

    centered = header_style in ("centered", "caps")
    if header_style == "caps":
        data = {**data, "full_name": name.upper()}
    return _header_block(data, styles, centered=centered)


def _timeline_experience(data, styles, total_width):
    """Experience as a light timeline: date on the left rail, a bullet node,
    then the role + achievements — the 'Timeline' template's signature."""
    entries = parse_entries(data.get("experience", ""))
    if not entries:
        return []
    acc = _acc()
    out = []
    rail = 1.15 * inch
    for e in entries:
        parts = e["parts"]
        title, company, location, dates = (parts + ["", "", "", ""])[:4]
        left = Paragraph(f'<font color="#{acc.hexval()[4:]}">{dates}</font>',
                         ParagraphStyle("tl", fontName=_fonts()[1], fontSize=_sz(8.5), leading=_sz(11), textColor=acc))
        head = f"{title}" + (f", {company}" if company else "") + (f" — {location}" if location else "")
        right_flow = [Paragraph(head, styles["entry_title"])]
        if e["bullets"]:
            right_flow += _bullets(e["bullets"], styles)
        else:
            right_flow.append(Spacer(1, 4))
        t = Table([[left, right_flow]], colWidths=[rail, total_width - rail])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 8),
            ("LEFTPADDING", (1, 0), (1, 0), 10), ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ("LINEBEFORE", (1, 0), (1, 0), 1.4, acc),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        out.append(t)
    return out


def _page_decorator(preset, page):
    """onPage callback for border / left rule / faint watermark initials."""
    if not (preset.get("border") or preset.get("rule_left") or preset.get("watermark")):
        return None
    acc = _acc()

    def deco(canvas, doc):
        w, h = page
        if preset.get("border"):
            canvas.setStrokeColor(acc)
            canvas.setLineWidth(1.3)
            canvas.rect(0.34 * inch, 0.34 * inch, w - 0.68 * inch, h - 0.68 * inch)
        if preset.get("rule_left"):
            canvas.setStrokeColor(acc)
            canvas.setLineWidth(3)
            canvas.line(0.42 * inch, 0.5 * inch, 0.42 * inch, h - 0.5 * inch)
        if preset.get("watermark"):
            data = getattr(doc, "_rb_data", {})
            initials = (data.get("photo_initials") or "".join(x[0] for x in (data.get("full_name") or "").split()[:2])).upper()
            canvas.saveState()
            try:
                canvas.setFillColor(acc)
                canvas.setFillAlpha(0.05)
            except Exception:
                canvas.setFillColor(colors.HexColor("#EEEEEE"))
            canvas.setFont("Helvetica-Bold", 150)
            canvas.drawCentredString(w / 2, h / 2 - 50, initials or "•")
            canvas.restoreState()
    return deco


_DEFAULT_LABELS = {
    "summary": "Professional Summary", "experience": "Experience", "skills": "Skills",
    "education": "Education", "projects": "Projects", "publications": "Publications",
    "certifications": "Certifications",
}


def build_generic(data, output_path, preset):
    styles = _get_styles()
    page = A4 if preset.get("page") == "A4" else LETTER
    dense = preset.get("dense")
    border = preset.get("border")
    tb = (0.42 if dense else 0.5) * inch
    lr = (0.7 if border else 0.62) * inch
    total_width = page[0] - 2 * lr
    doc = SimpleDocTemplate(output_path, pagesize=page, topMargin=tb, bottomMargin=tb,
                            leftMargin=lr, rightMargin=lr, title=data.get("full_name", "Resume"))
    doc._rb_data = data  # for the watermark decorator
    labels = {**_DEFAULT_LABELS, **(preset.get("labels") or {})}
    sec = preset.get("sec", "rule")

    story = list(_generic_header(data, styles, preset.get("header", "left"), total_width))
    story += _section_styled(labels["summary"], _paragraph_or_bullets(data.get("summary", ""), styles), styles, sec, total_width)
    if preset.get("timeline"):
        exp = _timeline_experience(data, styles, total_width)
    else:
        exp = _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", total_width)
    story += _section_styled(labels["experience"], exp, styles, sec, total_width)
    if preset.get("skills") == "chips":
        skill_flow = _chips_flowables(data.get("skills", ""), styles, total_width)
    else:
        skill_flow = _skills_flowables(data.get("skills", ""), styles)
    story += _section_styled(labels["skills"], skill_flow, styles, sec, total_width)
    story += _section_styled(labels["education"], _entries_flowables(parse_entries(data.get("education", "")), styles, "education", total_width), styles, sec, total_width)
    story += _section_styled(labels["projects"], _entries_flowables(parse_entries(data.get("projects", "")), styles, "projects", total_width), styles, sec, total_width)
    story += _section_styled(labels["publications"], _bullets(_lines(data.get("publications", "")), styles), styles, sec, total_width)
    story += _section_styled(labels["certifications"], _bullets(_lines(data.get("certifications", "")), styles), styles, sec, total_width)
    story += _custom_sections_flowables(data, styles, total_width, sec)

    deco = _page_decorator(preset, page)
    if deco:
        doc.build(story, onFirstPage=deco, onLaterPages=deco)
    else:
        doc.build(story)


def build_sidebar_generic(data, output_path, preset):
    """Light or solid sidebar family (twocolumn_sidebar / bold_sidebar /
    magazine_editorial). Sidebar holds contact + skills + education +
    certifications; main column holds summary + experience + projects +
    custom sections."""
    styles = _get_styles()
    acc = _acc()
    solid = preset.get("mode") == "solid"
    side_on_right = preset.get("side") == "right"
    doc = SimpleDocTemplate(output_path, pagesize=LETTER,
                            topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            title=data.get("full_name", "Resume"))
    side_w, main_w = 2.15 * inch, 4.95 * inch

    # --- sidebar content ---
    if solid:
        htxt, sub, lbl = colors.white, colors.HexColor("#E6E9F2"), colors.HexColor("#D4DAF0")
        def sp(t, size=8, bold=False, color=htxt, space=3):
            return Paragraph(t, ParagraphStyle(f"sp{size}{bold}{color}", fontName=_fonts()[1] if bold else _fonts()[0],
                                               fontSize=_sz(size), leading=_sz(size + 3.2), textColor=color, spaceAfter=space))
        def sh(t):
            return sp(t.upper(), size=8.6, bold=True, color=lbl, space=5)
    else:
        def sp(t, size=8.4, bold=False, color=None, space=3):
            return Paragraph(t, ParagraphStyle(f"sp{size}{bold}", fontName=_fonts()[1] if bold else _fonts()[0],
                                               fontSize=_sz(size), leading=_sz(size + 3.2),
                                               textColor=color or MUTED, spaceAfter=space))
        def sh(t):
            return sp(t.upper(), size=8.8, bold=True, color=acc, space=5)

    side = [sp(data.get("full_name", ""), size=13, bold=True, color=(colors.white if solid else acc), space=2)]
    if data.get("title"):
        side.append(sp(data["title"], size=9, space=8, color=(colors.HexColor("#E6E9F2") if solid else MUTED)))
    side.append(sh("Contact"))
    for c in [data.get("phone"), data.get("email"), data.get("location"), data.get("linkedin"), data.get("website")]:
        if c:
            side.append(sp(c, size=7.8, space=2, color=(colors.HexColor("#E6E9F2") if solid else MUTED)))
    if data.get("skills"):
        side.append(Spacer(1, 6)); side.append(sh("Skills"))
        for line in _lines(data.get("skills", "")):
            side.append(sp(line, size=7.7, space=3, color=(colors.HexColor("#E6E9F2") if solid else MUTED)))
    edu = parse_entries(data.get("education", ""))
    if edu:
        side.append(Spacer(1, 6)); side.append(sh("Education"))
        for e in edu:
            p = e["parts"]
            side.append(sp(p[0] if p else "", size=8, bold=True, space=1, color=(colors.white if solid else None)))
            if len(p) > 1:
                side.append(sp(p[1], size=7.6, space=1, color=(colors.HexColor("#E6E9F2") if solid else MUTED)))
            if len(p) > 2:
                side.append(sp(p[2], size=7.3, space=4, color=(colors.HexColor("#D4DAF0") if solid else MUTED)))
    certs = _lines(data.get("certifications", ""))
    if certs:
        side.append(Spacer(1, 6)); side.append(sh("Certifications"))
        for c in certs:
            side.append(sp(c, size=7.6, space=3, color=(colors.HexColor("#E6E9F2") if solid else MUTED)))

    # --- main content ---
    sec = preset.get("sec", "rule")
    main = [Paragraph(data.get("full_name", ""), styles["name"])]
    if data.get("title"):
        main.append(Paragraph(data["title"], styles["title"]))
    main.append(Spacer(1, 6))
    main += _section_styled("Professional Summary", _paragraph_or_bullets(data.get("summary", ""), styles), styles, sec, main_w)
    main += _section_styled("Experience", _entries_flowables(parse_entries(data.get("experience", "")), styles, "experience", main_w), styles, sec, main_w)
    main += _section_styled("Projects", _entries_flowables(parse_entries(data.get("projects", "")), styles, "projects", main_w), styles, sec, main_w)
    main += _section_styled("Publications", _bullets(_lines(data.get("publications", "")), styles), styles, sec, main_w)
    main += _custom_sections_flowables(data, styles, main_w, sec)

    row = [main, side] if side_on_right else [side, main]
    cols = [main_w, side_w] if side_on_right else [side_w, main_w]
    side_idx = 1 if side_on_right else 0
    t = Table([row], colWidths=cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (side_idx, 0), (side_idx, -1), acc if solid else SOFT_TINT),
        ("LEFTPADDING", (side_idx, 0), (side_idx, 0), 13), ("RIGHTPADDING", (side_idx, 0), (side_idx, 0), 13),
        ("LEFTPADDING", (1 - side_idx, 0), (1 - side_idx, 0), 16), ("RIGHTPADDING", (1 - side_idx, 0), (1 - side_idx, 0), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 16), ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
    ]))
    doc.build([t])


# --- the 29 uploaded formats as presets ---------------------------------
PRESETS = {
    "harvard_classic":      {"name": "Harvard Classic", "family": "single", "header": "centered", "sec": "rule", "accent": "#111827", "desc": "Centred header, all-caps ruled sections — traditional, ATS-safe."},
    "modern_minimalist":    {"name": "Modern Minimalist", "family": "single", "header": "left", "sec": "plain", "accent": "#2B2B2B", "desc": "Left header, thin headings, lots of whitespace."},
    "twocolumn_sidebar":    {"name": "Two-Column Sidebar", "family": "sidebar", "mode": "tint", "side": "left", "accent": "#3A3C63", "desc": "Tinted sidebar for contact/skills/education, main column for the rest."},
    "creative_colorful":    {"name": "Creative Colorful", "family": "single", "header": "band", "sec": "bar", "skills": "chips", "accent": "#F26522", "desc": "Coloured banner header, skill chips, bold accents."},
    "executive_elegant":    {"name": "Executive Elegant", "family": "single", "header": "centered", "sec": "rule", "font": "serif", "accent": "#1F2A44", "desc": "Elegant serif, centred header, refined."},
    "ats_plain":            {"name": "ATS Plain", "family": "single", "header": "left", "sec": "plain", "accent": "#000000", "desc": "No colour or lines — maximum ATS parseability."},
    "bold_sidebar":         {"name": "Bold Sidebar", "family": "sidebar", "mode": "solid", "side": "left", "accent": "#4C6FE7", "desc": "Solid colour sidebar with reversed text; strong contrast."},
    "timeline":             {"name": "Timeline", "family": "single", "header": "left", "sec": "rule", "timeline": True, "accent": "#6C5DD3", "desc": "Experience laid out on a vertical timeline rail."},
    "infographic":          {"name": "Infographic", "family": "single", "header": "left", "sec": "band", "skills": "chips", "accent": "#7C5CFC", "desc": "Banded section headers and skill chips — most graphical."},
    "compact_onepage":      {"name": "Compact", "family": "single", "header": "left", "sec": "rule", "dense": True, "accent": "#222222", "desc": "Tighter spacing to fit a long history on one page."},
    "elegant_banner":       {"name": "Elegant Banner", "family": "single", "header": "band", "sec": "rule", "accent": "#333333", "desc": "Refined banner header, generous margins."},
    "newspaper_columns":    {"name": "Newspaper Columns", "family": "single", "header": "centered", "sec": "rule", "accent": "#111111", "desc": "Masthead header, rule dividers (editorial)."},
    "swiss_grid":           {"name": "Swiss Grid", "family": "single", "header": "left", "sec": "bar", "accent": "#E2231A", "desc": "Swiss grid, short accent underlines, letter-spaced caps."},
    "pastel_soft":          {"name": "Pastel Soft", "family": "single", "header": "left", "sec": "diamond", "skills": "chips", "accent": "#8B7BD8", "desc": "Soft palette, diamond section markers, gentle chips."},
    "corporate_blue":       {"name": "Corporate Blue", "family": "single", "header": "left", "sec": "rule", "accent": "#1E63C4", "desc": "Corporate blue accents on headings and rules."},
    "diagonal_split":       {"name": "Diagonal Split", "family": "single", "header": "band", "sec": "bar", "skills": "chips", "accent": "#0E7C86", "desc": "Two-tone banner, skill chips."},
    "magazine_editorial":   {"name": "Magazine Editorial", "family": "sidebar", "mode": "tint", "side": "left", "accent": "#20232F", "desc": "Editorial sidebar + styled main column."},
    "academic_cv":          {"name": "Academic CV", "family": "single", "header": "centered", "sec": "rule", "page": "A4", "accent": "#2A2A2A", "labels": {"summary": "Research & Professional Summary"}, "desc": "CV kicker, research-oriented, A4."},
    "scandinavian_clean":   {"name": "Scandinavian Clean", "family": "single", "header": "left", "sec": "plain", "accent": "#5B6470", "desc": "Airy Nordic layout, mixed-case, whitespace-heavy."},
    "bordered_classic":     {"name": "Bordered Classic", "family": "single", "header": "centered", "sec": "rule", "border": True, "accent": "#1A1A1A", "desc": "Full-page border, centred header."},
    "gradient_modern":      {"name": "Gradient Modern", "family": "single", "header": "band", "sec": "rule", "accent": "#6A5AE0", "desc": "Bold coloured header band, modern."},
    "leftrule_watermark":   {"name": "Left-Rule Watermark", "family": "single", "header": "left", "sec": "rule", "rule_left": True, "watermark": True, "accent": "#3D5AFE", "desc": "Vertical accent rule + faint initials watermark."},
    "consulting_premium":   {"name": "Consulting Premium", "family": "single", "header": "split", "sec": "rule", "accent": "#12233B", "desc": "Split header (name left / contact right), premium."},
    "tech_clean_colorful":  {"name": "Tech Clean Colorful", "family": "single", "header": "left", "sec": "bar", "skills": "chips", "accent": "#2C9CDB", "desc": "Clean colourful tech accents, skill chips."},
    "finance_formal":       {"name": "Finance Formal", "family": "single", "header": "caps", "sec": "rule", "accent": "#14324F", "desc": "Centred caps name, conservative finance styling."},
    "startup_energetic":    {"name": "Startup Energetic", "family": "single", "header": "left", "sec": "diamond", "skills": "chips", "accent": "#FF5A5F", "desc": "Diamond markers, punchy, skill chips."},
    "government_formal":     {"name": "Government Formal", "family": "single", "header": "left", "sec": "rule", "page": "A4", "accent": "#1D4E2A", "labels": {"summary": "Personal Statement", "experience": "Employment History", "education": "Education & Qualifications"}, "desc": "UK public-sector CV phrasing, A4."},
    "layered_papercard":    {"name": "Layered Paper Card", "family": "single", "header": "left", "sec": "band", "skills": "chips", "accent": "#6C5DD3", "desc": "Banded 'card' section headers, skill chips."},
    "ice_nordic":           {"name": "Ice Nordic", "family": "single", "header": "caps", "sec": "plain", "skills": "chips", "accent": "#4A90C2", "desc": "Cool Nordic palette, caps header, skill chips."},
}

# Presets register into the legacy map only — they are kept intact so a preset
# can be promoted back into ACTIVE_TEMPLATES with a one-line change.
for _tid, _p in PRESETS.items():
    LEGACY_TEMPLATES[_tid] = {"name": _p["name"], "description": _p.get("desc", ""), "_preset": _p}


# ---------------------------------------------------------------------------
# Retired from the gallery, still renderable.
#
# The catalogue reached a point where several templates were the same layout in
# a different colour — three airy no-rule designs, two gradient banners, two
# dark sidebars, two bordered serif classics — which makes choosing harder, not
# easier. Those are no longer advertised, but a résumé already saved with one
# has to keep rendering exactly as it did, so their hand-written builders are
# registered here rather than deleted. Without this the id would fall through to
# the preset of the same name and quietly re-render in a different design.
#
# Each line records what replaced it, so the decision is reviewable:
#   scandinavian_clean, ice_nordic  -> modern_minimalist (same airy plain layout)
#   gradient_modern                 -> creative_colorful (same gradient banner)
#   infographic                     -> twocolumn_sidebar (same dark side panel)
#   corporate_letter                -> us_chronological (same centred Letter CV)
#   leftrule_watermark              -> modern_minimalist / swiss_grid
#   elegant_banner                  -> corporate_blue / magazine_editorial
#   bordered_classic                -> harvard_classic (also a bordered serif CV)
# ---------------------------------------------------------------------------
_RETIRED = {
    "scandinavian_clean": ("Scandinavian Clean", build_scandinavian_clean),
    "ice_nordic": ("Ice Nordic", build_ice_nordic),
    "gradient_modern": ("Gradient Modern", build_gradient_modern),
    "infographic": ("Infographic", build_infographic),
    "corporate_letter": ("Corporate Letter", build_corporate_letter),
    "leftrule_watermark": ("Left-Rule Watermark", build_leftrule_watermark),
    "elegant_banner": ("Elegant Banner", build_elegant_banner),
    "bordered_classic": ("Bordered Classic", build_bordered_classic),
    # Withdrawn from the gallery at the customer's request. The builders stay,
    # so a résumé already saved against one still regenerates exactly as it was.
    "profile_style": ("Profile Style", build_profile_style),
    "photo_header": ("Photo Header", build_photo_header),
    "photo_banner": ("Photo Banner", build_photo_banner),
}
for _tid, (_name, _builder) in _RETIRED.items():
    LEGACY_TEMPLATES[_tid] = {
        "name": _name,
        "description": "Retired from the template gallery; still renders for résumés saved with it.",
        "builder": _builder,
    }


# ---------------------------------------------------------------------------
# The live catalogue — the only thing the API advertises. Thirty rebuilt
# templates: 01–10, then the 11–19 and 20–30 batches. Every entry has a hand-written
# builder measured off its source design, and carries the descriptors the
# Design tab needs to draw a thumbnail plus the colour/font defaults a customer
# can override. An id that appears here shadows the same id in the legacy
# catalogue, so a resume saved earlier re-renders with the rebuilt design.
# ---------------------------------------------------------------------------
ACTIVE_TEMPLATES: dict = {
    "modern_minimalist": {
        "name": "Modern Minimalist",
        "description": "Extra-light name, sage section labels and no rules at all — structure comes from spacing rather than lines. Roomy, contemporary, and still single-column for ATS.",
        "builder": build_modern_minimalist,
        "font": "helvetica", "accent": "#5A8F7B",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "border": False,
    },
    "twocolumn_sidebar": {
        "name": "Two-Column Sidebar",
        "description": "Full-height navy panel carrying contact, skills, education and certifications, with the summary and experience given the wide column. Best when your skill list is long.",
        "builder": build_twocolumn_sidebar,
        "font": "helvetica", "accent": "#7FD9C4",
        "family": "sidebar", "header": "left", "sec": "rule", "skills": "cat", "mode": "solid", "side": "left", "border": False,
    },
    "creative_colorful": {
        "name": "Creative Colorful",
        "description": "Full-bleed gradient header with the name reversed out of it, title-case section labels and skills as tinted chips. The most visual of the set — built for design, marketing and product roles.",
        "builder": build_creative_colorful,
        "font": "helvetica", "accent": "#D9480F",
        "family": "single", "header": "band", "sec": "bar", "skills": "chips", "border": False,
    },
    "executive_elegant": {
        "name": "Executive Elegant",
        "description": "Serif throughout with gold section labels and a double hairline closing the header. Competencies run full width as labelled lines. Reads senior without shouting.",
        "builder": build_executive_elegant,
        "font": "times", "accent": "#8A6D3B",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "border": False,
    },
    "ats_plain": {
        "name": "ATS Plain",
        "description": "Black on white, no rules, no colour, no columns. Every heading is a plain string and every date sits on the same line as its role — the safest possible thing to feed a strict parser.",
        "builder": build_ats_plain,
        "font": "helvetica", "accent": "#000000",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "border": False,
    },
    "bold_sidebar": {
        "name": "Bold Sidebar",
        "description": "Pale sidebar with a crimson initials disc, and section headings marked by a short accent bar. Contact, skills and education sit left; profile and experience take the wide column.",
        "builder": build_bold_sidebar,
        "font": "helvetica", "accent": "#D62828",
        "family": "sidebar", "header": "left", "sec": "bar", "skills": "cat", "mode": "tint", "side": "left", "border": False,
    },
    "timeline": {
        "name": "Timeline",
        "description": "Experience and education hang off a vertical rail with a ringed marker per role, so a career reads as a sequence rather than a list. Single column, calm slate palette.",
        "builder": build_timeline,
        "font": "helvetica", "accent": "#4F6D7A",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "timeline": True, "border": False,
    },
    "harvard_classic": {
        "name": "Harvard Classic",
        "description": "Centred all-caps name, ruled section headings, right-aligned dates and a two-column skills table, inside a hairline page border. Serif, tight margins, no colour — the traditional academic-professional layout and the safest thing to put in front of an ATS.",
        "builder": build_harvard_classic,
        # Defaults the customer can still override from the Design tab.
        "font": "times",
        "accent": "#000000",
        # Descriptors the Design tab uses to draw the thumbnail + live preview.
        "family": "single",
        "header": "centered",
        "sec": "rule",
        "skills": "cat",
        "border": True,
    },
    "compact_onepage": {
        "name": "Compact",
        "description": "Name and role share one centred line, sections are separated by full-width rules, and the leading is tightened throughout. The densest layout here — it fits a long history into the fewest pages without dropping detail.",
        "builder": build_compact_onepage,
        "font": "helvetica", "accent": "#333333",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat",
        "dense": True, "border": False,
    },
    "newspaper_columns": {
        "name": "Newspaper Columns",
        "description": "An editorial masthead — paired rules above and below a centred serif name — then ruled headings down the page. No colour at all, so it prints and parses as cleanly as it reads.",
        "builder": build_newspaper_columns,
        "font": "times", "accent": "#111111",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat", "border": False,
    },
    "swiss_grid": {
        "name": "Swiss Grid",
        "description": "Oversized letter-spaced name, a red role line, and one hairline closing the header. Headings are tracked red caps with no rules — structure comes from the grid rather than decoration.",
        "builder": build_swiss_grid,
        "font": "helvetica", "accent": "#D7263D",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "border": False,
    },
    "pastel_soft": {
        "name": "Pastel Soft",
        "description": "Plum type on pink accents, diamond section markers, and each role on a pale card with an accent bar. Skills become rounded chips. The softest layout here — good for design, education and care roles.",
        "builder": build_pastel_soft,
        "font": "helvetica", "accent": "#F2B5D4",
        "family": "single", "header": "left", "sec": "diamond", "skills": "chips", "border": False,
    },
    "corporate_blue": {
        "name": "Corporate Blue",
        "description": "Navy header band, navy ruled headings, and \"Professional Summary / Experience\" wording. Conservative, high-contrast and the closest thing here to an internal-recruiter house style.",
        "builder": build_corporate_blue,
        "font": "helvetica", "accent": "#003366",
        "family": "single", "header": "band", "sec": "rule", "skills": "cat", "border": False,
    },
    "diagonal_split": {
        "name": "Diagonal Split",
        "description": "Two-tone teal banner split on the diagonal, headings underlined by a short accent bar, and skills as chips. Graphic up top, conventional single column underneath.",
        "builder": build_diagonal_split,
        "font": "helvetica", "accent": "#088395",
        "family": "single", "header": "band", "sec": "bar", "skills": "chips", "border": False,
    },
    "magazine_editorial": {
        "name": "Magazine Editorial",
        "description": "A yellow cover band with a \"Curriculum Vitae\" kicker and a 34pt serif name, then sans headings over serif body copy. Skills reverse out as yellow-on-black chips.",
        "builder": build_magazine_editorial,
        "font": "times", "accent": "#F4C430",
        "family": "single", "header": "band", "sec": "bar", "skills": "chips", "border": False,
    },
    "academic_cv": {
        "name": "Academic CV",
        "description": "Serif, black only, larger body type, and publications placed directly after the summary. Headings read \"Research & Professional Summary\" and \"Technical & Research Skills\" — the shape a faculty or research panel expects.",
        "builder": build_academic_cv,
        "font": "times", "accent": "#000000",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat", "border": False,
    },
    "centred_serif": {
        "name": "Centred Serif",
        "description": "Everything centred on the page: name in caps, then a contact strip ruled top and bottom with phone and email pushed to opposite margins. Section headings sit in full-width grey bands, and skills run in two columns rather than a label grid.",
        "builder": build_centred_serif,
        "font": "times", "accent": "#111111",
        "family": "single", "header": "centered", "sec": "bar", "skills": "cat", "border": False,
    },
    "consulting_premium": {
        "name": "Consulting Premium",
        "description": "Split header — name and role hard left, contact stacked flush right — over a navy rule, with serif type and \"Profile / Core Skills / Selected Projects\" wording. Reads like a partner-track CV.",
        "builder": build_consulting_premium,
        "font": "times", "accent": "#002349",
        "family": "single", "header": "split", "sec": "rule", "skills": "cat", "border": False,
    },
    "tech_clean_colorful": {
        "name": "Tech Clean Colorful",
        "description": "Four fading accent dots, a light name, blue title-case headings and no rules anywhere. Roles read \"Title @ Company\" on a single line — compact and obviously product-shaped.",
        "builder": build_tech_clean_colorful,
        "font": "helvetica", "accent": "#4285F4",
        "family": "single", "header": "left", "sec": "plain", "skills": "cat", "border": False,
    },
    "finance_formal": {
        "name": "Finance Formal",
        "description": "Centred letter-spaced caps name, serif body at a deliberately tight 6.9pt, ruled caps headings and bold rather than coloured dates. Conservative, dense and prints in mono.",
        "builder": build_finance_formal,
        "font": "times", "accent": "#101820",
        "family": "single", "header": "caps", "sec": "rule", "skills": "cat", "border": False,
    },
    "startup_energetic": {
        "name": "Startup Energetic",
        "description": "Violet headings with a triangular marker, an amber bar down the left of every role, and skills as violet chips. Geometric sans throughout — punchy without losing the single column.",
        "builder": build_startup_energetic,
        "font": "lato", "accent": "#6C5CE7",
        "family": "single", "header": "left", "sec": "diamond", "skills": "chips", "border": False,
    },
    "government_formal": {
        "name": "Government Formal",
        "description": "Public-sector wording — Personal Statement, Employment History, Education & Qualifications — in a GOV.UK-style palette: blue headings, grey rules, high-contrast ink.",
        "builder": build_government_formal,
        "font": "helvetica", "accent": "#005EA5",
        "family": "single", "header": "left", "sec": "rule", "skills": "cat", "border": False,
    },
    "layered_papercard": {
        "name": "Layered Paper Card",
        "description": "Off-white page with every role — and every skill group — on its own white card with a soft shadow. Slate and green throughout; the most tactile layout here.",
        "builder": build_layered_papercard,
        "font": "helvetica", "accent": "#52796F",
        "family": "single", "header": "left", "sec": "band", "skills": "cat", "border": False,
    },
    # --- regional market standards -----------------------------------------
    "us_chronological": {
        "name": "US Chronological",
        "description": "Centred name, ruled caps headings and Core Competencies above the roles. No photo, date of birth or marital status — in the US those get a resume filtered out rather than read.",
        "builder": build_us_chronological,
        "font": "helvetica", "accent": "#1F3864",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat", "border": False,
    },
    "uk_cv": {
        "name": "UK CV",
        "description": "British two-page CV: a \"Curriculum Vitae\" kicker, then Personal Statement, Key Skills, Employment History and Education & Qualifications, closing on the references line UK employers still expect.",
        "builder": build_uk_cv,
        "font": "helvetica", "accent": "#1F4E5F",
        "family": "single", "header": "left", "sec": "rule", "skills": "cat", "border": False,
    },
    "europass_cv": {
        "name": "Europass-Style CV",
        "description": "The shape EU application portals are built around: every section is a row with its title in a left label column. Carries a photo, Personal Information and Languages — all standard across Europe.",
        "builder": build_europass_cv,
        "font": "helvetica", "accent": "#0E4194",
        # The builder draws a single column with a label column per row — there
        # is no side panel in the PDF. Advertising "sidebar" made the preview
        # draw one, so the download looked like a different document from the
        # one being edited. The metadata has to describe what the builder does.
        "family": "single", "header": "left", "sec": "plain", "skills": "cat",
        "mode": "tint", "side": "left", "border": False,
        "photo": True,
    },
    "india_resume": {
        "name": "Indian Resume",
        "description": "Centred header with a photo, Career Objective, and academic qualifications placed above experience. Closes with the Personal Details block and signed Declaration Indian employers look for.",
        "builder": build_india_resume,
        "font": "helvetica", "accent": "#1F618D",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat", "border": False,
        "photo": True,
    },
    "canadian_resume": {
        "name": "Canadian Resume",
        "description": "Section labels reversed out of solid pills, no photo or personal details, and a closing references line. Plain, bilingual-market friendly and ATS-safe.",
        "builder": build_canadian_resume,
        "font": "helvetica", "accent": "#A6192E",
        "family": "single", "header": "left", "sec": "band", "skills": "cat", "border": False,
    },
    "gulf_cv": {
        "name": "Middle East / Gulf CV",
        "description": "Photo top right and — the point of the format — nationality, visa status, notice period and expected salary surfaced at the top, because Gulf recruiters screen on eligibility first.",
        "builder": build_gulf_cv,
        "font": "helvetica", "accent": "#0F766E",
        "family": "single", "header": "split", "sec": "rule", "skills": "cat", "border": False,
        "photo": True,
    },
    "japan_rirekisho": {
        "name": "Ruled Form",
        "description": "A ruled form layout: a boxed identity table with a photo cell, a dated education and work-history grid, a licences box and a personal statement box.",
        "builder": build_japan_rirekisho,
        "font": "helvetica", "accent": "#1A1A1A",
        "family": "single", "header": "caps", "sec": "band", "skills": "cat", "border": True,
        "photo": True,
    },
    # --- modern archetypes -------------------------------------------------
    "hybrid_combination": {
        "name": "Hybrid (Combination)",
        "description": "The format most recruiters now prefer: summary, then a full-width Areas of Expertise grid, then reverse-chronological roles — skills claimed up top and proven underneath.",
        "builder": build_hybrid_combination,
        "font": "helvetica", "accent": "#2563EB",
        "family": "single", "header": "left", "sec": "rule", "skills": "cat", "border": False,
    },
    "functional_skills": {
        "name": "Functional (Skills-First)",
        "description": "Competencies and achievements carry the page and employment history shrinks to one line per role. Headings carry a solid accent square instead of a rule. The layout for a career change or a gap, where a strict chronology works against you.",
        "builder": build_functional_skills,
        "font": "helvetica", "accent": "#6D28D9",
        "family": "single", "header": "left", "sec": "diamond", "skills": "cat", "border": False,
    },
    "achievement_focused": {
        "name": "Achievement Focused",
        "description": "Promotes the opening bullet of each role into a Key Achievements block on accent bars, so results land in the first fifteen seconds instead of being buried in the third role down.",
        "builder": build_achievement_focused,
        "font": "helvetica", "accent": "#B45309",
        "family": "single", "header": "left", "sec": "rule", "skills": "cat", "border": False,
    },
    "graduate_entry": {
        "name": "Graduate / Entry-Level",
        "description": "Education first, then projects, then internships and part-time work — the right order when the degree is the strongest thing on the page. Certifications sit near the top, not last.",
        "builder": build_graduate_entry,
        "font": "helvetica", "accent": "#0E7490",
        "family": "single", "header": "left", "sec": "rule", "skills": "cat", "border": False,
    },
    "photo_sidebar": {
        "name": "Photo Sidebar",
        "description": "Full-height dark panel with a large portrait at the top, then contact, skills and languages beneath it; experience takes the wide column. Built around the photo rather than making room for one.",
        "builder": build_photo_sidebar,
        "font": "helvetica", "accent": "#4FD1C5",
        "family": "sidebar", "header": "left", "sec": "rule", "skills": "cat",
        "mode": "solid", "side": "left", "photo": True, "border": False,
    },
    "executive_twopage": {
        "name": "Executive Two-Page",
        "description": "Serif, larger body type and the widest margins here, opening on an Executive Summary and Career Highlights. Built to run to two pages and be read, not squeezed onto one.",
        "builder": build_executive_twopage,
        "font": "times", "accent": "#14213D",
        "family": "single", "header": "centered", "sec": "rule", "skills": "cat", "border": False,
    },
}

# What the rest of the app sees. Kept as a name so existing imports keep working.
TEMPLATES = ACTIVE_TEMPLATES

# When a saved resume was generated with a template that is no longer listed we
# still have to be able to re-render its PDF, so resolution falls back to the
# legacy catalogue and then to any single active template.
FALLBACK_TEMPLATE_ID = "harvard_classic"


def resolve_template(template_id: str):
    """Return (resolved_id, template_dict) for any id we can still render."""
    for tid in (template_id, FALLBACK_TEMPLATE_ID):
        if not tid:
            continue
        if tid in ACTIVE_TEMPLATES:
            return tid, ACTIVE_TEMPLATES[tid]
        if tid in LEGACY_TEMPLATES:
            return tid, LEGACY_TEMPLATES[tid]
    if ACTIVE_TEMPLATES:
        tid = next(iter(ACTIVE_TEMPLATES))
        return tid, ACTIVE_TEMPLATES[tid]
    return None, None


def template_name(template_id: str, default: str = "Resume") -> str:
    _tid, t = resolve_template(template_id)
    return t["name"] if t else default
