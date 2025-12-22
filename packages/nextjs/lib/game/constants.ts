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
export const MOVE_AMOUNT = 5; // pixels per move
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
