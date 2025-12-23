import { GRID_SIZE, NUM_TEAMS, TerrainType } from "./constants";
import { type AgentArrays, updateAgent } from "./simulation";
import { DeterministicDice } from "deterministic-dice";

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

  // Terrain grid for movement restrictions (agents can only move on "ground" tiles)
  terrainGrid: TerrainType[][] | null = null;

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
   * Set the terrain grid for movement restrictions
   * Agents can only move on "ground" tiles
   */
  setTerrainGrid(terrainGrid: TerrainType[][]): void {
    this.terrainGrid = terrainGrid;
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
