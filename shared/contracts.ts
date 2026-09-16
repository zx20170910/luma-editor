export interface FileData { path: string; name: string; content: string; mtime: number; bom?: boolean }
export interface FileNode { path: string; name: string; directory: boolean }
export interface SavedTab { id: string; path: string | null; name: string; content: string; savedContent: string; mtime: number; language: string; bom?: boolean }
export interface Preferences { fontSize: number; tabSize: number; wordWrap: boolean; minimap: boolean; formatOnSave: boolean; theme: 'dark' | 'light'; preview: boolean; sidebar: boolean; sidebarWidth: number }
export interface Session { tabs: SavedTab[]; activeId: string | null; folder: FileNode | null; preferences: Preferences }
export interface ExternalFormatter { command: string; args: string[] }
export interface FormatterInfo { language: string; label: string; available: boolean; kind: 'builtin' | 'external' | 'missing'; detail: string }
export interface UpdateInfo { currentVersion: string; latestVersion: string | null; updateAvailable: boolean; releaseUrl: string; releaseName: string; publishedAt: string | null; asset: { name: string; url: string; size: number } | null; platform: string; reason?: string }
export interface EditorAPI {
  openFiles(): Promise<FileData[]>;
  openFolder(): Promise<FileNode | null>;
  readFile(path: string): Promise<FileData>;
  listDirectory(path: string): Promise<FileNode[]>;
  saveFile(request: { path: string | null; name: string; content: string; mtime: number; saveAs?: boolean; bom?: boolean }): Promise<FileData | null>;
  confirmClose(name: string): Promise<'save' | 'discard' | 'cancel'>;
  loadSession(): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  format(request: { content: string; language: string; filePath?: string; tabSize: number }): Promise<{ content: string; formatter: string }>;
  formatterStatus(): Promise<FormatterInfo[]>;
  getExternalFormatters(): Promise<Record<string, ExternalFormatter>>;
  setExternalFormatters(value: Record<string, ExternalFormatter>): Promise<void>;
  readAsset(path: string, documentPath: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  platform: string;
  windowControl(command: 'minimize' | 'toggle-maximize' | 'close'): Promise<boolean | void>;
  checkForUpdates(): Promise<UpdateInfo>;
  downloadUpdate(url: string, fileName: string): Promise<{ path: string; name: string }>;
  setDirty(value: boolean): void;
  respondToClose(): void;
  onCommand(callback: (command: string) => void): () => void;
  onOpenFiles(callback: (files: FileData[]) => void): () => void;
  onCloseRequested(callback: () => void): () => void;
}
declare global { interface Window { luma: EditorAPI; } }
