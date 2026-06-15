# ResumeAI × Карта SaaS-системы — Gap-анализ и план до первых продаж

**Дата:** 2026-06-10
**База сравнения:** `saas-business-system-map.html` (6 стадий, 9 подсистем, флайвил AARRR, юнит-экономика)
**Промты для Claude Code:** `docs/strategy/prompts/09-…12-…` (новые, июнь) + 01–08 (май, частично выполнены)

---

## 1. Где мы на карте (стадия роста)

По карте мы — **Stage 2 → 3 (MVP & First Customers → PMF)**: продукт жив, биллинг работает, но **proof point Stage 2 не закрыт**: «first real dollars + users coming back». Главное правило карты: *не масштабировать маркетинг до закрытия proof point текущей стадии*. Наш блокер — не маркетинг, а **ядро ценности: отклики не приводят к интервью** (см. §3).

## 2. Соответствие 9 подсистемам карты

| # | Подсистема карты | У нас | Статус | Gap |
|---|---|---|---|---|
| 1 | Product & Engineering | web + worker, CareerOps, инбокс | 🟢 сильный | метрика activation не считается |
| 2 | Infrastructure | VPS, Docker, CI/CD, uptime-kuma | 🟢 | Sentry частично; backup-drill не сделан (B5 в QA) |
| 3 | Acquisition (Marketing) | програм. SEO-страницы, lead API | 🟡 | нет аналитики трафика, нет контента, нет каналов с измеренным CAC |
| 4 | Sales & Conversion | pricing page, Stripe checkout | 🟡 | sign-in глючит с первого раза (!), нет trial/freemium-механики, нет страницы «proof» |
| 5 | Onboarding & Activation | wizard кампании | 🔴 | не измеряется time-to-value; «aha» (первый реальный отклик) не показывается ярко |
| 6 | Retention & Success | инбокс, Telegram-уведомления | 🔴 | **0 интервью = 0 ценности = churn 100%.** Нет health-score, нет churn-save |
| 7 | Monetization | Stripe, Pro/Unlimited $19.99+ | 🟢 | нет годового плана (промт 05), нет dunning-контроля |
| 8 | Finance & Metrics | admin/pmf | 🔴 | нет MRR/funnel-дашборда: signup→campaign→apply→reply→interview→paid |
| 9 | Team, Legal & Compliance | ToS? privacy? | 🟡 | проверить ToS/Privacy/GDPR-минимум перед маркетингом (промт 09) |

**Вывод по архитектуре:** код реорганизовывать НЕ нужно — блоки уже совпадают с подсистемами карты (сорсинг/фильтр/apply = Product; Stripe = Monetization; inbox = Retention; seo-страницы = Acquisition). Чего не хватает — **метрик и связки в флайвил**, а не перестановки папок. Единственная структурная правка: добавить `docs/SUBSYSTEMS.md` — индекс «подсистема карты → файлы кода → её метрика» (входит в промт 09).

## 3. Корень проблемы: 300 откликов, 0 интервью

Бенчмарки рынка: в среднем **~1 интервью на 40–50 откликов** (2–3%); у Sonara-пользователей 0–5%. На 300 откликов матожидание — **6–9 интервью**. Ноль — это не «не повезло», это структурная причина. Диагноз по коду:

1. **Право на работу — главный убийца.** `lib/eligibility.ts`: `if (job.isRemote) return null` — remote-вакансии **всегда проходят гейт**. Но большинство «remote» вакансий US-компаний легально нанимают только в US/EU. Worker честно отвечает на screening «нужна ли спонсорская виза» → **авто-реджект ATS до того, как человек увидел резюме**. Профиль `willingToRelocate=true, remoteOnly=false` усугубляет: подаёмся и на on-site.
2. **Часть из 300 ушла с битыми контактами** — баг с телефоном (intl-tel-input) и реальными данными из `resume.input` починен недавно. Эти отклики потеряны безвозвратно.
3. **Resume Quality V2 собран, но флаг мог быть не включён на VPS** (`RESUME_QUALITY_V2=true` в `/opt/resumeai/.env` — последний пункт промта 02 «Next step»). Если флаг выключен — все 300 ушли со старым «generic AI» резюме.
4. **Гиперконкурентный сегмент:** remote-global роли собирают 250+ откликов; AND-match по заголовку не контролирует седьмой грейд/seniority.
5. **Нет funnel-телеметрии:** мы не знаем, на каком шаге умирают отклики (не дошло / реджект / молчание).

**Решение** — промт `10-interview-conversion-engine.md`: remote-вакансии фильтровать по hiring-региону, предсказывать screening-нокаут ДО подачи, включить и проверить V2-резюме, поднять порог фита, добавить воронку статусов и follow-up. Честная цель: **первые ответы рекрутёров за 2–5 дней, интервью за 2–3 недели** — «интервью за 2 дня» как гарантию рынок не выдаст ни у кого, и это нельзя обещать публично (FTC).

## 4. Конкуренты и УТП

| Игрок | Цена | Слабость (из отзывов) |
|---|---|---|
| Simplify+ (1.8M юзеров, 300M заявок) | $39.99/мес | generic AI-резюме «стыдно отправлять» |
| Sonara (~$1.8M ARR) | $23.95/мес | галлюцинации резюме, дубли вакансий |
| LazyApply | lifetime | 2.4★ Trustpilot: не работает, рефанды игнорируют |
| JobCopilot | $56/мес Elite | спам-объёмы, нет free tier |
| Teal | $29/мес | только трекер, не подаёт заявки |

Все продают **объём**. Никто не продаёт **попадание**.

**Наше УТП: «Мы не сжигаем твои шансы».**
> *Every application we send is one you can actually win. Eligibility-checked, ATS-verified, tailored — or we don't send it. First recruiter replies in days, not months. 30-day money-back.*

Три опоры, которые уже в коде и которых нет у конкурентов: (1) честный eligibility-гейт — не подаём туда, где юзер юридически не может выиграть; (2) `_verify_submitted` — доказанный факт отправки, не «кликнули кнопку»; (3) встроенный инбокс ответов с классификацией — юзер видит результат, а не лог отправок. Это и есть anti-LazyApply позиционирование.

## 5. Бесплатный маркетинг (ежедневная генерация клиентов)

1. **Программное SEO** — уже есть страницы; промт 12 добавляет sitemap/метатеги/Schema.org, страницы «{tool} alternative» под слабости конкурентов (LazyApply refund, Sonara hallucinations) и индексацию в GSC.
2. **Каталоги и комьюнити** — план уже написан в `docs/marketing/` (Product Hunt, Reddit, директории) — исполнять после фикса §3, не раньше.
3. **Referral** (промт 07) — «1 бесплатный месяц за друга»: единственный канал с CAC≈0.
4. **Public proof-страница** — живой счётчик «заявок отправлено / ответов получено / интервью» (честный, из БД). Это контент, который шарят.
5. **Бесплатный лид-магнит:** «проверь, на сколько % твоё резюме проходит ATS» — уже есть jobfit-скоринг, обернуть в публичную страницу → email → воронка.

## 6. План до $10k MRR (порядок строгий)

| Неделя | Действие | Промт |
|---|---|---|
| 1 | Полный аудит системы + e2e юзер-путь (sign-in баг!) | 09, 11 |
| 1–2 | Interview Conversion Engine + включить V2 | 10 |
| 2 | Свой аккаунт как dogfood: добиться первых интервью-инвайтов, скриншоты = proof | — |
| 3 | SEO/рост-автоматизация + proof-страница + лид-магнит | 12 |
| 3–4 | Product Hunt + Reddit + директории (`docs/marketing/`) | — |
| 4+ | Referral + годовой план | 07, 05 |

$10k MRR по Route A карты = **~500 платящих по $19.99**. При конверсии visitor→paid 1–2% это 25–50k визитов/мес — без платного трафика реально только через SEO+referral+PH-всплеск, горизонт честно 2–4 месяца, не один. Для инвесторов важнее не $10k, а **график week-over-week роста и interview-rate продукта** — это и готовим.

**Сначала продукт доставляет интервью (хотя бы себе), потом маркетинг. Иначе любой трафик = leaky bucket (Stage 3 risk из карты).**

---

## Источники
- [Jobscan: auto-apply tools 2026](https://www.jobscan.co/blog/auto-apply-job-tools/)
- [ResuTrack: applications per interview benchmarks 2026](https://resutrack.com/blog/how-many-job-applications-to-get-interview-2026)
- [Sprad: JobCopilot alternatives / spam problem](https://sprad.io/blog/top-5-jobcopilot-alternatives-for-smarter-less-spammy-ai-job-applications)
- [Simplify pricing review](https://jobhire.ai/blog/simplify-jobs-review)
- [LazyApply Trustpilot](https://www.trustpilot.com/review/lazyapply.com)
- внутренние: `docs/strategy/STRATEGIC_ANALYSIS.md`, `docs/qa/launch_readiness_2026-05.md`
