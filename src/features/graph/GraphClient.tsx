'use client';

import dynamic from 'next/dynamic';

const GraphApp = dynamic(() => import('@/features/graph/GraphApp'), {
  ssr: false,
  loading: () => (
    <main className="app-shell app-shell--immersive">
      <section className="workspace-shell">
        <div className="graph-panel__canvas-frame" />
      </section>
    </main>
  ),
});

export default function GraphClient() {
  return <GraphApp />;
}
