export function getTopLevelBlockLabelForPath(filePath: string, rootName: string | null | undefined) {
  if (!rootName) {
    return '(root)'
  }
  const prefix = `${rootName}/`
  const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
  const [firstSegment] = relativePath.split('/')
  return firstSegment || '(root)'
}
