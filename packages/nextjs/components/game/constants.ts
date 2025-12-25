/**
 * Renderer-specific constants.
 */

// Direction to sprite sheet position: [col, row]
// Sheet layout: [[SOUTH, EAST], [NORTH, WEST]]
// Direction indices: 0=north, 1=east, 2=south, 3=west
export const DIRECTION_SPRITE_POS: [number, number][] = [
  [0, 1], // 0=north → bottom-left
  [1, 0], // 1=east → top-right
  [0, 0], // 2=south → top-left
  [1, 1], // 3=west → bottom-right
];

// Vehicle sprite vertical offset (negative = up, positive = down)
export const VEHICLE_Y_OFFSET = -32;

// Vehicle depth offset for isometric sorting (higher = rendered later/on top)
// Set to ~1.0 as a compromise between two edge cases:
// - Higher (1.1+): vehicles render over mountains they should be behind
// - Lower (0.9-): ground tiles at intersections cover vehicles
// 0.99 gives vehicles a tiny nudge "behind" to help with mountain occlusion
export const VEHICLE_DEPTH_OFFSET = 0.99;

// Ground tile depth offset (negative so ground renders before vehicles)
// This allows vehicles to render on top of ground tiles they're crossing
// while still being occluded by mountains (which have no offset)
export const GROUND_DEPTH_OFFSET = -1.0;

// First sprite sheet index that is a mountain (ground sheets are 0-10, mountains are 11+)
export const FIRST_MOUNTAIN_SHEET_INDEX = 11;

// Flag depth offset for sorting (in pixels, used before depth conversion)
export const FLAG_DEPTH_OFFSET = -25;

// Zoom limits
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

// Zoom sensitivity for mouse wheel
export const ZOOM_SENSITIVITY = 0.001;

// Minimap configuration
export const MINIMAP_SIZE = 180; // Size in pixels (square)
export const MINIMAP_MARGIN = 16; // Margin from screen edge
export const MINIMAP_SCALE = 0.06; // World-to-minimap scale (smaller = more area visible)
export const MINIMAP_SPRITE_SIZE = 12; // Vehicle sprite size on minimap
export const MINIMAP_BG_COLOR = "rgba(0, 0, 0, 0.75)";
export const MINIMAP_BORDER_COLOR = "#555";
export const MINIMAP_BORDER_WIDTH = 2;
export const MINIMAP_CORNER_RADIUS = 8;

// Top-view sprite position in sprite sheet (Frame 4 at col=2, row=0)
export const TOP_VIEW_SPRITE_COL = 2;
export const TOP_VIEW_SPRITE_ROW = 0;

// Direction to rotation angle (radians) for top-view sprites on minimap
// Top-view sprite faces North (up) by default, so we rotate based on direction
export const DIRECTION_TO_ROTATION: number[] = [
  0, // 0=north: 0 degrees (no rotation)
  Math.PI / 2, // 1=east: 90 degrees clockwise
  Math.PI, // 2=south: 180 degrees
  -Math.PI / 2, // 3=west: 270 degrees (or -90)
];
