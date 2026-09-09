/**
 * Library-wide Constants
 *
 * Centralizes magic numbers and default configuration values
 * used across FlowDrop services.
 *
 * @module config/constants
 */

/** Default API request timeout in milliseconds */
export const DEFAULT_API_TIMEOUT_MS = 30_000;

/** Cache timeout for node execution data in milliseconds */
export const NODE_EXECUTION_CACHE_TIMEOUT_MS = 30_000;

/** Duration to mark pipeline API as unavailable after 404 (milliseconds) */
export const PIPELINE_API_UNAVAILABLE_DURATION_MS = 5 * 60 * 1000;

/** Default cache TTL for schema and variable data in milliseconds (5 minutes) */
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Custom arrowhead dimensions (in pixels) drawn by FlowDropEdge.
 * The edge path is shortened by ARROW_LENGTH_PX so the stroke ends
 * at the arrow base, and the arrowhead polygon is rendered separately
 * at the target handle position.
 */
export const ARROW_LENGTH_PX = 8;
export const ARROW_HALF_WIDTH_PX = 4;

/** Edge marker arrow sizes by category */
export const EDGE_MARKER_SIZES = {
  loopback: { width: 14, height: 14 },
  trigger: { width: 16, height: 16 },
  tool: { width: 16, height: 16 },
  data: { width: 16, height: 16 }
} as const;

/**
 * How long each kind of toast stays, in milliseconds. `Infinity` means it
 * stays until the user closes it: errors and warnings name something to act
 * on, and a message that vanishes mid-read was never delivered.
 */
export const TOAST_DURATION = {
  SUCCESS: 4_000,
  ERROR: Infinity,
  WARNING: Infinity,
  INFO: 4_000,
  CONFIRMATION: 5_000
} as const;
