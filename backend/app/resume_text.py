import os


def extract_text_from_file(filepath: str) -> str:
    """Best-effort plain text extraction from a resume file. Returns "" on failure
    or unsupported file types (e.g. plain photos of a resume with no text layer)."""
    if not filepath or not os.path.exists(filepath):
        return ""
    ext = filepath.lower().rsplit(".", 1)[-1] if "." in filepath else ""
    try:
        if ext == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(filepath)
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        elif ext == "docx":
            import docx
            doc = docx.Document(filepath)
            lines = []
            for p in doc.paragraphs:
                text = p.text.strip()
                if not text:
                    continue
                # Word bullets/numbering are paragraph formatting, not
                # literal characters — p.text alone gives back a bare
                # sentence with no indication it was ever a list item. The
                # resume parser (ai/engine.py) relies on a leading "- " to
                # tell a bullet point apart from a header line, so that
                # marker is restored here from whichever signal is present:
                # a direct numbering/bullet property on the paragraph, or
                # (as a fallback, since some templates apply the numbering
                # via the paragraph style instead) a "List"/"Bullet" style
                # name.
                is_list_item = False
                try:
                    ppr = p._p.pPr
                    is_list_item = ppr is not None and ppr.numPr is not None
                except Exception:
                    pass
                if not is_list_item and p.style is not None:
                    style_name = (p.style.name or "").lower()
                    is_list_item = "list" in style_name or "bullet" in style_name
                lines.append(f"- {text}" if is_list_item else text)
            return "\n".join(lines)
        elif ext == "txt":
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        else:
            return ""
    except Exception:
        return ""
