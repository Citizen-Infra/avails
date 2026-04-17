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

        {/* AI Assistant */}
        <section className="py-16">
          <p className="text-sm font-medium text-[#0d9488] uppercase tracking-widest mb-4">
            AI-native scheduling
          </p>
          <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
            Create polls from<br />your AI assistant.
          </h2>
          <p className="text-xl text-[#6b6560] leading-relaxed mt-6 max-w-xl">
            Avails has a built-in{' '}
            <ExternalLink
              href="https://modelcontextprotocol.io"
              className="text-[#0d9488] hover:text-[#0f766e] underline underline-offset-2 decoration-[#0d9488]/30 hover:decoration-[#0d9488] transition-colors"
            >
              MCP
            </ExternalLink>
            {' '}endpoint. Connect it to Claude Code, Cursor, or any
            MCP-compatible tool and manage polls from your terminal.
          </p>

          <div className="mt-10 rounded-xl bg-[#f5f3f0] p-8">
            <p className="text-sm font-mono text-[#6b6560] mb-4">$ claude mcp add -s local -t http avails https://avails.zhgnv.com/mcp</p>
            <div className="grid sm:grid-cols-2 gap-6 mt-6">
              <div>
                <p className="text-sm font-semibold text-[#0d9488] uppercase tracking-wider mb-2">
                  What you can ask
                </p>
                <ul className="space-y-2 text-base text-[#6b6560]">
                  <li>"Create a poll for next week, 3-7pm"</li>
                  <li>"Who's available on Thursday?"</li>
                  <li>"Schedule at the best time and send invites"</li>
                  <li>"Share the poll to our Telegram group"</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0d9488] uppercase tracking-wider mb-2">
                  How it works
                </p>
                <p className="text-base text-[#6b6560] leading-relaxed">
                  You authenticate with your own Bluesky account. Polls are
                  created under your identity, stored in your PDS. No API keys,
                  no shared accounts — proper data ownership through the protocol.
                </p>
              </div>
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
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <Link to="/about" className="hover:text-[#6b6560] transition-colors">
              About
            </Link>
            <Link to="/privacy" className="hover:text-[#6b6560] transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-[#6b6560] transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
