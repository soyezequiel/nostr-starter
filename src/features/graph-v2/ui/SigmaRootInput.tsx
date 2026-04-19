'use client'

import { memo, useCallback, useId, useState } from 'react'

import {
  resolveRootIdentity,
  type RootIdentityResolution,
} from '@/features/graph-runtime/kernel/rootIdentity'

type ValidRootIdentity = Extract<RootIdentityResolution, { status: 'valid' }>

interface Props {
  feedback?: string | null
  onValidRoot: (payload: ValidRootIdentity) => void
}

export const SigmaRootInput = memo(function SigmaRootInput({
  feedback,
  onValidRoot,
}: Props) {
  const inputId = useId()
  const statusId = useId()
  const [inputValue, setInputValue] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const visibleStatus = statusMessage ?? feedback ?? null

  const submit = useCallback(async () => {
    const normalizedInput = inputValue.trim()
    if (!normalizedInput) {
      setStatusMessage('Pega un npub, nprofile, NIP-05, hex o link de perfil.')
      return
    }

    setIsResolving(true)
    setStatusMessage('Resolviendo identidad...')

    try {
      const result = await resolveRootIdentity(normalizedInput)

      if (result.status === 'invalid') {
        setStatusMessage(result.message)
        return
      }

      if (result.status === 'valid') {
        setStatusMessage(null)
        onValidRoot(result)
      }
    } finally {
      setIsResolving(false)
    }
  }, [inputValue, onValidRoot])

  return (
    <div className="sigma-root-input">
      <label className="sigma-root-input__label" htmlFor={inputId}>
        Identidad Nostr
      </label>
      <div className="sigma-root-input__row">
        <input
          aria-describedby={visibleStatus ? statusId : undefined}
          autoComplete="off"
          className="sigma-root-input__field"
          disabled={isResolving}
          id={inputId}
          inputMode="text"
          onChange={(event) => {
            setInputValue(event.target.value)
            if (statusMessage) setStatusMessage(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="npub, nprofile, NIP-05, hex o link"
          spellCheck={false}
          type="text"
          value={inputValue}
        />
        <button
          className="sigma-root-input__submit"
          disabled={isResolving}
          onClick={() => {
            void submit()
          }}
          type="button"
        >
          {isResolving ? 'Resolviendo...' : 'Explorar ->'}
        </button>
      </div>
      {visibleStatus ? (
        <p
          aria-live="polite"
          className="sigma-root-input__status"
          id={statusId}
        >
          {visibleStatus}
        </p>
      ) : null}
    </div>
  )
})
