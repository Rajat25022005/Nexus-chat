import logo from "../assets/logo.svg"

type AuthLayoutProps = {
  title: string
  subtitle: string
  children: React.ReactNode
}

export default function AuthLayout({
  title,
  subtitle,
  children,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-nexus-bg text-nexus-text">
      <div className="w-full max-w-md rounded-2xl bg-nexus-card p-8 shadow-xl">

        {/* Brand / Logo */}
        <div className="text-center mb-6">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center 
             rounded-xl bg-nexus-primary
             ring-1 ring-nexus-primary
             shadow-[0_0_18px_rgba(186,24,27,0.45)]"
            >
            <img
              src={logo}
              alt="Nexus logo"
              className="h-10 w-10 object-contain"
            />
</div>


          <h1 className="text-2xl font-semibold">Nexus</h1>
          <p className="text-sm text-nexus-muted">{subtitle}</p>
        </div>

        {/* Page title */}
        <h2 className="mb-4 text-lg font-medium">{title}</h2>

        {/* Page content */}
        {children}

      </div>
    </div>
  )
}
