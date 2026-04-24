import { useMemo, useState } from 'react'
import './App.css'

type TreeNode = {
  name: string
  path: string
  type: 'directory' | 'file'
  children?: TreeNode[]
}

type ScanResult = {
  rootName: string
  tree: TreeNode
  tsFileCount: number
  directoryCount: number
}

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build'])
const TARGET_EXTENSIONS = ['.ts', '.tsx']

function isTargetFile(name: string) {
  return TARGET_EXTENSIONS.some((extension) => name.endsWith(extension))
}

async function scanDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  basePath: string,
): Promise<{ node: TreeNode; tsFileCount: number; directoryCount: number }> {
  const currentPath = basePath ? `${basePath}/${directoryHandle.name}` : directoryHandle.name
  const files: TreeNode[] = []
  const directories: TreeNode[] = []
  let tsFileCount = 0
  let directoryCount = 1

  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'directory') {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }

      const scanned = await scanDirectory(entry, currentPath)
      if (scanned.node.children && scanned.node.children.length > 0) {
        directories.push(scanned.node)
      }
      tsFileCount += scanned.tsFileCount
      directoryCount += scanned.directoryCount
      continue
    }

    if (entry.kind === 'file' && isTargetFile(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push({
        name: entry.name,
        path: `${currentPath}/${entry.name}`,
        type: 'file',
      })
      tsFileCount += 1
    }
  }

  const sortedDirectories = directories.sort((left, right) => left.name.localeCompare(right.name))
  const sortedFiles = files.sort((left, right) => left.name.localeCompare(right.name))

  return {
    node: {
      name: directoryHandle.name,
      path: currentPath,
      type: 'directory',
      children: [...sortedDirectories, ...sortedFiles],
    },
    tsFileCount,
    directoryCount,
  }
}

function useTreeLines(node: TreeNode | null) {
  return useMemo(() => {
    if (!node) {
      return []
    }

    const lines: string[] = []

    function walk(current: TreeNode, prefix: string) {
      const children = current.children ?? []
      children.forEach((child, index) => {
        const isLast = index === children.length - 1
        const marker = isLast ? '└─' : '├─'
        const typeMarker = child.type === 'directory' ? '[D]' : '[F]'
        lines.push(`${prefix}${marker} ${typeMarker} ${child.name}`)
        if (child.children && child.children.length > 0) {
          walk(child, `${prefix}${isLast ? '   ' : '│  '}`)
        }
      })
    }

    lines.push(`[D] ${node.name}`)
    walk(node, '')
    return lines
  }, [node])
}

function App() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const treeLines = useTreeLines(scanResult?.tree ?? null)

  const isPickerAvailable = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  async function handlePickDirectory() {
    if (!isPickerAvailable) {
      setErrorMessage('Your browser does not support File System Access API (use Chromium-based browser).')
      return
    }

    setIsScanning(true)
    setErrorMessage(null)

    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      })
      const scanned = await scanDirectory(directoryHandle, '')
      setScanResult({
        rootName: directoryHandle.name,
        tree: scanned.node,
        tsFileCount: scanned.tsFileCount,
        directoryCount: scanned.directoryCount,
      })
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        return
      }
      setErrorMessage('Failed to scan the selected directory.')
      console.error(error)
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Schematic Code Visualizer</h1>
        <p className="subtitle">
          Iteration v1 scans TypeScript files and maps directory structure into logical board blocks.
        </p>
        <div className="actions">
          <button type="button" onClick={handlePickDirectory} disabled={isScanning}>
            {isScanning ? 'Scanning...' : 'Select Project Folder'}
          </button>
          <span className="hint">Supported: `.ts`, `.tsx`; excludes `node_modules`, `.git`, `dist`, `build`.</span>
        </div>
        {errorMessage && <p className="error">{errorMessage}</p>}
      </section>

      <section className="panel grid">
        <div className="stats">
          <h2>Scan Summary</h2>
          <p>
            <strong>Root:</strong> {scanResult?.rootName ?? '-'}
          </p>
          <p>
            <strong>Directories:</strong> {scanResult?.directoryCount ?? 0}
          </p>
          <p>
            <strong>TS Files:</strong> {scanResult?.tsFileCount ?? 0}
          </p>
        </div>
        <div className="tree">
          <h2>Directory Tree</h2>
          <pre>{treeLines.length > 0 ? treeLines.join('\n') : 'Select a folder to scan.'}</pre>
        </div>
      </section>
    </main>
  )
}

export default App
