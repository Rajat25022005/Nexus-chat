import { Component } from "react"
import type { ReactNode } from "react"

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("Error boundary caught error:", error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen items-center justify-center bg-nexus-bg">
                    <div className="max-w-md rounded-lg bg-red-50 p-6 text-center">
                        <h2 className="mb-2 text-xl font-bold text-red-800">Something went wrong</h2>
                        <p className="mb-4 text-red-600">
                            {this.state.error?.message || "An unexpected error occurred"}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
