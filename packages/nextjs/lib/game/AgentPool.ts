import { FIXED_POINT_SCALE, GRID_SIZE, NUM_TEAMS, TerrainType } from "./constants";
import { type AgentArrays, updateAgent } from "./simulation";
import { DeterministicDice } from "deterministic-dice";

/**
 * High-performance agent pool using TypedArrays for zero-allocation updates.
 * Uses Structure-of-Arrays (SoA) pattern for cache-friendly memory access.
 *
 * FIXED-POINT MATH: All position values use x100 fixed-point for Solidity parity.
 * When adding agents, world coordinates are automatically scaled.
 * When reading positions for rendering, use getWorldX/getWorldY to convert back.
 */
export class AgentPool {
  readonly maxAgents: number;
  count: number = 0;

  // Map bounds for boundary checking (stored as fixed-point x100)
  centerX: number = 0;
  gridSize: number = GRID_SIZE;

  // Terrain grid for movement restrictions (agents can only move on "ground" tiles)
  terrainGrid: TerrainType[][] | null = null;

  // Contiguous memory blocks for cache-friendly access
  // All positions stored as fixed-point integers (x100 scale)
  x: Int32Array;
  y: Int32Array;
  direction: Uint8Array; // 0=north, 1=east, 2=south, 3=west
  team: Uint8Array; // 0-11 team index (matches TEAM_COLORS)
  vehicleType: Uint8Array; // 0-11 vehicle type index (matches VEHICLE_TYPES)
  spawnX: Int32Array; // spawn position X (for comms units) - fixed-point
  spawnY: Int32Array; // spawn position Y (for comms units) - fixed-point

  // Team home base positions (for comms gravity) - fixed-point
  teamSpawnX: Int32Array;
  teamSpawnY: Int32Array;

  constructor(maxAgents: number) {
    this.maxAgents = maxAgents;
    this.x = new Int32Array(maxAgents);
    this.y = new Int32Array(maxAgents);
    this.direction = new Uint8Array(maxAgents);
    this.team = new Uint8Array(maxAgents);
    this.vehicleType = new Uint8Array(maxAgents);
    this.spawnX = new Int32Array(maxAgents);
    this.spawnY = new Int32Array(maxAgents);
    this.teamSpawnX = new Int32Array(NUM_TEAMS);
    this.teamSpawnY = new Int32Array(NUM_TEAMS);
  }

  /**
   * Set the home base (spawn point) for a team - used for comms gravity
   * @param teamIndex - Team index (0-11)
   * @param x - World X coordinate (will be converted to fixed-point)
   * @param y - World Y coordinate (will be converted to fixed-point)
   */
  setTeamSpawn(teamIndex: number, x: number, y: number): void {
    if (teamIndex >= 0 && teamIndex < NUM_TEAMS) {
      this.teamSpawnX[teamIndex] = Math.round(x * FIXED_POINT_SCALE);
      this.teamSpawnY[teamIndex] = Math.round(y * FIXED_POINT_SCALE);
    }
  }

  /**
   * Set the map bounds for boundary checking
   * @param centerX - World X coordinate of map center (will be converted to fixed-point)
   * @param gridSize - Size of the grid (not scaled)
   */
  setMapBounds(centerX: number, gridSize: number): void {
    this.centerX = Math.round(centerX * FIXED_POINT_SCALE);
    this.gridSize = gridSize;
  }

  /**
   * Set the terrain grid for movement restrictions
   * Agents can only move on "ground" tiles
   */
  setTerrainGrid(terrainGrid: TerrainType[][]): void {
    this.terrainGrid = terrainGrid;
  }

  /**
   * Add a new agent to the pool
   * @param x - World X coordinate (will be converted to fixed-point)
   * @param y - World Y coordinate (will be converted to fixed-point)
   * @param direction - Direction index (0-3)
   * @param team - Team index (0-11)
   * @param vehicleType - Vehicle type index (0-11)
   * @returns The index of the new agent, or -1 if pool is full
   */
  add(x: number, y: number, direction: number, team: number, vehicleType: number): number {
    if (this.count >= this.maxAgents) {
      return -1;
    }
    const index = this.count;
    // Convert world coordinates to fixed-point
    this.x[index] = Math.round(x * FIXED_POINT_SCALE);
    this.y[index] = Math.round(y * FIXED_POINT_SCALE);
    this.direction[index] = direction;
    this.team[index] = team;
    this.vehicleType[index] = vehicleType;
    // Store spawn position (initial position is the spawn point)
    this.spawnX[index] = this.x[index];
    this.spawnY[index] = this.y[index];
    this.count++;
    return index;
  }

  /**
   * Get world X coordinate for an agent (converts from fixed-point)
   * Use this for rendering
   */
  getWorldX(index: number): number {
    return this.x[index] / FIXED_POINT_SCALE;
  }

  /**
   * Get world Y coordinate for an agent (converts from fixed-point)
   * Use this for rendering
   */
  getWorldY(index: number): number {
    return this.y[index] / FIXED_POINT_SCALE;
  }

  /**
   * Reset the pool to empty state
   */
  reset(): void {
    this.count = 0;
  }

  /**
   * Get agent arrays for use with shared simulation functions
   */
  getArrays(): AgentArrays {
    return {
      x: this.x,
      y: this.y,
      direction: this.direction,
      vehicleType: this.vehicleType,
      team: this.team,
    };
  }

  /**
   * Update all agents based on deterministic dice rolls.
   * Zero allocations - mutates in place.
   * Includes boundary checking to prevent agents from leaving the map.
   * Includes terrain checking to prevent agents from moving onto non-ground tiles.
   *
   * Comms units use gravity-based behavior - they accumulate forces from all
   * nearby connections (home base + other same-team comms). Too close = repel,
   * too far = attract. This creates a natural web formation.
   *
   * Normal agents action mapping (0-15):
   * - 0-9 (62.5%): Move forward (if within bounds and terrain is traversable)
   * - 10-12 (18.75%): Turn left
   * - 13-15 (18.75%): Turn right
   */
  updateAll(dice: DeterministicDice): void {
    const arrays = this.getArrays();
    const count = this.count;

    for (let i = 0; i < count; i++) {
      // Always consume a dice roll for determinism
      const action = dice.roll(16);
      updateAgent(
        arrays,
        i,
        count,
        action,
        this.teamSpawnX,
        this.teamSpawnY,
        this.centerX,
        this.gridSize,
        this.terrainGrid,
      );
    }
  }
}
