/**
 * Settings Types for FlowDrop
 *
 * Provides comprehensive type definitions for all user-configurable settings.
 * Supports theme, editor, UI, behavior, and API settings with hybrid persistence.
 *
 * @module types/settings
 */

// =========================================================================
// Theme Settings
// =========================================================================

/**
 * Theme preference options
 * - 'light': Force light theme
 * - 'dark': Force dark theme
 * - 'auto': Follow system preference
 */
export type ThemePreference = 'light' | 'dark' | 'auto';

/**
 * Resolved theme (actual applied theme, never 'auto')
 */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Theme-related settings
 */
export interface ThemeSettings {
  /** User's theme preference */
  preference: ThemePreference;
}

// =========================================================================
// Editor Settings
// =========================================================================

/**
 * Editor canvas and interaction settings
 */
export interface EditorSettings {
  /** Show grid lines on the canvas */
  showGrid: boolean;
  /** Snap nodes to grid when dragging */
  snapToGrid: boolean;
  /** Grid cell size in pixels */
  gridSize: number;
  /** Show minimap for navigation */
  showMinimap: boolean;
  /** Default zoom level (1 = 100%) */
  defaultZoom: number;
  /** Automatically fit workflow to view on load */
  fitViewOnLoad: boolean;
  /** Enable proximity connect when dragging nodes near other nodes */
  proximityConnect: boolean;
  /** Distance threshold in pixels for proximity connect */
  proximityConnectDistance: number;
}

// =========================================================================
// UI Settings
// =========================================================================

/**
 * Where an auxiliary surface (config panel, console/chat) is hosted.
 *
 * - `sidebar` — the right rail.
 * - `modal` — a centered overlay floating above the canvas.
 * - `below` — the bottom panel.
 *
 * Surfaces routed to the same host coexist as tabs. Modelled as one enum per
 * surface (rather than a boolean per host) so invalid combinations — two hosts
 * at once, or none — are unrepresentable.
 */
export type SurfacePlacement = 'sidebar' | 'modal' | 'below';

/**
 * UI layout and display settings
 */
export interface UISettings {
  /** Width of the node sidebar in pixels */
  sidebarWidth: number;
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Enable compact mode for denser UI */
  compactMode: boolean;
  /** Active theme name — overridden by the theme prop when explicitly provided */
  theme: 'default' | 'minimal' | 'drafter';
  /** Whether the command console panel is open */
  consoleOpen: boolean;
  /** Height of the command console panel in pixels */
  consoleHeight: number;
  /** Active tab in the bottom panel */
  bottomPanelTab: 'console' | 'chat';
  /** Where the node/workflow configuration panel is hosted. Default `sidebar`. */
  configPlacement: SurfacePlacement;
  /** Where the console / AI Assistant group is hosted. Default `below`. */
  consolePlacement: SurfacePlacement;
}

// =========================================================================
// Behavior Settings
// =========================================================================

/**
 * Application behavior and automation settings
 */
export interface BehaviorSettings {
  /** Automatically save changes */
  autoSave: boolean;
  /** Auto-save interval in milliseconds */
  autoSaveInterval: number;
  /**
   * Persist workflow drafts in browser storage.
   *
   * When enabled (default), unsaved changes are written to browser storage
   * so they survive page reloads. On the default `localStorage` backend,
   * drafts remain stored on the device even after the tab or browser is
   * closed, until they are saved or cleared. Turning this off stops draft
   * writes and removes the current draft.
   *
   * Caveat: the toggle applies per tab. Other tabs that are already open
   * read settings at load time and keep writing drafts until reloaded.
   */
  storeDraftsInBrowser: boolean;
  /** Maximum number of undo history entries */
  undoHistoryLimit: number;
  /** Show confirmation dialog before deleting nodes */
  confirmDelete: boolean;
  /**
   * How the AI assistant works with the editor.
   *
   * - `'tools'` (default): the assistant calls the editor's tools — the same
   *   `describe_type`, `batch`, `save`, `run`, … a WebMCP browser agent gets —
   *   in a loop inside one message; reads run at once, document changes ask
   *   once per round in the approval dialog. Needs a backend with the
   *   `chat.toolResults` endpoint; without one the panel falls back to `'dsl'`
   *   for the session and says so.
   * - `'dsl'`: the legacy text mode — one reply holding a ```flowdrop block,
   *   previewed and applied on click. Deprecated; kept for one minor.
   */
  chatMode: 'tools' | 'dsl';
  /**
   * Automatically re-submit batch failures to the AI for self-correction.
   * Legacy `'dsl'` mode only: in `'tools'` mode the tool result itself tells
   * the assistant what went wrong, in the same turn.
   */
  chatAutoRetry: boolean;
  /**
   * Allow the AI assistant's commands to reposition nodes
   * (`layout auto`, `layout beautify`).
   *
   * Turn off to protect a hand-crafted layout: those commands are then skipped
   * (not failed) when a batch is applied, so the rest of the change set still
   * lands. Positioning nodes explicitly via `add ... at <x>,<y>` and viewport
   * commands (`canvas fitview`) are unaffected — they don't overwrite the
   * arrangement of existing nodes.
   */
  chatAllowLayoutChanges: boolean;
}

// =========================================================================
// API Settings
// =========================================================================

/**
 * API connection and request settings
 */
export interface ApiSettings {
  /** Request timeout in milliseconds */
  timeout: number;
  /** Enable automatic retry on failure */
  retryEnabled: boolean;
  /** Maximum number of retry attempts */
  retryAttempts: number;
  /** Enable response caching */
  cacheEnabled: boolean;
}

// =========================================================================
// Combined Settings
// =========================================================================

/**
 * All FlowDrop settings organized by category
 */
export interface FlowDropSettings {
  /** Theme appearance settings */
  theme: ThemeSettings;
  /** Editor canvas settings */
  editor: EditorSettings;
  /** UI layout settings */
  ui: UISettings;
  /** Application behavior settings */
  behavior: BehaviorSettings;
  /** API connection settings */
  api: ApiSettings;
}

/**
 * Settings category names for iteration and tab rendering
 */
export type SettingsCategory = keyof FlowDropSettings;

/**
 * All available settings categories
 */
export const SETTINGS_CATEGORIES: SettingsCategory[] = ['theme', 'editor', 'ui', 'behavior', 'api'];

/**
 * Human-readable labels for settings categories
 */
export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  theme: 'Theme',
  editor: 'Editor',
  ui: 'UI',
  behavior: 'Behavior',
  api: 'API'
};

/**
 * Icons for settings categories (Iconify icon names)
 */
export const SETTINGS_CATEGORY_ICONS: Record<SettingsCategory, string> = {
  theme: 'mdi:palette',
  editor: 'mdi:grid',
  ui: 'mdi:view-dashboard',
  behavior: 'mdi:cog-play',
  api: 'mdi:api'
};

// =========================================================================
// Default Settings
// =========================================================================

/**
 * Default theme settings
 */
export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  preference: 'light'
};

/**
 * Default editor settings
 */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  showGrid: true,
  snapToGrid: true,
  gridSize: 20,
  showMinimap: true,
  defaultZoom: 1,
  fitViewOnLoad: true,
  proximityConnect: false,
  proximityConnectDistance: 150
};

/**
 * Default UI settings
 */
export const DEFAULT_UI_SETTINGS: UISettings = {
  sidebarWidth: 280,
  sidebarCollapsed: false,
  compactMode: false,
  theme: 'default',
  consoleOpen: false,
  consoleHeight: 300,
  bottomPanelTab: 'console',
  configPlacement: 'sidebar',
  consolePlacement: 'below'
};

/**
 * Default behavior settings
 */
export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettings = {
  autoSave: false,
  autoSaveInterval: 30000,
  storeDraftsInBrowser: true,
  undoHistoryLimit: 50,
  confirmDelete: false,
  chatMode: 'tools',
  chatAutoRetry: true,
  chatAllowLayoutChanges: true
};

/**
 * Default API settings
 */
export const DEFAULT_API_SETTINGS: ApiSettings = {
  timeout: 30000,
  retryEnabled: true,
  retryAttempts: 3,
  cacheEnabled: false
};

/**
 * Complete default settings object
 */
export const DEFAULT_SETTINGS: FlowDropSettings = {
  theme: DEFAULT_THEME_SETTINGS,
  editor: DEFAULT_EDITOR_SETTINGS,
  ui: DEFAULT_UI_SETTINGS,
  behavior: DEFAULT_BEHAVIOR_SETTINGS,
  api: DEFAULT_API_SETTINGS
};

// =========================================================================
// Partial Settings Types (for updates)
// =========================================================================

/**
 * Deep partial type for nested settings updates
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Partial settings for incremental updates
 */
export type PartialSettings = DeepPartial<FlowDropSettings>;

// =========================================================================
// Settings Event Types
// =========================================================================

/**
 * Event payload for settings changes
 */
export interface SettingsChangeEvent {
  /** The category that changed */
  category: SettingsCategory;
  /** The key within the category that changed */
  key: string;
  /** The previous value */
  previousValue: unknown;
  /** The new value */
  newValue: unknown;
}

/**
 * Callback type for settings change listeners
 */
export type SettingsChangeCallback = (event: SettingsChangeEvent) => void;

// =========================================================================
// Settings Persistence Types
// =========================================================================

/**
 * localStorage key for persisting settings
 */
export const SETTINGS_STORAGE_KEY = 'flowdrop-settings';

/**
 * API sync status
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

/**
 * Settings store state including sync metadata
 */
export interface SettingsStoreState {
  /** Current settings values */
  settings: FlowDropSettings;
  /** Whether settings have been loaded from storage */
  initialized: boolean;
  /** API sync status */
  syncStatus: SyncStatus;
  /** Last sync timestamp */
  lastSyncedAt: number | null;
  /** Last sync error message */
  syncError: string | null;
}
