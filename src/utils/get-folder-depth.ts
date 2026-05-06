export function getFolderDepth(blockId: string) {
  if (!blockId.startsWith('block:')) return 0
  const relative = blockId.slice('block:'.length)
  if (!relative || relative === '(root)') return 0
  return relative.split('/').length
}
