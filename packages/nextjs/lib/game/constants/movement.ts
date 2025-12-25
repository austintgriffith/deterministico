/**
 * Movement and direction constants.
 * Defines direction vectors, turn mappings, and movement speeds.
 */
import { Direction } from "../types";

// Direction arrays
export const DIRECTIONS: Direction[] = ["north", "east", "south", "west"];

// Isometric direction vectors (matching tile angles)
// Moving ~4 pixels per step in isometric space
export const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 2, dy: -1 }, // top-right
  east: { dx: 2, dy: 1 }, // bottom-right
  south: { dx: -2, dy: 1 }, // bottom-left
  west: { dx: -2, dy: -1 }, // top-left
};

// Turn mappings
export const TURN_LEFT: Record<Direction, Direction> = {
  north: "west",
  east: "north",
  south: "east",
  west: "south",
};

export const TURN_RIGHT: Record<Direction, Direction> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

// Fast indexed direction vectors for TypedArray-based simulation
// Index: 0=north, 1=east, 2=south, 3=west
export const DIRECTION_DX = new Float32Array([2, 2, -2, -2]);
export const DIRECTION_DY = new Float32Array([-1, 1, 1, -1]);

// Base movement speed (legacy, use MOVE_SPEED_BY_TYPE for type-specific speeds)
export const MOVE_AMOUNT = 5;

// Movement speed per vehicle type (matches VEHICLE_TYPES order)
// heavy=3px, light=5px
export const MOVE_SPEED_BY_TYPE = new Float32Array([
  3, // heavy_comms (0)
  3, // heavy_harvester (1)
  3, // heavy_military (2)
  3, // heavy_miner (3)
  3, // heavy_railgun (4)
  3, // heavy_tanker (5)
  5, // light_comms (6)
  5, // light_harvester (7)
  5, // light_military (8)
  5, // light_miner (9)
  5, // light_railgun (10)
  5, // light_tanker (11)
]);

// Comms unit operating range (matches VEHICLE_TYPES order)
// 0 means not a comms unit
export const COMMS_RANGE = new Float32Array([
  800, // heavy_comms (0) - 800px range
  0, // heavy_harvester (1) - not comms
  0, // heavy_military (2) - not comms
  0, // heavy_miner (3) - not comms
  0, // heavy_railgun (4) - not comms
  0, // heavy_tanker (5) - not comms
  800, // light_comms (6) - 800px range
  0, // light_harvester (7) - not comms
  0, // light_military (8) - not comms
  0, // light_miner (9) - not comms
  0, // light_railgun (10) - not comms
  0, // light_tanker (11) - not comms
]);

// Comms gravity behavior - creates web formation
// Distance thresholds are multipliers of commsRange
export const COMMS_REPEL_RATIO = 0.4; // Below range * 0.4, units repel
export const COMMS_ATTRACT_RATIO = 0.8; // Above range * 0.8, units attract
export const COMMS_REPEL_STRENGTH = 1.5; // Force multiplier for repulsion
export const COMMS_ATTRACT_STRENGTH = 2.0; // Force multiplier for attraction
export const COMMS_FORCE_THRESHOLD = 0.1; // Minimum force magnitude to trigger movement
