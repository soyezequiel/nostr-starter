'use client'

import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'

type LandingMotionProviderProps = {
  children: ReactNode
}

export default function LandingMotionProvider({
  children,
}: LandingMotionProviderProps) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>{children}</LazyMotion>
    </MotionConfig>
  )
}
