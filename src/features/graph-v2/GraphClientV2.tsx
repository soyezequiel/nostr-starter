'use client'

import dynamic from 'next/dynamic'
import './ui/graph-v2.css'

const GraphAppV2 = dynamic(() => import('@/features/graph-v2/ui/GraphAppV2'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-[#0b0d0f] pt-16">
      <div className="mx-auto h-[calc(100vh-4rem)] max-w-[1600px] p-4">
        <div className="h-full rounded-3xl border border-white/10 bg-black/20" />
      </div>
    </main>
  ),
})

export default function GraphClientV2() {
  return <GraphAppV2 />
}

