import { DIRECTION_DX, DIRECTION_DY, MOVE_AMOUNT } from "./constants";
import { DeterministicDice } from "deterministic-dice";

/**
 * High-performance agent pool using TypedArrays for zero-allocation updates.
 * Uses Structure-of-Arrays (SoA) pattern for cache-friendly memory access.
 */
export class AgentPool {
  readonly maxAgents: number;
  count: number = 0;

  // Contiguous memory blocks for cache-friendly access
  x: Float32Array;
  y: Float32Array;
  direction: Uint8Array; // 0=north, 1=east, 2=south, 3=west

  constructor(maxAgents: number) {
    this.maxAgents = maxAgents;
    this.x = new Float32Array(maxAgents);
    this.y = new Float32Array(maxAgents);
    this.direction = new Uint8Array(maxAgents);
  }

  /**
   * Add a new agent to the pool
   * @returns The index of the new agent, or -1 if pool is full
   */
  add(x: number, y: number, direction: number): number {
    if (this.count >= this.maxAgents) {
      return -1;
    }
    const index = this.count;
    this.x[index] = x;
    this.y[index] = y;
    this.direction[index] = direction;
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
   *
   * Action mapping (0-15):
   * - 0-9 (62.5%): Move forward
   * - 10-12 (18.75%): Turn left
   * - 13-15 (18.75%): Turn right
   */
  updateAll(dice: DeterministicDice): void {
    const count = this.count;
    const x = this.x;
    const y = this.y;
    const direction = this.direction;

    for (let i = 0; i < count; i++) {
      const action = dice.roll(16);

      if (action <= 9) {
        // Move forward - inline vector lookup for speed
        const dir = direction[i];
        x[i] += DIRECTION_DX[dir] * MOVE_AMOUNT;
        y[i] += DIRECTION_DY[dir] * MOVE_AMOUNT;
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
