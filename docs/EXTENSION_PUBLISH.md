# Chrome Web Store publish checklist (D4)

The extension is built (`extension/`). Publishing is a **manual, one-time** task
(Google review takes a few days). Once live, set the store URL so the in-app CTA
appears automatically.

## Steps
1. **Zip the extension:** `cd extension && zip -r ../resumeai-extension.zip . -x '*.DS_Store'`
2. **Chrome Web Store Developer Dashboard** (https://chrome.google.com/webstore/devconsole) — one-time $5 registration if not already.
3. **Create item → upload the zip.** Fill the listing:
   - Name, summary, detailed description (lead with the eligibility/remote wedge).
   - **Screenshots** (1280×800): the autofill in action + the dashboard.
   - Icon (already in `extension/icons`).
   - Category: Productivity. Language: English.
   - **Privacy:** single purpose + permission justifications + a link to `/privacy`.
4. **Submit for review.** Approval usually 1–3 days.
5. **After approval:** copy the listing URL and set it as an env var so the
   dashboard "Install extension" CTA shows up:
   - On the VPS `/opt/resumeai/.env`: `NEXT_PUBLIC_CHROME_EXTENSION_URL=https://chromewebstore.google.com/detail/<id>`
   - (Also add it to the GitHub deploy env / docker-compose if you want it baked in.)
   - Recreate web: `cd /opt/resumeai && docker compose up -d web`

The CTA (`app/dashboard/page.tsx`) renders **only** when that env var is set, so
there's never a dead link before the extension is live.
