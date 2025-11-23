# Micro SaaS Starter Kit 🚀

A **production-ready**, **enterprise-grade** boilerplate for launching subscription-based web tools with Stripe and Next.js. This starter kit includes everything you need to ship your SaaS product in days, not months.

[![CI](https://github.com/your-repo/actions/workflows/ci.yml/badge.svg)](https://github.com/your-repo/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

### 🔐 Authentication & User Management
- **NextAuth.js** with Google & GitHub OAuth
- Protected routes with middleware
- Session management with PostgreSQL
- User roles (admin, user)
- Activity logging

### 💳 Payments & Subscriptions
- **Stripe** integration (checkout, webhooks, billing portal)
- 4 subscription tiers (Free, Basic, Pro, Enterprise)
- Automatic subscription status tracking
- Usage-based billing ready
- Proration support

### 🗄️ Database & ORM
- **Prisma** ORM with PostgreSQL
- Complete schema (Users, Subscriptions, API Keys, Webhooks, Activity Logs)
- Type-safe database queries
- Automatic migrations

### 🎨 UI/UX
- **Tailwind CSS** + **Radix UI** components
- Responsive design (mobile-first)
- Dark mode ready
- Loading states & skeletons
- Toast notifications
- Beautiful landing page

### 🔑 API & Webhooks
- **API key management** system
- Bcrypt-hashed keys for security
- Webhook management (create, test, monitor)
- Rate limiting (per-user, per-endpoint)
- RESTful API structure

### 📊 Analytics & Admin
- **Admin dashboard** with key metrics
- User analytics & activity tracking
- Subscription metrics (MRR, conversion rate)
- **Vercel Analytics** integration
- **Speed Insights** monitoring

### 📧 Email & Notifications
- **Resend** email service
- Welcome emails
- Subscription confirmations
- Cancellation notifications
- Customizable templates

### 🧪 Testing & Quality
- **Jest** for unit tests
- **Playwright** for E2E tests
- **Prettier** code formatting
- **ESLint** with Next.js config
- **Husky** pre-commit hooks
- **lint-staged** for fast checks

### 🚢 DevOps & Deployment
- **GitHub Actions** CI/CD pipeline
- **Docker** & **Docker Compose** support
- **Vercel** deployment ready
- **Sentry** error tracking
- Production optimizations
- Standalone build output

### 🔒 Security
- Rate limiting on API routes
- Stripe webhook signature verification
- API key hashing with bcrypt
- Environment variable validation
- HTTPS enforcement (production)
- CSRF protection (NextAuth)

## 📦 Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (App Router) |
| **Language** | TypeScript |
| **Database** | PostgreSQL + Prisma ORM |
| **Authentication** | NextAuth.js |
| **Payments** | Stripe |
| **Styling** | Tailwind CSS + Radix UI |
| **Email** | Resend |
| **Error Tracking** | Sentry |
| **Analytics** | Vercel Analytics |
| **Testing** | Jest + Playwright |
| **CI/CD** | GitHub Actions |
| **Deployment** | Vercel / Docker |

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** installed
- **PostgreSQL** database (local or hosted)
- **Stripe** account
- **Google OAuth** credentials (optional)
- **GitHub OAuth** credentials (optional)

### Installation

1. **Clone the repository:**
```bash
git clone <your-repo-url>
cd Micro-SaaS-Starter-Kit
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#environment-variables))

4. **Set up the database:**
```bash
npm run db:push
```

5. **Run the development server:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

## 🔧 Environment Variables

<details>
<summary>Click to expand full configuration</summary>

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/microsaas?schema=public"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"

# OAuth Providers
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GITHUB_ID="your-github-client-id"
GITHUB_SECRET="your-github-client-secret"

# Stripe
STRIPE_PUBLIC_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_ID_BASIC="price_..."
STRIPE_PRICE_ID_PRO="price_..."
STRIPE_PRICE_ID_ENTERPRISE="price_..."

# Email
RESEND_API_KEY="re_..."
EMAIL_FROM="noreply@yourdomain.com"

# Error Tracking
NEXT_PUBLIC_SENTRY_DSN="https://..."
SENTRY_ORG="your-org"
SENTRY_PROJECT="your-project"

# App Config
NEXT_PUBLIC_APP_NAME="Micro SaaS"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

</details>

## 📂 Project Structure

```
├── app/                          # Next.js app directory
│   ├── api/                      # API routes
│   │   ├── auth/                 # NextAuth endpoints
│   │   ├── keys/                 # API key management
│   │   ├── stripe/               # Stripe checkout & portal
│   │   └── webhooks/             # Stripe webhooks
│   ├── dashboard/                # Protected dashboard
│   │   ├── admin/                # Admin dashboard
│   │   ├── api-keys/             # API key management UI
│   │   └── settings/             # User settings
│   ├── changelog/                # Public changelog
│   ├── faq/                      # FAQ page
│   ├── login/                    # Login page
│   ├── pricing/                  # Pricing page
│   └── page.tsx                  # Landing page
├── components/                   # React components
│   ├── ui/                       # UI components (Button, Card, etc.)
│   ├── navbar.tsx                # Navigation
│   └── pricing-cards.tsx         # Pricing cards
├── lib/                          # Utility functions
│   ├── analytics.ts              # Analytics helpers
│   ├── api-keys.ts               # API key management
│   ├── auth.ts                   # NextAuth config
│   ├── email.ts                  # Email service
│   ├── prisma.ts                 # Prisma client
│   ├── rate-limit.ts             # Rate limiting
│   ├── stripe.ts                 # Stripe helpers
│   ├── subscription.ts           # Subscription logic
│   └── utils.ts                  # General utilities
├── prisma/                       # Database
│   └── schema.prisma             # Database schema
├── e2e/                          # E2E tests
├── .github/workflows/            # GitHub Actions
├── docker-compose.yml            # Docker Compose config
├── Dockerfile                    # Docker image
└── README.md                     # You are here
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# Unit tests (watch mode)
npm test

# E2E tests
npm run test:e2e

# E2E tests (UI mode)
npm run test:e2e:ui
```

## 🐳 Docker

### Using Docker Compose (Recommended)

```bash
# Start all services (app + database)
npm run docker:up

# Stop all services
npm run docker:down
```

### Building Docker Image

```bash
docker build -t micro-saas .
docker run -p 3000:3000 micro-saas
```

## 🚢 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import repository in [Vercel](https://vercel.com)
3. Add environment variables
4. Deploy! 🎉

### Other Platforms

Works with any platform supporting Node.js:
- Railway
- Render
- DigitalOcean App Platform
- AWS Amplify
- Fly.io

## 📝 Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run type-check` | TypeScript type checking |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |
| `npm run db:push` | Push database schema |
| `npm run db:studio` | Open Prisma Studio |
| `npm run stripe:listen` | Listen to Stripe webhooks |

## 🔐 API Key Usage

Users can generate API keys from `/dashboard/api-keys`:

```bash
curl -H "Authorization: Bearer sk_..." \
  https://your-domain.com/api/your-endpoint
```

## 📊 Admin Dashboard

Access admin features at `/dashboard/admin` (requires admin role):
- Total users & active subscriptions
- Conversion rates & MRR
- Recent user signups
- Users by plan distribution

## 🎨 Customization

### Branding

1. Update `NEXT_PUBLIC_APP_NAME` in `.env`
2. Replace colors in `tailwind.config.ts`
3. Update logo and images

### Subscription Plans

Edit `lib/subscription.ts` to customize:
- Plan names & prices
- Features list
- Usage limits

### Email Templates

Modify email templates in `lib/email.ts`

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with amazing open-source tools:
- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Stripe](https://stripe.com)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [Radix UI](https://radix-ui.com)

## 📞 Support

- 📧 Email: support@example.com
- 💬 Discord: [Join our community](#)
- 📚 Docs: [Read the docs](#)
- 🐛 Issues: [GitHub Issues](https://github.com/your-repo/issues)

## ⭐ Star History

If you find this project helpful, please consider giving it a star!

---

**Made with ❤️ for the SaaS community**
