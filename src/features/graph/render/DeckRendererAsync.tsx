/**
 * DeckRendererAsync — async boundary for the deck.gl renderer.
 *
 * This module is the ONLY static importer of DeckGraphRenderer.
 * It must never be imported statically from any other module.
 * GraphViewportLazy loads it via React.lazy() so Rollup can split
 * the entire deck.gl + luma.gl + math.gl tree into dedicated async chunks,
 * keeping them off the critical boot path.
 */
export { DeckGraphRenderer } from '@/features/graph/render/DeckGraphRenderer'
