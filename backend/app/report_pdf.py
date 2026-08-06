"""
Momentum Tracker — full-account PDF export.

Generates a multi-section PDF report that visually mirrors the web app's own
design language (navy header bars, mint accent color, card-style section
blocks, the same status badge colors used for job applications) so a PDF
export "looks like the website", the same way the Excel export does.
"""
import io
from datetime import datetime

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, Flowable,
)

# Brand palette — same hex values as tailwind.config in index.html
NAVY = colors.HexColor("#12283A")
NAVY_DARK = colors.HexColor("#0C1D2B")
MINT = colors.HexColor("#2FBFA0")
MINT_DARK = colors.HexColor("#249E84")
PAGEBG = colors.HexColor("#F4F5F7")
MUTED = colors.HexColor("#5B6672")
LIGHT_RULE = colors.HexColor("#E2E4E8")
WHITE = colors.white

# Same badge colors as STATUS_COLORS / scoreColor in app.js (Tailwind 100/700 pairs)
STATUS_BADGE_COLORS = {
    "applied": (colors.HexColor("#F3F4F6"), colors.HexColor("#374151")),
    "oa_test": (colors.HexColor("#DBEAFE"), colors.HexColor("#1D4ED8")),
    "phone_screen": (colors.HexColor("#E0E7FF"), colors.HexColor("#4338CA")),
    "interview": (colors.HexColor("#FEF3C7"), colors.HexColor("#B45309")),
    "offer": (colors.HexColor("#D1FAE5"), colors.HexColor("#047857")),
    "rejected": (colors.HexColor("#FEE2E2"), colors.HexColor("#B91C1C")),
    "ghosted": (colors.HexColor("#E5E7EB"), colors.HexColor("#6B7280")),
    "withdrawn": (colors.HexColor("#E5E7EB"), colors.HexColor("#6B7280")),
}
STATUS_LABELS = {
    "applied": "Applied", "oa_test": "OA / Test", "phone_screen": "Phone Screen",
    "interview": "Interview", "offer": "Offer", "rejected": "Rejected",
    "ghosted": "Ghosted", "withdrawn": "Withdrawn",
}


def _score_badge_color(score):
    if score is None:
        return (colors.HexColor("#F3F4F6"), colors.HexColor("#6B7280"))
    if score >= 75:
        return (colors.HexColor("#D1FAE5"), colors.HexColor("#047857"))
    if score >= 50:
        return (colors.HexColor("#FEF3C7"), colors.HexColor("#B45309"))
    return (colors.HexColor("#FEE2E2"), colors.HexColor("#B91C1C"))


def _get_styles():
    base = getSampleStyleSheet()
    return {
        "app_name": ParagraphStyle("app_name", parent=base["Title"], fontSize=20, leading=24,
                                    textColor=WHITE, alignment=TA_LEFT),
        "app_sub": ParagraphStyle("app_sub", parent=base["Normal"], fontSize=10, leading=13,
                                   textColor=colors.HexColor("#C9D3DB"), alignment=TA_LEFT),
        "section_title": ParagraphStyle("section_title", parent=base["Normal"], fontSize=12, leading=15,
                                         textColor=WHITE, fontName="Helvetica-Bold"),
        "cell": ParagraphStyle("cell", parent=base["Normal"], fontSize=8.5, leading=11),
        "cell_muted": ParagraphStyle("cell_muted", parent=base["Normal"], fontSize=8.5, leading=11, textColor=MUTED),
        "stat_label": ParagraphStyle("stat_label", parent=base["Normal"], fontSize=8.5, leading=11, textColor=MUTED),
        "stat_value": ParagraphStyle("stat_value", parent=base["Normal"], fontSize=18, leading=22,
                                      textColor=NAVY, fontName="Helvetica-Bold"),
        "badge": ParagraphStyle("badge", parent=base["Normal"], fontSize=7.5, leading=9,
                                 fontName="Helvetica-Bold", alignment=TA_CENTER),
    }


def _cover_header(styles, user_name: str) -> list:
    bar = Table(
        [[Paragraph("⚡ Momentum", styles["app_name"])],
         [Paragraph("Goals &amp; Job Tracker — Full Account Export", styles["app_sub"])],
         [Paragraph(f"{user_name} &nbsp;·&nbsp; Generated {datetime.utcnow().strftime('%d %b %Y')}", styles["app_sub"])]],
        colWidths=[7.1 * inch],
    )
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 16), ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (0, 0), 14), ("BOTTOMPADDING", (0, 0), (0, 0), 2),
        ("TOPPADDING", (0, 1), (0, 2), 2), ("BOTTOMPADDING", (0, 2), (0, 2), 14),
    ]))
    return [bar, Spacer(1, 16)]


def _section_header(title: str, styles) -> Table:
    t = Table([[Paragraph(title, styles["section_title"])]], colWidths=[7.1 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _data_table(headers, rows, col_widths, styles, badge_col_map=None):
    """badge_col_map: {col_index: lambda cell_value -> (bg, fg) or None} for
    rendering a value as a colored pill instead of plain text."""
    badge_col_map = badge_col_map or {}
    header_row = [Paragraph(f"<b>{h}</b>", ParagraphStyle("th", parent=styles["cell"], textColor=WHITE)) for h in headers]
    table_rows = [header_row]
    for row in rows:
        cells = []
        for i, val in enumerate(row):
            text = "" if val is None else str(val)
            if i in badge_col_map:
                bg, fg = badge_col_map[i](val) or (None, None)
                if bg:
                    cell_style = ParagraphStyle(f"badge{i}", parent=styles["badge"], textColor=fg, backColor=bg)
                    cells.append(Paragraph(text, cell_style))
                    continue
            cells.append(Paragraph(text, styles["cell"]))
        table_rows.append(cells)

    t = Table(table_rows, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LIGHT_RULE),
    ]
    for i in range(1, len(table_rows), 2):
        style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#FAFBFC")))
    t.setStyle(TableStyle(style_cmds))
    return t


def _stat_cards(stats: list, styles) -> Table:
    """stats: list of (label, value) tuples rendered as 4-up stat cards,
    matching the dashboard's statCard() component."""
    cells = []
    for label, value in stats:
        cell = Table([[Paragraph(str(value), styles["stat_value"])], [Paragraph(label, styles["stat_label"])]],
                     colWidths=[1.68 * inch])
        cell.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, LIGHT_RULE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        cells.append(cell)
    row = Table([cells], colWidths=[1.775 * inch] * len(cells))
    row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return row


def build_account_report_pdf(user, summary_today: dict, habits: list, tasks: list,
                              study_blocks: list, jobs: list, job_stats: dict,
                              resumes: list) -> bytes:
    styles = _get_styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER,
                             topMargin=0.4 * inch, bottomMargin=0.5 * inch,
                             leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                             title="Momentum Tracker Export")
    story = []
    story += _cover_header(styles, user.name)

    # ---------------- Overview stats ----------------
    story.append(_stat_cards([
        ("Today's Progress", f"{summary_today.get('percent', 0)}%"),
        ("Total Applications", job_stats.get("total", 0)),
        ("Response Rate", f"{job_stats.get('response_rate', 0)}%"),
        ("Interview Rate", f"{job_stats.get('interview_rate', 0)}%"),
    ], styles))
    story.append(Spacer(1, 16))

    # ---------------- Habits ----------------
    story.append(_section_header("Habits", styles))
    if habits:
        rows = [[h.title, h.category or "—", "Active" if h.active else "Paused"] for h in habits]
        story.append(_data_table(["Habit", "Category", "Status"], rows, [3.3 * inch, 2.3 * inch, 1.5 * inch], styles))
    else:
        story.append(Paragraph("No habits yet.", styles["cell_muted"]))
    story.append(Spacer(1, 14))

    # ---------------- Tasks ----------------
    story.append(_section_header("Tasks", styles))
    if tasks:
        rows = [[str(t.date), t.title, "Done" if t.completed else "Open"] for t in tasks[:60]]
        story.append(_data_table(["Date", "Task", "Status"], rows, [1.3 * inch, 4.5 * inch, 1.3 * inch], styles))
        if len(tasks) > 60:
            story.append(Paragraph(f"...and {len(tasks) - 60} more (see Excel export for the full list).", styles["cell_muted"]))
    else:
        story.append(Paragraph("No tasks yet.", styles["cell_muted"]))
    story.append(Spacer(1, 14))

    # ---------------- Study Plan ----------------
    story.append(_section_header("Study Plan", styles))
    if study_blocks:
        rows = [[str(b.date), b.subject, f"{b.start_time}–{b.end_time}", "Done" if b.completed else "Planned"]
                for b in study_blocks[:40]]
        story.append(_data_table(["Date", "Subject", "Time", "Status"], rows,
                                  [1.2 * inch, 2.8 * inch, 1.5 * inch, 1.6 * inch], styles))
    else:
        story.append(Paragraph("No study blocks yet.", styles["cell_muted"]))

    story.append(PageBreak())

    # ---------------- Job Applications ----------------
    story.append(_section_header("Job Applications", styles))
    story.append(Spacer(1, 8))
    if jobs:
        def status_color(val):
            return STATUS_BADGE_COLORS.get(val, (colors.HexColor("#F3F4F6"), colors.HexColor("#374151")))

        def score_color(val):
            return _score_badge_color(val)

        rows = [[
            j.company_name, j.role_title,
            STATUS_LABELS.get(j.status.value if hasattr(j.status, "value") else j.status,
                               j.status.value if hasattr(j.status, "value") else j.status),
            str(j.date_applied), (f"{j.ats_score}" if j.ats_score is not None else "—"),
        ] for j in jobs]
        story.append(_data_table(
            ["Company", "Role", "Status", "Applied", "ATS Score"], rows,
            [1.6 * inch, 2.1 * inch, 1.3 * inch, 1.0 * inch, 1.1 * inch], styles,
            badge_col_map={2: lambda v: status_color(next(k for k, lbl in STATUS_LABELS.items() if lbl == v)),
                           4: lambda v: score_color(int(v) if v not in ("—", None) else None)},
        ))
    else:
        story.append(Paragraph("No job applications yet.", styles["cell_muted"]))
    story.append(Spacer(1, 14))

    # ---------------- Resumes ----------------
    story.append(_section_header("Resumes", styles))
    if resumes:
        rows = [[r.name, r.notes or "—", str(r.created_at.date())] for r in resumes]
        story.append(_data_table(["Name", "Notes", "Created"], rows, [2.7 * inch, 3.0 * inch, 1.4 * inch], styles))
    else:
        story.append(Paragraph("No resumes yet.", styles["cell_muted"]))

    doc.build(story)
    buf.seek(0)
    return buf.read()


# ===========================================================================
# FOCUSED EXPORTS
# ---------------------------------------------------------------------------
# The full account report answers "everything", which is rarely the question.
# These two answer the questions people actually ask a tracker: how am I doing
# (statistics — both dashboards on one sheet), and what have I applied to
# (the application log). Both reuse the palette above so an export still looks
# like the app it came from.
# ===========================================================================

CHART_INK = colors.HexColor("#1F2937")
# Same palette, keyed by the label the reader sees.
_LABEL_BADGE = {STATUS_LABELS[k]: v for k, v in STATUS_BADGE_COLORS.items() if k in STATUS_LABELS}


class _BarRow(Flowable):
    """One labelled bar: label, track, value. Charts here are drawn rather than
    imaged so the PDF stays vector, searchable and a few KB rather than a MB."""

    def __init__(self, label, value, total, width, color=MINT, label_w=118.0, value_w=52.0):
        Flowable.__init__(self)
        self.label, self.value, self.total = label, value, max(total, 1)
        self.w, self.color = width, color
        self.label_w, self.value_w = label_w, value_w
        self.h = 17.0

    def wrap(self, availWidth, availHeight):
        self.w = availWidth
        return availWidth, self.h

    def draw(self):
        c = self.canv
        track_x = self.label_w
        track_w = max(10.0, self.w - self.label_w - self.value_w)
        c.setFont("Helvetica", 8.5)
        c.setFillColor(CHART_INK)
        c.drawString(0, 5.0, self.label[:26])
        c.setFillColor(colors.HexColor("#EEF0F3"))
        c.roundRect(track_x, 3.0, track_w, 9.0, 4.5, stroke=0, fill=1)
        frac = self.value / self.total
        if frac > 0:
            c.setFillColor(self.color)
            c.roundRect(track_x, 3.0, max(9.0, track_w * frac), 9.0, 4.5, stroke=0, fill=1)
        c.setFillColor(CHART_INK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawRightString(self.w, 5.0, str(self.value))


class _ColumnChart(Flowable):
    """Monthly volume as columns — the one shape that shows momentum at a
    glance, which is the whole point of the statistics export."""

    def __init__(self, points, width, height=104.0, color=MINT):
        Flowable.__init__(self)
        self.points, self.w, self.h, self.color = points, width, height, color

    def wrap(self, availWidth, availHeight):
        self.w = availWidth
        return availWidth, self.h

    def draw(self):
        c = self.canv
        if not self.points:
            return
        top = max(v for _l, v in self.points) or 1
        n = len(self.points)
        gap = 9.0
        bw = max(8.0, (self.w - gap * (n - 1)) / n)
        base = 16.0
        usable = self.h - base - 14.0
        c.setStrokeColor(LIGHT_RULE)
        c.setLineWidth(0.5)
        c.line(0, base - 3, self.w, base - 3)
        for i, (label, value) in enumerate(self.points):
            x = i * (bw + gap)
            bh = (value / top) * usable
            c.setFillColor(self.color if value else colors.HexColor("#E7EAEE"))
            c.roundRect(x, base, bw, max(2.0, bh), 3.0, stroke=0, fill=1)
            c.setFillColor(CHART_INK)
            c.setFont("Helvetica-Bold", 7.5)
            if value:
                c.drawCentredString(x + bw / 2, base + max(2.0, bh) + 4, str(value))
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7)
            c.drawCentredString(x + bw / 2, base - 12, label)


def _kpi_row(stats, styles, width=7.1 * inch):
    """Stat cards with a caption line — the dashboard's own component."""
    cells = []
    for label, value, caption in stats:
        inner = Table([[Paragraph(str(value), styles["stat_value"])],
                       [Paragraph(label, styles["stat_label"])],
                       [Paragraph(caption or "", styles["cell_muted"])]],
                      colWidths=[width / len(stats) - 10])
        inner.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, LIGHT_RULE),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (0, 0), 9), ("BOTTOMPADDING", (0, 2), (0, 2), 9),
            ("TOPPADDING", (0, 1), (0, 2), 1), ("BOTTOMPADDING", (0, 0), (0, 1), 1),
        ]))
        cells.append(inner)
    row = Table([cells], colWidths=[width / len(cells)] * len(cells))
    row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return row


def _report_shell(buf, title):
    return SimpleDocTemplate(buf, pagesize=LETTER,
                             topMargin=0.4 * inch, bottomMargin=0.55 * inch,
                             leftMargin=0.7 * inch, rightMargin=0.7 * inch, title=title)


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.7 * inch, 0.34 * inch, "Momentum Tracker")
    canvas.drawRightString(LETTER[0] - 0.7 * inch, 0.34 * inch, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


def _cover(styles, user_name, subtitle):
    bar = Table([[Paragraph("⚡ Momentum", styles["app_name"])],
                 [Paragraph(subtitle, styles["app_sub"])],
                 [Paragraph(f"{user_name} &nbsp;·&nbsp; Generated {datetime.utcnow().strftime('%d %b %Y')}",
                            styles["app_sub"])]], colWidths=[7.1 * inch])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 16), ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (0, 0), 14), ("BOTTOMPADDING", (0, 0), (0, 0), 2),
        ("TOPPADDING", (0, 1), (0, 2), 2), ("BOTTOMPADDING", (0, 2), (0, 2), 14),
    ]))
    return [bar, Spacer(1, 16)]


def build_statistics_pdf(user, tracker: dict, jobs_stats: dict) -> bytes:
    """The two dashboards, one per page — and never more than two pages.

    A report that spills onto a third page stops being a dashboard, so the
    content is *budgeted* rather than merely laid out: each page has a fixed
    height allowance, list sections are capped to what fits, and anything cut
    is acknowledged with a "+N more" line instead of silently disappearing.
    That holds for a brand-new account with nothing in it and for one with
    fifty habits.

    `tracker` and `jobs_stats` are already-computed summaries — this module
    draws, it doesn't query, so the numbers here are the ones the dashboards
    showed rather than a second, slightly different calculation.
    """
    styles = _get_styles()
    buf = io.BytesIO()
    doc = _report_shell(buf, "Momentum Tracker — Dashboards")
    width = 7.1 * inch
    # Usable height per page after the masthead, minus a safety margin. Bars are
    # 17pt, headings ~26pt with their spacers; the caps below come from this.
    BAR_ROWS_PER_LIST = 7

    def bar_list(title, items, total_fn, color, note=None):
        """A capped bar chart: at most BAR_ROWS_PER_LIST rows, rest counted."""
        out = [Paragraph(f"<b>{title}</b>" + (f" — {note}" if note else ""), styles["cell"]),
               Spacer(1, 6)]
        shown = items[:BAR_ROWS_PER_LIST]
        top = total_fn(shown)
        for label, value in shown:
            out.append(_BarRow(str(label), value, top, width, color=color))
        hidden = len(items) - len(shown)
        if hidden > 0:
            out.append(Spacer(1, 2))
            out.append(Paragraph(f"+{hidden} more not shown", styles["cell_muted"]))
        out.append(Spacer(1, 12))
        return out

    # ---------------- Page 1: goals, habits and study ----------------
    story = _cover(styles, user.name, "Dashboard 1 of 2 — goals, habits and study")
    story.append(_kpi_row([
        ("Today", f"{tracker.get('today_percent', 0)}%", "of today's plan done"),
        ("Habits", str(tracker.get("habit_count", 0)), f"{tracker.get('habit_done_today', 0)} done today"),
        ("Tasks", str(tracker.get("task_count", 0)), f"{tracker.get('task_done', 0)} completed"),
        ("Study", f"{tracker.get('study_hours', 0)}h", f"{tracker.get('study_blocks', 0)} sessions"),
    ], styles, width))
    story.append(Spacer(1, 18))

    habit_rates = [(name, done) for name, done, _total in tracker.get("habit_rates", [])]
    if habit_rates:
        story += bar_list("Habit consistency", habit_rates, lambda _i: 30,
                          MINT, note="days completed in the last 30")
    subjects = tracker.get("study_by_subject", [])
    if subjects:
        story += bar_list("Study hours by subject", subjects,
                          lambda items: max((v for _s, v in items), default=1),
                          colors.HexColor("#7C5CFC"))
    if not habit_rates and not subjects:
        story.append(Paragraph("No habits or study sessions logged yet — once you start, "
                               "this page fills in automatically.", styles["cell_muted"]))

    # ---------------- Page 2: the job search ----------------
    story.append(PageBreak())
    story += _cover(styles, user.name, "Dashboard 2 of 2 — job search")
    story.append(_kpi_row([
        ("Applications", str(jobs_stats.get("total", 0)), "all time"),
        ("Response rate", f"{jobs_stats.get('response_rate', 0)}%", "replied to"),
        ("Interview rate", f"{jobs_stats.get('interview_rate', 0)}%", "reached interview"),
        ("Offers", str(jobs_stats.get("offers", 0)), "received"),
    ], styles, width))
    story.append(Spacer(1, 18))

    if jobs_stats.get("by_month"):
        story.append(Paragraph("<b>Applications per month</b> — last six months", styles["cell"]))
        story.append(Spacer(1, 8))
        story.append(_ColumnChart(jobs_stats["by_month"], width))
        story.append(Spacer(1, 16))

    statuses = [(STATUS_LABELS.get(s, s.title()), c) for s, c in jobs_stats.get("by_status", [])]
    if statuses:
        total = sum(c for _s, c in statuses) or 1
        out = [Paragraph("<b>Where they stand</b>", styles["cell"]), Spacer(1, 6)]
        for (label, count), (raw, _c) in zip(statuses[:BAR_ROWS_PER_LIST], jobs_stats["by_status"]):
            _bg, fg = STATUS_BADGE_COLORS.get(raw, (LIGHT_RULE, MUTED))
            out.append(_BarRow(label, count, total, width, color=fg))
        out.append(Spacer(1, 12))
        story += out

    companies = jobs_stats.get("top_companies", [])[:5]
    if companies:
        story += bar_list("Most applied to", companies,
                          lambda items: max((v for _c, v in items), default=1),
                          colors.HexColor("#3D5AFE"))
    if not jobs_stats.get("total"):
        story.append(Paragraph("No applications logged yet.", styles["cell_muted"]))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def build_applied_jobs_pdf(user, jobs: list, jobs_stats: dict) -> bytes:
    """The application log: every role applied for, newest first."""
    styles = _get_styles()
    buf = io.BytesIO()
    doc = _report_shell(buf, "Momentum Tracker — Applied jobs")
    width = 7.1 * inch
    story = _cover(styles, user.name, f"Applied jobs — {len(jobs)} application{'' if len(jobs) == 1 else 's'}")

    story.append(_kpi_row([
        ("Applications", str(jobs_stats.get("total", 0)), "in this list"),
        ("Active", str(jobs_stats.get("active", 0)), "still in play"),
        ("Interviews", str(jobs_stats.get("interviews", 0)), "reached"),
        ("Offers", str(jobs_stats.get("offers", 0)), "received"),
    ], styles, width))
    story.append(Spacer(1, 16))

    story.append(_section_header("Applications", styles))
    story.append(Spacer(1, 8))
    if jobs:
        rows = []
        for j in jobs:
            applied = j.date_applied.strftime("%d %b %Y") if j.date_applied else "—"
            # Human labels in the cell, colour still keyed off the raw status:
            # "oa_test" is a database value, not something to show a person.
            rows.append([applied, j.company_name or "—", j.role_title or "—",
                         j.location or j.source or "—",
                         STATUS_LABELS.get(j.status.value, j.status.value.title())])
        story.append(_data_table(
            ["Applied", "Company", "Role", "Location", "Status"], rows,
            [0.95 * inch, 1.55 * inch, 2.1 * inch, 1.2 * inch, 1.3 * inch], styles,
            badge_col_map={4: lambda v: _LABEL_BADGE.get(v)},
        ))
    else:
        story.append(Paragraph("No applications logged yet.", styles["cell_muted"]))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
