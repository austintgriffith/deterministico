/**
 * Sprite sheet configuration constants.
 * Calibrated values from the tilesprites calibration tool.
 */

// Sprite sheet grid dimensions
export const SPRITE_SHEET_COLS = 5;
export const SPRITE_SHEET_ROWS = 3;
export const TOTAL_TILES_PER_SHEET = SPRITE_SHEET_COLS * SPRITE_SHEET_ROWS; // 15

// Sprite extraction parameters (pixel offsets within sprite sheets)
export const TILE_START_X = 22;
export const TILE_START_Y = 34;
export const TILE_STEP_X = 196;
export const TILE_STEP_Y = 166;

// Display size for rendered tiles
export const TILE_RENDER_WIDTH = 200;
export const TILE_RENDER_HEIGHT = 200;

// Surface layout (isometric spacing)
export const TILE_X_SPACING = 89; // horizontal offset between tiles
export const TILE_Y_SPACING = 47; // vertical offset between tiles
export const GRID_SIZE = 111; // 111x111 grid (odd number so there's a true center tile)

// Legacy tile dimensions (used for map bounds calculations)
export const TILE_WIDTH = TILE_RENDER_WIDTH;
export const TILE_HEIGHT = TILE_RENDER_HEIGHT;

// Per-frame x,y offsets for vehicle sprites (all vehicles use same offsets)
// Frame index: 0=South, 1=East, 2=North, 3=West
export const VEHICLE_FRAME_OFFSETS = [
  { x: -37, y: 0 }, // Frame 0 (South)
  { x: 20, y: 0 }, // Frame 1 (East)
  { x: -23, y: 47 }, // Frame 2 (North)
  { x: 10, y: 47 }, // Frame 3 (West)
];
