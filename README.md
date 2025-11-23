# Micro SaaS Starter Kit

A production-ready boilerplate for launching subscription-based web tools with Stripe and Next.js.

## Features

- **Next.js 14** with App Router and TypeScript
- **Authentication** with NextAuth.js (Google & GitHub OAuth)
- **Payments** with Stripe (subscriptions, billing portal, webhooks)
- **Database** with Prisma and PostgreSQL
- **Styling** with Tailwind CSS and Radix UI components
- **Fully Responsive** design
- **Production Ready** with proper error handling and security

## Tech Stack

- **Framework**: Next.js 14
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js
- **Payments**: Stripe
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Deployment**: Vercel (recommended)

## Getting Started

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (local or hosted)
- Stripe account
- Google OAuth credentials (optional)
- GitHub OAuth credentials (optional)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd Micro-SaaS-Starter-Kit
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/microsaas?schema=public"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# OAuth Providers
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GITHUB_ID="your-github-client-id"
GITHUB_SECRET="your-github-client-secret"

# Stripe
STRIPE_PUBLIC_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Stripe Price IDs (create these in your Stripe dashboard)
STRIPE_PRICE_ID_BASIC="price_..."
STRIPE_PRICE_ID_PRO="price_..."
STRIPE_PRICE_ID_ENTERPRISE="price_..."

# App Config
NEXT_PUBLIC_APP_NAME="Micro SaaS"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

4. Set up the database:
```bash
npm run db:push
```

5. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your app.

## Stripe Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)

2. Create your subscription products and prices in the Stripe Dashboard

3. Set up webhooks:
   - For local development: `npm run stripe:listen`
   - For production: Add your webhook endpoint at `https://your-domain.com/api/webhooks/stripe`
   - Required events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`

4. Update your `.env` file with the Stripe keys and price IDs

## OAuth Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID and Client Secret to `.env`

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Homepage URL: `http://localhost:3000`
4. Set Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
5. Copy Client ID and Client Secret to `.env`

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/    # NextAuth.js routes
│   │   ├── stripe/                 # Stripe checkout & portal
│   │   └── webhooks/stripe/        # Stripe webhooks
│   ├── dashboard/                  # Protected dashboard pages
│   ├── login/                      # Login page
│   ├── pricing/                    # Pricing page
│   └── page.tsx                    # Landing page
├── components/
│   ├── ui/                         # Reusable UI components
│   ├── navbar.tsx                  # Navigation bar
│   └── pricing-cards.tsx           # Pricing cards component
├── lib/
│   ├── auth.ts                     # NextAuth configuration
│   ├── prisma.ts                   # Prisma client
│   ├── stripe.ts                   # Stripe helpers
│   ├── subscription.ts             # Subscription logic
│   └── utils.ts                    # Utility functions
├── prisma/
│   └── schema.prisma               # Database schema
└── types/
    └── next-auth.d.ts              # NextAuth type extensions
```

## Database Schema

The app uses a PostgreSQL database with the following main tables:

- **User**: User accounts with Stripe customer info
- **Account**: OAuth account connections
- **Session**: User sessions
- **VerificationToken**: Email verification tokens

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import your repository in Vercel
3. Add environment variables
4. Deploy!

### Other Platforms

This is a standard Next.js app and can be deployed to any platform that supports Node.js:

- Railway
- Render
- DigitalOcean App Platform
- AWS Amplify
- etc.

## Environment Variables for Production

Make sure to update these for production:

- `NEXTAUTH_URL`: Your production domain
- `NEXT_PUBLIC_APP_URL`: Your production domain
- `STRIPE_PUBLIC_KEY`: Your live Stripe public key
- `STRIPE_SECRET_KEY`: Your live Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Your production webhook secret
- `STRIPE_PRICE_ID_*`: Your live Stripe price IDs

## Customization

### Branding

1. Update `NEXT_PUBLIC_APP_NAME` in `.env`
2. Replace logo and images in the landing page
3. Customize colors in `tailwind.config.ts`

### Subscription Plans

Edit `lib/subscription.ts` to modify:
- Plan names, prices, and features
- Usage limits
- Plan comparison

### Features

Add your SaaS features by:
1. Creating new pages in `app/`
2. Adding API routes in `app/api/`
3. Updating the database schema in `prisma/schema.prisma`

## Security Best Practices

- ✅ Environment variables for secrets
- ✅ HTTPS in production (handled by hosting platform)
- ✅ Stripe webhook signature verification
- ✅ NextAuth.js for secure authentication
- ✅ Database connection pooling with Prisma
- ✅ Server-side session validation
- ✅ CSRF protection (built into NextAuth)

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:push` - Push database schema changes
- `npm run db:studio` - Open Prisma Studio
- `npm run stripe:listen` - Listen to Stripe webhooks locally

## Support

For issues and questions:
- Check the [documentation](https://nextjs.org/docs)
- Review [Stripe docs](https://stripe.com/docs)
- Check [NextAuth.js docs](https://next-auth.js.org)

## License

MIT License - feel free to use this for your own projects!

## Credits

Built with:
- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Stripe](https://stripe.com)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [Radix UI](https://radix-ui.com)
