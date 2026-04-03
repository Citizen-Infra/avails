import Logo from '@/components/Logo'
import { Link } from 'react-router'

function ExternalLink({ href, children, className = '' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  )
}

function ProjectCard({ title, description, href }) {
  return (
    <ExternalLink
      href={href}
      className="group block rounded-xl border border-[#e8e5df] bg-white p-6 hover:border-[#0d9488] transition-all duration-200 hover:shadow-[0_2px_16px_rgba(13,148,136,0.08)]"
    >
      <h3 className="text-lg font-semibold text-[#1a1a1a] group-hover:text-[#0d9488] transition-colors">
        {title}
      </h3>
      <p className="text-base text-[#6b6560] mt-2 leading-relaxed">{description}</p>
      <span className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-[#0d9488] opacity-0 group-hover:opacity-100 transition-opacity">
        View on GitHub
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3l5 5-5 5" />
        </svg>
      </span>
    </ExternalLink>
  )
}

export default function About() {
  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <header className="border-b border-[#e8e5df]">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-xl font-bold tracking-tight text-[#1a1a1a]">avails</span>
          </Link>
          <nav className="flex items-center gap-6 text-base text-[#6b6560]">
            <span className="text-[#1a1a1a] font-medium">About</span>
            <ExternalLink
              href="https://github.com/Citizen-Infra/avails"
              className="hover:text-[#1a1a1a] transition-colors"
            >
              GitHub
            </ExternalLink>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6">
        {/* Hero */}
        <section className="pt-20 pb-16">
          <p className="text-sm font-medium text-[#0d9488] uppercase tracking-widest mb-6">
            Open-source scheduling
          </p>
          <h1 className="text-5xl sm:text-6xl font-bold text-[#1a1a1a] tracking-tight leading-[1.08]">
            Your calendar,<br />your data,<br />
            <span className="text-[#0d9488]">your protocol.</span>
          </h1>
          <p className="text-xl text-[#6b6560] leading-relaxed mt-8 max-w-xl">
            Avails is group scheduling on the AT Protocol. Your polls live in
            your Bluesky account — no lock-in, no centralized database. No
            account needed to respond — just open the link and paint your
            availability.
          </p>
        </section>

        {/* Divider */}
        <div className="border-t border-[#e8e5df]" />

        {/* Why ATProto */}
        <section className="py-16">
          <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Why ATProto
          </h2>
          <div className="mt-10 grid sm:grid-cols-2 gap-x-12 gap-y-8">
            <div>
              <p className="text-base text-[#6b6560] leading-relaxed">
                Most scheduling tools store your data on their servers. If they
                shut down, your data is gone. Avails stores polls as records in
                your Personal Data Server (PDS) — the same place your Bluesky
                posts live.
              </p>
            </div>
            <div>
              <p className="text-base text-[#6b6560] leading-relaxed">
                The poll format is an open schema (Lexicon) — anyone can build
                another client that reads the same data. Your identity is your
                Bluesky handle — portable across every ATProto app.
              </p>
            </div>
          </div>

          {/* Pull quote */}
          <div className="mt-12 border-l-4 border-[#0d9488] pl-8 py-2">
            <p className="text-2xl font-semibold text-[#1a1a1a] leading-snug tracking-tight">
              Data portability is not a feature.
              <br />
              It is a right.
            </p>
          </div>

          {/* Protocol details */}
          <div className="mt-12 rounded-xl bg-[#f5f3f0] p-8">
            <div className="grid sm:grid-cols-3 gap-8">
              <div>
                <p className="text-sm font-semibold text-[#0d9488] uppercase tracking-wider mb-2">
                  Identity
                </p>
                <p className="text-base text-[#1a1a1a] font-medium">Your Bluesky handle</p>
                <p className="text-sm text-[#6b6560] mt-1">
                  Portable across every ATProto app
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0d9488] uppercase tracking-wider mb-2">
                  Storage
                </p>
                <p className="text-base text-[#1a1a1a] font-medium">Your Personal Data Server</p>
                <p className="text-sm text-[#6b6560] mt-1">
                  Same repo as your Bluesky posts
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0d9488] uppercase tracking-wider mb-2">
                  Schema
                </p>
                <p className="text-base text-[#1a1a1a] font-medium">Open Lexicon format</p>
                <p className="text-sm text-[#6b6560] mt-1">
                  Build your own client — same data
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-[#e8e5df]" />

        {/* Citizen Infrastructure */}
        <section className="py-16">
          <p className="text-sm font-medium text-[#0d9488] uppercase tracking-widest mb-4">
            Citizen Infrastructure
          </p>
          <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Forging digital pitchforks<br />against techno-feudalism.
          </h2>
          <p className="text-xl text-[#6b6560] leading-relaxed mt-6 max-w-xl">
            Avails is part of{' '}
            <ExternalLink
              href="https://github.com/Citizen-Infra"
              className="text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2 decoration-[#0d9488]/30 hover:decoration-[#0d9488] transition-colors"
            >
              Citizen Infrastructure
            </ExternalLink>
            {' '}— a collective building community tools on open protocols. Tools
            that teach collective action through use.
          </p>

          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            <ProjectCard
              title="My Community"
              description="Online community dashboard as a new tab — Bluesky feeds, Telegram and Slack digests, participation opportunities."
              href="https://github.com/Citizen-Infra/my-community"
            />
            <ProjectCard
              title="Dear Neighbors"
              description="Neighborhood dashboard. Local information, community resources, and civic participation in one place."
              href="https://github.com/Citizen-Infra/dear-neighbors"
            />
            <ProjectCard
              title="Navidrome Jam"
              description="Synchronized music listening for communities. Start a session, everyone hears the same track at the same time."
              href="https://github.com/Citizen-Infra/navidrome-jam"
            />
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-[#e8e5df]" />

        {/* My Community integration */}
        <section className="py-16">
          <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Works with My Community
          </h2>
          <div className="mt-8 rounded-xl border border-[#e8e5df] bg-white p-8 sm:flex sm:items-start sm:gap-8">
            <div className="shrink-0 w-12 h-12 rounded-lg bg-[#ccfbf1] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <p className="text-base text-[#6b6560] leading-relaxed mt-4 sm:mt-0">
                Avails polls show up in{' '}
                <ExternalLink
                  href="https://github.com/Citizen-Infra/my-community"
                  className="text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2 decoration-[#0d9488]/30 hover:decoration-[#0d9488] transition-colors"
                >
                  My Community
                </ExternalLink>
                's participation feed. When your community has an open scheduling
                poll, it appears as a banner alongside events and sessions —
                making collective coordination visible where people already look.
              </p>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-[#e8e5df]" />

        {/* Open Source */}
        <section className="py-16">
          <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Open source, open data
          </h2>
          <p className="text-base text-[#6b6560] leading-relaxed mt-6 max-w-xl">
            AGPL-3.0 license. The code is yours. Read it, fork it, run your own
            instance, build something better. That is the point.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <ExternalLink
              href="https://github.com/Citizen-Infra/avails"
              className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-[#1a1a1a] text-white text-base font-medium hover:bg-[#333] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              View on GitHub
            </ExternalLink>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            {['React', 'Vite', 'Tailwind', 'shadcn/ui', 'Express', '@atproto/lex'].map(
              (tech) => (
                <span
                  key={tech}
                  className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#f5f3f0] text-[#6b6560] border border-[#e8e5df]"
                >
                  {tech}
                </span>
              )
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e8e5df] mt-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between text-base text-[#a09a94]">
          <span>Built on ATProto</span>
          <div className="flex items-center gap-6">
            <Link to="/about" className="hover:text-[#6b6560] transition-colors">
              About
            </Link>
            <ExternalLink
              href="https://github.com/Citizen-Infra/avails"
              className="hover:text-[#6b6560] transition-colors"
            >
              GitHub
            </ExternalLink>
          </div>
        </div>
      </footer>
    </div>
  )
}
