/**
 * FlowDrop Command DSL
 *
 * A deterministic command language for programmatic workflow manipulation.
 * Excludes storeIntegration.svelte.ts (Svelte-coupled, import separately).
 *
 * @module commands
 */

// Types
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
  BeautifyLayoutCommand,
  CanvasFitViewCommand,
  CanvasZoomInCommand,
  CanvasZoomOutCommand,
  CanvasZoomToCommand,
  CanvasPanToCommand,
  CanvasResetViewCommand,
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
  SetConfigResultData,
  HelpResultData,
  SwapNodeResultData,
  CommandResultData,
  CommandResultOk,
  CommandResultError,
  CommandResult,
  BatchResult,
  UIAction,
  CommandDispatch,
  CommandContext
} from './types.js';

export { buildTypeMap } from './types.js';

// Parser
export { parseCommand } from './parser.js';

// Executor
export { executeCommand, toShortId, toShortTypeId, resolveNode, COMMAND_HELP } from './executor.js';

// Batch executor
export { executeBatch } from './batch.js';

// Positioner
export { computeAutoPosition } from './positioner.js';
