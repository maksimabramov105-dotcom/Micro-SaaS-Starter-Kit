#!/usr/bin/env python3
"""
regenerate_thumbnails.py — Re-render template thumbnails as PNG files.

Renders each resume template using the sample resume fixture via WeasyPrint,
then saves the first page as a 200px-wide PNG using pdf2image.

Run from the project root:
    uv run python worker/scripts/regenerate_thumbnails.py

Output:
    public/template-thumbnails/{template_id}.png  (200 × ~260 px, 96 DPI)

Prerequisites:
    pip install weasyprint jinja2 pdf2image
    # On macOS: brew install poppler
    # On Debian/Ubuntu: apt-get install -y poppler-utils
"""
import json
import sys
from pathlib import Path

# Ensure worker package is importable when run from project root
REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "worker"))

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

TEMPLATES_DIR = Path(__file__).parent.parent / "worker" / "templates" / "resumes"
OUTPUT_DIR = REPO_ROOT / "public" / "template-thumbnails"
SAMPLE_RESUME_PATH = TEMPLATES_DIR / "_sample_resume.json"

ALLOWED_TEMPLATES = [
    "modern_minimalist",
    "classic_executive",
    "tech_compact",
    "creative_accent",
    "new_grad",
]


def render_template_to_pdf(template_id: str, resume: dict) -> bytes:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template(f"{template_id}.html")
    html_str = template.render(resume=resume)
    return HTML(string=html_str, base_url=str(TEMPLATES_DIR)).write_pdf()


def pdf_to_thumbnail(pdf_bytes: bytes, output_path: Path, width_px: int = 200) -> None:
    try:
        from pdf2image import convert_from_bytes
    except ImportError:
        print("  pdf2image not installed — skipping PNG conversion")
        print(f"  Install: pip install pdf2image && brew install poppler (macOS)")
        return

    images = convert_from_bytes(pdf_bytes, dpi=96, first_page=1, last_page=1)
    if not images:
        print("  pdf2image returned no images — check poppler installation")
        return
    img = images[0]
    # Resize to 200px wide while preserving aspect ratio
    ratio = width_px / img.width
    new_height = int(img.height * ratio)
    img = img.resize((width_px, new_height))
    img.save(str(output_path), "PNG", optimize=True)
    print(f"  Saved PNG: {output_path} ({width_px}×{new_height})")


def main() -> None:
    resume = json.loads(SAMPLE_RESUME_PATH.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for template_id in ALLOWED_TEMPLATES:
        print(f"Rendering {template_id}…")
        try:
            pdf_bytes = render_template_to_pdf(template_id, resume)
            print(f"  PDF: {len(pdf_bytes):,} bytes")
            output_path = OUTPUT_DIR / f"{template_id}.png"
            pdf_to_thumbnail(pdf_bytes, output_path)
        except Exception as exc:
            print(f"  ERROR: {exc}")

    print("\nDone. Commit any updated PNG files in public/template-thumbnails/")


if __name__ == "__main__":
    main()
