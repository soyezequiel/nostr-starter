'use client'

import { memo, useId, useState } from 'react'

import { decodeRootPointer } from '@/features/graph/kernel/nip19'

interface Props {
  feedback?: string | null
  onValidRoot: (payload: {
    pubkey: string
    kind: 'npub' | 'nprofile'
    relays: string[]
  }) => void
}

export const SigmaRootInput = memo(function SigmaRootInput({
  feedback,
  onValidRoot,
}: Props) {
  const inputId = useId()
  const statusId = useId()
  const [inputValue, setInputValue] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const visibleStatus = statusMessage ?? feedback ?? null

  const submit = () => {
    const normalizedInput = inputValue.trim()
    if (!normalizedInput) {
      setStatusMessage('Pegá un npub o nprofile para empezar.')
      return
    }

    const result = decodeRootPointer(normalizedInput)
    if (result.status === 'invalid') {
      setStatusMessage(result.message)
      return
    }

    if (result.status === 'valid') {
      setStatusMessage(null)
      onValidRoot({
        pubkey: result.pubkey,
        kind: result.kind,
        relays: result.relays,
      })
    }
  }

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
          id={inputId}
          inputMode="text"
          onChange={(event) => {
            setInputValue(event.target.value)
            if (statusMessage) setStatusMessage(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="npub1... o nprofile1..."
          spellCheck={false}
          type="text"
          value={inputValue}
        />
        <button
          className="sigma-root-input__submit"
          onClick={submit}
          type="button"
        >
          Explorar →
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
