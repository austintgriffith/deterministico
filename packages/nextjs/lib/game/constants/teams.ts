/**
 * Team and vehicle type constants.
 * Defines team colors, vehicle types, and team configuration.
 */

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
  "heavy_harvester",
  "heavy_military",
  "heavy_miner",
  "heavy_railgun",
  "heavy_tanker",
  "light_comms",
  "light_harvester",
  "light_military",
  "light_miner",
  "light_railgun",
  "light_tanker",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

// Team configuration
export const NUM_TEAMS = 12;
export const MIN_SPAWN_DISTANCE = 800; // Minimum pixels between team spawns
