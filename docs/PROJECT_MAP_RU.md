# ResumeAI — карта проекта (для Claude Cowork)

> Единый обзор всей системы: где лежит код, где прод, из каких блоков состоит,
> как деплоится. Прочитай это первым, чтобы понимать всю систему целиком.
> Дата: 2026-06-10.

---

## 1. ГДЕ НАСТОЯЩИЙ ПРОЕКТ (это важно)

| | Путь / адрес |
|---|---|
| **Активный репозиторий (ВЕСЬ актуальный код)** | `/Users/maksimabramov/code/Micro-SaaS-Starter-Kit` |
| **GitHub** | `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit`, ветка `main` |
| **Прод-сайт** | https://resumeai-bot.ru |
| **Прод-сервер (VPS)** | Hetzner CX23 (2 vCPU / 4 GB), `root@178.105.185.214` |
| **Папка приложения на сервере** | `/opt/resumeai` (Docker Compose) |

⚠️ **НЕ путать:** папка `/Users/maksimabramov/resume-ai-bot` — это **СТАРЫЙ отдельный
Telegram-бот** (Python, `analytics_tracker.py`, `autoapply/` и т.д.). Он НЕ связан с
текущим продуктом и **не используется**. Весь актуальный проект — только в
`~/code/Micro-SaaS-Starter-Kit`. (Терминал иногда сбрасывает cwd в `~/resume-ai-bot`
— это просто рабочая директория сессии, а не место проекта.)

---

## 2. ЧТО ЭТО ЗА ПРОДУКТ

**ResumeAI** — живой SaaS, который **автоматически откликается на вакансии** за
кандидата (auto-apply) и **ловит ответы рекрутёров** во встроенный инбокс.
Модель оплаты — **только Stripe** (подписка Pro/Unlimited, $19.99/мес и выше).

Поток пользователя: регистрация (Google/GitHub) → создаёт резюме → создаёт
кампанию авто-отклика (ключевые слова, локации, профиль права на работу) → крон
каждый запуск ищет вакансии, фильтрует по совпадению/праву на работу/скору
соответствия и подаёт заявки через безголовый браузер → ответы рекрутёров
приходят на inbox-адрес и классифицируются → видны в дашборде.

---

## 3. АРХИТЕКТУРА (стек и контейнеры)

Один VPS, **Docker Compose**, 7 контейнеров (`docker-compose.yml`):

```
┌─────────────────────────────────────────────────────────────┐
│  caddy            — reverse-proxy + TLS (resumeai-bot.ru)     │
│   ├── web         — Next.js 16 (App Router) — сайт, API, дашборд │
│   └── worker      — Python FastAPI + Playwright — авто-отклик/скрейпинг │
│  postgres         — PostgreSQL (основная БД, Prisma)          │
│  redis            — очереди/локи/кэш (лок крона, run-summary) │
│  notifier         — отправка уведомлений (Telegram и т.п.)    │
│  uptime-kuma      — мониторинг аптайма                        │
└─────────────────────────────────────────────────────────────┘
```

- **Web (Next.js 16, TypeScript)** — фронт (лендинг, дашборд, биллинг) + все API-роуты + крон-оркестратор авто-отклика. Каталог `app/`, `lib/`, `components/`.
- **Worker (Python, FastAPI, Playwright)** — реально заполняет и отправляет формы заявок (CareerOps-движок) и скрейпит вакансии. Каталог `worker/`.
- **БД:** PostgreSQL через **Prisma** (`prisma/schema.prisma`, **30 моделей**).
- **Redis:** лок от двойного запуска крона, сохранение сводки запуска, кэш.

---

## 4. КАРТА КОДА (где какой блок лежит)

### Web — `/Users/maksimabramov/code/Micro-SaaS-Starter-Kit`
```
app/
  page.tsx                 — лендинг (главная)
  pricing/ login/ dashboard/  — страницы (дашборд, инбокс, биллинг, настройки)
  api/
    cron/run-campaigns/route.ts  — ⭐ ГЛАВНЫЙ ОРКЕСТРАТОР авто-отклика
    stripe/  webhooks/stripe/    — чекаут + вебхуки Stripe
    inbox/inbound/route.ts       — приём входящих писем (ответы рекрутёров)
    admin/ campaigns/ resumes/ teardown/ lead/ ...  — прочие API
  jobs-in/ auto-apply/ resume/ alternatives/ remote/  — программное SEO
lib/
  eligibility.ts           — фильтр права на работу + детект remote
  pricing.ts  stripe.ts  subscription.ts  quota.ts  — биллинг/тарифы
  run-campaigns-ops.ts     — лок/сводка запуска крона (Redis)
  inbox/classify.ts        — классификация писем (OpenAI)
  flags.ts                 — фиче-флаги (напр. jobfit_min_score = порог)
  proof.ts  seo-data.json  remote-guides.ts  — маркетинг/SEO-контент
prisma/schema.prisma       — 30 моделей БД (User, Resume, AutoApplyCampaign,
                              JobApplication, InboxMessage, FeatureFlag, ...)
components/  extension/  notifier/  scripts/  e2e/  __tests__/
```

### Worker — `worker/worker/`
```
main.py                    — FastAPI приложение
routes/jobs.py             — эндпоинты: /jobs/scrape/{board}, /jobs/autoapply/careerops,
                             /jobs/resolve-apply (резолв board→ATS), рендер резюме
autoapply/
  careerops.py             — ⭐ движок заполнения/отправки форм (Greenhouse/Lever/
                             Workable/Ashby/...); intl-tel-input телефон, email-код,
                             повторы заполнения, проверка факта отправки
  eligibility.py  common.py  linkedin.py
scrapers/                  — источники вакансий (по одному файлу на источник):
  greenhouse.py lever.py ashby.py  — ATS со списком компаний (заполнимые)
  remoteok.py wwr.py himalayas.py themuse.py adzuna.py arbeitnow.py  — борды (remote)
  recruitee.py personio.py  — EU SMB
  resolve.py               — резолв board-ссылок → реальный ATS apply-URL
ai/                        — генерация резюме/cover letter, скоринг соответствия (jobfit)
```

### Прод-сервер (`/opt/resumeai`)
- `.env` — все секреты (Stripe, OpenAI, Resend, БД, ENCRYPTION_KEY, CRON_SECRET, WORKER_SECRET …).
- `docker-compose.yml` + override. БД: `docker exec -i resumeai-db psql -U resumeai -d resumeai`.

---

## 5. ОСНОВНЫЕ БЛОКИ СИСТЕМЫ (функциональные)

1. **Сорсинг вакансий** — 11 скрейперов (ATS со списками компаний + remote-борды). Greenhouse кэшируется один раз за запуск.
2. **Фильтрация** — совпадение ключевых слов (AND: все слова в заголовке), отсечка по праву на работу (`eligibility.ts`), скор соответствия `jobfit` (порог через фиче-флаг `jobfit_min_score`, сейчас 65).
3. **Авто-отклик (CareerOps)** — `careerops.py` через Playwright реально заполняет формы и жмёт submit; подтверждает факт отправки (честный гейт `_verify_submitted`), проходит шаг email-кода (Greenhouse), повторяет заполнение обязательных полей.
4. **Инбокс/ответы** — входящие письма через Resend webhook → классификация (OpenAI) на INTERVIEW_REQUEST / REJECTION / QUESTION / AUTOMATED → видно в дашборде, нотификация в Telegram.
5. **Биллинг** — Stripe checkout + вебхуки + биллинг-портал; тарифы в `lib/pricing.ts`.
6. **Дашборд** — статус заявок, инбокс, fit-score, биллинг.
7. **Маркетинг/SEO** — программные страницы (jobs-in, auto-apply, resume, alternatives, remote), OG-картинки, лиды.
8. **Расширение Chrome** (`extension/`) — отдельный модуль (CTA на сайте через env).

---

## 6. КАК ДЕПЛОИТСЯ (CI/CD)

- **Деплой = push в `main`.** GitHub Actions `.github/workflows/deploy.yml` собирает Docker-образы (`ghcr.io/...resumeai-web` и `...-worker`, тег = git SHA) и по SSH разворачивает на VPS (~15–18 мин; долгая выкачка web-образа — это нормально).
- Гейты CI: `ci.yml` (build & lint + тесты), `codeql.yml`, проверка «No Cyrillic in source».
- Крон авто-отклика: `.github/workflows/run-campaigns.yml` дёргает `GET /api/cron/run-campaigns` (авторизация `Bearer CRON_SECRET`). Запуск идёт асинхронно через Next `after()`.

Полезные документы в репо: `docs/ARCHITECTURE.md`, `docs/HANDOFF.md`,
`docs/SCALING.md`, `docs/REPLIES_SETUP.md`, `README.md`, `worker/README.md`.

---

## 7. ВНЕШНИЕ СЕРВИСЫ

| Сервис | Зачем | Где настройки |
|---|---|---|
| **Stripe** (live) | Подписки/оплата | ключи в `/opt/resumeai/.env`; вебхук → `/api/webhooks/stripe`. ⚠️ У ключа был IP-allowlist на сервер `178.105.185.214` |
| **Resend** | Приём входящих писем (ответы) + отправка | `RESEND_API_KEY`; inbox-домен `inbox.resumeai-bot.ru` |
| **OpenAI** | Классификация писем, генерация резюме, заполнение полей | `OPENAI_API_KEY` (может быть OpenRouter-ключ + `OPENAI_BASE_URL`) |
| **Telegram** | Уведомления (новые ответы) | через `notifier` |
| **ATS public API** | Greenhouse / Lever / Ashby и др. — источники вакансий | без ключей |
| GitHub Actions + GHCR | CI/CD, хранение образов | секреты репо (VPS_HOST и т.д.) |

---

## 8. ТЕКУЩЕЕ СОСТОЯНИЕ (на 2026-06-10)

- Прод живой; платежи Stripe работают (checkout + вебхуки проверены).
- Таргетинг исправлен: AND-совпадение ключевых слов, порог fit=65, источники
  перебалансированы на remote-first компании, профиль кампаний — глобально-remote
  (`remoteOnly=false`, `willingToRelocate=true`).
- Авто-отклик подаёт заявки на релевантные роли; недавно починен баг с телефоном
  (intl-tel-input) и передачей реальных контактных данных из `resume.input`.
- Инбокс ловит ответы людей (есть реальные REJECTION/QUESTION).

**Жёсткие ограничения проекта (соблюдать):** только Docker Compose на одном VPS
(без SQS/RabbitMQ/второй БД); оплата только Stripe; не публиковать фейковые отзывы
(FTC); на скрининг-вопросы отвечать честно по профилю права на работу; Ashby-apply
заблокирован (бот-защита) — используется только как источник.
