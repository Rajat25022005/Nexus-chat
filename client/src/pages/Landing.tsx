import { useNavigate } from "react-router-dom"
import logo from "../assets/logo.svg"
import { ArrowRight, MessageSquare, Shield, Zap } from "lucide-react"

export default function Landing() {
    const navigate = useNavigate()

    return (
        <div className="min-h-screen bg-nexus-bg text-nexus-text flex flex-col">
            {/* Header */}
            <header className="px-6 py-4 flex items-center justify-between border-b border-nexus-border">
                <div className="flex items-center gap-2">
                    <img src={logo} alt="Nexus" className="h-8 w-8 rounded-md bg-nexus-primary p-1" />
                    <span className="font-bold text-xl">Nexus Chat</span>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate("/login")}
                        className="text-sm font-medium hover:text-nexus-primary transition"
                    >
                        Login
                    </button>
                    <button
                        onClick={() => navigate("/signup")}
                        className="px-4 py-2 bg-nexus-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition"
                    >
                        Get Started
                    </button>
                </div>
            </header>

            {/* Hero */}
            <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20">
                <div className="max-w-3xl space-y-6">
                    <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight">
                        Seamless Communication for <span className="text-nexus-primary px-2">Modern Teams</span>
                    </h1>
                    <p className="text-xl text-nexus-muted max-w-2xl mx-auto">
                        Experience real-time collaboration with AI-powered insights. Secure, fast, and designed for productivity.
                    </p>
                    <div className="flex items-center justify-center gap-4 pt-4">
                        <button
                            onClick={() => navigate("/signup")}
                            className="px-8 py-4 bg-nexus-primary text-white text-lg font-bold rounded-xl hover:opacity-90 transition flex items-center gap-2 shadow-lg shadow-nexus-primary/20"
                        >
                            Start Chatting Free <ArrowRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => navigate("/login")}
                            className="px-8 py-4 bg-nexus-card border border-nexus-border text-nexus-text text-lg font-bold rounded-xl hover:bg-nexus-input transition"
                        >
                            Existing User
                        </button>
                    </div>
                </div>

                {/* Features */}
                <div className="grid md:grid-cols-3 gap-8 mt-24 max-w-6xl w-full px-4">
                    <div className="p-6 bg-nexus-card rounded-2xl border border-nexus-border">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4 text-blue-400">
                            <MessageSquare className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Real-time Chat</h3>
                        <p className="text-nexus-muted">Instant messaging with rich media support and seamless group collaboration.</p>
                    </div>
                    <div className="p-6 bg-nexus-card rounded-2xl border border-nexus-border">
                        <div className="w-12 h-12 bg-emerald-500/10 rounded-lg flex items-center justify-center mb-4 text-emerald-400">
                            <Zap className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">AI Powered</h3>
                        <p className="text-nexus-muted">Integrated AI assistant to help you summarize, generate, and analyze content on the fly.</p>
                    </div>
                    <div className="p-6 bg-nexus-card rounded-2xl border border-nexus-border">
                        <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4 text-purple-400">
                            <Shield className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Secure & Private</h3>
                        <p className="text-nexus-muted">Enterprise-grade security with end-to-end encryption for all your conversations.</p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="py-8 text-center text-sm text-nexus-muted border-t border-nexus-border">
                <p>© 2026 Nexus Chat. All rights reserved.</p>
            </footer>
        </div>
    )
}
