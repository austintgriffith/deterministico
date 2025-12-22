import {
  COMMS_ATTRACT_RATIO,
  COMMS_ATTRACT_STRENGTH,
  COMMS_FORCE_THRESHOLD,
  COMMS_RANGE,
  COMMS_REPEL_RATIO,
  COMMS_REPEL_STRENGTH,
  DIRECTION_DX,
  DIRECTION_DY,
  GRID_SIZE,
  MOVE_SPEED_BY_TYPE,
  NUM_TEAMS,
  TILE_X_SPACING,
  TILE_Y_SPACING,
} from "./constants";
import { DeterministicDice } from "deterministic-dice";

/**
 * Convert a force vector (fx, fy) to the best matching direction index (0-3)
 * Uses isometric coordinate system
 */
function getDirectionFromForce(fx: number, fy: number): number {
  // Determine quadrant based on sign of force components
  if (fx >= 0 && fy < 0) return 0; // north (top-right)
  if (fx >= 0 && fy >= 0) return 1; // east (bottom-right)
  if (fx < 0 && fy >= 0) return 2; // south (bottom-left)
  return 3; // west (top-left)
}

/**
 * Check if a world position is within the valid isometric tile bounds
 * The map is a diamond shape, so we convert to tile coordinates and check bounds
 */
function isWithinBounds(worldX: number, worldY: number, centerX: number, gridSize: number): boolean {
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
 * High-performance agent pool using TypedArrays for zero-allocation updates.
 * Uses Structure-of-Arrays (SoA) pattern for cache-friendly memory access.
 */
export class AgentPool {
  readonly maxAgents: number;
  count: number = 0;

  // Map bounds for boundary checking
  centerX: number = 0;
  gridSize: number = GRID_SIZE;

  // Contiguous memory blocks for cache-friendly access
  x: Float32Array;
  y: Float32Array;
  direction: Uint8Array; // 0=north, 1=east, 2=south, 3=west
  team: Uint8Array; // 0-11 team index (matches TEAM_COLORS)
  vehicleType: Uint8Array; // 0-6 vehicle type index (matches VEHICLE_TYPES)
  spawnX: Float32Array; // spawn position X (for comms units)
  spawnY: Float32Array; // spawn position Y (for comms units)

  // Team home base positions (for comms gravity)
  teamSpawnX: Float32Array;
  teamSpawnY: Float32Array;

  constructor(maxAgents: number) {
    this.maxAgents = maxAgents;
    this.x = new Float32Array(maxAgents);
    this.y = new Float32Array(maxAgents);
    this.direction = new Uint8Array(maxAgents);
    this.team = new Uint8Array(maxAgents);
    this.vehicleType = new Uint8Array(maxAgents);
    this.spawnX = new Float32Array(maxAgents);
    this.spawnY = new Float32Array(maxAgents);
    this.teamSpawnX = new Float32Array(NUM_TEAMS);
    this.teamSpawnY = new Float32Array(NUM_TEAMS);
  }

  /**
   * Set the home base (spawn point) for a team - used for comms gravity
   */
  setTeamSpawn(teamIndex: number, x: number, y: number): void {
    if (teamIndex >= 0 && teamIndex < NUM_TEAMS) {
      this.teamSpawnX[teamIndex] = x;
      this.teamSpawnY[teamIndex] = y;
    }
  }

  /**
   * Set the map bounds for boundary checking
   */
  setMapBounds(centerX: number, gridSize: number): void {
    this.centerX = centerX;
    this.gridSize = gridSize;
  }

  /**
   * Add a new agent to the pool
   * @returns The index of the new agent, or -1 if pool is full
   */
  add(x: number, y: number, direction: number, team: number, vehicleType: number): number {
    if (this.count >= this.maxAgents) {
      return -1;
    }
    const index = this.count;
    this.x[index] = x;
    this.y[index] = y;
    this.direction[index] = direction;
    this.team[index] = team;
    this.vehicleType[index] = vehicleType;
    // Store spawn position (initial position is the spawn point)
    this.spawnX[index] = x;
    this.spawnY[index] = y;
    this.count++;
    return index;
  }

  /**
   * Reset the pool to empty state
   */
  reset(): void {
    this.count = 0;
  }

  /**
   * Update all agents based on deterministic dice rolls.
   * Zero allocations - mutates in place.
   * Includes boundary checking to prevent agents from leaving the map.
   *
   * Comms units use gravity-based behavior - they accumulate forces from all
   * nearby connections (home base + other same-team comms). Too close = repel,
   * too far = attract. This creates a natural web formation.
   *
   * Normal agents action mapping (0-15):
   * - 0-9 (62.5%): Move forward (if within bounds)
   * - 10-12 (18.75%): Turn left
   * - 13-15 (18.75%): Turn right
   */
  updateAll(dice: DeterministicDice): void {
    const count = this.count;
    const x = this.x;
    const y = this.y;
    const direction = this.direction;
    const vehicleType = this.vehicleType;
    const team = this.team;
    const teamSpawnX = this.teamSpawnX;
    const teamSpawnY = this.teamSpawnY;
    const centerX = this.centerX;
    const gridSize = this.gridSize;

    for (let i = 0; i < count; i++) {
      // Always consume a dice roll for determinism
      const action = dice.roll(16);
      const vt = vehicleType[i];
      const commsRange = COMMS_RANGE[vt];

      // Check if this is a comms unit
      if (commsRange > 0) {
        // === COMMS UNIT GRAVITY BEHAVIOR ===
        const myX = x[i];
        const myY = y[i];
        const myTeam = team[i];

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
            // Use dice-based direction for deterministic random push
            const randomDir = action % 4; // 0-3 direction
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
          if (j === i) continue;
          if (team[j] !== myTeam) continue;
          if (COMMS_RANGE[vehicleType[j]] === 0) continue; // not a comms unit

          // Only check units within our communication range (local vision)
          const dx = x[j] - myX;
          const dy = y[j] - myY;
          const distSq = dx * dx + dy * dy;
          if (distSq > commsRange * commsRange) continue; // Outside range, can't see them

          applyForce(x[j], y[j], commsRange);
        }

        // Convert accumulated force to movement
        const forceMag = Math.sqrt(forceX * forceX + forceY * forceY);
        if (forceMag > COMMS_FORCE_THRESHOLD) {
          // Set direction based on net force
          direction[i] = getDirectionFromForce(forceX, forceY);

          // Move in that direction
          const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
          const newX = myX + DIRECTION_DX[direction[i]] * moveSpeed;
          const newY = myY + DIRECTION_DY[direction[i]] * moveSpeed;

          if (isWithinBounds(newX, newY, centerX, gridSize)) {
            x[i] = newX;
            y[i] = newY;
          }
        }
        // else: forces balanced, stay still (in the sweet spot)
      } else {
        // === NORMAL AGENT BEHAVIOR ===
        if (action <= 9) {
          // Move forward - but only if the new position is within bounds
          const dir = direction[i];
          const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
          const newX = x[i] + DIRECTION_DX[dir] * moveSpeed;
          const newY = y[i] + DIRECTION_DY[dir] * moveSpeed;

          if (isWithinBounds(newX, newY, centerX, gridSize)) {
            x[i] = newX;
            y[i] = newY;
          } else {
            // Can't move forward, turn around instead
            direction[i] = (direction[i] + 2) % 4;
          }
        } else if (action <= 12) {
          // Turn left: (dir + 3) % 4
          direction[i] = (direction[i] + 3) % 4;
        } else {
          // Turn right: (dir + 1) % 4
          direction[i] = (direction[i] + 1) % 4;
        }
      }
    }
  }
}
