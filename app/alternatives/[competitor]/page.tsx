// app/alternatives/[competitor]/page.tsx
// Next.js 16 App Router — competitor "alternative to" pages (high purchase intent).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import seo from "@/lib/seo-data.json"; // <-- adjust path if needed
import { RescueCtaBlock } from "@/components/rescue-cta-block";
import { PRICE } from "@/lib/pricing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const SITE = seo._meta.site;
const competitors = seo.competitors;

type Params = { competitor: string };
const get = (slug: string) => competitors.find((c) => c.slug === slug);

export function generateStaticParams() {
  return competitors.map((c) => ({ competitor: c.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<Params> }
): Promise<Metadata> {
  const { competitor } = await params;
  const c = get(competitor);
  if (!c) return {};
  const title =
    c.status === "shut down"
      ? `Best ${c.name} Alternative in 2026 (${c.name} Shut Down — Use This Instead)`
      : `Best ${c.name} Alternative in 2026 — ResumeAI-Bot`;
  const description = `Looking for a ${c.name} alternative? ResumeAI-Bot auto-applies to jobs in 50+ countries with AI resumes, a free tier, and a 30-day money-back guarantee.`;
  const url = `${SITE}/alternatives/${c.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "ResumeAI-Bot", type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { competitor } = await params;
  const c = get(competitor);
  if (!c) notFound();
  const url = `${SITE}/alternatives/${c.slug}`;

  const faq = [
    { q: `Is ${c.name} still available?`, a: c.status === "shut down" ? `No — ${c.name} has shut down, which is why many users are looking for a replacement.` : `Yes, ${c.name} is still active, but it isn't the best fit for everyone — especially international and relocation job seekers.` },
    { q: `How is ResumeAI-Bot different from ${c.name}?`, a: c.ourEdge.join(" ") },
    { q: `Is there a free version?`, a: `Yes — ${seo._meta.freeTier}. Paid plans add a ${seo._meta.guarantee}.` },
    { q: `Can I cancel anytime?`, a: `Yes, and every paid plan is backed by a 30-day money-back guarantee.` },
  ];

  const features = (c as { features?: Record<string, string> }).features;
  const sources = (c as { sources?: { label: string; url: string }[] }).sources;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", headline: `Best ${c.name} Alternative (2026)`, mainEntityOfPage: url, author: { "@type": "Organization", name: "ResumeAI-Bot" }, publisher: { "@type": "Organization", name: "ResumeAI-Bot" } },
      { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Alternatives", item: `${SITE}/compare` },
        { "@type": "ListItem", position: 3, name: `${c.name} alternative`, item: url },
      ] },
    ],
  };

  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <h1>
        {c.status === "shut down"
          ? `The Best ${c.name} Alternative in 2026 (${c.name} Shut Down — Here's What to Use Instead)`
          : `The Best ${c.name} Alternative in 2026`}
      </h1>

      <p>{c.summary}</p>

      <h2>Why people are switching from {c.name}</h2>
      <ul>{c.whySwitch.map((w) => <li key={w}>{w}</li>)}</ul>

      <h2>ResumeAI-Bot vs {c.name}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ textAlign: "left" }}></th><th style={{ textAlign: "left" }}>ResumeAI-Bot</th><th style={{ textAlign: "left" }}>{c.name}</th></tr>
        </thead>
        <tbody>
          {features ? (
            <>
              <tr><td>Hands-off auto-apply</td><td>✅ Yes</td><td>{features.autoApply}</td></tr>
              <tr><td>Eligibility check (work auth / sponsorship / remote)</td><td>✅ Yes</td><td>{features.eligibility}</td></tr>
              <tr><td>Verified by employer ATS</td><td>✅ Yes</td><td>{features.verifiedSubmissions}</td></tr>
              <tr><td>Replies captured in one inbox</td><td>✅ Yes</td><td>{features.replyInbox}</td></tr>
            </>
          ) : null}
          <tr><td>Countries covered</td><td><strong>50+</strong></td><td>Limited</td></tr>
          <tr><td>AI resume tailored per role</td><td>✅</td><td>Limited</td></tr>
          <tr><td>Free tier</td><td>✅ (3 apps/day)</td><td>{c.slug === "loopcv" || c.slug === "jobright" ? "✅" : "❌"}</td></tr>
          <tr><td>30-day money-back guarantee</td><td>✅ 30-day</td><td>—</td></tr>
          <tr><td>Price</td><td>{PRICE.proMonthly}/mo</td><td>{features ? features.price : c.theirPrice}</td></tr>
          <tr><td>Status</td><td>Active</td><td>{c.status === "shut down" ? "Shut down" : "Active"}</td></tr>
        </tbody>
      </table>

      {sources && sources.length > 0 && (
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Sources (verify the claims yourself):{" "}
          {sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 ? " · " : ""}
              <a href={s.url} target="_blank" rel="nofollow noopener noreferrer">{s.label}</a>
            </span>
          ))}
        </p>
      )}

      <h2>What makes ResumeAI-Bot different</h2>
      <ul>{c.ourEdge.map((e) => <li key={e}>{e}</li>)}</ul>

      <h2>Switching is easy</h2>
      <p>Import your resume, choose your target countries, and ResumeAI-Bot starts applying for you.
        Start on the free plan — no card required — and upgrade only when you see results.</p>
      <p><Link href="/?ref=seo-alt" style={{ fontWeight: 600 }}>Try the {c.name} alternative free →</Link></p>

      <RescueCtaBlock refTag="seo-alt" />

      <h2>Frequently asked questions</h2>
      {faq.map((f) => (<div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>))}

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: 14 }}>
        Compare more:{" "}
        {competitors.filter((x) => x.slug !== c.slug).map((x) => (
          <Link key={x.slug} href={`/alternatives/${x.slug}`} style={{ marginRight: 8 }}>{x.name} alternative</Link>
        ))}
        · <Link href="/compare">Full comparison</Link>
        · <Link href="/proof">Live proof</Link>
        · <Link href="/pricing">Pricing →</Link>
      </p>
    </article>
      <SiteFooter />
    </>
  );
}
