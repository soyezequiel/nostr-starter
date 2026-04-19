'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

const burstParticles = [
  { id: 'spark-top', symbol: '✨', x: 0, y: -58, rotate: -10, size: 'text-sm' },
  { id: 'orange-left', symbol: '🍊', x: -52, y: -24, rotate: -28, size: 'text-base' },
  { id: 'spark-right', symbol: '✦', x: 52, y: -18, rotate: 24, size: 'text-sm' },
  { id: 'spark-bottom-right', symbol: '✨', x: 32, y: 38, rotate: 18, size: 'text-xs' },
  { id: 'orange-bottom', symbol: '🍊', x: -18, y: 46, rotate: 32, size: 'text-sm' },
  { id: 'spark-left', symbol: '✺', x: -44, y: 20, rotate: -34, size: 'text-xs' },
] as const

const githubThreshold = 20
const githubUrl = 'https://github.com/soyezequiel'
const surpriseLabels = ['Modo citrico', 'Naranja hack', 'Zest overload'] as const

export default function OrangeSurprise() {
  const shouldReduceMotion = useReducedMotion()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasOpenedGithubRef = useRef(false)
  const [isBursting, setIsBursting] = useState(false)
  const [burstCount, setBurstCount] = useState(0)
  const [clickCount, setClickCount] = useState(0)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const triggerSurprise = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    const nextClickCount = clickCount + 1
    setClickCount(nextClickCount)
    setBurstCount((current) => current + 1)
    setIsBursting(true)

    if (nextClickCount > githubThreshold && !hasOpenedGithubRef.current) {
      hasOpenedGithubRef.current = true
      window.open(githubUrl, '_blank', 'noopener,noreferrer')
    }

    timeoutRef.current = setTimeout(() => {
      setIsBursting(false)
    }, shouldReduceMotion ? 850 : 1600)
  }

  const surpriseLabel = surpriseLabels[burstCount % surpriseLabels.length]

  return (
    <span className="relative ml-1 inline-flex align-middle">
      <motion.button
        animate={
          isBursting
            ? shouldReduceMotion
              ? { scale: [1, 1.08, 1] }
              : { rotate: [0, -18, 16, -10, 0], scale: [1, 1.24, 0.92, 1.14, 1] }
            : { rotate: 0, scale: 1 }
        }
        aria-label="Activar sorpresa naranja"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-[1.45rem] leading-none outline-none focus-visible:ring-2 focus-visible:ring-[#ffb25c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070707]"
        onClick={triggerSurprise}
        transition={{
          duration: shouldReduceMotion ? 0.26 : 0.72,
          ease: [0.22, 1, 0.36, 1],
        }}
        type="button"
        whileHover={shouldReduceMotion ? undefined : { scale: 1.08, rotate: 8, y: -1 }}
        whileTap={shouldReduceMotion ? { scale: 0.96 } : { scale: 0.88, rotate: -12 }}
      >
        <span aria-hidden="true">🍊</span>
      </motion.button>

      <AnimatePresence>
        {isBursting ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 left-1/2 [transform:translateX(-50%)]"
            key={`label-${burstCount}`}
          >
            <motion.span
              animate={{ opacity: 1, y: shouldReduceMotion ? -8 : -16, scale: 1 }}
              className="block whitespace-nowrap rounded-full border border-[#ffb25c]/40 bg-[#140d08]/90 px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.24em] text-[#ffd7a1] shadow-[0_10px_34px_rgba(255,145,51,0.18)]"
              exit={{ opacity: 0, y: -26, scale: 0.9 }}
              initial={{ opacity: 0, y: 0, scale: 0.72 }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            >
              {surpriseLabel}
            </motion.span>
          </span>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isBursting && !shouldReduceMotion ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 [transform:translate(-50%,-50%)]"
            key={`burst-${burstCount}`}
          >
            {burstParticles.map((particle, index) => (
              <motion.span
                animate={{
                  opacity: [0, 1, 0],
                  x: particle.x,
                  y: particle.y,
                  rotate: particle.rotate,
                  scale: [0.35, 1.16, 0.7],
                }}
                className={`absolute left-0 top-0 ${particle.size}`}
                initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.2 }}
                key={particle.id}
                transition={{
                  delay: index * 0.03,
                  duration: 0.74,
                  ease: [0.2, 0.9, 0.3, 1],
                }}
              >
                {particle.symbol}
              </motion.span>
            ))}
          </span>
        ) : null}
      </AnimatePresence>
    </span>
  )
}
