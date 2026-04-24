interface ShowDirectoryPickerOptions {
  mode?: 'read' | 'readwrite'
}

interface Window {
  showDirectoryPicker(options?: ShowDirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}
