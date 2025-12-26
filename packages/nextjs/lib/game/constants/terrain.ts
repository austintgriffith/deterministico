/**
 * Terrain type system constants.
 * Defines terrain types, their sprite sheets, and generation weights.
 */

// Terrain type system

export type TerrainType = "ground" | "mountain" | "liquid" | "mushroom" | "rubyMountain" | "undiscovered";

// Sprite sheets organized by terrain type (liquid has no sprites - rendered as colored diamond)
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
  mountain: ["mountain_tiles_1", "mountain_tiles_2", "mountain_tiles_3", "mountain_tiles_4"],
  liquid: [], // No sprite sheets - rendered as colored diamond
  mushroom: ["mushrooms"],
  rubyMountain: ["rubymountain_tiles_01"],
  undiscovered: ["unknown"], // Fog of war / unexplored areas
};

// Terrain type weights (must sum to 100 for natural terrain types)
export const TERRAIN_WEIGHTS: Record<TerrainType, number> = {
  ground: 50,
  mountain: 20,
  liquid: 17,
  mushroom: 10,
  rubyMountain: 3,
  undiscovered: 0, // Not naturally generated - applied programmatically for fog of war
};

// Terrain types in order for weighted selection (undiscovered excluded - not naturally generated)
export const TERRAIN_TYPES: TerrainType[] = ["ground", "mountain", "liquid", "mushroom", "rubyMountain"];

// All available sprite sheets (flattened for loading)
export const SPRITE_SHEETS = [
  ...TERRAIN_SHEETS.ground,
  ...TERRAIN_SHEETS.mountain,
  ...TERRAIN_SHEETS.mushroom,
  ...TERRAIN_SHEETS.rubyMountain,
  ...TERRAIN_SHEETS.undiscovered,
] as const;

export type SpriteSheetName = (typeof SPRITE_SHEETS)[number];
