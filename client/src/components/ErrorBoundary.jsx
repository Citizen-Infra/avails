import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[avails] React error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-2xl font-bold text-[#1a1a1a]">Something went wrong</h2>
            <p className="text-base text-[#6b6560]">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2 rounded-lg bg-[#0d9488] text-white text-base font-medium hover:bg-[#0f766e] transition-colors"
              >
                Reload page
              </button>
              <a
                href="/"
                className="px-5 py-2 rounded-lg border border-[#e8e5df] text-base text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
