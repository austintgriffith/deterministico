import { Direction } from "./types";

// Tile configuration
export const TILE_X_SPACING = 64; // horizontal offset between tiles
export const TILE_Y_SPACING = 32; // vertical offset between tiles
export const GRID_SIZE = 111; // 111x111 grid (odd number so there's a true center tile)
export const TILE_WIDTH = 140; // approximate tile width for centering
export const TILE_HEIGHT = 80; // approximate tile height

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

// Game settings
export const MOVE_AMOUNT = 5; // pixels per move (legacy, use MOVE_SPEED_BY_TYPE for type-specific speeds)

// Movement speed per vehicle type (matches VEHICLE_TYPES order)
// heavy=3px, medium=4px, light=5px
export const MOVE_SPEED_BY_TYPE = new Float32Array([
  3, // heavy_comms (0)
  3, // heavy_military (1)
  3, // heavy_miner (2)
  5, // light_comms (3)
  5, // light_military (4)
  5, // light_miner (5)
  4, // medium_military (6)
]);

// Comms unit operating range (matches VEHICLE_TYPES order)
// 0 means not a comms unit
export const COMMS_RANGE = new Float32Array([
  800, // heavy_comms (0) - 800px range
  0, // heavy_military (1) - not comms
  0, // heavy_miner (2) - not comms
  800, // light_comms (3) - 800px range
  0, // light_military (4) - not comms
  0, // light_miner (5) - not comms
  0, // medium_military (6) - not comms
]);

// Comms gravity behavior - creates web formation
// Distance thresholds are multipliers of commsRange
export const COMMS_REPEL_RATIO = 0.4; // Below range * 0.4, units repel
export const COMMS_ATTRACT_RATIO = 0.8; // Above range * 0.8, units attract
export const COMMS_REPEL_STRENGTH = 1.5; // Force multiplier for repulsion
export const COMMS_ATTRACT_STRENGTH = 2.0; // Force multiplier for attraction
export const COMMS_FORCE_THRESHOLD = 0.1; // Minimum force magnitude to trigger movement
export const MAX_ROUNDS = 1000;
export const SPAWN_CUTOFF_ROUND = 100; // Stop spawning new agents after this round
export const ROUND_DELAY = 250;
export const MAX_AGENTS = 2000; // Maximum agents for pool allocation

// Fast indexed direction vectors for TypedArray-based simulation
// Index: 0=north, 1=east, 2=south, 3=west
export const DIRECTION_DX = new Float32Array([2, 2, -2, -2]);
export const DIRECTION_DY = new Float32Array([-1, 1, 1, -1]);

// Team colors (12 teams) - matches vehicle sprite filenames
export const TEAM_COLORS = [
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "mint",
  "cyan",
  "sky",
  "blue",
  "violet",
  "magenta",
  "pink",
] as const;

export type TeamColor = (typeof TEAM_COLORS)[number];

// Hex colors for flag rendering (matches TEAM_COLORS order)
export const TEAM_HEX_COLORS: Record<TeamColor, string> = {
  red: "#FF323E",
  orange: "#FF8C32",
  yellow: "#FFCC1D",
  lime: "#8FFF00",
  green: "#2CB323",
  mint: "#99FFB4",
  cyan: "#00F9FF",
  sky: "#32A5FF",
  blue: "#323EFF",
  violet: "#8C32FF",
  magenta: "#F332FF",
  pink: "#FF32A5",
};

// Vehicle types (size_type combinations available in /vehicles folder)
export const VEHICLE_TYPES = [
  "heavy_comms",
  "heavy_military",
  "heavy_miner",
  "light_comms",
  "light_military",
  "light_miner",
  "medium_military",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

// Team configuration
export const NUM_TEAMS = 12;
export const MIN_SPAWN_DISTANCE = 800; // Minimum pixels between team spawns
