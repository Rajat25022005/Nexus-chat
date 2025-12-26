import type { ReactNode } from "react"

type SocialButtonProps = {
  icon: ReactNode
  text: string
}

export default function SocialButton({ icon, text }: SocialButtonProps) {
  return (
    <button
      className="flex w-full items-center justify-center gap-3 rounded-lg
                 bg-[#1c1c1c] py-3 text-sm text-nexus-text
                 hover:bg-[#222] transition"
    >
      <span className="text-lg">{icon}</span>
      {text}
    </button>
  )
}
