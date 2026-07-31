/**
 * lib/ab.ts — client-assigned A/B tests that do not cost static rendering.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE
 *
 * lib/experiments.ts assigns variants on the server, which means reading a
 * cookie, which means the route opts out of static rendering. On /pricing that
 * was measurable and expensive: server response was a healthy 190 ms and total
 * blocking time 70 ms, but with no static caching LCP landed at 5.4 s and
 * Lighthouse performance at 72 — on the page that takes the money. The landing
 * page and /ats-check, which are static, score 99 and 97.
 *
 * Server-side assignment is still the right tool when the variant changes what
 * the server must FETCH. For a copy test it buys nothing and costs the cache.
 *
 * HOW THIS WORKS INSTEAD
 *
 *   server  decides whether a test runs and at what percentage, from the
 *           FeatureFlag table, on the page's ISR window. No per-request work.
 *   client  decides which visitor gets which variant, from a stable id in
 *           localStorage, in an inline script that runs before paint.
 *
 * The control copy is what sits in the HTML, so crawlers index one stable
 * version of every page and there is no flicker for anyone.
 *
 * Both scripts are strings rather than React because they must run during parse
 * — waiting for hydration means the visitor watches the headline change, which
 * reads as a broken page.
 */

/** Shared visitor id. One id across every test, so buckets are independent. */
const ID_KEY = 'rai_ab_id'

export interface AbConfig {
  active: boolean
  /** 0-100. Share of visitors who get variant B. */
  pct: number
}

/** Element id → the text variant B should show instead. */
export type VariantSwaps = Record<string, string>

/**
 * Normalise a FeatureFlag row into a test config.
 *
 * 0% and 100% are both "everyone sees one thing": no split to run, and no
 * exposure events worth recording.
 */
export function toAbConfig(
  flag: { enabled: boolean; rolloutPct: number } | null,
): AbConfig {
  if (!flag?.enabled) return { active: false, pct: 0 }
  const pct = Math.max(0, Math.min(100, flag.rolloutPct))
  return { active: pct > 0 && pct < 100, pct }
}

/**
 * Inline script: bucket the visitor, swap the copy, drop the attribution cookie.
 *
 * The cookie is what makes a test decidable — server-side conversion events read
 * it and attach the variant, so a purchase traces back to the copy that produced
 * it. Every step is wrapped against a browser with storage disabled; a visitor
 * with cookies blocked must still see a working page, just always the control.
 */
export function variantScript(opts: {
  experimentKey: string
  cookieName: string
  pct: number
  swaps: VariantSwaps
}): string {
  const swaps = Object.entries(opts.swaps)
    .map(([id, text]) => `s(${JSON.stringify(id)},${JSON.stringify(text)});`)
    .join('')

  return `(function(){try{
var K=${JSON.stringify(ID_KEY)},id=null;
try{id=localStorage.getItem(K);if(!id){id=Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem(K,id)}}catch(e){}
if(!id){id=String(Math.random())}
var h=0,q=${JSON.stringify(opts.experimentKey)}+':'+id;
for(var i=0;i<q.length;i++){h=((h<<5)-h+q.charCodeAt(i))|0}
var v=(Math.abs(h)%100)<${opts.pct}?'b':'a';
window.__raiAb=window.__raiAb||{};window.__raiAb[${JSON.stringify(opts.experimentKey)}]=v;
try{document.cookie=${JSON.stringify(opts.cookieName)}+'='+v+';path=/;max-age=7776000;samesite=lax'}catch(e){}
if(v==='b'){function s(i,t){var el=document.getElementById(i);if(el){el.textContent=t}}${swaps}}
}catch(e){}})();`
}

/**
 * Inline beacon: record that this visitor saw this variant, once per browser.
 *
 * Without an exposure count a conversion count is a number with no denominator,
 * and counting one visitor twice makes the winning variant look worse than it
 * is — hence the dedupe.
 */
export function exposureScript(opts: { experimentKey: string; page: string }): string {
  const key = JSON.stringify(opts.experimentKey)
  return `(function(){try{
var m=window.__raiAb||{},v=m[${key}];if(!v)return;
var K='rai_ab_seen_'+${key};
try{if(localStorage.getItem(K)===v)return;localStorage.setItem(K,v)}catch(e){}
fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({event:'experiment_exposure',page:${JSON.stringify(opts.page)},properties:{experiment_key:${key},variant:v}}),
keepalive:true}).catch(function(){});
}catch(e){}})();`
}

/** Read a variant cookie off an incoming request, for conversion attribution. */
export function readVariantCookie(
  cookieHeader: string | null,
  cookieName: string,
): 'a' | 'b' | undefined {
  const m = cookieHeader?.match(new RegExp(`(?:^|; )${cookieName}=(a|b)`))
  return (m?.[1] as 'a' | 'b' | undefined) ?? undefined
}
