<!--
  Settings Panel Component

  A comprehensive settings panel with tabbed categories for configuring
  FlowDrop preferences. Uses SchemaForm for dynamic form generation.

  Features:
  - Tabbed interface for settings categories (Theme, Editor, UI, Behavior, API)
  - Real-time settings updates via settingsStore
  - Optional API sync with "Sync to Cloud" button
  - Reset to defaults functionality

  @example
  ```svelte
  <script>
    import { SettingsPanel } from "@flowdrop/flowdrop";

    function handleClose() {
      // Handle settings panel close
    }
  </script>

  <SettingsPanel
    showSyncButton={true}
    onClose={handleClose}
  />
  ```
-->

<script lang="ts">
  import Icon from '@iconify/svelte';
  import { SchemaForm } from '$lib/form/index.js';
  import { m } from '$lib/messages/index.js';
  import type { ConfigSchema } from '$lib/types/index.js';
  import type { SettingsCategory } from '$lib/types/settings.js';
  import {
    SETTINGS_CATEGORIES,
    SETTINGS_CATEGORY_LABELS,
    SETTINGS_CATEGORY_ICONS
  } from '$lib/types/settings.js';
  import {
    getSettings,
    updateSettings,
    resetSettings,
    syncSettingsToApi,
    getSyncStatus
  } from '$lib/stores/settingsStore.svelte.js';
  import { logger } from '../utils/logger.js';

  /**
   * Props interface for SettingsPanel component
   */
  interface Props {
    /** Categories to display (defaults to all) */
    categories?: SettingsCategory[];
    /** Show the "Sync to Cloud" button */
    showSyncButton?: boolean;
    /** Show the reset button */
    showResetButton?: boolean;
    /** Callback when settings change */
    onSettingsChange?: (category: SettingsCategory, values: Record<string, unknown>) => void;
    /** Callback when close is requested */
    onClose?: () => void;
    /** Custom CSS class */
    class?: string;
  }

  const {
    categories = SETTINGS_CATEGORIES,
    showSyncButton = true,
    showResetButton = true,
    onSettingsChange,
    onClose,
    class: className = ''
  }: Props = $props();

  // Unique per component instance so two FlowDrop editors on one page
  // don't render colliding tab/panel DOM ids (a11y).
  const uid = $props.id();

  /**
   * Currently active tab
   */
  // initial default, user switches tabs
  // svelte-ignore state_referenced_locally
  let activeTab = $state<SettingsCategory>(categories[0] ?? 'theme');

  /**
   * Whether sync is in progress
   */
  let isSyncing = $derived(getSyncStatus().status === 'syncing');

  /**
   * JSON Schema definitions for each settings category
   */
  const schemas: Record<SettingsCategory, ConfigSchema> = {
    theme: {
      type: 'object',
      properties: {
        preference: {
          type: 'string',
          title: 'Theme Preference',
          description: 'Choose your preferred color scheme',
          oneOf: [
            { const: 'light', title: 'Light' },
            { const: 'dark', title: 'Dark' },
            { const: 'auto', title: 'Auto (System)' }
          ],
          default: 'auto'
        }
      }
    },
    editor: {
      type: 'object',
      properties: {
        showGrid: {
          type: 'boolean',
          title: 'Show Grid',
          description: 'Display grid lines on the canvas',
          default: true
        },
        snapToGrid: {
          type: 'boolean',
          title: 'Snap to Grid',
          description: 'Snap nodes to grid when dragging',
          default: true
        },
        gridSize: {
          type: 'number',
          title: 'Grid Size',
          description: 'Grid cell size in pixels',
          minimum: 5,
          maximum: 50,
          default: 20
        },
        showMinimap: {
          type: 'boolean',
          title: 'Show Minimap',
          description: 'Display navigation minimap',
          default: true
        },
        defaultZoom: {
          type: 'number',
          title: 'Default Zoom',
          description: 'Initial zoom level (1 = 100%)',
          minimum: 0.25,
          maximum: 2,
          default: 1
        },
        fitViewOnLoad: {
          type: 'boolean',
          title: 'Fit View on Load',
          description: 'Automatically fit workflow to view when loading',
          default: true
        },
        proximityConnect: {
          type: 'boolean',
          title: 'Proximity Connect',
          description: 'Auto-connect compatible ports when dragging nodes near each other',
          default: false
        },
        proximityConnectDistance: {
          type: 'number',
          title: 'Proximity Distance',
          description: 'Distance threshold in pixels for proximity connect',
          minimum: 50,
          maximum: 500,
          default: 150
        }
      }
    },
    ui: {
      type: 'object',
      properties: {
        sidebarWidth: {
          type: 'number',
          title: 'Sidebar Width',
          description: 'Width of the node sidebar in pixels',
          minimum: 200,
          maximum: 500,
          default: 280
        },
        sidebarCollapsed: {
          type: 'boolean',
          title: 'Sidebar Collapsed',
          description: 'Start with sidebar collapsed',
          default: false
        },
        compactMode: {
          type: 'boolean',
          title: 'Compact Mode',
          description: 'Use compact UI with smaller spacing',
          default: false
        },
        theme: {
          type: 'string',
          title: 'UI Theme',
          description: 'Visual style and layout of the editor',
          oneOf: [
            { const: 'default', title: 'Default' },
            { const: 'minimal', title: 'Minimal' },
            { const: 'drafter', title: 'Drafter' }
          ],
          default: 'default'
        },
        configPlacement: {
          type: 'string',
          title: 'Config Panel Location',
          description: 'Where the node/workflow configuration panel opens',
          oneOf: [
            { const: 'sidebar', title: 'Right sidebar' },
            { const: 'modal', title: 'Modal window' },
            { const: 'below', title: 'Bottom panel' }
          ],
          default: 'sidebar'
        },
        consolePlacement: {
          type: 'string',
          title: 'Console / AI Assistant Location',
          description: 'Where the console and AI Assistant open',
          oneOf: [
            { const: 'sidebar', title: 'Right sidebar' },
            { const: 'modal', title: 'Modal window' },
            { const: 'below', title: 'Bottom panel' }
          ],
          default: 'below'
        }
      }
    },
    behavior: {
      type: 'object',
      properties: {
        autoSave: {
          type: 'boolean',
          title: 'Auto Save',
          description: 'Automatically save changes',
          default: false
        },
        autoSaveInterval: {
          type: 'number',
          title: 'Auto Save Interval',
          description: 'Time between auto-saves in milliseconds',
          minimum: 5000,
          maximum: 300000,
          default: 30000
        },
        storeDraftsInBrowser: {
          type: 'boolean',
          title: 'Store Drafts in Browser',
          description:
            'Keep unsaved workflow drafts in browser storage so they survive page reloads. ' +
            'Warning: drafts (including node configuration values) may stay stored on this ' +
            'device even after the tab or browser is closed, until they are saved or cleared. ' +
            'Turn off on shared devices.',
          default: true
        },
        undoHistoryLimit: {
          type: 'number',
          title: 'Undo History Limit',
          description: 'Maximum number of undo steps (0 to disable)',
          minimum: 0,
          maximum: 200,
          default: 0
        },
        confirmDelete: {
          type: 'boolean',
          title: 'Confirm Delete',
          description: 'Show confirmation before deleting nodes',
          default: true
        },
        chatMode: {
          type: 'string',
          title: 'AI Assistant Mode',
          description:
            'Tools: the assistant calls the editor tools in a loop and asks before changing the workflow. ' +
            'Text (legacy): one reply with a command block you apply by hand. ' +
            'Tools needs a backend that supports tool-calling turns; otherwise the panel falls back to Text.',
          oneOf: [
            { const: 'tools', title: 'Tools' },
            { const: 'dsl', title: 'Text (legacy)' }
          ],
          default: 'tools'
        },
        chatAutoRetry: {
          type: 'boolean',
          title: 'AI Assistant Auto-retry',
          description: 'Automatically ask the AI to self-correct when commands fail',
          default: true
        },
        chatAllowLayoutChanges: {
          type: 'boolean',
          title: 'AI Assistant Layout Changes',
          description:
            'Let the AI assistant re-arrange node positions (layout auto / layout beautify). ' +
            'Turn off to keep a hand-crafted layout — those commands are then skipped and ' +
            'the rest of the batch still applies.',
          default: true
        }
      }
    },
    api: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          title: 'Request Timeout',
          description: 'API request timeout in milliseconds',
          minimum: 5000,
          maximum: 120000,
          default: 30000
        },
        retryEnabled: {
          type: 'boolean',
          title: 'Enable Retry',
          description: 'Automatically retry failed requests',
          default: true
        },
        retryAttempts: {
          type: 'number',
          title: 'Retry Attempts',
          description: 'Maximum number of retry attempts',
          minimum: 1,
          maximum: 10,
          default: 3
        },
        cacheEnabled: {
          type: 'boolean',
          title: 'Enable Caching',
          description: 'Cache API responses for better performance',
          default: true
        }
      }
    }
  };

  /**
   * Get current values for a category from the store
   */
  function getCategoryValues(category: SettingsCategory): Record<string, unknown> {
    const settings = getSettings();
    const categorySettings = settings[category];
    // Convert to Record<string, unknown> for SchemaForm compatibility
    return Object.fromEntries(Object.entries(categorySettings));
  }

  /**
   * Handle form value changes
   */
  function handleChange(category: SettingsCategory, values: Record<string, unknown>): void {
    // Update the store
    updateSettings({ [category]: values });

    // Notify parent if callback provided
    if (onSettingsChange) {
      onSettingsChange(category, values);
    }
  }

  /**
   * Handle sync to cloud button click
   */
  async function handleSync(): Promise<void> {
    try {
      await syncSettingsToApi();
    } catch (error) {
      logger.error('Failed to sync settings:', error);
    }
  }

  /**
   * Handle reset button click
   */
  function handleReset(): void {
    if (confirm(`Reset ${SETTINGS_CATEGORY_LABELS[activeTab]} settings to defaults?`)) {
      resetSettings([activeTab]);
    }
  }

  /**
   * Handle reset all button click
   */
  function handleResetAll(): void {
    if (confirm('Reset all settings to defaults?')) {
      resetSettings();
    }
  }

  /**
   * Handle tab keyboard navigation
   */
  function handleTabKeydown(event: KeyboardEvent, index: number): void {
    const tabs = categories;
    let newIndex = index;

    switch (event.key) {
      case 'ArrowLeft':
        newIndex = index > 0 ? index - 1 : tabs.length - 1;
        break;
      case 'ArrowRight':
        newIndex = index < tabs.length - 1 ? index + 1 : 0;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'End':
        newIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activeTab = tabs[newIndex];

    // Focus the new tab
    const tabElement = document.querySelector(
      `[data-tab="${tabs[newIndex]}"]`
    ) as HTMLElement | null;
    tabElement?.focus();
  }
</script>

<div class="flowdrop-settings-panel {className}">
  <!-- Tab Navigation -->
  <div
    class="flowdrop-settings-panel__tabs"
    role="tablist"
    aria-label={m().layout.settingsCategories}
  >
    {#each categories as category, index (category)}
      <button
        class="flowdrop-settings-panel__tab"
        class:flowdrop-settings-panel__tab--active={activeTab === category}
        role="tab"
        aria-selected={activeTab === category}
        aria-controls="{uid}-panel-{category}"
        id="{uid}-tab-{category}"
        data-tab={category}
        tabindex={activeTab === category ? 0 : -1}
        onclick={() => (activeTab = category)}
        onkeydown={(e) => handleTabKeydown(e, index)}
      >
        <Icon icon={SETTINGS_CATEGORY_ICONS[category]} class="flowdrop-settings-panel__tab-icon" />
        <span class="flowdrop-settings-panel__tab-label">{SETTINGS_CATEGORY_LABELS[category]}</span>
      </button>
    {/each}
  </div>

  <!-- Tab Panels -->
  <div class="flowdrop-settings-panel__content">
    {#each categories as category (category)}
      <div
        id="{uid}-panel-{category}"
        class="flowdrop-settings-panel__panel"
        class:flowdrop-settings-panel__panel--active={activeTab === category}
        role="tabpanel"
        aria-labelledby="{uid}-tab-{category}"
        hidden={activeTab !== category}
      >
        {#if activeTab === category}
          <SchemaForm
            schema={schemas[category]}
            values={getCategoryValues(category)}
            onChange={(values) => handleChange(category, values)}
            showActions={false}
          />
        {/if}
      </div>
    {/each}
  </div>

  <!-- Footer Actions -->
  <div class="flowdrop-settings-panel__footer">
    <div class="flowdrop-settings-panel__footer-start">
      {#if showResetButton}
        <button
          class="flowdrop-settings-panel__btn flowdrop-settings-panel__btn--outline"
          onclick={handleReset}
          title="Reset current category to defaults"
        >
          <Icon icon="mdi:refresh" />
          <span>Reset</span>
        </button>
        <button
          class="flowdrop-settings-panel__btn flowdrop-settings-panel__btn--ghost"
          onclick={handleResetAll}
          title="Reset all settings to defaults"
        >
          Reset All
        </button>
      {/if}
    </div>

    <div class="flowdrop-settings-panel__footer-end">
      {#if showSyncButton}
        <button
          class="flowdrop-settings-panel__btn flowdrop-settings-panel__btn--secondary"
          onclick={handleSync}
          disabled={isSyncing}
          title="Sync settings to cloud"
        >
          {#if isSyncing}
            <Icon icon="mdi:loading" class="flowdrop-settings-panel__spin" />
            <span>Syncing...</span>
          {:else}
            <Icon icon="mdi:cloud-upload" />
            <span>Sync to Cloud</span>
          {/if}
        </button>
      {/if}

      {#if onClose}
        <button
          class="flowdrop-settings-panel__btn flowdrop-settings-panel__btn--primary"
          onclick={onClose}
        >
          <span>Close</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Sync Status Indicator -->
  {#if getSyncStatus().error}
    <div class="flowdrop-settings-panel__error">
      <Icon icon="mdi:alert-circle" />
      <span>{getSyncStatus().error}</span>
    </div>
  {:else if getSyncStatus().status === 'synced' && getSyncStatus().lastSyncedAt}
    <div class="flowdrop-settings-panel__synced">
      <Icon icon="mdi:check-circle" />
      <span>Synced {new Date(getSyncStatus().lastSyncedAt!).toLocaleTimeString()}</span>
    </div>
  {/if}
</div>

<style>
  .flowdrop-settings-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--fd-background);
    color: var(--fd-foreground);
  }

  /* Tabs */
  .flowdrop-settings-panel__tabs {
    display: flex;
    gap: var(--fd-space-3xs);
    padding: var(--fd-space-md);
    border-bottom: 1px solid var(--fd-border);
    overflow-x: auto;
  }

  .flowdrop-settings-panel__tab {
    display: flex;
    align-items: center;
    gap: var(--fd-space-xs);
    padding: var(--fd-space-xs) var(--fd-space-md);
    border: none;
    border-radius: var(--fd-radius-md);
    background-color: transparent;
    color: var(--fd-muted-foreground);
    font-size: var(--fd-text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--fd-transition-fast);
    white-space: nowrap;
  }

  .flowdrop-settings-panel__tab:hover {
    background-color: var(--fd-muted);
    color: var(--fd-foreground);
  }

  .flowdrop-settings-panel__tab--active {
    background-color: var(--fd-primary);
    color: var(--fd-primary-foreground);
  }

  .flowdrop-settings-panel__tab--active:hover {
    background-color: var(--fd-primary);
    color: var(--fd-primary-foreground);
  }

  :global(.flowdrop-settings-panel__tab-icon) {
    font-size: var(--fd-text-base);
  }

  /* Content */
  .flowdrop-settings-panel__content {
    flex: 1;
    overflow-y: auto;
    padding: var(--fd-space-xl);
  }

  .flowdrop-settings-panel__panel {
    display: none;
  }

  .flowdrop-settings-panel__panel--active {
    display: block;
  }

  /* Footer */
  .flowdrop-settings-panel__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--fd-space-md) var(--fd-space-xl);
    border-top: 1px solid var(--fd-border);
    gap: var(--fd-space-md);
  }

  .flowdrop-settings-panel__footer-start,
  .flowdrop-settings-panel__footer-end {
    display: flex;
    gap: var(--fd-space-xs);
    align-items: center;
  }

  /* Buttons */
  .flowdrop-settings-panel__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--fd-space-xs);
    padding: var(--fd-space-xs) var(--fd-space-md);
    border-radius: var(--fd-radius-md);
    font-size: var(--fd-text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--fd-transition-fast);
    border: 1px solid transparent;
  }

  .flowdrop-settings-panel__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .flowdrop-settings-panel__btn--primary {
    background-color: var(--fd-primary);
    color: var(--fd-primary-foreground);
    border-color: var(--fd-primary);
  }

  .flowdrop-settings-panel__btn--primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .flowdrop-settings-panel__btn--secondary {
    background-color: var(--fd-secondary);
    color: var(--fd-secondary-foreground);
    border-color: var(--fd-border);
  }

  .flowdrop-settings-panel__btn--secondary:hover:not(:disabled) {
    background-color: var(--fd-muted);
  }

  .flowdrop-settings-panel__btn--outline {
    background-color: transparent;
    color: var(--fd-foreground);
    border-color: var(--fd-border);
  }

  .flowdrop-settings-panel__btn--outline:hover:not(:disabled) {
    background-color: var(--fd-muted);
  }

  .flowdrop-settings-panel__btn--ghost {
    background-color: transparent;
    color: var(--fd-muted-foreground);
    border-color: transparent;
  }

  .flowdrop-settings-panel__btn--ghost:hover:not(:disabled) {
    background-color: var(--fd-muted);
    color: var(--fd-foreground);
  }

  /* Status Indicators */
  .flowdrop-settings-panel__error,
  .flowdrop-settings-panel__synced {
    display: flex;
    align-items: center;
    gap: var(--fd-space-xs);
    padding: var(--fd-space-xs) var(--fd-space-xl);
    font-size: var(--fd-text-xs);
  }

  .flowdrop-settings-panel__error {
    background-color: var(--fd-destructive);
    color: var(--fd-destructive-foreground);
  }

  .flowdrop-settings-panel__synced {
    background-color: var(--fd-success, #22c55e);
    color: white;
  }

  /* Spin Animation */
  :global(.flowdrop-settings-panel__spin) {
    animation: flowdrop-spin 1s linear infinite;
  }

  @keyframes flowdrop-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
