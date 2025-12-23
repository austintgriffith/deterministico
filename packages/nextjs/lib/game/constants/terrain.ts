/**
 * Terrain type system constants.
 * Defines terrain types, their sprite sheets, and generation weights.
 */

// Terrain type system
export type TerrainType = "ground" | "mountain" | "rubyMountain";

// Sprite sheets organized by terrain type
export const TERRAIN_SHEETS: Record<TerrainType, string[]> = {
  ground: [
    "ground_tiles_00",
    "ground_tiles_01",
    "ground_tiles_02",
    "ground_tiles_03",
    "ground_tiles_04",
    "ground_tiles_05",
    "ground_tiles_06",
    "ground_tiles_07",
    "ground_tiles_08",
    "ground_tiles_09",
    "ground_tiles_10",
  ],
  mountain: ["mountain_tiles_1", "mountain_tiles_2", "mountain_tiles_3"],
  rubyMountain: ["rubymountain_tiles_01"],
};

// Terrain type weights (must sum to 100)
export const TERRAIN_WEIGHTS: Record<TerrainType, number> = {
  ground: 80, // 80%
  mountain: 18, // 18%
  rubyMountain: 2, //  2%
};

// Terrain types in order for weighted selection
export const TERRAIN_TYPES: TerrainType[] = ["ground", "mountain", "rubyMountain"];

// All available sprite sheets (flattened for loading)
export const SPRITE_SHEETS = [
  ...TERRAIN_SHEETS.ground,
  ...TERRAIN_SHEETS.mountain,
  ...TERRAIN_SHEETS.rubyMountain,
] as const;

export type SpriteSheetName = (typeof SPRITE_SHEETS)[number];
