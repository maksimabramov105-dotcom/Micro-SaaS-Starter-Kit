import { Navbar } from '@/components/navbar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const changelog = [
  {
    version: '1.0.0',
    date: 'January 2024',
    changes: [
      { type: 'feature', text: 'Initial release with full authentication system' },
      { type: 'feature', text: 'Stripe subscription integration' },
      { type: 'feature', text: 'API key management system' },
      { type: 'feature', text: 'User dashboard and settings' },
      { type: 'feature', text: 'Admin analytics dashboard' },
      { type: 'feature', text: 'Email notifications with Resend' },
      { type: 'feature', text: 'Rate limiting for API endpoints' },
      { type: 'feature', text: 'Activity logging and analytics' },
      { type: 'feature', text: 'Responsive design with Tailwind CSS' },
      { type: 'feature', text: 'Production-ready deployment configuration' },
    ],
  },
]

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-4">Changelog</h1>
            <p className="text-lg text-gray-500">
              All notable changes to this project will be documented here.
            </p>
          </div>

          <div className="space-y-8">
            {changelog.map((release) => (
              <Card key={release.version}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Version {release.version}</CardTitle>
                    <Badge variant="outline">{release.date}</Badge>
                  </div>
                  <CardDescription>Latest updates and improvements</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {release.changes.map((change, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <Badge
                          variant={
                            change.type === 'feature'
                              ? 'default'
                              : change.type === 'fix'
                              ? 'destructive'
                              : 'secondary'
                          }
                          className="mt-0.5"
                        >
                          {change.type}
                        </Badge>
                        <span>{change.text}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
