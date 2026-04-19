export const hasRenderableSigmaContainer = (
  container:
    | Pick<HTMLElement, 'offsetWidth' | 'offsetHeight'>
    | null
    | undefined,
) => {
  return (
    container !== null &&
    container !== undefined &&
    container.offsetWidth > 0 &&
    container.offsetHeight > 0
  )
}
