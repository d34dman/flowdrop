/**
 * FlowDrop Core Module
 *
 * This module exports types, utilities, and lightweight functionality
 * with zero heavy dependencies. Safe to import without bundling
 * @xyflow/svelte, codemirror, or marked.
 *
 * @module core
 *
 * @example
 * ```typescript
 * // Import types and utilities without heavy dependencies
 * import type { Workflow, WorkflowNode, NodeMetadata } from "@flowdrop/flowdrop/core";
 * import { getStatusColor, createDefaultExecutionInfo } from "@flowdrop/flowdrop/core";
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

// Workflow format types
export type { WorkflowFormat, BuiltinWorkflowFormat } from '../types/index.js';
export { DEFAULT_WORKFLOW_FORMAT } from '../types/index.js';

// Main workflow types
export type {
  NodeCategory,
  BuiltinNodeCategory,
  CategoryDefinition,
  NodeDataType,
  NodePort,
  DynamicPort,
  Branch,
  NodeMetadata,
  NodeExtensions,
  NodeUIExtensions,
  PortsConfig,
  PortConfigEntry,
  PortBinding,
  WorkflowInterface,
  WorkflowInterfaceEntry,
  ConfigValues,
  WorkflowNode,
  WorkflowEdge,
  Workflow,
  ApiResponse,
  NodesResponse,
  WorkflowResponse,
  WorkflowsResponse,
  ExecutionStatus,
  ExecutionResult,
  FlowDropConfig,
  WorkflowEvents,
  BuiltinNodeType,
  // Port configuration
  PortConfig,
  PortCompatibilityRule,
  // Config Schema
  ConfigSchema,
  ConfigProperty,
  // Admin/Edit configuration types
  HttpMethod,
  DynamicSchemaEndpoint,
  ExternalEditLink,
  ConfigEditOptions,
  // Edge types
  EdgeCategory,
  // UISchema types
  UISchemaElementType,
  UISchemaElementBase,
  UISchemaControl,
  UISchemaVerticalLayout,
  UISchemaGroup,
  UISchemaElement
} from '../types/index.js';

export { isUISchemaControl, isUISchemaVerticalLayout, isUISchemaGroup } from '../types/index.js';

// Configuration types
export type {
  WorkflowEditorConfig,
  EditorFeatures,
  UIConfig,
  APIConfig,
  ExecutionConfig,
  StorageConfig
} from '../types/config.js';

// Authentication types
export type { AuthProvider, StaticAuthConfig, CallbackAuthConfig } from '../types/auth.js';

// Event types
export type {
  WorkflowChangeType,
  FlowDropEventHandlers,
  FlowDropFeatures
} from '../types/events.js';

// Form field types (no component dependencies)
export type {
  FieldSchema,
  FieldType,
  FieldFormat,
  FieldOption,
  SchemaFormProps,
  BaseFieldProps,
  TextFieldProps,
  TextareaFieldProps,
  NumberFieldProps,
  ToggleFieldProps,
  RangeFieldProps,
  SelectFieldProps,
  CheckboxGroupFieldProps,
  ArrayFieldProps,
  CodeEditorFieldProps,
  MarkdownEditorFieldProps,
  TemplateEditorFieldProps,
  FormFieldFactoryProps,
  FormFieldWrapperProps
} from '../components/form/types.js';

// Base registry
export { BaseRegistry } from '../registry/BaseRegistry.svelte.js';

// Registry types
export type {
  NodeComponentProps,
  NodeTypeInfo,
  NodeComponentRegistration,
  NodeComponentCategory,
  StatusPosition,
  StatusSize,
  NodeRegistrationFilter,
  FlowDropPluginConfig,
  PluginNodeDefinition,
  PluginRegistrationResult
} from '../registry/index.js';

// Field registry types (framework-agnostic)
export type { FieldMatcherRegistration } from '../form/fieldRegistry.js';

// Workflow format registry (the class — instances live on `fd.formats`)
export { WorkflowFormatRegistry } from '../registry/workflowFormatRegistry.js';
export type {
  WorkflowFormatAdapter,
  FormatValidationResult
} from '../registry/workflowFormatRegistry.js';

// Built-in format adapters (used to seed instance format registries)
export { getBuiltinFormatAdapters } from '../registry/builtinFormats.js';

// Service types
export type { ToastType, ToastOptions } from '../services/toastService.js';
export type { DynamicSchemaResult } from '../services/dynamicSchemaService.js';

// Playground types
export type {
  PlaygroundSession,
  PlaygroundMessage,
  PlaygroundInputField,
  PlaygroundMessageRequest,
  PlaygroundMessagesResult,
  PlaygroundConfig,
  PlaygroundMode,
  PlaygroundSessionStatus,
  PlaygroundMessageRole,
  PlaygroundMessageLevel,
  PlaygroundMessageMetadata,
  PlaygroundApiResponse,
  PlaygroundSessionsResponse,
  PlaygroundSessionResponse,
  PlaygroundMessageResponse,
  PlaygroundMessagesApiResponse
} from '../types/playground.js';

export { isChatInputNode, CHAT_INPUT_PATTERNS } from '../types/playground.js';

// Endpoint config types
export type { EndpointConfig } from '../config/endpoints.js';

// Svelte app types
export type { FlowDropMountOptions, MountedFlowDropApp, NavbarAction } from '../svelte-app.js';

// ============================================================================
// Authentication Providers (no dependencies)
// ============================================================================

export { StaticAuthProvider, CallbackAuthProvider, NoAuthProvider } from '../types/auth.js';

// ============================================================================
// Event Utilities
// ============================================================================

export { DEFAULT_FEATURES, mergeFeatures } from '../types/events.js';

// ============================================================================
// Utility Functions (no heavy dependencies)
// ============================================================================

// Node status utilities
export {
  getStatusColor,
  getStatusIcon,
  getStatusLabel,
  getStatusBackgroundColor,
  getStatusTextColor,
  createDefaultExecutionInfo,
  updateExecutionStart,
  updateExecutionComplete,
  updateExecutionFailed,
  resetExecutionInfo,
  formatExecutionDuration,
  formatLastExecuted
} from '../utils/nodeStatus.js';

// Node wrapper utilities
export {
  createNodeWrapperConfig,
  shouldShowNodeStatus,
  getOptimalStatusPosition,
  getOptimalStatusSize,
  DEFAULT_NODE_STATUS_CONFIG
} from '../utils/nodeWrapper.js';
export type { NodeStatusConfig } from '../utils/nodeWrapper.js';

// Color utilities
export {
  CATEGORY_COLOR_TOKENS,
  DEFAULT_COLORS,
  getCategoryColorToken,
  getDataTypeColorToken,
  getDataTypeConfig,
  getAvailableDataTypes,
  getCategoryColors,
  getCategoryBackground,
  getCategoryAccent,
  getCategoryText,
  getCategoryBorder,
  getNodeColors,
  getNodeBackground,
  getNodeAccent,
  getNodeText,
  getNodeBorder,
  getDataTypeColor,
  parseDataTypeDisplay,
  getDataTypeDisplayText,
  isArrayDataType,
  getArrayElementType,
  hexToRgb,
  getRelativeLuminance,
  isLightColor,
  getContrastTextColor,
  resolveColorToken,
  getContrastTextColorForDataType,
  getContrastTextColorForCategory,
  getPortBackgroundColor,
  getPortBorderColor,
  rgbToHex,
  getLightTint,
  getDarkTint,
  getBorderTint,
  getDarkBorderTint,
  getColorVariants,
  getThemeAwareColorVariants
} from '../utils/colors.js';
export type { ColorVariants } from '../utils/colors.js';

// Icon utilities
export {
  DEFAULT_ICONS,
  CATEGORY_ICONS,
  getNodeIcon,
  getCategoryIcon,
  getDefaultIcon,
  isValidIcon,
  getValidIcon
} from '../utils/icons.js';

// Config utilities
export {
  createDefaultFeatures,
  createDefaultUIConfig,
  createDefaultAPIConfig,
  createDefaultExecutionConfig,
  createDefaultStorageConfig,
  createDefaultConfig,
  mergeConfig,
  validateConfig
} from '../utils/config.js';

// Node type utilities
export {
  getComponentNameForNodeType,
  getAvailableNodeTypes,
  getPrimaryNodeType,
  resolveNodeType,
  resolveComponentName,
  isNodeTypeSupported,
  getNodeTypeOneOfOptions,
  createNodeTypeConfigProperty,
  isValidNodeType,
  getAllNodeTypes
} from '../utils/nodeTypes.js';

// Connection utilities (including loopback edge detection)
export {
  isLoopbackEdge,
  isValidLoopbackCycle,
  hasCycles,
  hasInvalidCycles
} from '../utils/connections.js';

// Form type utilities
export { isFieldOptionArray, normalizeOptions } from '../components/form/types.js';

// UISchema utilities
export {
  resolveScopeToKey,
  keyToScope,
  generateDefaultUISchema,
  collectReferencedKeys
} from '../utils/uischema.js';

// ============================================================================
// Configuration
// ============================================================================

export { DEFAULT_PORT_CONFIG } from '../config/defaultPortConfig.js';
export { defaultEndpointConfig, createEndpointConfig } from '../config/endpoints.js';

// ============================================================================
// Shared Utilities
// ============================================================================

export { generateNodeId, extractConfigDefaults } from '../utils/nodeIds.js';

// ============================================================================
// Command DSL
// ============================================================================

export type {
  AddNodeCommand,
  DeleteNodeCommand,
  RenameNodeCommand,
  SetConfigCommand,
  GetConfigCommand,
  ConnectCommand,
  DisconnectPortsCommand,
  DisconnectNodeCommand,
  ListNodesCommand,
  ListEdgesCommand,
  ListTypesCommand,
  DescribeTypeCommand,
  SearchTypesCommand,
  InfoCommand,
  UndoCommand,
  RedoCommand,
  ConfigOpenCommand,
  SelectNodeCommand,
  HelpCommand,
  ClearCommand,
  SwapNodeCommand,
  MoveNodeCommand,
  AutoLayoutCommand,
  Command,
  ParseResult,
  CommandErrorCode,
  AddNodeResultData,
  ListNodesResultData,
  ListEdgesResultData,
  ListTypesResultData,
  SearchTypesResultData,
  DescribeTypeResultData,
  TypeSummary,
  ConfigKeyDescription,
  PortDescription,
  InfoResultData,
  GetConfigResultData,
  GetConfigKeyResultData,
  GetConfigAllResultData,
  SetConfigResultData,
  HelpResultData,
  CommandResultData,
  CommandResultOk,
  CommandResultError,
  CommandResult,
  BatchResult,
  UIAction,
  CommandDispatch,
  CommandContext
} from '../commands/index.js';

export {
  buildTypeMap,
  parseCommand,
  executeCommand,
  toShortId,
  toShortTypeId,
  resolveNode,
  executeBatch,
  computeAutoPosition
} from '../commands/index.js';

// ============================================================================
// Adapters
// ============================================================================

export { WorkflowAdapter } from '../adapters/WorkflowAdapter.js';
export type {
  StandardNode,
  StandardEdge,
  StandardWorkflow,
  WorkflowExecutionResult,
  WorkflowValidationResult
} from '../adapters/WorkflowAdapter.js';

// ============================================================================
// Agent Spec Types & Adapter
// ============================================================================

// Agent Spec type definitions
export type {
  AgentSpecNodeComponentType,
  AgentSpecToolComponentType,
  AgentSpecComponentType,
  AgentSpecProperty,
  AgentSpecNodeBase,
  AgentSpecStartNode,
  AgentSpecEndNode,
  AgentSpecLLMNode,
  AgentSpecAPINode,
  AgentSpecAgentNode,
  AgentSpecFlowNode,
  AgentSpecMapNode,
  AgentSpecBranchingNode,
  AgentSpecToolNode,
  AgentSpecNode,
  AgentSpecBranch,
  AgentSpecControlFlowEdge,
  AgentSpecDataFlowEdge,
  AgentSpecFlow,
  AgentSpecToolBase,
  AgentSpecServerTool,
  AgentSpecClientTool,
  AgentSpecRemoteTool,
  AgentSpecTool,
  AgentSpecLLMConfig,
  AgentSpecAgent,
  AgentSpecDocument
} from '../types/agentspec.js';

export {
  COMPONENT_REF_PREFIX,
  isComponentRef,
  extractComponentRefId,
  createComponentRef
} from '../types/agentspec.js';

// Agent Spec default node types (optional starter templates — users can provide their own)
export {
  getAgentSpecNodeMetadata,
  getDefaultAgentSpecNodeTypes,
  createAgentSpecNodeMetadata
} from '../adapters/agentspec/defaultNodeTypes.js';

// Agent Spec component type defaults (adapter infrastructure)
export {
  getComponentTypeDefaults,
  extractComponentType,
  isAgentSpecNodeId,
  AGENTSPEC_NAMESPACE
} from '../adapters/agentspec/componentTypeDefaults.js';
export type { ComponentTypeDefaults } from '../adapters/agentspec/componentTypeDefaults.js';

// Agent Spec adapter (bidirectional conversion)
export { AgentSpecAdapter } from '../adapters/agentspec/AgentSpecAdapter.js';

// Agent Spec agent-level adapter
export { AgentSpecAgentAdapter } from '../adapters/agentspec/agentAdapter.js';
export type { AgentConfig, AgentSpecImportResult } from '../adapters/agentspec/agentAdapter.js';

// Agent Spec validation
export {
  validateForAgentSpecExport,
  validateAgentSpecFlow
} from '../adapters/agentspec/validator.js';
export type { AgentSpecValidationResult } from '../adapters/agentspec/validator.js';

// Agent Spec auto-layout
export { computeAutoLayout } from '../adapters/agentspec/autoLayout.js';
export type { AutoLayoutConfig } from '../adapters/agentspec/autoLayout.js';

// Agent Spec runtime endpoint configuration
export type { AgentSpecEndpointConfig } from '../config/agentSpecEndpoints.js';
export {
  defaultAgentSpecEndpoints,
  createAgentSpecEndpointConfig,
  buildAgentSpecUrl,
  getAgentSpecAuthHeaders
} from '../config/agentSpecEndpoints.js';

// Agent Spec execution service (instantiate per instance — no global singleton)
export { AgentSpecExecutionService } from '../services/agentSpecExecutionService.js';
export type { AgentSpecExecutionHandle } from '../services/agentSpecExecutionService.js';

// ============================================================================
// Workflow JSON Schema
// ============================================================================

export { workflowSchema, WORKFLOW_SCHEMA_VERSION } from '../schemas/index.js';

// ============================================================================
// Theme System (FlowDrop UI themes — skin + config bundles)
// ============================================================================

export type { FlowDropTheme, FlowDropThemeName, FlowDropThemeConfig } from '../types/theme.js';
export { defaultTheme, minimalTheme, resolveTheme } from '../themes/index.js';

// Skin primitives — for custom theme authors who need to compose skins
export type { FlowDropSkin, FlowDropSkinName, FlowDropSkinTokens } from '../types/skin.js';
export { slateSkin, defaultSkin } from '../skins/index.js';

// ============================================================================
// Color Theme System (light/dark preference)
// ============================================================================

export type { ThemePreference, ResolvedTheme } from '../stores/settingsStore.svelte.js';
export {
  getTheme as theme,
  getResolvedTheme as resolvedTheme,
  setTheme,
  toggleTheme,
  cycleTheme,
  initializeTheme,
  isThemeInitialized
} from '../stores/settingsStore.svelte.js';

// ============================================================================
// Logger
// ============================================================================

export { logger, setLogLevel, getLogLevel } from '../utils/logger.js';
export type { LogLevel } from '../utils/logger.js';

// ============================================================================
// Node Swap
// ============================================================================

export {
  computeSwapPreview,
  computeSwapPreviewWithOptions,
  executeSwap,
  mapConfig,
  getVersionUpgrade,
  compareSemver,
  performSwap,
  validateSwapResult,
  SwapValidationError
} from '../utils/nodeSwap.js';
export type {
  SwapPreview,
  SwapResult,
  PortMapping,
  DroppedEdge,
  MatchQuality,
  PortMappingOverride,
  ConfigMappingOverride,
  SwapOptions,
  SwapStrategy,
  SwapStrategyContext,
  SwapEventContext
} from '../utils/nodeSwap.js';

// ============================================================================
// Messages (typed, overridable, translation-ready user-facing strings)
//
// Consumers pass `messages={partial}` (or a getter) to <FlowDrop>; type the
// partial as `MessagesOverride`. `setMessages` + `mergeMessages` are exported
// for ad-hoc mounts that render flowdrop components outside the root provider
// (Storybook stories, standalone <SchemaForm>, etc.) — see the i18n guide.
// ============================================================================

export { defaultMessages, mergeMessages, setMessages } from '../messages/index.js';
export type { Messages, MessagesOverride } from '../messages/index.js';
