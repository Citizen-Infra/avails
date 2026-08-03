import Logo from '@/components/Logo'
export default function Terms() {
  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-[#1a1a1a]">avails</span>
          </a>
          <nav className="flex items-center gap-6 text-base text-[#6b6560]">
            <a href="/about" className="hover:text-[#1a1a1a] transition-colors">About</a>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <h1 className="text-4xl font-bold text-[#1a1a1a] tracking-tight">Terms of Service</h1>
        <p className="text-base text-[#6b6560]">Last updated: April 2, 2026</p>

        <div className="space-y-6 text-base text-[#1a1a1a] leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What this is</h2>
            <p>Avails is a free, open-source scheduling tool operated by <a href="https://github.com/Citizen-Infra" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">Citizen Infrastructure</a>. These terms cover your use of avails.citizeninfra.org, and of avails.zhgnv.com, which serves the same service.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Your data</h2>
            <p>Polls you create are stored in your AT Protocol PDS. You own your data. Avails acts as a client that reads and writes records on your behalf with your authorization. You can revoke access at any time.</p>
            <p>If you respond to a poll without signing in, your name and selected time slots are stored in the poll creator's PDS. If you provide an email, it is used only to send calendar invites.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Service availability</h2>
            <p>Avails is provided as-is. We make reasonable efforts to keep the service running but make no guarantees of uptime or availability. Since your data lives in your PDS (not on our servers), it is not lost if avails goes offline.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Acceptable use</h2>
            <p>Use avails for scheduling. Don't use it to spam, harass, or create polls with harmful content. We reserve the right to remove content or restrict access if necessary.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Google Calendar</h2>
            <p>Avails' use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Calendar data is processed in your browser only and is not stored or transmitted to our servers.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Open source</h2>
            <p>The avails source code is available under the AGPL-3.0 license at <a href="https://github.com/Citizen-Infra/avails" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">github.com/Citizen-Infra/avails</a>. You are free to self-host your own instance.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Changes</h2>
            <p>We may update these terms. Changes will be reflected on this page with an updated date. Continued use of avails after changes constitutes acceptance.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>Questions about these terms? Open an issue on <a href="https://github.com/Citizen-Infra/avails/issues" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">GitHub</a> or contact hello@zhgnv.com.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
