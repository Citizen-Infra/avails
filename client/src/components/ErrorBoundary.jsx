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
            <h2 className="text-2xl font-bold text-foreground">Something went wrong</h2>
            <p className="text-base text-foreground-secondary">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2 rounded-sm bg-primary text-primary-foreground text-base font-medium hover:bg-primary-hover transition-colors"
              >
                Reload page
              </button>
              <a
                href="/"
                className="px-5 py-2 rounded-sm border border-input text-base text-foreground-secondary hover:text-foreground transition-colors"
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
