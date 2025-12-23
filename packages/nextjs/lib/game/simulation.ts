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
  TILE_X_SPACING,
  TILE_Y_SPACING,
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
 * Check if a world position is within the valid isometric tile bounds.
 * The map is a diamond shape, so we convert to tile coordinates and check bounds.
 *
 * @param worldX - World X coordinate
 * @param worldY - World Y coordinate
 * @param centerX - X coordinate of map center
 * @param gridSize - Size of the grid (e.g., 111 for 111x111)
 * @returns true if position is within bounds
 */
export function isWithinBounds(worldX: number, worldY: number, centerX: number, gridSize: number): boolean {
  // Convert world coordinates to tile coordinates
  // worldX = centerX + (col - row) * TILE_X_SPACING
  // worldY = (col + row) * TILE_Y_SPACING
  // Solving: col - row = (worldX - centerX) / TILE_X_SPACING
  //          col + row = worldY / TILE_Y_SPACING
  const colMinusRow = (worldX - centerX) / TILE_X_SPACING;
  const colPlusRow = worldY / TILE_Y_SPACING;

  const col = (colMinusRow + colPlusRow) / 2;
  const row = (colPlusRow - colMinusRow) / 2;

  // Check if within grid bounds with a small margin
  const margin = 2;
  return row >= margin && row < gridSize - margin && col >= margin && col < gridSize - margin;
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

    if (isWithinBounds(newX, newY, centerX, gridSize)) {
      x[index] = newX;
      y[index] = newY;
    }
  }
  // else: forces balanced, stay still (in the sweet spot)
}

/**
 * Update a single normal (non-comms) agent based on dice roll.
 *
 * Action mapping (0-15):
 * - 0-9 (62.5%): Move forward (if within bounds)
 * - 10-12 (18.75%): Turn left
 * - 13-15 (18.75%): Turn right
 *
 * @param arrays - Agent data arrays
 * @param index - Index of the agent to update
 * @param action - Dice roll result (0-15)
 * @param centerX - Map center X coordinate
 * @param gridSize - Grid size for bounds checking
 */
export function updateNormalAgent(
  arrays: AgentArrays,
  index: number,
  action: number,
  centerX: number,
  gridSize: number,
): void {
  const { x, y, direction, vehicleType } = arrays;

  if (action <= 9) {
    // Move forward - but only if the new position is within bounds
    const dir = direction[index];
    const moveSpeed = MOVE_SPEED_BY_TYPE[vehicleType[index]];
    const newX = x[index] + DIRECTION_DX[dir] * moveSpeed;
    const newY = y[index] + DIRECTION_DY[dir] * moveSpeed;

    if (isWithinBounds(newX, newY, centerX, gridSize)) {
      x[index] = newX;
      y[index] = newY;
    } else {
      // Can't move forward, turn around instead
      direction[index] = (direction[index] + 2) % 4;
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
): void {
  const commsRange = COMMS_RANGE[arrays.vehicleType[index]];

  if (commsRange > 0) {
    updateCommsUnit(arrays, index, count, action, teamSpawnX, teamSpawnY, centerX, gridSize);
  } else {
    updateNormalAgent(arrays, index, action, centerX, gridSize);
  }
}
