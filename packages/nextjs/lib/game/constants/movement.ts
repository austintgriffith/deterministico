/**
 * Movement and direction constants.
 * Defines direction vectors, turn mappings, and movement speeds.
 *
 * FIXED-POINT MATH: All position values use x100 fixed-point for Solidity parity.
 * A JS value of 1234.56 becomes 123456 in storage.
 * Direction vectors and speeds are also scaled x100.
 */
import { Direction } from "../types";

// Fixed-point scale factor (x100 precision)
export const FIXED_POINT_SCALE = 100;

// Direction arrays
export const DIRECTIONS: Direction[] = ["north", "east", "south", "west"];

// Isometric direction vectors (matching tile angles)
// Original values: north={2,-1}, east={2,1}, south={-2,1}, west={-2,-1}
// These are NOT scaled - they represent unit direction vectors
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

// Fast indexed direction vectors for TypedArray-based simulation (x100 scaled)
// Index: 0=north, 1=east, 2=south, 3=west
// Original: [2, 2, -2, -2] -> scaled x100 = [200, 200, -200, -200]
export const DIRECTION_DX = new Int32Array([200, 200, -200, -200]);
export const DIRECTION_DY = new Int32Array([-100, 100, 100, -100]);

// Base movement speed (legacy, use MOVE_SPEED_BY_TYPE for type-specific speeds)
// Original: 5px -> scaled x100 = 500
export const MOVE_AMOUNT = 500;

// Movement speed per vehicle type (matches VEHICLE_TYPES order)
// Original: heavy=3px, light=5px -> scaled x100
export const MOVE_SPEED_BY_TYPE = new Int32Array([
  300, // heavy_comms (0) - 3px * 100
  300, // heavy_harvester (1)
  300, // heavy_military (2)
  300, // heavy_miner (3)
  300, // heavy_railgun (4)
  300, // heavy_tanker (5)
  500, // light_comms (6) - 5px * 100
  500, // light_harvester (7)
  500, // light_military (8)
  500, // light_miner (9)
  500, // light_railgun (10)
  500, // light_tanker (11)
]);

// Comms unit operating range (matches VEHICLE_TYPES order) - scaled x100
// 0 means not a comms unit
// Original: 800px -> scaled x100 = 80000
export const COMMS_RANGE = new Int32Array([
  80000, // heavy_comms (0) - 800px * 100
  0, // heavy_harvester (1) - not comms
  0, // heavy_military (2) - not comms
  0, // heavy_miner (3) - not comms
  0, // heavy_railgun (4) - not comms
  0, // heavy_tanker (5) - not comms
  80000, // light_comms (6) - 800px * 100
  0, // light_harvester (7) - not comms
  0, // light_military (8) - not comms
  0, // light_miner (9) - not comms
  0, // light_railgun (10) - not comms
  0, // light_tanker (11) - not comms
]);

// Comms gravity behavior - creates web formation
// Distance thresholds are multipliers of commsRange (no scaling needed for ratios)
export const COMMS_REPEL_RATIO = 0.4; // Below range * 0.4, units repel
export const COMMS_ATTRACT_RATIO = 0.8; // Above range * 0.8, units attract
