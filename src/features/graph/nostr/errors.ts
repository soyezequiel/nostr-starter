import type {
  RelayAdapterErrorCode,
  RelayAdapterErrorDetails,
} from './types'

export class RelayAdapterError extends Error {
  readonly code: RelayAdapterErrorCode
  readonly source = 'relay' as const
  readonly relayUrl?: string
  readonly retryable: boolean
  readonly details?: RelayAdapterErrorDetails

  constructor(input: {
    code: RelayAdapterErrorCode
    message: string
    relayUrl?: string
    retryable: boolean
    details?: RelayAdapterErrorDetails
  }) {
    super(input.message)
    this.name = 'RelayAdapterError'
    this.code = input.code
    this.relayUrl = input.relayUrl
    this.retryable = input.retryable
    this.details = input.details
  }
}

export function createRelayAdapterError(input: {
  code: RelayAdapterErrorCode
  message: string
  relayUrl?: string
  retryable: boolean
  details?: RelayAdapterErrorDetails
}): RelayAdapterError {
  return new RelayAdapterError(input)
}
