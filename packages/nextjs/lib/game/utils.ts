import { DIRECTION_VECTORS, MOVE_AMOUNT, TURN_LEFT, TURN_RIGHT } from "./constants";
import { Agent } from "./types";
import { DeterministicDice } from "deterministic-dice";

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
 * Generate a 2D grid of tile types (1-13) from a roll hash
 */
export function generateGrid(roll: `0x${string}`, gridSize: number): number[][] {
  const dice = new DeterministicDice(roll);
  return Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => dice.roll(13) + 1));
}
