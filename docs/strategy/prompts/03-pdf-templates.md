# Prompt 03 — 5 professional ATS-safe PDF templates + picker UI

> **Paste into Claude Code. Adds a NEW dependency (WeasyPrint) to the worker. Adds new endpoints, new UI, new DB column. Behind a feature flag.**
>
> ⚠️ **READ FIRST: `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.2.** The existing PDF flow at `app/api/resumes/[id]/pdf/route.ts` passes `resume_text` (a single string) to the worker route `POST /jobs/resume/pdf` — NOT structured JSON. Templates need structured data. Add a JSON shape adapter that prefers `resume.generated.resume_structured` if present, otherwise degrades from `resume_text`. Keep the legacy `/jobs/resume/pdf` route untouched as fallback.
>
> 🚨 **VPS hard-fail:** end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why
Today resumes export to a single PDF layout. Competitors charge $40/mo and still ship one template. We can ship 5 templates with a picker and immediately have a marketable parity-plus feature. All 5 templates are single-column, ATS-safe, parseable by Workday/Lever/Greenhouse.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §3 — template choices and rationale
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.2 — JSON adapter spec + this prompt's overrides
3. `docs/ARCHITECTURE.md` — Worker section, Resume domain model
4. `app/api/resumes/[id]/pdf/route.ts` — current PDF endpoint (passes `resume_text` string)
5. `worker/worker/routes/jobs.py` — current `/jobs/resume/pdf` worker endpoint
6. `prisma/schema.prisma` — `Resume` model (add `templateId` column)
7. `app/dashboard/resumes/[id]/page.tsx` — where the picker UI lives
8. `lib/worker-client.ts` — extend with `renderResumePdf` helper

## Design choices (already decided in §3 of the analysis)
- **Renderer:** WeasyPrint (HTML+CSS → PDF). Keep reportlab for any download-as-PDF code path that already works; do NOT delete it.
- **Templates:** 5 single-column, ATS-safe Jinja2 + CSS templates.
- **Storage:** Template ID stored on `Resume` row. User can switch and re-render at any time.
- **Behind flag:** `PDF_TEMPLATES_V1` (default OFF; enable in prod after smoke test).

## Changes

### Change 1 — Add WeasyPrint dependency

In `worker/pyproject.toml` (or `requirements.txt`), add:
```
weasyprint>=62.0
jinja2>=3.1.4
```

WeasyPrint needs system deps (`libpango`, `libcairo`, etc). Update `worker/Dockerfile`:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 \
    libgdk-pixbuf2.0-0 libffi-dev shared-mime-info \
    && rm -rf /var/lib/apt/lists/*
```

### Change 2 — Templates directory

Create `worker/worker/templates/resumes/`:
- `_base.html` — shared HTML scaffold (head, body, contact block macro, footer)
- `_common.css` — shared print-safe CSS reset, font fallback stack, page margins
- `modern_minimalist.html` + `modern_minimalist.css`
- `classic_executive.html` + `classic_executive.css`
- `tech_compact.html` + `tech_compact.css`
- `creative_accent.html` + `creative_accent.css`
- `new_grad.html` + `new_grad.css`

**Hard rules every template must follow:**
- Single column. No `<table>` for layout. No `display: flex` with multiple columns of content.
- Section headings exactly: "Summary", "Experience", "Education", "Skills", "Projects" (case as shown).
- Contact info in first 3 lines of `<body>`, NOT in `<header>` element.
- Fonts only from: Arial, Calibri, Cambria, Garamond, Georgia, Helvetica, Times New Roman. Use CSS `font-family` fallback stack including a web-safe family — do not embed custom @font-face fonts.
- 0.4"–0.75" page margins via `@page { size: Letter; margin: ... }`.
- Total file size after render: <120 KB.
- No background images, no logos, no icons. Text only.

### Change 3 — Render endpoint

Add `POST /resumes/{resume_id}/render` to `worker/worker/routes/jobs.py`:
```python
from pydantic import BaseModel
from fastapi import HTTPException
from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML, CSS
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "resumes"
ALLOWED_TEMPLATES = {
    "modern_minimalist", "classic_executive",
    "tech_compact", "creative_accent", "new_grad",
}

class RenderRequest(BaseModel):
    template_id: str
    resume_data: dict

@router.post("/resumes/{resume_id}/render")
async def render_resume(resume_id: str, body: RenderRequest):
    if body.template_id not in ALLOWED_TEMPLATES:
        raise HTTPException(400, f"Unknown template_id: {body.template_id}")
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template(f"{body.template_id}.html")
    html_str = template.render(resume=body.resume_data, common_css="_common.css")
    pdf_bytes = HTML(string=html_str, base_url=str(TEMPLATES_DIR)).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")
```

### Change 4 — DB column

`prisma/schema.prisma`:
```prisma
model Resume {
  // ... existing fields
  templateId String @default("modern_minimalist")
}
```
Run `npx prisma migrate dev --name add_resume_template_id`. Verify migration applies cleanly on dev DB.

### Change 5 — Web-side glue

In `lib/worker-client.ts`, add:
```typescript
export async function renderResumePdf(args: {
  resumeId: string;
  templateId: string;
  resumeData: Record<string, unknown>;
}): Promise<Buffer> { ... }
```

Update `app/api/resumes/[id]/pdf/route.ts` to:
1. Read `Resume.templateId` from DB (default to `modern_minimalist` if null)
2. Call `renderResumePdf` if `PDF_TEMPLATES_V1` flag is ON
3. Otherwise call the existing reportlab path

### Change 6 — Picker UI

In `app/dashboard/resumes/[id]/page.tsx`:
1. Add a template-picker dropdown ("Modern Minimalist", "Classic Executive", "Tech Compact", "Creative Accent", "New Grad")
2. Add a thumbnail per template (PNG, ~200×260, stored in `public/template-thumbnails/`)
3. "Preview" button calls a new lightweight preview endpoint that renders the PDF and embeds it in an iframe via blob URL
4. "Save & Download" updates `Resume.templateId` and triggers download

UI mock (shadcn/ui):
- Card grid, 5 cards, each with thumbnail + name + 1-line description
- Selected card highlighted with primary border
- Right side: live preview iframe
- Bottom: "Download PDF" button (primary)

### Change 7 — Thumbnails

Render a thumbnail PNG for each template using a sample resume (create `worker/worker/templates/resumes/_sample_resume.json` — fake but realistic data). Render via WeasyPrint → save first page as PNG via `pdf2image` (already-pinned dep) at 96 DPI, downsample to 200px wide. Commit thumbnails to `public/template-thumbnails/`. Re-generate via a one-off script `worker/scripts/regenerate_thumbnails.py` that you also commit.

### Change 8 — Feature flag

Add to `worker/worker/config.py` and `lib/flags.ts`:
- `pdf_templates_v1: bool = false`

When flag is OFF, picker UI is hidden and existing reportlab download path is used.

### Change 9 — Tests

`worker/tests/test_resume_render.py`:
- Each template renders without exception on sample data
- Output PDF starts with `%PDF-` magic bytes
- Output text contains all sample sections (Summary, Experience, etc.)
- Output text does NOT contain template-specific Jinja syntax (no `{{ }}` leaks)
- Each rendered PDF is <120 KB
- Rejecting unknown `template_id` returns 400

Web-side: `__tests__/api/resumes/pdf.test.ts`:
- Calls correct worker endpoint with correct `template_id` from DB
- Falls back to default template if `templateId` is null

## Verification before commit
1. Local: spin up worker, hit `/resumes/test-id/render` with each template_id, eyeball each PDF
2. Verify each PDF opens in Preview/Adobe AND text-selects cleanly (ATS-readable test)
3. Open each PDF in a free ATS parser like https://www.jobscan.co/resume-checker (or similar) — sections should parse correctly
4. Verify thumbnails exist and look right
5. Verify migration applies and rolls back cleanly

## Deploy
1. Branch `feat/pdf-templates-v1`
2. Run prisma migrate on production DB BEFORE deploying app: `npx prisma migrate deploy` on VPS
3. Commit, push, merge — CI builds worker image with new system deps (will take longer due to apt-get)
4. Pull on VPS, `docker-compose up -d --build worker web`
5. Verify worker container starts: `docker-compose logs --tail=100 worker`
6. Set `PDF_TEMPLATES_V1=true` in `.env` for web and worker, restart
7. Smoke test all 5 templates from the dashboard
8. If anything wrong: `PDF_TEMPLATES_V1=false`, restart, fix in branch

## Rules
- Do NOT delete the reportlab path. Keep as fallback.
- Do NOT modify the existing `/resumes/[id]/pdf` route contract — same request shape, same response shape.
- Do NOT introduce client-side PDF rendering. Server-only.
- Migration must be **additive only** — no dropping columns, no breaking changes.
- Commit messages:
  - `feat(worker): add WeasyPrint + 5 ATS-safe resume templates`
  - `feat(web): add template picker UI behind PDF_TEMPLATES_V1 flag`
  - `db(migration): add Resume.templateId default "modern_minimalist"`

## Definition of done
- 5 templates exist and render correctly on sample data
- DB migration applied to dev + prod
- Picker UI present, gated by flag
- Worker image builds with WeasyPrint system deps
- Smoke test all 5 templates from prod dashboard
- All PDFs <120 KB, ATS-parseable
- VPS git HEAD matches GitHub main
- `docs/strategy/STRATEGIC_ANALYSIS.md` §3 — append completion note
- `docs/ARCHITECTURE.md` updated to include the new render endpoint and template system
