/**
 * Core game types.
 */

// Direction type for agent movement
export type Direction = "north" | "east" | "south" | "west";

// Agent state (legacy object-based representation)
export type Agent = {
  x: number;
  y: number;
  direction: Direction;
};

// Tile data for grid generation (sprite sheet index + tile index within sheet)
export type TileData = {
  sheetIndex: number; // Index into SPRITE_SHEETS array (0-14)
  tileIndex: number; // Index within the sprite sheet (0-14)
};

// Spawn point for team bases
export type SpawnPoint = {
  x: number;
  y: number;
};

/**
 * Rendering types.
 */

// Vehicle sprite info (frame dimensions stored per vehicle type)
export type VehicleSpriteInfo = {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
};

// Sprite sheet info (image and dimensions)
export type SpriteSheetInfo = {
  image: HTMLImageElement;
  width: number;
  height: number;
};

// Image cache for canvas rendering
export type ImageCache = {
  // Map of sprite sheet name -> sprite sheet info
  spriteSheets: Map<string, SpriteSheetInfo>;
  // Map of "vehicleType_teamColor" -> sprite info (e.g., "heavy_miner_orange")
  vehicleSprites: Map<string, VehicleSpriteInfo>;
  loaded: boolean;
};

/**
 * Camera types.
 */

// Camera state for pan/zoom
export type CameraState = {
  x: number;
  y: number;
};

// Drag start state
export type DragState = {
  x: number;
  y: number;
  cameraX: number;
  cameraY: number;
};

// Pinch gesture state
export type PinchState = {
  distance: number;
  zoom: number;
  centerX: number;
  centerY: number;
};

/**
 * Drawable types for depth sorting.
 */

export type DrawableAgent = {
  type: "agent";
  y: number;
  index: number;
};

export type DrawableFlag = {
  type: "flag";
  y: number;
  index: number;
};

export type Drawable = DrawableAgent | DrawableFlag;
