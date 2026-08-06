"""The account dashboard, drawn as a PDF.

This replaces an attempt to photograph the browser's dashboards with html2canvas.
That approach kept failing on modern CSS the rasteriser can't parse — colour-mix,
oklch, color() — and every fix uncovered another. Drawing the report server-side
removes the whole class of problem: no browser, no CDN, no CSS parsing, nothing
to go stale in a cache. It also produces a better artefact — real vector charts
that stay sharp and searchable, at a few KB rather than a megabyte of JPEG.

One export, not two. The dashboards and the application log used to be separate
downloads, which made the customer choose before they knew what was in either.
The file is now:
  1. Overview      — the numbers that matter, plus where applications stand
  2. Habits, tasks and study
  3. Job search    — pipeline, volume over time, where you're applying
  4+ Application log — every application, oldest page last

Pages 1–3 are budgeted to exactly one page each; the log is the only part that
grows, and it grows in the one place where a reader expects a long list.

Charts are ReportLab's own (pie, doughnut, bar, line) rather than hand-drawn
rectangles, so axes, labels and legends behave like charts rather than like
drawings that happen to look like charts.
"""
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.graphics.shapes import Drawing, String, Rect, Line
from reportlab.graphics.charts.piecharts import Pie
try:                                    # ReportLab moved Doughnut out of piecharts
    from reportlab.graphics.charts.doughnut import Doughnut
except ImportError:                     # older builds keep it alongside Pie
    from reportlab.graphics.charts.piecharts import Doughnut
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.charts.legends import Legend
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

from .report_pdf import (
    NAVY, NAVY_DARK, MINT, MUTED, LIGHT_RULE, STATUS_LABELS, STATUS_BADGE_COLORS,
)

# A categorical palette that survives greyscale printing: the values step in
# lightness as well as hue, so a pie chart is still readable in mono.
SERIES = [
    colors.HexColor("#3D5AFE"), colors.HexColor("#FF6A3D"), colors.HexColor("#7C5CFC"),
    colors.HexColor("#1FAE6B"), colors.HexColor("#E4A335"), colors.HexColor("#2C9CDB"),
    colors.HexColor("#E14B6A"), colors.HexColor("#12283A"), colors.HexColor("#8A94A6"),
]
CARD_W = 7.1 * inch


def _styles():
    base = getSampleStyleSheet()
    S = lambda n, **kw: ParagraphStyle(n, parent=base["Normal"], **kw)
    return {
        "app": S("app", fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=colors.white),
        "sub": S("sub", fontName="Helvetica", fontSize=8.5, leading=12,
                 textColor=colors.HexColor("#B9C4D0")),
        "h2": S("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=colors.white),
        "h3": S("h3", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=NAVY),
        "body": S("body", fontName="Helvetica", fontSize=8.5, leading=12,
                  textColor=colors.HexColor("#26303C")),
        "muted": S("muted", fontName="Helvetica", fontSize=7.5, leading=10.5, textColor=MUTED),
        "kpi": S("kpi", fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=NAVY),
        "kpi_l": S("kpi_l", fontName="Helvetica-Bold", fontSize=7, leading=9.5, textColor=MUTED),
        "cell": S("cell", fontName="Helvetica", fontSize=7.8, leading=10.5,
                  textColor=colors.HexColor("#26303C")),
        "cell_b": S("cell_b", fontName="Helvetica-Bold", fontSize=7.8, leading=10.5, textColor=colors.white),
    }


def _masthead(st, user_name, subtitle):
    bar = Table([[Paragraph("⚡ Momentum", st["app"])],
                 [Paragraph(subtitle, st["sub"])],
                 [Paragraph(f"{user_name} &nbsp;·&nbsp; {datetime.utcnow().strftime('%d %b %Y')}", st["sub"])]],
                colWidths=[CARD_W])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 15), ("RIGHTPADDING", (0, 0), (-1, -1), 15),
        ("TOPPADDING", (0, 0), (0, 0), 12), ("BOTTOMPADDING", (0, 2), (0, 2), 12),
        ("TOPPADDING", (0, 1), (0, 2), 1), ("BOTTOMPADDING", (0, 0), (0, 1), 1),
    ]))
    return [bar, Spacer(1, 12)]


def _band(st, title):
    t = Table([[Paragraph(title, st["h2"])]], colWidths=[CARD_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 11), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [t, Spacer(1, 9)]


def _kpis(st, items):
    cells = []
    for label, value, caption in items:
        c = Table([[Paragraph(str(value), st["kpi"])],
                   [Paragraph(label.upper(), st["kpi_l"])],
                   [Paragraph(caption or "", st["muted"])]], colWidths=[CARD_W / len(items) - 9])
        c.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, LIGHT_RULE),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (0, 0), 8), ("BOTTOMPADDING", (0, 2), (0, 2), 8),
            ("TOPPADDING", (0, 1), (0, 2), 0), ("BOTTOMPADDING", (0, 0), (0, 1), 0),
        ]))
        cells.append(c)
    row = Table([cells], colWidths=[CARD_W / len(cells)] * len(cells))
    row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return row


def _empty(width, height, message):
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=colors.HexColor("#FBFCFD"),
               strokeColor=LIGHT_RULE, strokeWidth=0.7))
    d.add(String(width / 2, height / 2 - 3, message, fontName="Helvetica", fontSize=8,
                 fillColor=MUTED, textAnchor="middle"))
    return d


def _legend(d, x, y, pairs, box_w=90):
    lg = Legend()
    lg.x, lg.y = x, y
    lg.alignment = "right"
    lg.fontName, lg.fontSize = "Helvetica", 7
    lg.dxTextSpace = 5
    lg.dx = lg.dy = 5
    lg.deltay = 10
    lg.columnMaximum = 8
    lg.colorNamePairs = pairs
    d.add(lg)


def pie_chart(data, width=210, height=150, doughnut=False, title_note=None):
    """Pie or doughnut with a legend. `data` is [(label, value)]."""
    data = [(l, v) for l, v in data if v]
    if not data:
        return _empty(width, height, "Nothing to show yet")
    d = Drawing(width, height)
    ch = (Doughnut if doughnut else Pie)()
    ch.x, ch.y = 6, 14
    ch.width = ch.height = min(height - 26, 118)
    ch.data = [v for _l, v in data]
    ch.labels = None
    if doughnut:
        ch.innerRadiusFraction = 0.58
    for i in range(len(data)):
        ch.slices[i].fillColor = SERIES[i % len(SERIES)]
        ch.slices[i].strokeColor = colors.white
        ch.slices[i].strokeWidth = 1.1
    d.add(ch)
    total = sum(v for _l, v in data) or 1
    _legend(d, ch.x + ch.width + 14, height - 22,
            [(SERIES[i % len(SERIES)], f"{l} — {v} ({round(v / total * 100)}%)")
             for i, (l, v) in enumerate(data)])
    if doughnut:
        d.add(String(ch.x + ch.width / 2, ch.y + ch.height / 2 + 2, str(total),
                     fontName="Helvetica-Bold", fontSize=14, fillColor=NAVY, textAnchor="middle"))
        d.add(String(ch.x + ch.width / 2, ch.y + ch.height / 2 - 10, "TOTAL",
                     fontName="Helvetica", fontSize=6.5, fillColor=MUTED, textAnchor="middle"))
    return d


def bar_chart(data, width=CARD_W, height=150, color=None, horizontal_labels=True):
    """Vertical bars. `data` is [(label, value)]."""
    if not data or not any(v for _l, v in data):
        return _empty(width, height, "Nothing to show yet")
    d = Drawing(width, height)
    ch = VerticalBarChart()
    ch.x, ch.y = 34, 26
    ch.width, ch.height = width - 50, height - 44
    ch.data = [[v for _l, v in data]]
    ch.categoryAxis.categoryNames = [str(l)[:14] for l, _v in data]
    ch.categoryAxis.labels.fontName = "Helvetica"
    ch.categoryAxis.labels.fontSize = 6.5
    ch.categoryAxis.labels.angle = 0 if horizontal_labels else 30
    ch.categoryAxis.labels.dy = -4
    ch.valueAxis.valueMin = 0
    ch.valueAxis.valueMax = max(v for _l, v in data) * 1.2 or 1
    ch.valueAxis.labels.fontName = "Helvetica"
    ch.valueAxis.labels.fontSize = 6.5
    ch.valueAxis.strokeColor = LIGHT_RULE
    ch.valueAxis.gridStrokeColor = colors.HexColor("#EEF1F4")
    ch.valueAxis.visibleGrid = 1
    ch.bars[0].fillColor = color or MINT
    ch.bars[0].strokeColor = None
    ch.barSpacing = 2
    ch.groupSpacing = 8
    ch.barLabels.fontName = "Helvetica-Bold"
    ch.barLabels.fontSize = 6.5
    ch.barLabelFormat = "%d"
    ch.barLabels.dy = 4
    d.add(ch)
    return d


def line_chart(labels, series, width=CARD_W, height=155, names=None):
    """Line chart. `series` is a list of value-lists sharing `labels`."""
    if not labels or not any(any(s) for s in series):
        return _empty(width, height, "Nothing to show yet")
    d = Drawing(width, height)
    ch = HorizontalLineChart()
    ch.x, ch.y = 34, 28
    ch.width, ch.height = width - 50, height - 50
    ch.data = series
    ch.categoryAxis.categoryNames = [str(l) for l in labels]
    ch.categoryAxis.labels.fontName = "Helvetica"
    ch.categoryAxis.labels.fontSize = 6.5
    ch.valueAxis.valueMin = 0
    peak = max((max(s) if s else 0) for s in series) or 1
    ch.valueAxis.valueMax = peak * 1.25
    ch.valueAxis.labels.fontName = "Helvetica"
    ch.valueAxis.labels.fontSize = 6.5
    ch.valueAxis.gridStrokeColor = colors.HexColor("#EEF1F4")
    ch.valueAxis.visibleGrid = 1
    for i in range(len(series)):
        ch.lines[i].strokeColor = SERIES[i % len(SERIES)]
        ch.lines[i].strokeWidth = 1.6
        ch.lines[i].symbol = None
    d.add(ch)
    if names:
        _legend(d, ch.x, height - 8, [(SERIES[i % len(SERIES)], n) for i, n in enumerate(names)])
    return d


def _two_up(left, right, gap=14):
    t = Table([[left, right]], colWidths=[(CARD_W - gap) / 2, (CARD_W - gap) / 2])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), gap),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _table(st, headers, rows, widths, badge_col=None):
    head = [Paragraph(h, st["cell_b"]) for h in headers]
    body = [head]
    for r in rows:
        cells = []
        for i, v in enumerate(r):
            text = "" if v is None else str(v)
            if badge_col is not None and i == badge_col:
                pair = STATUS_BADGE_COLORS.get(v) or (LIGHT_RULE, MUTED)
                stl = ParagraphStyle(f"b{i}", parent=st["cell"], textColor=pair[1], backColor=pair[0],
                                     alignment=1, borderPadding=(2, 3, 2, 3))
                cells.append(Paragraph(STATUS_LABELS.get(v, text.title()), stl))
            else:
                cells.append(Paragraph(text, st["cell"]))
        body.append(cells)
    t = Table(body, colWidths=widths, repeatRows=1)
    cmds = [("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
            ("LINEBELOW", (0, 1), (-1, -1), 0.4, LIGHT_RULE)]
    for i in range(2, len(body), 2):
        cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#FAFBFC")))
    t.setStyle(TableStyle(cmds))
    return t


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.7 * inch, 0.34 * inch, "Momentum Tracker — account dashboard")
    canvas.drawRightString(LETTER[0] - 0.7 * inch, 0.34 * inch, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


def build_dashboard_pdf(user, d: dict) -> bytes:
    """`d` is the pre-computed payload from the export router."""
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, topMargin=0.4 * inch, bottomMargin=0.55 * inch,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            title="Momentum Tracker — Dashboard")
    story = []

    # ---------------- Page 1 — overview ----------------
    story += _masthead(st, user.name, "Account dashboard — page 1 of 3 · Overview")
    story.append(_kpis(st, [
        ("Today", f"{d['today_percent']}%", "of today's plan"),
        ("Habits", d["habit_count"], f"{d['habit_done_today']} done today"),
        ("Applications", d["jobs_total"], f"{d['jobs_active']} active"),
        ("Interviews", d["interviews"], f"{d['interview_rate']}% of applied"),
        ("Study", f"{d['study_hours']}h", f"{d['study_blocks']} sessions"),
    ]))
    story.append(Spacer(1, 14))
    story += _band(st, "Activity — last 12 weeks")
    story.append(line_chart(d["weeks"], [d["week_habits"], d["week_tasks"], d["week_apps"]],
                            names=["Habit check-ins", "Tasks done", "Applications"]))
    story.append(Spacer(1, 12))
    story += _band(st, "Where things stand")
    story.append(_two_up(
        pie_chart([(STATUS_LABELS.get(s, s.title()), v) for s, v in d["by_status"]],
                  width=(CARD_W - 14) / 2, doughnut=True),
        pie_chart(d["by_job_type"], width=(CARD_W - 14) / 2)))

    # ---------------- Page 2 — habits, tasks, study ----------------
    story.append(PageBreak())
    story += _masthead(st, user.name, "Account dashboard — page 2 of 3 · Habits, tasks and study")
    story.append(_kpis(st, [
        ("Habits", d["habit_count"], "being tracked"),
        ("Check-ins", d["habit_checkins"], "last 30 days"),
        ("Tasks", d["task_count"], f"{d['task_done']} completed"),
        ("Study", f"{d['study_hours']}h", f"across {len(d['study_by_subject'])} subjects"),
    ]))
    story.append(Spacer(1, 14))
    story += _band(st, "Habit consistency — days completed in the last 30")
    story.append(bar_chart(d["habit_rates"][:9], height=142, color=MINT))
    story.append(Spacer(1, 12))
    story += _band(st, "Study")
    story.append(_two_up(
        pie_chart(d["study_by_subject"][:7], width=(CARD_W - 14) / 2),
        bar_chart(d["study_by_week"], width=(CARD_W - 14) / 2, height=150,
                  color=colors.HexColor("#7C5CFC"))))

    # ---------------- Page 3 — job search ----------------
    story.append(PageBreak())
    story += _masthead(st, user.name, "Account dashboard — page 3 of 3 · Job search")
    story.append(_kpis(st, [
        ("Applications", d["jobs_total"], "all time"),
        ("Response rate", f"{d['response_rate']}%", "replied to"),
        ("Interview rate", f"{d['interview_rate']}%", "reached interview"),
        ("Offers", d["offers"], "received"),
    ]))
    story.append(Spacer(1, 14))
    story += _band(st, "Applications per month")
    story.append(bar_chart(d["by_month"], height=120, color=colors.HexColor("#3D5AFE")))
    story.append(Spacer(1, 12))
    story += _band(st, "Most applied to")
    story.append(_two_up(
        bar_chart(d["top_companies"][:6], width=(CARD_W - 14) / 2, height=132,
                  color=colors.HexColor("#FF6A3D"), horizontal_labels=False),
        pie_chart(d["by_source"][:6], width=(CARD_W - 14) / 2, height=132, doughnut=True)))
    story.append(Spacer(1, 12))
    story += _band(st, "Most recent applications")
    if d["recent_jobs"]:
        # Six rows is what is left of the page — the full log is its own export.
        story.append(_table(st, ["Applied", "Company", "Role", "Status"], d["recent_jobs"][:6],
                            [0.95 * inch, 1.9 * inch, 2.65 * inch, 1.6 * inch], badge_col=3))
    else:
        story.append(Paragraph("No applications logged yet.", st["muted"]))

    # ---------------- Page 4+ — the full application log ----------------
    log = d.get("all_jobs") or []
    if log:
        story.append(PageBreak())
        story += _masthead(st, user.name,
                           f"Application log — {len(log)} application{'' if len(log) == 1 else 's'}")
        story += _band(st, "Every application, most recent first")
        story.append(_table(st, ["Applied", "Company", "Role", "Location", "Status"], log,
                            [0.9 * inch, 1.6 * inch, 2.1 * inch, 1.2 * inch, 1.3 * inch], badge_col=4))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
