import { DIRECTION_DX, DIRECTION_DY, GRID_SIZE, MOVE_AMOUNT, TILE_X_SPACING, TILE_Y_SPACING } from "./constants";
import { DeterministicDice } from "deterministic-dice";

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

  constructor(maxAgents: number) {
    this.maxAgents = maxAgents;
    this.x = new Float32Array(maxAgents);
    this.y = new Float32Array(maxAgents);
    this.direction = new Uint8Array(maxAgents);
    this.team = new Uint8Array(maxAgents);
    this.vehicleType = new Uint8Array(maxAgents);
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
   * Action mapping (0-15):
   * - 0-9 (62.5%): Move forward (if within bounds)
   * - 10-12 (18.75%): Turn left
   * - 13-15 (18.75%): Turn right
   */
  updateAll(dice: DeterministicDice): void {
    const count = this.count;
    const x = this.x;
    const y = this.y;
    const direction = this.direction;
    const centerX = this.centerX;
    const gridSize = this.gridSize;

    for (let i = 0; i < count; i++) {
      const action = dice.roll(16);

      if (action <= 9) {
        // Move forward - but only if the new position is within bounds
        const dir = direction[i];
        const newX = x[i] + DIRECTION_DX[dir] * MOVE_AMOUNT;
        const newY = y[i] + DIRECTION_DY[dir] * MOVE_AMOUNT;

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
