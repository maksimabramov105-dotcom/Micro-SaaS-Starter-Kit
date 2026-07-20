/**
 * lib/remote-guides.ts — eligibility/remote-first programmatic landing pages (D3).
 *
 * Each entry renders a unique, indexable page at /remote/<slug> via
 * app/remote/[slug]/page.tsx. These claim the wedge incumbents ignore:
 * eligibility-aware, remote-first auto-apply. Keep copy distinct + truthful.
 */
export interface RemoteGuide {
  slug: string
  /** <title> */
  title: string
  /** meta description */
  description: string
  /** on-page H1 */
  h1: string
  /** 1–2 sentence intro under the H1 */
  intro: string
  /** who this is for */
  forWho: string
  /** 3 distinct value points for this intent */
  points: string[]
  faqs: { q: string; a: string }[]
}

const EDGE =
  'ResumeAI-Bot only applies to jobs you are actually eligible for — it reads your work-authorized countries, whether you need visa sponsorship, and remote-eligibility, answers screening questions honestly, then tailors your resume per role and tracks the replies in one inbox.'

export const REMOTE_GUIDES: RemoteGuide[] = [
  {
    slug: 'auto-apply-remote-jobs',
    title: 'Auto-Apply to Remote Jobs (2026) — Eligibility-Aware | ResumeAI-Bot',
    description: 'Auto-apply to fully-remote jobs worldwide. We target remote-eligible roles, tailor your resume per job, answer screening questions honestly, and track replies.',
    h1: 'Auto-apply to remote jobs — without the spray-and-pray',
    intro: 'Most auto-apply tools blast on-site US postings and get you ghosted. We prioritize fully-remote roles you can actually do from where you are.',
    forWho: 'Remote-first job seekers who want hands-off applications to roles that don’t require relocation.',
    points: [
      'Remote-first sourcing across global remote boards (RemoteOK, Himalayas, We Work Remotely) and startup ATS (Lever, Ashby, Greenhouse).',
      'Eligibility filter skips on-site roles you can’t take, so quota isn’t wasted on auto-rejections.',
      'Every reply lands in one inbox; a job is only marked “submitted” after the employer’s ATS confirms it.',
    ],
    faqs: [
      { q: 'Do you only apply to remote roles?', a: 'You choose. Set your campaign to remote-only (the default) and we skip on-site postings entirely; opt into on-site/hybrid any time.' },
      { q: 'Will I get auto-rejected for work authorization?', a: 'No — we answer authorization and sponsorship questions from your real eligibility profile, and skip roles you’re not eligible for instead of claiming false authorization.' },
    ],
  },
  {
    slug: 'visa-sponsorship-jobs',
    title: 'Visa-Sponsorship Jobs Auto-Apply (2026) | ResumeAI-Bot',
    description: 'Need visa sponsorship? We answer sponsorship questions honestly and target roles that fit your eligibility — no false “authorized to work” answers that get you ghosted.',
    h1: 'Auto-apply to jobs honestly — when you need visa sponsorship',
    intro: 'Tools that auto-answer “authorized to work? yes” for everyone get sponsorship-needing applicants silently rejected. We answer truthfully and target accordingly.',
    forWho: 'International applicants who need (or may need) visa sponsorship and want honest, eligibility-aware applications.',
    points: [
      'Your eligibility profile records whether you need sponsorship; we answer every screening question to match it.',
      'We prioritize remote and sponsorship-friendly roles so you’re not wasting applications on dead ends.',
      'Honest status: confirmed-by-ATS tracking, so you see which applications actually landed.',
    ],
    faqs: [
      { q: 'Do you guarantee sponsorship?', a: 'No tool can. What we do is stop you from being auto-rejected by answering sponsorship questions honestly and focusing volume on remote / sponsorship-aware roles.' },
      { q: 'Can I mark that I need sponsorship?', a: 'Yes — it’s a field in your eligibility profile, and it drives how every application answers work-authorization questions.' },
    ],
  },
  {
    slug: 'auto-apply-international-jobs',
    title: 'Auto-Apply to International Jobs (2026) — AU/NZ/US/EU | ResumeAI-Bot',
    description: 'Apply across borders. We auto-apply to roles in your authorized countries and to remote jobs that hire internationally, with honest eligibility answers.',
    h1: 'Auto-apply to international remote-first jobs (AU/NZ/US/EU)',
    intro: 'Built for people applying across borders — not just US LinkedIn. We only target what you’re eligible for.',
    forWho: 'Job seekers searching across multiple countries, relocating, or going remote internationally.',
    points: [
      'List the countries you’re authorized to work in; we only apply on-site there (plus remote everywhere eligible).',
      'Sources span EU/global ATS (Recruitee, Personio, Workable) and worldwide remote boards.',
      'Per-role AI resume + a single reply inbox across every country you target.',
    ],
    faqs: [
      { q: 'Which countries do you cover?', a: '50+ via global job boards and company career pages. You control which countries to target in your campaign.' },
      { q: 'How do you handle different work-authorization rules?', a: 'Your authorized-countries list drives it: on-site roles outside those countries are skipped unless you’re willing to relocate without sponsorship.' },
    ],
  },
  {
    slug: 'work-from-anywhere-jobs',
    title: 'Work-From-Anywhere Jobs Auto-Apply (2026) | ResumeAI-Bot',
    description: 'Target true work-from-anywhere roles. We filter to globally-remote jobs and auto-apply with a per-role resume, tracking every reply.',
    h1: 'Auto-apply to work-from-anywhere jobs',
    intro: 'Not all “remote” jobs are global — many are region-locked. We focus your applications on roles open to applicants worldwide.',
    forWho: 'Digital nomads and location-independent workers who want genuinely global remote roles.',
    points: [
      'Remote-first sourcing with location/timezone awareness (Himalayas, We Work Remotely).',
      'Eligibility-aware answers so region-restricted “remote” roles don’t silently reject you.',
      'One dashboard with honest queued → submitted → confirmed → reply status.',
    ],
    faqs: [
      { q: 'Can you avoid US-only “remote” jobs?', a: 'We prioritize globally-open remote roles and use the eligibility filter to skip ones you can’t take.' },
    ],
  },
  {
    slug: 'remote-jobs-hiring-worldwide',
    title: 'Remote Jobs Hiring Worldwide — Auto-Apply (2026) | ResumeAI-Bot',
    description: 'Auto-apply to companies hiring remotely worldwide. Eligibility-aware targeting, per-role AI resumes, and a tracked reply inbox.',
    h1: 'Auto-apply to companies hiring remotely worldwide',
    intro: 'We continuously source roles from companies that hire across borders and apply on your behalf — honestly.',
    forWho: 'Anyone who wants to reach global-remote employers without manually applying to each one.',
    points: [
      'Direct-to-company applications via startup ATS (Lever, Ashby, Greenhouse) where reply rates are highest.',
      'Eligibility filter + honest screening answers to avoid auto-rejection.',
      'Job-fit scoring ranks roles before applying so volume goes to good-fit jobs.',
    ],
    faqs: [
      { q: 'How do you pick which jobs to apply to?', a: 'A 0–100 fit score (skills, seniority, eligibility, remote-fit, language) gates applications, so we apply to good-fit roles, not everything.' },
    ],
  },
  {
    slug: 'relocation-jobs',
    title: 'Relocation Jobs Auto-Apply (2026) | ResumeAI-Bot',
    description: 'Willing to relocate? We factor relocation + sponsorship into every application so you target roles you can realistically take.',
    h1: 'Auto-apply to relocation jobs — matched to your real situation',
    intro: 'If you’re open to relocating, we widen targeting accordingly — but still answer authorization and sponsorship honestly.',
    forWho: 'Job seekers open to relocating for the right role, including across borders.',
    points: [
      'Relocation + sponsorship flags in your profile expand which on-site roles we target.',
      'Honest answers prevent the “authorized everywhere” lie that gets relocation applicants ghosted.',
      'Track which relocation applications were confirmed and replied to.',
    ],
    faqs: [
      { q: 'I’ll relocate but need sponsorship — what happens?', a: 'We still apply where it makes sense and answer sponsorship questions truthfully; roles that clearly won’t sponsor are de-prioritized.' },
    ],
  },
  {
    slug: 'remote-tech-jobs',
    title: 'Auto-Apply to Remote Tech Jobs (2026) | ResumeAI-Bot',
    description: 'Remote software, data, and IT roles — auto-applied with a per-role AI resume and honest, eligibility-aware screening answers.',
    h1: 'Auto-apply to remote tech jobs',
    intro: 'Engineering, data, and IT roles dominate remote hiring. We source them from the ATS where startups actually reply.',
    forWho: 'Developers, data, and IT professionals targeting remote roles.',
    points: [
      'Startup ATS sourcing (Lever, Ashby, Greenhouse) — direct-to-company, fast replies.',
      'AI tailors your resume to each stack and seniority level for ATS pass-through.',
      'Eligibility-aware + reply tracking, so your pipeline is honest.',
    ],
    faqs: [
      { q: 'Does the resume get tailored to the stack?', a: 'Yes — each application gets a per-role tailored resume so it reads like you wrote it for that job.' },
    ],
  },
  {
    slug: 'eligibility-aware-job-search',
    title: 'Eligibility-Aware Job-Search Automation (2026) | ResumeAI-Bot',
    description: 'The auto-apply tool that checks work authorization, sponsorship, and remote-eligibility before applying — instead of spray-and-pray.',
    h1: 'Eligibility-aware job-search automation',
    intro: 'The core difference: we model whether you can actually take a job before applying. Incumbents don’t.',
    forWho: 'Anyone tired of being auto-rejected for jobs they were never eligible for.',
    points: [
      'A profile of authorized countries, sponsorship needs, relocation, remote-only, and languages drives every application.',
      'Screening answers are generated from that profile — never a hardcoded “authorized in the US”.',
      'Ineligible roles are skipped with a logged reason, so quota goes to winnable jobs.',
    ],
    faqs: [
      { q: 'What is eligibility-aware auto-apply?', a: 'It means the tool only applies to roles you can legally take and answers work-authorization questions honestly, instead of blasting every posting.' },
      { q: 'Why does this matter?', a: 'False “authorized to work” answers are the #1 reason auto-apply tools get applicants silently rejected. Honesty + targeting fixes the ghosting.' },
    ],
  },
  {
    slug: 'auto-apply-eu-remote-jobs',
    title: 'Auto-Apply to EU Remote Jobs (2026) | ResumeAI-Bot',
    description: 'Target EU-based and EU-remote roles via European ATS (Recruitee, Personio, Workable) with eligibility-aware, honest applications.',
    h1: 'Auto-apply to EU remote jobs',
    intro: 'Europe’s SMB hiring runs on ATS most US tools ignore. We source there and apply with honest eligibility answers.',
    forWho: 'Applicants targeting EU remote/relocation roles, including non-EU citizens needing sponsorship clarity.',
    points: [
      'EU-heavy ATS coverage: Recruitee, Personio, Workable, plus global remote boards.',
      'Authorized-countries + sponsorship logic tuned for cross-border EU applications.',
      'Per-role resume and a tracked reply inbox.',
    ],
    faqs: [
      { q: 'Do you cover European company career pages?', a: 'Yes — Recruitee and Personio (DACH/EU SMB) plus Workable, in addition to worldwide remote boards.' },
    ],
  },
  {
    slug: 'remote-jobs-without-us-authorization',
    title: 'Remote Jobs Without US Work Authorization — Auto-Apply (2026) | ResumeAI-Bot',
    description: 'No US work authorization? We won’t claim you have it. We target remote roles open to your location and answer screening questions honestly.',
    h1: 'Auto-apply to remote jobs without US work authorization',
    intro: 'If you’re not authorized to work in the US, blasting US on-site postings just burns applications. We target what you can actually take.',
    forWho: 'Internationally-located applicants without US work authorization who want legitimate remote opportunities.',
    points: [
      'We never answer “authorized to work in the US” as yes when you’re not — that honesty avoids instant rejection.',
      'Targeting focuses on globally-remote roles and your authorized countries.',
      'Confirmed-by-ATS tracking so you know which applications truly went through.',
    ],
    faqs: [
      { q: 'Will you lie to get me past screening?', a: 'No. We answer work-authorization questions truthfully from your profile. The strategy is honest targeting + volume on eligible roles, not false answers.' },
    ],
  },
]

export const getRemoteGuide = (slug: string) => REMOTE_GUIDES.find((g) => g.slug === slug)
