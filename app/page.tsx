import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">
          Land your next job faster
        </h1>
        <p className="mt-6 text-xl text-slate-500">
          AI-powered resume tailoring and auto-apply — built for serious job seekers.
        </p>
        <div className="mt-10">
          <Link
            href="/login"
            className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Get started
          </Link>
        </div>
      </div>
    </main>
  )
}
