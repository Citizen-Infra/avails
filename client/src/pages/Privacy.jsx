import Logo from '@/components/Logo'
export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-foreground">Avails</span>
          </a>
          <nav className="flex items-center gap-6 text-base text-foreground-secondary">
            <a href="/about" className="hover:text-foreground transition-colors">About</a>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <h1 className="text-4xl font-bold text-foreground tracking-tight">Privacy Policy</h1>
        <p className="text-base text-foreground-secondary">Last updated: October 28, 2026</p>

        <div className="space-y-6 text-base text-foreground leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What avails does</h2>
            <p>Avails is an open-source group scheduling tool built on the AT Protocol. It helps people find meeting times that work for everyone.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Data storage</h2>
            <p>Your scheduling polls are stored as records in your AT Protocol Personal Data Server (PDS) — the same place your Bluesky posts live. Avails does not operate a centralized database. Your data belongs to you.</p>
            <p>Participant responses (name, availability slots, optional email) are stored in the poll creator's PDS.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Authentication</h2>
            <p>Avails uses AT Protocol OAuth for sign-in. Your Bluesky credentials are never shared with avails — authentication is handled by your PDS provider. We store an OAuth session token on our server to write records on your behalf.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Google Calendar</h2>
            <p>If you choose to connect your Google Calendar, avails requests read-only access to check your busy times. Calendar data is processed in your browser and never sent to our server or stored anywhere. You can disconnect at any time by revoking access in your <a href="https://myaccount.google.com/permissions" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">Google Account settings</a>.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Email</h2>
            <p>If you provide your email address when responding to a poll, it is used solely to send you a calendar invite (.ics file) when a meeting time is finalized. We do not use your email for marketing or share it with third parties.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Cookies</h2>
            <p>Avails uses an HTTP-only session cookie to maintain your sign-in state. Your optional analytics choice is saved in your browser’s local storage. If you allow analytics, a random identifier held only in page memory links events during the current page session. It is not linked to your account, changes on reload and is discarded when you turn analytics off. No analytics identifier is saved in cookies or browser storage.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Optional product analytics</h2>
            <p>Only after you choose “Allow analytics,” Avails sends a small set of usage events directly to PostHog’s US service: broad page categories, successful poll creation, response submission and meeting finalization. We do not send poll IDs or content, availability, calendar data, names, emails, Bluesky identifiers, raw page URLs or referrers. There is no automatic click tracking, session replay or account identification.</p>
            <p>As with any direct connection, PostHog receives network information such as your IP address and browser request headers. Event payloads use a placeholder IP and request no location enrichment or person profiles. This is limited, consent-based analytics—not a promise of complete anonymity.</p>
            <p>You can change your choice in “Optional usage analytics” at the bottom of any page. Turning analytics off stops new events, cancels pending requests and removes the tab’s analytics identifier; it cannot recall events already delivered. If browser storage is unavailable, your choice applies only to the current tab. Refusing does not limit scheduling.</p>
            <p>These measurements cover consenting browser sessions only. They do not track API/MCP activity, connect an organizer to other participants or measure all visits.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Cloudflare traffic and performance analytics</h2>
            <p>The hosting layer also includes a Cloudflare Web Analytics beacon for site traffic and performance measurements. It is separate from the optional PostHog setting above. See <a href="https://developers.cloudflare.com/web-analytics/about/" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">Cloudflare’s Web Analytics documentation</a> for its data-handling information.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Open source</h2>
            <p>Avails is open source under the AGPL-3.0 license. You can inspect exactly what the code does at <a href="https://github.com/Citizen-Infra/avails" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">github.com/Citizen-Infra/avails</a>.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>For privacy questions, open an issue on <a href="https://github.com/Citizen-Infra/avails/issues" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">GitHub</a> or contact hello@citizeninfra.org.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
