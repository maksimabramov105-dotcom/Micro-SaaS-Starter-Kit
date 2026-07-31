import { HERO_B, HERO_COOKIE, HERO_EXPERIMENT, type HeroExperiment } from '@/lib/hero-experiment'

/**
 * components/hero-experiment.tsx — the client half of the landing hero A/B (P5.7).
 *
 * Two pieces, both tiny, both deliberately not React:
 *
 * HeroVariantScript — an inline script that runs while the parser is still
 * inside the hero, before anything is painted. It buckets the visitor from a
 * stable localStorage id, and for variant B replaces the text of the two hero
 * nodes. Doing it any later means the visitor sees the control headline flip to
 * something else, which reads as a broken page; doing it on the server means
 * the homepage stops being statically rendered (see lib/hero-experiment.ts).
 *
 * It also writes a cookie, which is the part that makes the test decidable:
 * conversion events fired server-side read it and attach the variant, so a
 * purchase can be traced to the headline that produced it.
 *
 * HeroExposure — records that this visitor saw this variant, once per browser.
 * Without an exposure count a conversion count is a number with no denominator.
 *
 * Neither renders anything visible, and both render nothing at all when the
 * test is off — no dead script tags, no beacons, no cookie on a page that is
 * not running an experiment.
 */

export function HeroVariantScript({ experiment }: { experiment: HeroExperiment }) {
  if (!experiment.active) return null

  // Written as a string on purpose: it must execute during parse, and it must
  // not wait for React to hydrate.
  const script = `(function(){try{
var K='rai_ab_id',id=null;
try{id=localStorage.getItem(K);if(!id){id=(Date.now().toString(36)+Math.random().toString(36).slice(2,10));localStorage.setItem(K,id)}}catch(e){}
if(!id){id=String(Math.random())}
var h=0,s='${HERO_EXPERIMENT}:'+id;
for(var i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0}
var v=(Math.abs(h)%100)<${experiment.pct}?'b':'a';
window.__raiHero=v;
document.cookie='${HERO_COOKIE}='+v+';path=/;max-age=7776000;samesite=lax';
if(v==='b'){
var a=document.getElementById('hero-headline');if(a){a.textContent=${JSON.stringify(HERO_B.headline)}}
var b=document.getElementById('hero-subhead');if(b){b.textContent=${JSON.stringify(HERO_B.subhead)}}
}
}catch(e){}})();`

  return <script dangerouslySetInnerHTML={{ __html: script }} />
}

export function HeroExposure({ experiment }: { experiment: HeroExperiment }) {
  if (!experiment.active) return null

  // Fires after paint, deduped per browser: an exposure counted twice inflates
  // the denominator and makes the winning variant look worse than it is.
  const script = `(function(){try{
var v=window.__raiHero;if(!v)return;
var K='rai_ab_seen_${HERO_EXPERIMENT}';
try{if(localStorage.getItem(K)===v)return;localStorage.setItem(K,v)}catch(e){}
fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({event:'experiment_exposure',page:'/',properties:{experiment_key:'${HERO_EXPERIMENT}',variant:v}}),
keepalive:true}).catch(function(){});
}catch(e){}})();`

  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
