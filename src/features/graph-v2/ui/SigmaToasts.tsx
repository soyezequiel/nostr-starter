'use client'

export interface SigmaToast {
  id: string
  msg: string
  tone?: 'warn' | 'bad' | 'zap' | 'default'
}

interface Props {
  toasts: SigmaToast[]
}

export function SigmaToasts({ toasts }: Props) {
  if (toasts.length === 0) return null

  return (
    <div className="sg-toasts">
      {toasts.map((t) => (
        <div
          className={`sg-toast${t.tone && t.tone !== 'default' ? ` sg-toast--${t.tone}` : ''}`}
          key={t.id}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}
