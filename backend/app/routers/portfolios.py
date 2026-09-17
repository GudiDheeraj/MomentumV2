"""Portfolio websites.

The Portfolio tab lets someone turn what they already keep in Momentum — a
résumé, a project list, a job title — into a personal site they can host
anywhere. The server's job here is deliberately small:

  * store the content (`data`) and which template it is wearing,
  * remember which résumé the site offers for download,
  * and turn a saved résumé into portfolio-shaped content on request.

The *rendering* lives in the front end, in portfolio.js. That is what makes
the export a single self-contained .html file with no build step: the same
function draws the live preview and writes the downloaded file, so what the
customer sees while editing is byte-for-byte what they deploy.
"""

import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


# ---------------------------------------------------------------------------
# Template catalogue
# ---------------------------------------------------------------------------
# Metadata only — the actual markup for each of these lives in
# portfolio-templates.js. Keeping the list here as well gives the server a
# single place to answer "does this template id exist?" so a hand-edited API
# call can't save a portfolio wearing a template that will never render.
#
# It must stay in step with PF_TEMPLATES in portfolio-templates.js: an id the
# front end can draw but this list has never heard of gets silently rewritten
# to the default on save, which loses the customer's choice without telling
# them. backend/tests/test_portfolios.py asserts the two lists match.
TEMPLATES = [
    {"id": "aurora", "name": "Aurora",
     "description": "Glassmorphic dark hero with a living gradient and a drifting particle field.",
     "accent": "#7C5CFC", "tone": "dark", "best_for": "Designers, founders, product people"},
    {"id": "monogram", "name": "Monogram",
     "description": "Quiet black-and-white typography. Nothing moves that doesn't earn it.",
     "accent": "#171A1F", "tone": "light", "best_for": "Writers, researchers, consultants"},
    {"id": "terminal", "name": "Terminal",
     "description": "A shell that types itself out — and a prompt whose commands really run.",
     "accent": "#3CE88F", "tone": "dark", "best_for": "Backend, DevOps and security engineers"},
    {"id": "neon", "name": "Neon Grid",
     "description": "Cyberpunk grid, glitching headline and a scanline sweep across every card.",
     "accent": "#FF2E88", "tone": "dark", "best_for": "Game devs, creative coders, students"},
    {"id": "editorial", "name": "Editorial",
     "description": "Magazine layout — oversized serif headline, drop cap, a real reading column.",
     "accent": "#B5432E", "tone": "light", "best_for": "Content, marketing and UX writers"},
    {"id": "sidebar", "name": "Sidebar Pro",
     "description": "Fixed profile rail, scroll-spy navigation, skill meters, prints beautifully.",
     "accent": "#2C6FDB", "tone": "light", "best_for": "Corporate roles, analysts, PMs"},
    {"id": "timeline", "name": "Timeline",
     "description": "One vertical spine down the page; every role reveals itself as you scroll.",
     "accent": "#3C9D7B", "tone": "light", "best_for": "Long histories and career changers"},
    {"id": "deck", "name": "Card Deck",
     "description": "Filterable project grid, tilt-on-hover cards and a detail dialog per project.",
     "accent": "#E4A335", "tone": "light", "best_for": "Portfolios where the work is the point"},
    {"id": "bold", "name": "Gradient Bold",
     "description": "Full-bleed colour blocks, a scrolling skills marquee and type at full volume.",
     "accent": "#FF5A3C", "tone": "dark", "best_for": "Creatives, brand and motion designers"},
    {"id": "slate", "name": "Slate",
     "description": "Clean two-column layout, counting stat tiles and a real light/dark toggle.",
     "accent": "#1F7A8C", "tone": "auto", "best_for": "Engineering, data and finance"},
    {"id": "prism", "name": "Prism",
     "description": "Iridescent conic aura, chromatic-split headline, glass cards that refract under the cursor.",
     "accent": "#8B5CF6", "tone": "dark", "best_for": "Designers and creative technologists"},
    {"id": "nebula", "name": "Nebula",
     "description": "A real canvas starfield with depth parallax, and constellations that draw to your cursor.",
     "accent": "#38BDF8", "tone": "dark", "best_for": "Data, ML and research engineers"},
    {"id": "kinetic", "name": "Kinetic",
     "description": "Type at billboard scale — letters spring in one by one and the headline warps as you scroll.",
     "accent": "#FF3B2F", "tone": "light", "best_for": "Art directors, copywriters, brand"},
    {"id": "blueprint", "name": "Blueprint",
     "description": "Drafting paper, crosshairs and dimension lines that draw themselves as each section arrives.",
     "accent": "#4CC9F0", "tone": "dark", "best_for": "Architects, hardware and systems engineers"},
    {"id": "liquid", "name": "Liquid",
     "description": "Gooey metaballs that chase the cursor and morphing blob dividers between every section.",
     "accent": "#FF6B9D", "tone": "light", "best_for": "Illustrators, educators, wellness"},
    {"id": "bento", "name": "Bento",
     "description": "A bento grid of unequal tiles, each one springing and tilting under the pointer.",
     "accent": "#0EA5E9", "tone": "light", "best_for": "Product managers and generalists"},
    {"id": "riso", "name": "Risograph",
     "description": "Duotone halftone, paper grain and rotated stickers — a printed poster that happens to scroll.",
     "accent": "#E8503A", "tone": "light", "best_for": "Illustrators, zine makers, studios"},
    {"id": "orbit", "name": "Orbit",
     "description": "Skills ride rotating orbital rings around your portrait, and the sections turn on a dial.",
     "accent": "#FBBF24", "tone": "dark", "best_for": "Multi-disciplinary and portfolio careers"},
    {"id": "strata", "name": "Strata",
     "description": "Five parallax layers drifting at different speeds — a dusk landscape you scroll through.",
     "accent": "#60A5FA", "tone": "dark", "best_for": "Filmmakers, photographers, storytellers"},
    {"id": "chrome", "name": "Chrome",
     "description": "Liquid-metal type with a sheen that sweeps on a loop, bevelled glass and a scrolling ticker.",
     "accent": "#A5B4FC", "tone": "dark", "best_for": "Music, fashion and motion designers"},
    {"id": "aquarelle", "name": "Aquarelle",
     "description": "Watercolour washes that bleed into the paper, a handwritten greeting and a hand-drawn underline under every heading.",
     "accent": "#5B8FB9", "tone": "light", "best_for": "Editors, teachers, writers and career changers"},
    {"id": "beacon", "name": "Beacon",
     "description": "Bright and uncluttered, with a skills matrix grouped by category and a contact form that really sends.",
     "accent": "#4F46E5", "tone": "light", "best_for": "Students, bootcamp grads and first-role developers"},
    {"id": "memphis", "name": "Memphis",
     "description": "Squiggles, zigzags and terrazzo confetti that bounce and spin as the page scrolls past them.",
     "accent": "#FF4D6D", "tone": "light", "best_for": "Illustrators, event and brand designers"},
    {"id": "isometric", "name": "Isometric",
     "description": "A real isometric plane — cards sit on the grid at 30 degrees and rotate flat when you reach them.",
     "accent": "#6C5CE7", "tone": "light", "best_for": "3D artists, game and systems designers"},
    {"id": "comic", "name": "Comic",
     "description": "Inked panels, speech bubbles and a halftone action burst behind every heading.",
     "accent": "#E4002B", "tone": "light", "best_for": "Storytellers, comic artists, animators"},
    {"id": "ticket", "name": "Boarding Pass",
     "description": "Every section is a perforated stub — dashed tear lines, a real barcode and an ink stamp.",
     "accent": "#0F8A8A", "tone": "light", "best_for": "Travel writers, consultants, anyone who moves"},
    {"id": "notebook", "name": "Notebook",
     "description": "Ruled paper with a highlighter that wipes across each heading, sticky notes and margin doodles.",
     "accent": "#2F6FED", "tone": "light", "best_for": "Teachers, students, researchers"},
    {"id": "arcade", "name": "Arcade",
     "description": "Pixel borders, a blinking score HUD and chunky sprite type — daylight arcade, not another black CRT.",
     "accent": "#FF3B6B", "tone": "light", "best_for": "Game developers, hobbyists, indie makers"},
    {"id": "botanical", "name": "Botanical",
     "description": "A vine draws itself down the page as you scroll, sprouting a leaf beside every entry.",
     "accent": "#3F8F5B", "tone": "light", "best_for": "Ecology, wellness, food and craft"},
    {"id": "bauhaus", "name": "Bauhaus",
     "description": "Primaries, hard grid and oversized arcs — a poster composition that reassembles as you scroll.",
     "accent": "#E63946", "tone": "light", "best_for": "Architects, product and industrial designers"},
    {"id": "clay", "name": "Clay",
     "description": "Puffy claymorphic shapes with double shadows that squish inward under the pointer.",
     "accent": "#8B7BF7", "tone": "light", "best_for": "App designers, illustrators, kids and education"},
    {"id": "chart", "name": "Chart",
     "description": "Your career as an infographic — animated bars, a donut and a plotted timeline, with a table view.",
     "accent": "#2A78D6", "tone": "light", "best_for": "Analysts, data scientists, researchers"},
    {"id": "flux", "name": "Flux",
     "description": "A live fragment shader on the GPU — domain-warped noise flowing behind the page, never the same twice.",
     "accent": "#FF7A00", "tone": "light", "best_for": "Creative technologists and motion designers"},
    {"id": "reel", "name": "Reel",
     "description": "A cover-flow carousel in real perspective — drag, flick or scroll it and the cards settle on a spring.",
     "accent": "#C026D3", "tone": "light", "best_for": "Photographers, film and product designers"},
    {"id": "halo", "name": "Halo",
     "description": "Conic borders that rotate through a typed @property angle, and a spotlight that tracks your cursor across the grid.",
     "accent": "#0891B2", "tone": "light", "best_for": "Front-end engineers and design engineers"},
    {"id": "filament", "name": "Filament",
     "description": "Skills hang from verlet-simulated threads that swing when you push them and settle under real gravity.",
     "accent": "#65A30D", "tone": "light", "best_for": "Makers, engineers and interaction designers"},
    {"id": "morph", "name": "Morph",
     "description": "Projects morph open with shared-element View Transitions — the card becomes the detail page, not a modal over it.",
     "accent": "#DB2777", "tone": "light", "best_for": "Product designers and case-study portfolios"},
    {"id": "aperture", "name": "Aperture",
     "description": "Sections open through a clip-path iris and the page racks focus as you scroll, like a lens finding its subject.",
     "accent": "#7E22CE", "tone": "light", "best_for": "Directors, editors and photographers"},
]
TEMPLATE_IDS = {t["id"] for t in TEMPLATES}
DEFAULT_TEMPLATE = "aurora"

MAX_PORTFOLIOS = 40          # a soft ceiling; nobody legitimately needs more
MAX_DATA_BYTES = 4_000_000   # ~4MB: enough for an embedded photo, not a video


# A design the customer assembled themselves in the designer is stored on the
# portfolio as "custom:<design id>" rather than as a built-in id. The server
# does not resolve it — the design lives in `portfolio_templates` and is drawn
# by the front end — so all this needs to recognise is the shape.
CUSTOM_TEMPLATE_RE = re.compile(r"^custom:\d{1,12}$")


def _resolve_template(tid: str | None) -> str:
    """Never 404 on an unknown template — an old portfolio whose template was
    renamed should still open, wearing the default, rather than becoming
    unreachable content.

    A "custom:<id>" reference passes through unchecked on purpose. Verifying
    the design still exists here would only move the failure earlier: a design
    can be deleted at any time, so the front end already falls back to the
    default when a lookup misses. Rewriting the id on save instead would mean
    a customer who deletes a design silently loses the reference on every
    portfolio that used it, with no way to point them back at a restored one."""
    if tid and CUSTOM_TEMPLATE_RE.match(tid):
        return tid
    return tid if tid in TEMPLATE_IDS else DEFAULT_TEMPLATE


def _load(p: models.Portfolio) -> dict:
    try:
        return json.loads(p.data) if p.data else {}
    except (ValueError, TypeError):
        return {}


def _out(p: models.Portfolio) -> schemas.PortfolioOut:
    return schemas.PortfolioOut(
        id=p.id, name=p.name, template_id=p.template_id or DEFAULT_TEMPLATE,
        resume_id=p.resume_id, data=_load(p),
        last_exported_at=p.last_exported_at,
        created_at=p.created_at, updated_at=p.updated_at,
    )


def _summary(p: models.Portfolio) -> schemas.PortfolioSummary:
    d = _load(p)
    sections = d.get("sections") or {}
    return schemas.PortfolioSummary(
        id=p.id, name=p.name, template_id=p.template_id or DEFAULT_TEMPLATE,
        resume_id=p.resume_id,
        headline=(d.get("full_name") or None),
        subheading=(d.get("title") or None),
        section_count=sum(1 for v in sections.values() if v),
        last_exported_at=p.last_exported_at,
        created_at=p.created_at, updated_at=p.updated_at,
    )


def _owned(portfolio_id: int, db: Session, user: models.User) -> models.Portfolio:
    p = (db.query(models.Portfolio)
           .filter(models.Portfolio.id == portfolio_id,
                   models.Portfolio.user_id == user.id)
           .first())
    if not p:
        raise HTTPException(404, "Portfolio not found")
    return p


def _check_size(data: dict | None) -> str | None:
    if data is None:
        return None
    blob = json.dumps(data)
    if len(blob.encode("utf-8")) > MAX_DATA_BYTES:
        raise HTTPException(
            413,
            "This portfolio is too large to save. The usual cause is a very "
            "large profile photo — try one under 2MB.",
        )
    return blob


# ---------------------------------------------------------------------------
# Static routes first: "/templates" must be matched before "/{portfolio_id}",
# or FastAPI tries to read "templates" as an int and answers 422.
# ---------------------------------------------------------------------------
@router.get("/templates")
def list_templates():
    return TEMPLATES


@router.get("", response_model=list[schemas.PortfolioSummary])
def list_portfolios(db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    rows = (db.query(models.Portfolio)
              .filter(models.Portfolio.user_id == current_user.id)
              .order_by(models.Portfolio.updated_at.desc().nullslast(),
                        models.Portfolio.created_at.desc())
              .all())
    return [_summary(p) for p in rows]


@router.post("", response_model=schemas.PortfolioOut, status_code=201)
def create_portfolio(payload: schemas.PortfolioCreate,
                     db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    count = (db.query(models.Portfolio)
               .filter(models.Portfolio.user_id == current_user.id).count())
    if count >= MAX_PORTFOLIOS:
        raise HTTPException(400, f"You've reached the limit of {MAX_PORTFOLIOS} portfolios. Delete one to make room.")

    name = (payload.name or "").strip() or "Untitled Portfolio"
    p = models.Portfolio(
        user_id=current_user.id,
        name=name[:200],
        template_id=_resolve_template(payload.template_id),
        data=_check_size(payload.data or {}),
        resume_id=payload.resume_id or None,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _out(p)


@router.get("/{portfolio_id}", response_model=schemas.PortfolioOut)
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    return _out(_owned(portfolio_id, db, current_user))


@router.put("/{portfolio_id}", response_model=schemas.PortfolioOut)
def update_portfolio(portfolio_id: int, payload: schemas.PortfolioUpdate,
                     db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    p = _owned(portfolio_id, db, current_user)

    if payload.name is not None:
        p.name = (payload.name.strip() or "Untitled Portfolio")[:200]
    if payload.template_id is not None:
        p.template_id = _resolve_template(payload.template_id)
    if payload.data is not None:
        p.data = _check_size(payload.data)
    if payload.resume_id is not None:
        # 0 is the "unlink" signal — see the schema comment.
        p.resume_id = payload.resume_id or None

    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _out(p)


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    p = _owned(portfolio_id, db, current_user)
    db.delete(p)
    db.commit()
    return None


@router.post("/{portfolio_id}/duplicate", response_model=schemas.PortfolioOut, status_code=201)
def duplicate_portfolio(portfolio_id: int, db: Session = Depends(get_db),
                        current_user: models.User = Depends(get_current_user)):
    """Copies a portfolio so a second version can be tried — a different
    template, a shorter about — without risking the one that already works."""
    src = _owned(portfolio_id, db, current_user)
    count = (db.query(models.Portfolio)
               .filter(models.Portfolio.user_id == current_user.id).count())
    if count >= MAX_PORTFOLIOS:
        raise HTTPException(400, f"You've reached the limit of {MAX_PORTFOLIOS} portfolios. Delete one to make room.")

    copy = models.Portfolio(
        user_id=current_user.id,
        name=f"{src.name} (copy)"[:200],
        template_id=src.template_id,
        data=src.data,
        resume_id=src.resume_id,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _out(copy)


@router.post("/{portfolio_id}/exported", response_model=schemas.PortfolioOut)
def mark_exported(portfolio_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    """Called by the front end after a successful download. The file itself
    never touches the server — this only stamps the card so the library can
    show what has actually been shipped."""
    p = _owned(portfolio_id, db, current_user)
    p.last_exported_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _out(p)


# ---------------------------------------------------------------------------
# Résumé → portfolio
# ---------------------------------------------------------------------------
def _entries(block_text: str | None) -> list[dict]:
    """Splits a Resume Builder textarea ('---' between entries, a pipe-separated
    header line, then '-' bullets) into structured entries. Same grammar the
    résumé PDF renderer uses, so an import can't disagree with the PDF."""
    if not block_text:
        return []
    out = []
    for block in [b.strip() for b in block_text.split("\n---\n") if b.strip()]:
        lines = [l for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        parts = [p.strip() for p in lines[0].split("|")]
        bullets = [l.strip()[1:].strip() for l in lines[1:] if l.strip().startswith("-")]
        body = [l.strip() for l in lines[1:] if not l.strip().startswith("-")]
        out.append({"parts": parts, "bullets": bullets, "body": " ".join(body).strip()})
    return out


def _skill_list(skills_text: str | None) -> list[str]:
    """Flattens 'Category: a, b, c' lines into a plain, de-duplicated list.
    A portfolio shows skills as chips, so the categories a résumé needs for
    density are noise here — but the order is kept, because people put their
    strongest category first."""
    if not skills_text:
        return []
    seen, out = set(), []
    for line in skills_text.split("\n"):
        line = line.strip()
        if not line:
            continue
        body = line.split(":", 1)[1] if ":" in line else line
        for item in body.split(","):
            item = item.strip(" •-\t")
            key = item.lower()
            if item and key not in seen:
                seen.add(key)
                out.append(item)
    return out[:40]


@router.get("/import/resume/{resume_id}")
def import_from_resume(resume_id: int, db: Session = Depends(get_db),
                       current_user: models.User = Depends(get_current_user)):
    """Turns a saved résumé into portfolio content.

    Only résumés built in the Resume Builder carry structured data. An
    uploaded PDF is just a file, so there is nothing here to map — that case
    returns a 422 with a message the UI shows verbatim, rather than silently
    handing back an empty form the customer then has to fill in twice.
    """
    resume = (db.query(models.Resume)
                .filter(models.Resume.id == resume_id,
                        models.Resume.user_id == current_user.id)
                .first())
    if not resume:
        raise HTTPException(404, "Resume not found")
    if not resume.builder_data:
        raise HTTPException(
            422,
            "That résumé was uploaded as a file, so there's no structured content to import. "
            "Open it in the Resume Builder first (or pick a résumé you built there), "
            "then import it here.",
        )

    try:
        rb = json.loads(resume.builder_data)
    except (ValueError, TypeError):
        raise HTTPException(422, "That résumé's saved content couldn't be read.")

    experience = []
    for e in _entries(rb.get("experience")):
        parts = e["parts"] + ["", "", ""]
        experience.append({
            "role": parts[0], "org": parts[1], "period": parts[2],
            "location": parts[3] if len(e["parts"]) > 3 else "",
            "bullets": e["bullets"], "summary": e["body"],
        })

    education = []
    for e in _entries(rb.get("education")):
        parts = e["parts"] + ["", "", ""]
        education.append({
            "degree": parts[0], "school": parts[1], "period": parts[2],
            "detail": e["body"] or (" · ".join(e["bullets"]) if e["bullets"] else ""),
        })

    projects = []
    for e in _entries(rb.get("projects")):
        parts = e["parts"] + ["", "", ""]
        # A résumé project header is "Name | tech or role | dates"; the second
        # field is far more often a tech list than a date, so it seeds tags.
        tags = [t.strip() for t in parts[1].replace("/", ",").split(",") if t.strip()][:6]
        projects.append({
            "name": parts[0], "tags": tags, "period": parts[2],
            "description": e["body"] or " ".join(e["bullets"]),
            "bullets": e["bullets"], "link": "", "repo": "",
        })

    data = {
        "full_name": rb.get("full_name") or current_user.name or "",
        "title": rb.get("title") or "",
        "location": rb.get("location") or "",
        "email": rb.get("email") or current_user.email or "",
        "phone": rb.get("phone") or "",
        "website": rb.get("website") or "",
        "linkedin": rb.get("linkedin") or "",
        "about": rb.get("summary") or "",
        "skills": _skill_list(rb.get("skills")),
        "experience": experience,
        "education": education,
        "projects": projects,
        "certifications": [l.strip() for l in (rb.get("certifications") or "").split("\n") if l.strip()],
        "accent_color": rb.get("accent_color") or None,
    }
    return {
        "data": {k: v for k, v in data.items() if v not in (None, "", [], {})},
        "suggested_name": f"{data['full_name']}'s Portfolio".strip() or "My Portfolio",
        "resume_name": resume.name,
    }
