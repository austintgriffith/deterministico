import {
  DIRECTION_VECTORS,
  MOVE_AMOUNT,
  SPRITE_SHEETS,
  TERRAIN_SHEETS,
  TERRAIN_TYPES,
  TERRAIN_WEIGHTS,
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  TILE_START_Y,
  TILE_STEP_Y,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  TOTAL_TILES_PER_SHEET,
  TURN_LEFT,
  TURN_RIGHT,
  TerrainType,
} from "./constants";
import { Agent, SpawnPoint, TileData } from "./types";
import { DeterministicDice } from "deterministic-dice";
import { encodePacked, keccak256 } from "viem";

/**
 * Process an agent's action based on a dice roll result (0-15)
 * - 0-9 (62.5%): Move forward
 * - 10-12 (18.75%): Turn left
 * - 13-15 (18.75%): Turn right
 */
export function processAgentAction(agent: Agent, action: number): Agent {
  if (action <= 9) {
    // Move forward
    const vec = DIRECTION_VECTORS[agent.direction];
    return {
      ...agent,
      x: agent.x + vec.dx * MOVE_AMOUNT,
      y: agent.y + vec.dy * MOVE_AMOUNT,
    };
  } else if (action <= 12) {
    // Turn left
    return { ...agent, direction: TURN_LEFT[agent.direction] };
  } else {
    // Turn right
    return { ...agent, direction: TURN_RIGHT[agent.direction] };
  }
}

/**
 * Keccak256-based hash function for Solidity compatibility
 * Returns a bigint that can be used for deterministic position-based randomness
 *
 * Solidity equivalent:
 * function hash(uint256 x, uint256 y, uint256 seed) pure returns (uint256) {
 *     return uint256(keccak256(abi.encodePacked(x, y, seed)));
 * }
 */
export function hash(x: number, y: number, seed: bigint): bigint {
  return BigInt(keccak256(encodePacked(["uint256", "uint256", "uint256"], [BigInt(x), BigInt(y), seed])));
}

/**
 * Get terrain type based on weighted random selection (deterministic)
 * Uses keccak256 hash for position-based randomness
 */
export function getWeightedTerrainType(row: number, col: number, seed: bigint): TerrainType {
  const roll = Number(hash(row, col, seed) % 100n); // 0-99
  let cumulative = 0;
  for (const terrainType of TERRAIN_TYPES) {
    cumulative += TERRAIN_WEIGHTS[terrainType];
    if (roll < cumulative) {
      return terrainType;
    }
  }
  return "ground"; // Fallback (shouldn't happen if weights sum to 100)
}

/**
 * Apply one smoothing pass using cellular automata rules
 * Groups similar terrain types together for a more natural look
 */
export function smoothTerrainGrid(grid: TerrainType[][], passNumber: number, seed: bigint): TerrainType[][] {
  const newGrid: TerrainType[][] = [];

  for (let row = 0; row < grid.length; row++) {
    const newRow: TerrainType[] = [];
    for (let col = 0; col < grid[row].length; col++) {
      const currentType = grid[row][col];

      // Count neighbors of each type (including self)
      const counts: Record<TerrainType, number> = {
        ground: 0,
        mountain: 0,
        liquid: 0,
        mushroom: 0,
        rubyMountain: 0,
      };

      // Check 3x3 neighborhood (including self)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[nr].length) {
            counts[grid[nr][nc]]++;
          }
        }
      }

      // Determine dominant type
      let dominantType: TerrainType = currentType;
      let maxCount = counts[currentType];

      for (const terrainType of TERRAIN_TYPES) {
        if (counts[terrainType] > maxCount) {
          maxCount = counts[terrainType];
          dominantType = terrainType;
        }
      }

      // Preserve rare types (rubyMountain) - only change if very isolated (0-1 neighbors)
      if (currentType === "rubyMountain") {
        // rubyMountain stays unless it has 0-1 same-type neighbors (including self)
        if (counts.rubyMountain >= 2) {
          newRow.push(currentType);
          continue;
        }
      }

      // For ties or close counts, use deterministic roll to decide
      if (maxCount === counts[currentType]) {
        // Keep current type if it's tied
        newRow.push(currentType);
      } else if (maxCount - counts[currentType] <= 2) {
        // Close call - use deterministic roll
        const tieBreaker = Number(hash(row + passNumber * 1000, col + passNumber * 1000, seed) % 100n);
        if (tieBreaker < 40) {
          newRow.push(currentType); // 40% chance to keep current
        } else {
          newRow.push(dominantType);
        }
      } else {
        // Clear majority - switch to dominant type
        newRow.push(dominantType);
      }
    }
    newGrid.push(newRow);
  }

  return newGrid;
}

/**
 * Result of grid generation including both tile data and terrain types
 */
export type GridData = {
  tiles: TileData[][];
  terrain: TerrainType[][];
};

/**
 * Generate a 2D grid of tile data from a roll hash
 * Uses three-phase generation:
 * 1. Weighted type assignment (ground 80%, mountain 18%, rubyMountain 2%)
 * 2. Smoothing passes (cellular automata for natural clustering)
 * 3. Tile variant selection (random sheet + tile from terrain type)
 *
 * Returns both tile data (for rendering) and terrain types (for movement checks).
 *
 * Solidity equivalent for seed derivation:
 * uint256 seed = uint256(keccak256(abi.encodePacked(roll, "map")));
 */
export function generateGrid(roll: `0x${string}`, gridSize: number): GridData {
  // Derive seed from roll hash using keccak256 (Solidity compatible)
  const seed = BigInt(keccak256(encodePacked(["bytes32", "string"], [roll as `0x${string}`, "map"])));

  // Phase 1: Generate initial type grid with weighted random selection
  let typeGrid: TerrainType[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const rowTypes: TerrainType[] = [];
    for (let col = 0; col < gridSize; col++) {
      rowTypes.push(getWeightedTerrainType(row, col, seed));
    }
    typeGrid.push(rowTypes);
  }

  // Phase 2: Apply smoothing passes (2 passes for natural clustering)
  typeGrid = smoothTerrainGrid(typeGrid, 1, seed);
  typeGrid = smoothTerrainGrid(typeGrid, 2, seed);

  // Phase 3: Select tile variants based on terrain type
  const tiles: TileData[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const rowTiles: TileData[] = [];
    for (let col = 0; col < gridSize; col++) {
      const terrainType = typeGrid[row][col];

      // Get available sheets for this terrain type
      const availableSheets = TERRAIN_SHEETS[terrainType];

      // Handle terrain types with no sprite sheets (e.g., liquid)
      if (availableSheets.length === 0) {
        // Use -1 as marker for "no sprite" - renderer will draw colored overlay
        rowTiles.push({ sheetIndex: -1, tileIndex: 0 });
        continue;
      }

      // Use deterministic hash to select sheet and tile
      const sheetHash = hash(row + 2000, col + 2000, seed);
      const tileHash = hash(row + 3000, col + 3000, seed);

      // Select random sheet from available sheets for this terrain type
      const selectedSheetName = availableSheets[Number(sheetHash % BigInt(availableSheets.length))];

      // Find the index in the full SPRITE_SHEETS array
      const sheetIndex = SPRITE_SHEETS.findIndex(s => s === selectedSheetName);

      // Select random tile index (0-14 for 5x3 grid)
      const tileIndex = Number(tileHash % BigInt(TOTAL_TILES_PER_SHEET));

      rowTiles.push({ sheetIndex, tileIndex });
    }
    tiles.push(rowTiles);
  }

  return { tiles, terrain: typeGrid };
}

/**
 * Coordinate conversion utilities
 */

/**
 * Convert tile coordinates (row, col) to world coordinates (top-left corner of tile)
 * @param row - Tile row index
 * @param col - Tile column index
 * @param centerX - X coordinate of map center
 * @returns World coordinates { x, y } of tile's top-left corner
 */
export function tileToWorld(row: number, col: number, centerX: number): { x: number; y: number } {
  return {
    x: centerX + (col - row) * TILE_X_SPACING,
    y: (col + row) * TILE_Y_SPACING,
  };
}

/**
 * Convert tile coordinates (row, col) to world coordinates at the center of the tile
 * Use this for placing entities (flags, spawn points) that should be centered on tiles.
 *
 * The isometric diamond is positioned within the 200x200 tile image:
 * - X center: TILE_RENDER_WIDTH / 2 = 100 (horizontal center of image)
 * - Y center: Calculated from sprite offset (TILE_START_Y scaled) + half diamond height
 *   The diamond starts ~41px from top (34 * 200/166) and is 94px tall (2 * TILE_Y_SPACING)
 *   So center is at ~88px from image top
 *
 * @param row - Tile row index
 * @param col - Tile column index
 * @param centerX - X coordinate of map center
 * @returns World coordinates { x, y } at the center of the tile diamond
 */
export function tileCenterToWorld(row: number, col: number, centerX: number): { x: number; y: number } {
  // Calculate the Y offset to the center of the isometric diamond within the tile image
  // Diamond top is at scaled TILE_START_Y, center is half a diamond height below that
  const scaledTopOffset = (TILE_START_Y * TILE_RENDER_HEIGHT) / TILE_STEP_Y; // ~41
  const tileCenterYOffset = scaledTopOffset + TILE_Y_SPACING; // ~88

  return {
    x: centerX + (col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2,
    y: (col + row) * TILE_Y_SPACING + tileCenterYOffset,
  };
}

/**
 * Check if a point is far enough from all existing spawn points
 * @param x - X coordinate to check
 * @param y - Y coordinate to check
 * @param spawns - Array of existing spawn points
 * @param minDistance - Minimum required distance
 * @returns true if point is far enough from all spawns
 */
export function isFarEnough(x: number, y: number, spawns: SpawnPoint[], minDistance: number): boolean {
  for (const spawn of spawns) {
    const dx = x - spawn.x;
    const dy = y - spawn.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < minDistance) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a tile is a valid spawn location.
 * A valid spawn tile must be on "ground" terrain AND have at least 4 ground neighbors.
 * This ensures home bases are placed on open flat areas, not isolated tiles.
 *
 * @param row - Tile row index
 * @param col - Tile column index
 * @param terrainGrid - 2D array of terrain types
 * @param minGroundNeighbors - Minimum number of ground neighbors required (default 4)
 * @returns true if the tile is a valid spawn location
 */
export function isValidSpawnTile(
  row: number,
  col: number,
  terrainGrid: TerrainType[][],
  minGroundNeighbors: number = 4,
): boolean {
  // Check bounds
  if (row < 0 || row >= terrainGrid.length || col < 0 || col >= terrainGrid[0]?.length) {
    return false;
  }

  // Center tile must be ground
  if (terrainGrid[row][col] !== "ground") {
    return false;
  }

  // Count ground neighbors (8-directional)
  let groundCount = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue; // Skip center tile
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < terrainGrid.length && nc >= 0 && nc < terrainGrid[nr].length) {
        if (terrainGrid[nr][nc] === "ground") {
          groundCount++;
        }
      }
    }
  }

  return groundCount >= minGroundNeighbors;
}

/**
 * Generate spawn points for all teams within the valid tile area.
 * Uses tile coordinates to ensure spawns are always on the map.
 * Spawn points are placed on flat ground tiles with sufficient ground neighbors.
 *
 * @param dice - Deterministic dice for random generation
 * @param centerX - X coordinate of map center
 * @param gridSize - Size of the grid
 * @param numTeams - Number of teams to generate spawn points for
 * @param minDistance - Minimum distance between spawn points
 * @param terrainGrid - 2D array of terrain types for spawn validation
 * @returns Array of spawn points, one per team
 */
export function generateSpawnPoints(
  dice: DeterministicDice,
  centerX: number,
  gridSize: number,
  numTeams: number,
  minDistance: number,
  terrainGrid: TerrainType[][],
): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  const tileMargin = 10; // Stay this many tiles away from edges

  for (let team = 0; team < numTeams; team++) {
    let attempts = 0;
    let worldX: number, worldY: number;
    let row: number, col: number;

    do {
      // Generate random tile coordinates within bounds
      row = tileMargin + dice.roll(gridSize - 2 * tileMargin);
      col = tileMargin + dice.roll(gridSize - 2 * tileMargin);

      // Convert to world coordinates (centered on tile)
      const world = tileCenterToWorld(row, col, centerX);
      worldX = world.x;
      worldY = world.y;
      attempts++;
    } while (
      (!isFarEnough(worldX, worldY, spawns, minDistance) || !isValidSpawnTile(row, col, terrainGrid)) &&
      attempts < 100
    );

    spawns.push({ x: worldX, y: worldY });
  }

  return spawns;
}
