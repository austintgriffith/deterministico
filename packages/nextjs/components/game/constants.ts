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
export const VEHICLE_Y_OFFSET = -30;

// Flag depth offset for sorting
export const FLAG_DEPTH_OFFSET = -25;

// Zoom limits
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

// Zoom sensitivity for mouse wheel
export const ZOOM_SENSITIVITY = 0.001;
