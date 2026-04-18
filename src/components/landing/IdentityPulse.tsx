'use client'

import { motion } from 'motion/react'

const nodes = [
  { id: 'a', x: 96, y: 134, r: 4, delay: 0 },
  { id: 'b', x: 172, y: 82, r: 3, delay: 0.1 },
  { id: 'c', x: 252, y: 152, r: 5, delay: 0.2 },
  { id: 'd', x: 354, y: 112, r: 3, delay: 0.3 },
  { id: 'e', x: 438, y: 194, r: 4, delay: 0.4 },
  { id: 'f', x: 148, y: 274, r: 5, delay: 0.5 },
  { id: 'g', x: 274, y: 302, r: 4, delay: 0.6 },
  { id: 'h', x: 382, y: 276, r: 5, delay: 0.7 },
  { id: 'i', x: 500, y: 328, r: 3, delay: 0.8 },
  { id: 'j', x: 220, y: 424, r: 4, delay: 0.9 },
  { id: 'k', x: 342, y: 454, r: 6, delay: 1 },
  { id: 'l', x: 474, y: 426, r: 4, delay: 1.1 },
]

const links = [
  ['a', 'b'],
  ['b', 'c'],
  ['c', 'd'],
  ['d', 'e'],
  ['a', 'f'],
  ['c', 'f'],
  ['c', 'g'],
  ['e', 'h'],
  ['g', 'h'],
  ['h', 'i'],
  ['f', 'j'],
  ['g', 'j'],
  ['g', 'k'],
  ['h', 'k'],
  ['i', 'l'],
  ['k', 'l'],
] as const

const nodeById = new Map(nodes.map((node) => [node.id, node]))

export default function IdentityPulse() {
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[length:84px_84px] opacity-50" />
      <motion.div
        data-identity-pulse-root
        className="absolute -right-24 top-12 h-[620px] w-[720px] max-w-none opacity-95 sm:right-0 lg:right-12"
        animate={{ x: [0, -26, 10, 0], y: [0, 18, -8, 0], scale: [1, 1.035, 0.995, 1] }}
        transition={{ duration: 9, ease: 'easeInOut', repeat: Infinity }}
        style={{ willChange: 'transform' }}
      >
        <svg
          className="h-full w-full"
          role="img"
          viewBox="0 0 600 560"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="identity-pulse-line" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#f5f5f0" stopOpacity="0.1" />
              <stop offset="48%" stopColor="#ff4658" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#f5f5f0" stopOpacity="0.16" />
            </linearGradient>
            <radialGradient id="identity-pulse-node">
              <stop offset="0%" stopColor="#fff7f2" />
              <stop offset="46%" stopColor="#ff4658" />
              <stop offset="100%" stopColor="#ff4658" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g>
            {links.map(([fromId, toId], index) => {
              const from = nodeById.get(fromId)
              const to = nodeById.get(toId)

              if (!from || !to) {
                return null
              }

              return (
                <motion.line
                  key={`${fromId}-${toId}`}
                  x1={from.x}
                  x2={to.x}
                  y1={from.y}
                  y2={to.y}
                  stroke="url(#identity-pulse-line)"
                  strokeLinecap="round"
                  strokeWidth="1.45"
                  initial={{ opacity: 0.08 }}
                  animate={{ opacity: [0.08, 1, 0.14] }}
                  transition={{
                    delay: index * 0.08,
                    duration: 2.6,
                    ease: 'easeInOut',
                    repeat: Infinity,
                    repeatDelay: 1.2,
                  }}
                />
              )
            })}
          </g>

          <g>
            {nodes.map((node) => (
              <g key={node.id}>
                <motion.circle
                  cx={node.x}
                  cy={node.y}
                  fill="url(#identity-pulse-node)"
                  initial={{ opacity: 0.05, scale: 0.64 }}
                  r={node.r * 4.2}
                  animate={{ opacity: [0.05, 0.34, 0.07], scale: [0.64, 1.24, 0.72] }}
                  transition={{
                    delay: node.delay,
                    duration: 2.4,
                    ease: 'easeInOut',
                    repeat: Infinity,
                    repeatDelay: 1.1,
                  }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
                <motion.circle
                  cx={node.x}
                  cy={node.y}
                  fill="#fff7f2"
                  initial={{ opacity: 0.5, scale: 0.82 }}
                  r={node.r}
                  animate={{ opacity: [0.5, 1, 0.58], scale: [0.82, 1.55, 0.9] }}
                  transition={{
                    delay: node.delay,
                    duration: 2,
                    ease: 'easeInOut',
                    repeat: Infinity,
                    repeatDelay: 1.4,
                  }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
              </g>
            ))}
          </g>
        </svg>
      </motion.div>
      <motion.div
        className="absolute right-8 top-24 h-72 w-72 rounded-full border border-[#ff4b5d]/40 bg-[radial-gradient(circle,rgba(255,75,93,0.24),transparent_58%)] opacity-0 blur-[1px] sm:right-28 sm:top-32 sm:h-96 sm:w-96"
        initial={{ opacity: 0, scale: 0.62 }}
        animate={{ opacity: [0, 0.52, 0], scale: [0.62, 1.12, 1.42] }}
        transition={{ duration: 3.4, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.1 }}
        style={{ willChange: 'transform, opacity' }}
      />
      <motion.div
        className="absolute right-0 top-0 h-full w-24 bg-[linear-gradient(90deg,transparent,rgba(255,75,93,0.18),transparent)] opacity-0"
        initial={{ opacity: 0, x: 160 }}
        animate={{ opacity: [0, 0.8, 0], x: [160, -520, -760] }}
        transition={{ duration: 4.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2 }}
        style={{ willChange: 'transform, opacity' }}
      />
      <div className="absolute inset-y-0 left-0 w-full bg-[radial-gradient(circle_at_68%_34%,rgba(255,70,88,0.2),transparent_34%),linear-gradient(90deg,#070707_0%,rgba(7,7,7,0.92)_34%,rgba(7,7,7,0.28)_74%,#070707_100%)]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_5px)] opacity-35" />
    </motion.div>
  )
}
