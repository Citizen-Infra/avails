import Logo from '@/components/Logo'
export default function Privacy() {
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
        <h1 className="text-4xl font-bold text-[#1a1a1a] tracking-tight">Privacy Policy</h1>
        <p className="text-base text-[#6b6560]">Last updated: April 2, 2026</p>

        <div className="space-y-6 text-base text-[#1a1a1a] leading-relaxed">
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
            <p>If you choose to connect your Google Calendar, avails requests read-only access to check your busy times. Calendar data is processed in your browser and never sent to our server or stored anywhere. You can disconnect at any time by revoking access in your <a href="https://myaccount.google.com/permissions" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">Google Account settings</a>.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Email</h2>
            <p>If you provide your email address when responding to a poll, it is used solely to send you a calendar invite (.ics file) when a meeting time is finalized. We do not use your email for marketing or share it with third parties.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Cookies</h2>
            <p>Avails uses a single HTTP-only session cookie to maintain your sign-in state. No tracking cookies or analytics are used.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Open source</h2>
            <p>Avails is open source under the AGPL-3.0 license. You can inspect exactly what the code does at <a href="https://github.com/Citizen-Infra/avails" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">github.com/Citizen-Infra/avails</a>.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>For privacy questions, open an issue on <a href="https://github.com/Citizen-Infra/avails/issues" className="text-[#0d9488] underline underline-offset-2" target="_blank" rel="noopener noreferrer">GitHub</a> or contact hello@zhgnv.com.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
