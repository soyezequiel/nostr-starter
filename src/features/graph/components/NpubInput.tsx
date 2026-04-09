import { useEffect, useRef, useState } from 'react'

import { decodeRootPointer, type RootPointerDecodeResult } from '@/features/graph/kernel/nip19'

interface NpubInputProps {
  onValidRoot: (payload: { pubkey: string; kind: 'npub' | 'nprofile' }) => void
  onInvalidRoot?: (
    payload: Extract<RootPointerDecodeResult, { status: 'invalid' }>,
  ) => void
}

export function NpubInput({ onValidRoot, onInvalidRoot }: NpubInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [validationState, setValidationState] =
    useState<RootPointerDecodeResult>({ status: 'empty' })
  const lastPublishedRoot = useRef<string | null>(null)
  const validationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (validationState.status === 'valid') {
      if (lastPublishedRoot.current !== validationState.pubkey) {
        lastPublishedRoot.current = validationState.pubkey
        onValidRoot({
          pubkey: validationState.pubkey,
          kind: validationState.kind,
        })
      }

      return
    }

    if (validationState.status === 'invalid') {
      lastPublishedRoot.current = null
      onInvalidRoot?.(validationState)
    }
  }, [onInvalidRoot, onValidRoot, validationState])

  const statusMessage = (() => {
    switch (validationState.status) {
      case 'empty':
        return 'Pega una clave `npub` o `nprofile` para cargar el nodo raiz.'
      case 'validating':
        return 'Validando clave...'
      case 'valid':
        return `Clave valida: ${validationState.pubkey}`
      case 'invalid':
        return `${validationState.message} (${validationState.code})`
    }
  })()

  const handleChange = (nextValue: string) => {
    setInputValue(nextValue)

    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current)
      validationTimerRef.current = null
    }

    const normalizedInput = nextValue.trim()

    if (normalizedInput.length === 0) {
      setValidationState({ status: 'empty' })
      lastPublishedRoot.current = null
      return
    }

    setValidationState({ status: 'validating', input: normalizedInput })
    validationTimerRef.current = window.setTimeout(() => {
      setValidationState(decodeRootPointer(normalizedInput))
      validationTimerRef.current = null
    }, 0)
  }

  return (
    <div className="npub-input">
      <label className="npub-input__label" htmlFor="root-pointer-input">
        Npub o nprofile
      </label>
      <input
        autoComplete="off"
        className="npub-input__field"
        id="root-pointer-input"
        inputMode="text"
        onChange={(event) => handleChange(event.target.value)}
        placeholder="npub1... o nprofile1..."
        spellCheck={false}
        type="text"
        value={inputValue}
      />
      <p aria-live="polite" className="npub-input__status">
        {statusMessage}
      </p>
    </div>
  )
}
