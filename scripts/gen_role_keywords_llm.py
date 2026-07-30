"""G2 take 2: per-posting LLM extraction, aggregated by frequency.

extract_ats_keywords() truncates its input to 3000 chars, so feeding a blob of
several postings effectively used only the FIRST one — while the page would have
claimed "extracted from N job descriptions". That would be a false claim, so
instead we call the extractor once PER posting and rank keywords by how many
postings mention them. listingCount is then the number of postings actually
analysed, making the page's claim literally true.
"""
import asyncio, json, re, sys, collections
sys.path.insert(0, "/app")
from worker.ai.keywords import extract_ats_keywords

ROLE_PATTERNS = [
    ("machine-learning-engineer","Machine Learning Engineer",r"\b(machine learning|ml)\s+engineer\b"),
    ("ai-engineer","AI Engineer",r"\bai\s+(infrastructure\s+)?engineer\b|\bai/ml\b"),
    ("data-engineer","Data Engineer",r"\bdata\s+engineer\b"),
    ("analytics-engineer","Analytics Engineer",r"\banalytics\s+engineer\b"),
    ("devops-engineer","DevOps Engineer",r"\b(devops|sre|site reliability|platform)\s+engineer\b"),
    ("security-engineer","Security Engineer",r"\b(security|grc|appsec)\s+engineer\b"),
    ("qa-engineer","QA Engineer",r"\b(qa|quality assurance|test automation|sdet)\b.*\bengineer\b"),
    ("mobile-engineer","Mobile Engineer",r"\b(ios|android|mobile|react native|flutter)\s+(engineer|developer)\b"),
    ("backend-engineer","Backend Engineer",r"\b(backend|back-end|back end|python|golang|java|ruby|node)\s+(engineer|developer)\b"),
    ("full-stack-engineer","Full Stack Engineer",r"\bfull[\s-]?stack\s+(engineer|developer)\b"),
    ("solutions-engineer","Solutions Engineer",r"\b(solutions?|presales|pre-sales|sales)\s+engineer\b|\bsolutions? architect\b"),
    ("forward-deployed-engineer","Forward Deployed Engineer",r"\bforward[\s-]deployed\b"),
    ("customer-success-engineer","Customer Success Engineer",r"\bcustomer success engineer\b"),
    ("support-engineer","Support Engineer",r"\b(technical support|support|product support)\s+engineer\b"),
    ("engineering-manager","Engineering Manager",r"\bengineering manager\b|\bmanager,?\s+(engineering|software)\b"),
    ("software-engineer","Software Engineer",r"\b(software\s+)?engineer\b|\bdeveloper\b"),
    ("technical-support-specialist","Technical Support Specialist",r"\btechnical support (specialist|expert|consultant|technician)\b"),
    ("customer-support-specialist","Customer Support Specialist",r"\b(customer|client|product|consumer) support (specialist|consultant|advocate|agent|representative)\b"),
    ("it-support-specialist","IT Support Specialist",r"\bit (support|systems)\b"),
    ("operations-specialist","Operations Specialist",r"\boperations (specialist|manager|analyst)\b|\bglobal operations\b"),
    ("hr-specialist","HR Specialist",r"\b(hr|human resources|people|employee relations|benefits)\s+(specialist|partner|manager|coordinator)\b"),
    ("data-analyst","Data Analyst",r"\b(data|business|financial)\s+analyst\b"),
    ("project-manager","Project Manager",r"\b(project|program|delivery)\s+manager\b"),
]
PATS = [(s, r, re.compile(rx, re.I)) for s, r, rx in ROLE_PATTERNS]
MAX_POSTINGS_PER_ROLE = 8
MIN_POSTINGS, MIN_KEYWORDS = 2, 10

rows = json.load(open("/tmp/corpus.json"))
buckets = collections.defaultdict(list)
for t, co, d in rows:
    for slug, role, rx in PATS:
        if rx.search(t or ""):
            buckets[(slug, role)].append((t, co, d)); break

async def for_role(slug, role, items):
    bodies = [(c, d) for _, c, d in items if len(d) > 300][:MAX_POSTINGS_PER_ROLE]
    if len(bodies) < MIN_POSTINGS:
        print(f"SKIP {slug}: only {len(bodies)} usable postings", file=sys.stderr); return None
    results = await asyncio.gather(*[extract_ats_keywords(d) for _, d in bodies],
                                   return_exceptions=True)
    freq, first = collections.Counter(), {}
    ok = 0
    for res in results:
        if isinstance(res, Exception) or not res: continue
        ok += 1
        for k in {k.strip() for k in res if k and 2 <= len(k.strip()) <= 40}:
            key = k.lower(); freq[key] += 1; first.setdefault(key, k.strip())
    if ok < MIN_POSTINGS:
        print(f"SKIP {slug}: only {ok} successful extractions", file=sys.stderr); return None
    # Rank by how many postings mention it -> role-level, not employer-level.
    ranked = [first[k] for k, _ in freq.most_common() if freq[k] >= 2] or \
             [first[k] for k, _ in freq.most_common()]
    kws, seen = [], []
    for k in ranked:
        kl = k.lower()
        if any(kl in s or s in kl for s in seen): continue
        seen.append(kl); kws.append(k)
        if len(kws) >= 24: break
    if len(kws) < MIN_KEYWORDS:
        print(f"SKIP {slug}: {len(kws)} keywords after dedupe", file=sys.stderr); return None
    companies = sorted({c for c, _ in bodies if c})
    print(f"OK   {slug}: {len(kws)} kw from {ok} postings ({len(items)} in bucket)", file=sys.stderr)
    # listingCount = postings ACTUALLY analysed, so the page's claim is true.
    return {"slug": slug, "role": role, "keywords": kws,
            "listingCount": ok, "companies": companies}

async def main():
    out = []
    for (slug, role), items in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        r = await for_role(slug, role, items)
        if r: out.append(r)
    out.sort(key=lambda r: r["slug"])
    open("/tmp/rk2.json", "w").write(json.dumps(out, indent=2) + "\n")
    print(f"WROTE {len(out)} roles", file=sys.stderr)

asyncio.run(main())
