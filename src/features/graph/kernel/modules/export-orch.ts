import type {
  MultipartArchiveResult,
  ProfilePhotoArchiveResult,
} from '@/features/graph/export/types'
import type { KernelContext } from '@/features/graph/kernel/modules/context'
import { transitionExportJob } from '@/features/graph/kernel/transitions/export-job'

export function createExportModule(ctx: KernelContext) {
  function setExportPhase(
    action:
      | 'start'
      | 'freeze-done'
      | 'authored-done'
      | 'inbound-done'
      | 'complete'
      | 'partial'
      | 'fail'
      | 'reset',
    patch: {
      percent?: number
      currentPubkey?: string | null
      errorMessage?: string | null
    } = {},
  ): void {
    const state = ctx.store.getState()
    const nextPhase = transitionExportJob(state.exportJob.phase, action)
    if (nextPhase === null) {
      console.warn(
        `Invalid transition: exportJob ${state.exportJob.phase} -> ${action}`,
      )
      return
    }

    state.setExportJobProgress({
      phase: nextPhase,
      ...patch,
    })
  }

  async function exportSnapshot(): Promise<MultipartArchiveResult> {
    const state = ctx.store.getState()
    if (
      state.exportJob.phase === 'completed' ||
      state.exportJob.phase === 'failed' ||
      state.exportJob.phase === 'partial'
    ) {
      setExportPhase('reset')
    }

    if (Object.keys(state.nodes).length === 0) {
      setExportPhase('start', {
        percent: 0,
        currentPubkey: null,
        errorMessage: null,
      })
      setExportPhase('fail', {
        errorMessage: 'No hay nodos descubiertos para exportar.',
      })
      throw new Error('No hay nodos descubiertos para exportar.')
    }

    setExportPhase('start', {
      percent: 0,
      currentPubkey: state.rootNodePubkey,
      errorMessage: null,
    })

    try {
      const [{ freezeSnapshot }, { buildMultipartArchive }, { downloadBlob }] =
        await Promise.all([
          import('@/features/graph/export/snapshot-freezer'),
          import('@/features/graph/export/archive-builder'),
          import('@/features/graph/export/download'),
        ])
      const snapshot = await freezeSnapshot({
        store: ctx.store,
        repositories: ctx.repositories,
          now: ctx.now,
        })

      setExportPhase('freeze-done', {
        percent: 2,
        currentPubkey: state.rootNodePubkey,
      })
      setExportPhase('authored-done', {
        percent: 5,
        currentPubkey: state.rootNodePubkey,
      })
      setExportPhase('inbound-done', {
        percent: 10,
        currentPubkey: state.rootNodePubkey,
      })

      const result = await buildMultipartArchive(snapshot, {
        onPartBuilt: (partNumber, totalParts) => {
          const percent = 10 + Math.round((partNumber / totalParts) * 85)
          ctx.store.getState().setExportJobProgress({ percent })
        },
      })

      for (const part of result.parts) {
        downloadBlob(part.blob, part.filename)
      }

      setExportPhase('complete', {
        percent: 100,
        currentPubkey: null,
        errorMessage: null,
      })
      ctx.emitter.emit({
        type: 'export-completed',
        captureId: result.captureId,
        partCount: result.parts.length,
      })
      return result
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido durante el export.'
      setExportPhase('fail', { currentPubkey: null, errorMessage: message })
      throw error
    }
  }

  async function downloadDiscoveredProfilePhotos(): Promise<ProfilePhotoArchiveResult> {
    const state = ctx.store.getState()

    if (Object.keys(state.nodes).length === 0) {
      throw new Error(
        'No hay nodos descubiertos para descargar fotos de perfil.',
      )
    }

    const [{ freezeSnapshot }, { buildProfilePhotoArchive }, { downloadBlob }] =
      await Promise.all([
        import('@/features/graph/export/snapshot-freezer'),
        import('@/features/graph/export/profile-photo-archive'),
        import('@/features/graph/export/download'),
      ])

    const snapshot = await freezeSnapshot({
      store: ctx.store,
      repositories: ctx.repositories,
      now: ctx.now,
    })

    const result = await buildProfilePhotoArchive(snapshot)
    downloadBlob(result.blob, result.filename)

    return result
  }

  return { exportSnapshot, downloadDiscoveredProfilePhotos }
}

export type ExportModule = ReturnType<typeof createExportModule>
