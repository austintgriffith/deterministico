/**
 * Shared simulation logic for agent updates.
 * Used by AgentPool for game simulation.
 *
 * This module contains pure functions with no allocations for maximum performance.
 * All state is passed in via TypedArrays and mutated in place.
 *
 * Note: A web worker implementation existed previously and can be recreated
 * using these shared functions if off-main-thread simulation is needed.
 */
import {
  COMMS_ATTRACT_RATIO,
  COMMS_ATTRACT_STRENGTH,
  COMMS_FORCE_THRESHOLD,
  COMMS_RANGE,
  COMMS_REPEL_RATIO,
  COMMS_REPEL_STRENGTH,
  DIRECTION_DX,
  DIRECTION_DY,
  MOVE_SPEED_BY_TYPE,
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  TILE_START_Y,
  TILE_STEP_Y,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  TerrainType,
} from "./constants";

/**
 * Convert a force vector (fx, fy) to the best matching direction index (0-3)
 * Uses isometric coordinate system:
 * - 0 = north (top-right)
 * - 1 = east (bottom-right)
 * - 2 = south (bottom-left)
 * - 3 = west (top-left)
 */
export function getDirectionFromForce(fx: number, fy: number): number {
  if (fx >= 0 && fy < 0) return 0; // north (top-right)
  if (fx >= 0 && fy >= 0) return 1; // east (bottom-right)
  if (fx < 0 && fy >= 0) return 2; // south (bottom-left)
  return 3; // west (top-left)
}

/**
 * Pre-calculated tile center Y offset.
 * The isometric diamond center is offset within the tile image:
 * - Diamond top starts at scaled TILE_START_Y
 * - Center is half a diamond height (TILE_Y_SPACING) below that
 */
const TILE_CENTER_Y_OFFSET = (TILE_START_Y * TILE_RENDER_HEIGHT) / TILE_STEP_Y + TILE_Y_SPACING; // ~88

/**
 * Convert world coordinates to tile coordinates.
 * Accounts for tile center offsets since agents are positioned at tile centers.
 * Uses Math.round for more accurate tile detection near boundaries.
 *
 * @param worldX - World X coordinate
 * @param worldY - World Y coordinate
 * @param centerX - X coordinate of map center
 * @returns { row, col } tile coordinates
 */
export function worldToTile(worldX: number, worldY: number, centerX: number): { row: number; col: number } {
  // Account for tile center offsets - agents are positioned at tile centers,
  // not top-left corners, so we need to adjust before converting
  const adjustedX = worldX - TILE_RENDER_WIDTH / 2;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const colMinusRow = (adjustedX - centerX) / TILE_X_SPACING;
  const colPlusRow = adjustedY / TILE_Y_SPACING;

  const col = (colMinusRow + colPlusRow) / 2;
  const row = (colPlusRow - colMinusRow) / 2;

  // Use Math.round instead of Math.floor for more accurate tile detection
  // This prevents small floating-point errors from causing wrong tile lookups
  return { row: Math.round(row), col: Math.round(col) };
}

/**
 * Check if a world position is within the valid isometric tile bounds.
 * The map is a diamond shape, so we convert to tile coordinates and check bounds.
 * Uses the same tile center offset adjustment as worldToTile for consistency.
 *
 * @param worldX - World X coordinate
 * @param worldY - World Y coordinate
 * @param centerX - X coordinate of map center
 * @param gridSize - Size of the grid (e.g., 111 for 111x111)
 * @returns true if position is within bounds
 */
export function isWithinBounds(worldX: number, worldY: number, centerX: number, gridSize: number): boolean {
  const { row, col } = worldToTile(worldX, worldY, centerX);

  // Check if within grid bounds with a small margin
  const margin = 2;
  return row >= margin && row < gridSize - margin && col >= margin && col < gridSize - margin;
}

/** Padding around vehicle collision point in pixels */
const VEHICLE_COLLISION_PADDING = 32;

/**
 * Check if a single point is on ground terrain.
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
 * Checks multiple points around the position with padding to prevent
 * vehicles from getting too close to mountain tile edges.
 *
 * @param worldX - World X coordinate
 * @param worldY - World Y coordinate
 * @param centerX - X coordinate of map center
 * @param terrainGrid - 2D array of terrain types
 * @returns true if position is traversable (all padded points on ground)
 */
export function isTraversable(
  worldX: number,
  worldY: number,
  centerX: number,
  terrainGrid: TerrainType[][] | null,
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

  // Check padded points in cardinal directions (N, E, S, W)
  // This creates a collision "circle" around the vehicle
  const pad = VEHICLE_COLLISION_PADDING;

  // North (isometric: dx positive, dy negative)
  if (!isPointOnGround(worldX + pad, worldY - pad / 2, centerX, terrainGrid)) {
    return false;
  }

  // East (isometric: dx positive, dy positive)
  if (!isPointOnGround(worldX + pad, worldY + pad / 2, centerX, terrainGrid)) {
    return false;
  }

  // South (isometric: dx negative, dy positive)
  if (!isPointOnGround(worldX - pad, worldY + pad / 2, centerX, terrainGrid)) {
    return false;
  }

  // West (isometric: dx negative, dy negative)
  if (!isPointOnGround(worldX - pad, worldY - pad / 2, centerX, terrainGrid)) {
    return false;
  }

  return true;
}

/**
 * Agent data arrays passed to update functions.
 * Uses Structure-of-Arrays (SoA) pattern for cache-friendly access.
 */
export interface AgentArrays {
  x: Float32Array;
  y: Float32Array;
  direction: Uint8Array;
  vehicleType: Uint8Array;
  team: Uint8Array;
}

/**
 * Update a single comms unit using gravity-based behavior.
 * Comms units accumulate forces from home base + other same-team comms.
 * Too close = repel, too far = attract. Creates a natural web formation.
 *
 * @param arrays - Agent data arrays
 * @param index - Index of the agent to update
 * @param count - Total number of agents
 * @param action - Dice roll result (0-15) for deterministic random direction
 * @param teamSpawnX - Team spawn X coordinates
 * @param teamSpawnY - Team spawn Y coordinates
 * @param centerX - Map center X coordinate
 * @param gridSize - Grid size for bounds checking
 * @param terrainGrid - 2D array of terrain types for movement restrictions
 */
export function updateCommsUnit(
  arrays: AgentArrays,
  index: number,
  count: number,
  action: number,
  teamSpawnX: Float32Array,
  teamSpawnY: Float32Array,
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

  // Calculate distance thresholds based on this unit's range
  const repelDist = commsRange * COMMS_REPEL_RATIO;
  const attractDist = commsRange * COMMS_ATTRACT_RATIO;

  // Accumulate forces from all connections
  let forceX = 0;
  let forceY = 0;

  // Helper to apply force from a connection point (only if within range)
  const applyForce = (connX: number, connY: number, maxRange: number) => {
    const dx = connX - myX;
    const dy = connY - myY;
    const distSq = dx * dx + dy * dy;

    // If basically on top of it, push away in a random direction
    if (distSq < 1) {
      const randomDir = action % 4;
      forceX += DIRECTION_DX[randomDir] * COMMS_REPEL_STRENGTH;
      forceY += DIRECTION_DY[randomDir] * COMMS_REPEL_STRENGTH;
      return;
    }

    const dist = Math.sqrt(distSq);

    // Only aware of things within range (local vision)
    if (dist > maxRange) return;

    // Normalize direction
    const nx = dx / dist;
    const ny = dy / dist;

    if (dist < repelDist) {
      // Repel - push away (force points opposite to connection)
      const strength = ((repelDist - dist) / repelDist) * COMMS_REPEL_STRENGTH;
      forceX -= nx * strength;
      forceY -= ny * strength;
    } else if (dist > attractDist) {
      // Attract - pull toward connection (approaching edge of range)
      const strength = ((dist - attractDist) / commsRange) * COMMS_ATTRACT_STRENGTH;
      forceX += nx * strength;
      forceY += ny * strength;
    }
    // Between repelDist and attractDist = sweet spot, no force
  };

  // Apply force from home base (team spawn point) - always visible
  applyForce(teamSpawnX[myTeam], teamSpawnY[myTeam], commsRange);

  // Apply force from same-team comms units within range
  for (let j = 0; j < count; j++) {
    if (j === index) continue;
    if (team[j] !== myTeam) continue;
    if (COMMS_RANGE[vehicleType[j]] === 0) continue; // not a comms unit

    // Only check units within our communication range (local vision)
    const dx = x[j] - myX;
    const dy = y[j] - myY;
    const distSq = dx * dx + dy * dy;
    if (distSq > commsRange * commsRange) continue;

    applyForce(x[j], y[j], commsRange);
  }

  // Convert accumulated force to movement
  const forceMag = Math.sqrt(forceX * forceX + forceY * forceY);
  if (forceMag > COMMS_FORCE_THRESHOLD) {
    // Set direction based on net force
    direction[index] = getDirectionFromForce(forceX, forceY);

    // Move in that direction
    const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
    const newX = myX + DIRECTION_DX[direction[index]] * moveSpeed;
    const newY = myY + DIRECTION_DY[direction[index]] * moveSpeed;

    // Check bounds and terrain - only move if within bounds AND on traversable terrain
    if (isWithinBounds(newX, newY, centerX, gridSize) && isTraversable(newX, newY, centerX, terrainGrid)) {
      x[index] = newX;
      y[index] = newY;
    } else {
      // Blocked by terrain/bounds - turn completely around and move away
      direction[index] = (direction[index] + 2) % 4;
      x[index] = myX + DIRECTION_DX[direction[index]] * moveSpeed;
      y[index] = myY + DIRECTION_DY[direction[index]] * moveSpeed;
    }
  }
  // else: forces balanced, stay still (in the sweet spot)
}

/**
 * Update a single normal (non-comms) agent based on dice roll.
 *
 * Action mapping (0-15):
 * - 0-9 (62.5%): Move forward (if within bounds and terrain is traversable)
 * - 10-12 (18.75%): Turn left
 * - 13-15 (18.75%): Turn right
 *
 * @param arrays - Agent data arrays
 * @param index - Index of the agent to update
 * @param action - Dice roll result (0-15)
 * @param centerX - Map center X coordinate
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
    const newX = x[index] + DIRECTION_DX[dir] * moveSpeed;
    const newY = y[index] + DIRECTION_DY[dir] * moveSpeed;

    const withinBounds = isWithinBounds(newX, newY, centerX, gridSize);
    const canTraverse = isTraversable(newX, newY, centerX, terrainGrid);

    if (withinBounds && canTraverse) {
      x[index] = newX;
      y[index] = newY;
    } else if (!withinBounds) {
      // Out of bounds - turn around
      direction[index] = (direction[index] + 2) % 4;
    } else {
      // Terrain not traversable (mountain) - turn completely around and move away
      direction[index] = (direction[index] + 2) % 4;
      x[index] = x[index] + DIRECTION_DX[direction[index]] * moveSpeed;
      y[index] = y[index] + DIRECTION_DY[direction[index]] * moveSpeed;
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
 * @param arrays - Agent data arrays
 * @param index - Index of the agent to update
 * @param count - Total number of agents (needed for comms unit neighbor checks)
 * @param action - Dice roll result (0-15)
 * @param teamSpawnX - Team spawn X coordinates
 * @param teamSpawnY - Team spawn Y coordinates
 * @param centerX - Map center X coordinate
 * @param gridSize - Grid size for bounds checking
 * @param terrainGrid - 2D array of terrain types for movement restrictions
 */
export function updateAgent(
  arrays: AgentArrays,
  index: number,
  count: number,
  action: number,
  teamSpawnX: Float32Array,
  teamSpawnY: Float32Array,
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
