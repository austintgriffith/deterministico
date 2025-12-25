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
// Frames 0-3: Directional (used in game rendering)
// Frames 4-5: UI only (Top/Side views for menus, tooltips, etc.)
export const VEHICLE_FRAME_OFFSETS = [
  { x: -21, y: -4 }, // Frame 0 (South)
  { x: -32, y: -3 }, // Frame 1 (East)
  { x: -30, y: 26 }, // Frame 2 (North)
  { x: -15, y: 28 }, // Frame 3 (West)
  { x: -8, y: -44 }, // Frame 4 (Top - UI only)
  { x: -1, y: -11 }, // Frame 5 (Side - UI only)
];
