/**
 * Shared simulation logic for agent updates.
 * Used by AgentPool for game simulation.
 *
 * This module contains pure functions with no allocations for maximum performance.
 * All state is passed in via TypedArrays and mutated in place.
 *
 * FIXED-POINT MATH: All position values use x100 fixed-point for Solidity parity.
 * Direction vectors, speeds, and distances are all pre-scaled.
 * Comms physics uses squared distances to avoid sqrt operations.
 *
 * Note: A web worker implementation existed previously and can be recreated
 * using these shared functions if off-main-thread simulation is needed.
 */
import {
  COMMS_ATTRACT_RATIO,
  COMMS_RANGE,
  COMMS_REPEL_RATIO,
  DIRECTION_DX,
  DIRECTION_DY,
  FIXED_POINT_SCALE,
  MOVE_SPEED_BY_TYPE,
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  TILE_START_Y,
  TILE_STEP_Y,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  TerrainType,
} from "./constants";

/** Padding distance - how far ahead to check in movement direction (in original pixels, not scaled) */
export const VEHICLE_COLLISION_PADDING = 8;

/** Y offset for collision point - shifts collision check down from sprite origin (fixed-point x100) */
export const VEHICLE_COLLISION_Y_OFFSET = 800; // 8px * 100

/**
 * Integer division that matches Solidity's behavior (truncation toward zero).
 * JavaScript's Math.floor rounds toward negative infinity, but Solidity truncates toward zero.
 * Example: -7/2 = -3 in Solidity, but Math.floor(-7/2) = -4 in JS.
 * Math.trunc() matches Solidity's behavior for both positive and negative numbers.
 */
export function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * Convert a delta vector (dx, dy) to the best matching direction index (0-3)
 * Uses isometric coordinate system:
 * - 0 = north (top-right): dx >= 0, dy < 0
 * - 1 = east (bottom-right): dx >= 0, dy >= 0
 * - 2 = south (bottom-left): dx < 0, dy >= 0
 * - 3 = west (top-left): dx < 0, dy < 0
 */
export function getDirectionFromDelta(dx: number, dy: number): number {
  if (dx >= 0 && dy < 0) return 0; // north (top-right)
  if (dx >= 0 && dy >= 0) return 1; // east (bottom-right)
  if (dx < 0 && dy >= 0) return 2; // south (bottom-left)
  return 3; // west (top-left)
}

/**
 * Pre-calculated tile center Y offset (fixed-point x100).
 * The isometric diamond center is offset within the tile image:
 * - Diamond top starts at scaled TILE_START_Y
 * - Center is half a diamond height (TILE_Y_SPACING) below that
 * Original: ~88px -> scaled x100 = 8800
 */
const TILE_CENTER_Y_OFFSET = Math.round(
  ((TILE_START_Y * TILE_RENDER_HEIGHT) / TILE_STEP_Y + TILE_Y_SPACING) * FIXED_POINT_SCALE,
);

// Pre-calculate tile spacing scaled for fixed-point math
const TILE_X_SPACING_SCALED = TILE_X_SPACING * FIXED_POINT_SCALE; // 8900
const TILE_Y_SPACING_SCALED = TILE_Y_SPACING * FIXED_POINT_SCALE; // 4700
const TILE_RENDER_WIDTH_HALF_SCALED = (TILE_RENDER_WIDTH / 2) * FIXED_POINT_SCALE; // 10000

/**
 * Solidity-compatible integer division with rounding.
 * This matches how Solidity handles rounding in integer division.
 * For positive a: floor((a + b/2) / b)
 * For negative a: floor((a - b/2) / b)
 */
function roundedDiv(a: number, b: number): number {
  if (a >= 0) {
    return Math.floor((a + Math.floor(b / 2)) / b);
  }
  return Math.floor((a - Math.floor(b / 2)) / b);
}

/**
 * Convert world coordinates to tile coordinates.
 * Accounts for tile center offsets since agents are positioned at tile centers.
 * Uses integer division with proper rounding for Solidity parity.
 *
 * @param worldX - World X coordinate (fixed-point x100)
 * @param worldY - World Y coordinate (fixed-point x100)
 * @param centerX - X coordinate of map center (fixed-point x100)
 * @returns { row, col } tile coordinates (integers)
 */
export function worldToTile(worldX: number, worldY: number, centerX: number): { row: number; col: number } {
  // Account for tile center offsets - agents are positioned at tile centers,
  // not top-left corners, so we need to adjust before converting
  const adjustedX = worldX - TILE_RENDER_WIDTH_HALF_SCALED;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  // Integer division with rounding - MUST match Solidity exactly
  // Using roundedDiv instead of Math.round for proper Solidity parity
  const colMinusRow = roundedDiv(adjustedX - centerX, TILE_X_SPACING_SCALED);
  const colPlusRow = roundedDiv(adjustedY, TILE_Y_SPACING_SCALED);

  // Integer divide by 2 using bit shift
  const col = (colMinusRow + colPlusRow) >> 1;
  const row = (colPlusRow - colMinusRow) >> 1;

  return { row, col };
}

/**
 * Check if a world position is within the valid isometric tile bounds.
 * The map is a diamond shape, so we convert to tile coordinates and check bounds.
 * Uses the same tile center offset adjustment as worldToTile for consistency.
 *
 * @param worldX - World X coordinate (fixed-point x100)
 * @param worldY - World Y coordinate (fixed-point x100)
 * @param centerX - X coordinate of map center (fixed-point x100)
 * @param gridSize - Size of the grid (e.g., 111 for 111x111)
 * @returns true if position is within bounds
 */
export function isWithinBounds(worldX: number, worldY: number, centerX: number, gridSize: number): boolean {
  const { row, col } = worldToTile(worldX, worldY, centerX);

  // Check if within grid bounds with a small margin
  const margin = 2;
  return row >= margin && row < gridSize - margin && col >= margin && col < gridSize - margin;
}

/**
 * Check if a single point is on ground terrain.
 * @param worldX - World X coordinate (fixed-point x100)
 * @param worldY - World Y coordinate (fixed-point x100)
 * @param centerX - X coordinate of map center (fixed-point x100)
 * @param terrainGrid - 2D array of terrain types
 */
function isPointOnGround(worldX: number, worldY: number, centerX: number, terrainGrid: TerrainType[][]): boolean {
  const { row, col } = worldToTile(worldX, worldY, centerX);
  const gridSize = terrainGrid.length;

  // Check bounds
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
    return false;
  }

  return terrainGrid[row][col] === "ground";
}

/**
 * Check if a world position is on traversable terrain (ground tiles only).
 * Agents can only drive on "ground" tiles.
 * Checks center point + one point ahead in the movement direction for padding.
 *
 * @param worldX - World X coordinate (fixed-point x100)
 * @param worldY - World Y coordinate (fixed-point x100)
 * @param centerX - X coordinate of map center (fixed-point x100)
 * @param terrainGrid - 2D array of terrain types
 * @param direction - Movement direction (0=N, 1=E, 2=S, 3=W)
 * @returns true if position is traversable (center + ahead point on ground)
 */
export function isTraversable(
  worldX: number,
  worldY: number,
  centerX: number,
  terrainGrid: TerrainType[][] | null,
  direction: number,
): boolean {
  // If no terrain grid provided, block all movement to make the issue obvious
  if (!terrainGrid || terrainGrid.length === 0) {
    console.warn("isTraversable: No terrain grid provided!");
    return false;
  }

  // Check center point
  if (!isPointOnGround(worldX, worldY, centerX, terrainGrid)) {
    return false;
  }

  // Check padding distance ahead in movement direction
  // DIRECTION_DX/DY are scaled x100, VEHICLE_COLLISION_PADDING is in pixels
  // Result: aheadX = worldX (scaled x100) + DIRECTION_DX (scaled x100) * padding (pixels)
  // This gives us the correct ahead position in fixed-point
  const aheadX = worldX + DIRECTION_DX[direction] * VEHICLE_COLLISION_PADDING;
  const aheadY = worldY + DIRECTION_DY[direction] * VEHICLE_COLLISION_PADDING;
  if (!isPointOnGround(aheadX, aheadY, centerX, terrainGrid)) {
    return false;
  }

  return true;
}

/**
 * Agent data arrays passed to update functions.
 * Uses Structure-of-Arrays (SoA) pattern for cache-friendly access.
 * All positions are in fixed-point x100 format.
 */
export interface AgentArrays {
  x: Int32Array;
  y: Int32Array;
  direction: Uint8Array;
  vehicleType: Uint8Array;
  team: Uint8Array;
}

/**
 * Update a single comms unit using simplified gravity-based behavior.
 *
 * SIMPLIFIED FOR SOLIDITY PARITY:
 * - Uses squared distances only (no sqrt operations)
 * - Binary decision: too close = repel, too far = attract, sweet spot = stay
 * - Accumulates direction votes instead of force magnitudes
 *
 * @param arrays - Agent data arrays (fixed-point x100)
 * @param index - Index of the agent to update
 * @param count - Total number of agents
 * @param action - Dice roll result (0-15) for deterministic random direction
 * @param teamSpawnX - Team spawn X coordinates (fixed-point x100)
 * @param teamSpawnY - Team spawn Y coordinates (fixed-point x100)
 * @param centerX - Map center X coordinate (fixed-point x100)
 * @param gridSize - Grid size for bounds checking
 * @param terrainGrid - 2D array of terrain types for movement restrictions
 */
export function updateCommsUnit(
  arrays: AgentArrays,
  index: number,
  count: number,
  action: number,
  teamSpawnX: Int32Array,
  teamSpawnY: Int32Array,
  centerX: number,
  gridSize: number,
  terrainGrid: TerrainType[][] | null,
): void {
  const { x, y, direction, vehicleType, team } = arrays;

  const vt = vehicleType[index];
  const commsRange = COMMS_RANGE[vt];
  const myX = x[index];
  const myY = y[index];
  const myTeam = team[index];

  // Calculate squared distance thresholds (no sqrt needed!)
  const repelDist = commsRange * COMMS_REPEL_RATIO;
  const attractDist = commsRange * COMMS_ATTRACT_RATIO;
  const repelDistSq = repelDist * repelDist;
  const attractDistSq = attractDist * attractDist;
  const commsRangeSq = commsRange * commsRange;

  // Accumulate direction deltas instead of force magnitudes
  // This is simpler and produces deterministic integer results
  let totalDx = 0;
  let totalDy = 0;

  // Helper to process a connection point using squared distance only
  const processConnection = (connX: number, connY: number) => {
    const dx = connX - myX;
    const dy = connY - myY;
    const distSq = dx * dx + dy * dy;

    // If basically on top of it (within 1 pixel = 100 fixed-point), push away randomly
    if (distSq < 10000) {
      // 100 * 100 = 10000
      const randomDir = action % 4;
      totalDx -= DIRECTION_DX[randomDir];
      totalDy -= DIRECTION_DY[randomDir];
      return;
    }

    // Only aware of things within range (local vision)
    if (distSq > commsRangeSq) return;

    if (distSq < repelDistSq) {
      // Too close - move away (subtract delta)
      // Use sign of dx/dy to determine direction without normalizing
      totalDx -= dx > 0 ? 1 : dx < 0 ? -1 : 0;
      totalDy -= dy > 0 ? 1 : dy < 0 ? -1 : 0;
    } else if (distSq > attractDistSq) {
      // Too far - move toward (add delta)
      totalDx += dx > 0 ? 1 : dx < 0 ? -1 : 0;
      totalDy += dy > 0 ? 1 : dy < 0 ? -1 : 0;
    }
    // Between repelDistSq and attractDistSq = sweet spot, no force
  };

  // Process home base (team spawn point) - always visible
  processConnection(teamSpawnX[myTeam], teamSpawnY[myTeam]);

  // Process same-team comms units within range
  for (let j = 0; j < count; j++) {
    if (j === index) continue;
    if (team[j] !== myTeam) continue;
    if (COMMS_RANGE[vehicleType[j]] === 0) continue; // not a comms unit

    processConnection(x[j], y[j]);
  }

  // Convert accumulated direction to movement if there's any net direction
  if (totalDx !== 0 || totalDy !== 0) {
    // Set direction based on accumulated delta
    direction[index] = getDirectionFromDelta(totalDx, totalDy);

    // Move in that direction
    // Direction vectors and move speed are both in fixed-point scale
    // DIRECTION_DX is scaled x100, moveSpeed is scaled x100
    // So we need to divide by 100 to get the right result
    // Use intDiv for Solidity parity (truncation toward zero)
    const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
    const newX = myX + intDiv(DIRECTION_DX[direction[index]] * moveSpeed, FIXED_POINT_SCALE);
    const newY = myY + intDiv(DIRECTION_DY[direction[index]] * moveSpeed, FIXED_POINT_SCALE);

    // Check bounds and terrain - only move if within bounds AND on traversable terrain
    // Add Y offset to shift collision point down from sprite origin
    const collisionX = newX;
    const collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;
    if (
      isWithinBounds(collisionX, collisionY, centerX, gridSize) &&
      isTraversable(collisionX, collisionY, centerX, terrainGrid, direction[index])
    ) {
      x[index] = newX;
      y[index] = newY;
    } else {
      // Blocked by terrain/bounds - turn completely around and move away
      direction[index] = (direction[index] + 2) % 4;
      x[index] = myX + intDiv(DIRECTION_DX[direction[index]] * moveSpeed, FIXED_POINT_SCALE);
      y[index] = myY + intDiv(DIRECTION_DY[direction[index]] * moveSpeed, FIXED_POINT_SCALE);
    }
  }
  // else: forces balanced or no connections, stay still
}

/**
 * Update a single normal (non-comms) agent based on dice roll.
 *
 * Action mapping (0-15):
 * - 0-9 (62.5%): Move forward (if within bounds and terrain is traversable)
 * - 10-12 (18.75%): Turn left
 * - 13-15 (18.75%): Turn right
 *
 * All positions and movements use fixed-point x100 math.
 *
 * @param arrays - Agent data arrays (fixed-point x100)
 * @param index - Index of the agent to update
 * @param action - Dice roll result (0-15)
 * @param centerX - Map center X coordinate (fixed-point x100)
 * @param gridSize - Grid size for bounds checking
 * @param terrainGrid - 2D array of terrain types for movement restrictions
 */
export function updateNormalAgent(
  arrays: AgentArrays,
  index: number,
  action: number,
  centerX: number,
  gridSize: number,
  terrainGrid: TerrainType[][] | null,
): void {
  const { x, y, direction, vehicleType } = arrays;

  if (action <= 9) {
    // Move forward - but only if the new position is within bounds and on ground terrain
    const dir = direction[index];
    const moveSpeed = MOVE_SPEED_BY_TYPE[vehicleType[index]];
    // Direction vectors and move speed are already in fixed-point scale
    // DIRECTION_DX is scaled x100, moveSpeed is scaled x100
    // So we need to divide by 100 to get the right result
    // Use intDiv for Solidity parity (truncation toward zero)
    const newX = x[index] + intDiv(DIRECTION_DX[dir] * moveSpeed, FIXED_POINT_SCALE);
    const newY = y[index] + intDiv(DIRECTION_DY[dir] * moveSpeed, FIXED_POINT_SCALE);

    // Add Y offset to shift collision point down from sprite origin
    const collisionX = newX;
    const collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;
    const withinBounds = isWithinBounds(collisionX, collisionY, centerX, gridSize);
    const canTraverse = isTraversable(collisionX, collisionY, centerX, terrainGrid, dir);

    if (withinBounds && canTraverse) {
      x[index] = newX;
      y[index] = newY;
    } else if (!withinBounds) {
      // Out of bounds - turn around
      direction[index] = (direction[index] + 2) % 4;
    } else {
      // Terrain not traversable (mountain) - turn completely around and move away
      direction[index] = (direction[index] + 2) % 4;
      x[index] = x[index] + intDiv(DIRECTION_DX[direction[index]] * moveSpeed, FIXED_POINT_SCALE);
      y[index] = y[index] + intDiv(DIRECTION_DY[direction[index]] * moveSpeed, FIXED_POINT_SCALE);
    }
  } else if (action <= 12) {
    // Turn left: (dir + 3) % 4
    direction[index] = (direction[index] + 3) % 4;
  } else {
    // Turn right: (dir + 1) % 4
    direction[index] = (direction[index] + 1) % 4;
  }
}

/**
 * Update a single agent (either comms or normal) based on dice roll.
 * This is the main entry point for agent updates.
 *
 * All positions use fixed-point x100 math for Solidity parity.
 *
 * @param arrays - Agent data arrays (fixed-point x100)
 * @param index - Index of the agent to update
 * @param count - Total number of agents (needed for comms unit neighbor checks)
 * @param action - Dice roll result (0-15)
 * @param teamSpawnX - Team spawn X coordinates (fixed-point x100)
 * @param teamSpawnY - Team spawn Y coordinates (fixed-point x100)
 * @param centerX - Map center X coordinate (fixed-point x100)
 * @param gridSize - Grid size for bounds checking
 * @param terrainGrid - 2D array of terrain types for movement restrictions
 */
export function updateAgent(
  arrays: AgentArrays,
  index: number,
  count: number,
  action: number,
  teamSpawnX: Int32Array,
  teamSpawnY: Int32Array,
  centerX: number,
  gridSize: number,
  terrainGrid: TerrainType[][] | null,
): void {
  const commsRange = COMMS_RANGE[arrays.vehicleType[index]];

  if (commsRange > 0) {
    updateCommsUnit(arrays, index, count, action, teamSpawnX, teamSpawnY, centerX, gridSize, terrainGrid);
  } else {
    updateNormalAgent(arrays, index, action, centerX, gridSize, terrainGrid);
  }
}
