/**
 * GameSimulator Parity Test
 *
 * This script tests that the Solidity GameSimulator produces
 * identical results to the TypeScript simulation.
 *
 * Run with: node scripts-js/gameSimulatorParity.js
 */

import { keccak256, toHex } from "viem";
import { DeterministicDice } from "deterministic-dice";

// ============ CONSTANTS (matching both JS and Solidity) ============

const FIXED_POINT_SCALE = 100;
const GRID_SIZE = 21;
const CENTER_X = 1869 * FIXED_POINT_SCALE; // Fixed-point

// Direction vectors (x100 scaled)
const DIRECTION_DX = [200, 200, -200, -200];
const DIRECTION_DY = [-100, 100, 100, -100];

// Move speeds (x100 scaled) - heavy=300, light=500
const MOVE_SPEED_BY_TYPE = [
  300, 300, 300, 300, 300, 300, 500, 500, 500, 500, 500, 500,
];

// Comms range (x100 scaled) - only types 0 and 6
const COMMS_RANGE = [80000, 0, 0, 0, 0, 0, 80000, 0, 0, 0, 0, 0];

const COMMS_REPEL_RATIO = 0.4;
const COMMS_ATTRACT_RATIO = 0.8;

const VEHICLE_COLLISION_Y_OFFSET = 800;

// ============ TILE CONVERSION (matching Solidity) ============

const TILE_X_SPACING_SCALED = 8900;
const TILE_Y_SPACING_SCALED = 4700;
const TILE_RENDER_WIDTH_HALF_SCALED = 10000;
const TILE_CENTER_Y_OFFSET = 8796;  // Fixed: was 8800

/**
 * Integer division with rounding (matches Solidity roundedDiv).
 * Uses Math.floor for negative numbers to match JS floor behavior.
 */
function roundedDiv(a, b) {
  if (a >= 0) {
    // For positive: truncation = floor, both work the same
    return Math.floor((a + Math.floor(b / 2)) / b);
  } else {
    // For negative: use Math.floor to match JS semantics
    return Math.floor((a - Math.floor(b / 2)) / b);
  }
}

/**
 * Integer division matching Solidity (truncation toward zero).
 */
function intDiv(a, b) {
  return Math.trunc(a / b);
}

function worldToTile(worldX, worldY, centerX) {
  const adjustedX = worldX - TILE_RENDER_WIDTH_HALF_SCALED;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const colMinusRow = roundedDiv(adjustedX - centerX, TILE_X_SPACING_SCALED);
  const colPlusRow = roundedDiv(adjustedY, TILE_Y_SPACING_SCALED);

  const col = (colMinusRow + colPlusRow) >> 1;
  const row = (colPlusRow - colMinusRow) >> 1;

  return { row, col };
}

function isWithinBounds(worldX, worldY, centerX, gridSize) {
  const { row, col } = worldToTile(worldX, worldY, centerX);
  const margin = 2;
  return (
    row >= margin &&
    row < gridSize - margin &&
    col >= margin &&
    col < gridSize - margin
  );
}

// ============ TERRAIN ============

function createTerrainGrid(gridSize) {
  // All ground for testing
  const grid = [];
  for (let i = 0; i < gridSize; i++) {
    grid.push(new Array(gridSize).fill(true));
  }
  return grid;
}

function isGround(terrain, row, col) {
  if (row < 0 || col < 0 || row >= terrain.length || col >= terrain[0].length) {
    return false;
  }
  return terrain[row][col];
}

function isTraversable(terrain, worldX, worldY, centerX, direction) {
  const { row, col } = worldToTile(worldX, worldY, centerX);
  if (!isGround(terrain, row, col)) return false;

  // Check ahead
  const aheadX = worldX + DIRECTION_DX[direction] * 8;
  const aheadY = worldY + DIRECTION_DY[direction] * 8;
  const { row: aRow, col: aCol } = worldToTile(aheadX, aheadY, centerX);
  return isGround(terrain, aRow, aCol);
}

// ============ DIRECTION ============

function getDirectionFromDelta(dx, dy) {
  if (dx >= 0 && dy < 0) return 0; // north
  if (dx >= 0 && dy >= 0) return 1; // east
  if (dx < 0 && dy >= 0) return 2; // south
  return 3; // west
}

// ============ AGENT SIMULATION ============

class Agent {
  constructor(x, y, direction, team, vehicleType) {
    this.x = Math.round(x * FIXED_POINT_SCALE);
    this.y = Math.round(y * FIXED_POINT_SCALE);
    this.direction = direction;
    this.team = team;
    this.vehicleType = vehicleType;
    this.spawnX = this.x;
    this.spawnY = this.y;
  }
}

function processConnection(myX, myY, connX, connY, commsRange, action) {
  const deltaX = connX - myX;
  const deltaY = connY - myY;
  const distSq = deltaX * deltaX + deltaY * deltaY;

  // On top of connection
  if (distSq < 10000) {
    const randomDir = action % 4;
    return { dx: -DIRECTION_DX[randomDir], dy: -DIRECTION_DY[randomDir] };
  }

  const rangeSq = commsRange * commsRange;
  if (distSq > rangeSq) return { dx: 0, dy: 0 };

  const repelDist = commsRange * COMMS_REPEL_RATIO;
  const attractDist = commsRange * COMMS_ATTRACT_RATIO;
  const repelDistSq = repelDist * repelDist;
  const attractDistSq = attractDist * attractDist;

  let dx = 0,
    dy = 0;

  if (distSq < repelDistSq) {
    dx = deltaX > 0 ? -1 : deltaX < 0 ? 1 : 0;
    dy = deltaY > 0 ? -1 : deltaY < 0 ? 1 : 0;
  } else if (distSq > attractDistSq) {
    dx = deltaX > 0 ? 1 : deltaX < 0 ? -1 : 0;
    dy = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0;
  }

  return { dx, dy };
}

function updateCommsUnit(
  agents,
  index,
  action,
  teamSpawnX,
  teamSpawnY,
  terrain,
  centerX,
  gridSize
) {
  const agent = agents[index];
  const commsRange = COMMS_RANGE[agent.vehicleType];

  // Process home base
  let { dx: totalDx, dy: totalDy } = processConnection(
    agent.x,
    agent.y,
    teamSpawnX[agent.team],
    teamSpawnY[agent.team],
    commsRange,
    action
  );

  // Process other comms units
  for (let j = 0; j < agents.length; j++) {
    if (j === index) continue;
    const other = agents[j];
    if (other.team !== agent.team || COMMS_RANGE[other.vehicleType] === 0)
      continue;

    const { dx, dy } = processConnection(
      agent.x,
      agent.y,
      other.x,
      other.y,
      commsRange,
      action
    );
    totalDx += dx;
    totalDy += dy;
  }

  if (totalDx !== 0 || totalDy !== 0) {
    agent.direction = getDirectionFromDelta(totalDx, totalDy);
    moveAgent(agent, terrain, centerX, gridSize);
  }
}

function moveAgent(agent, terrain, centerX, gridSize) {
  const myX = agent.x;
  const myY = agent.y;
  const dir = agent.direction;
  const moveSpeed = MOVE_SPEED_BY_TYPE[agent.vehicleType];

  // Use intDiv for Solidity parity (truncation toward zero)
  const newX = myX + intDiv(DIRECTION_DX[dir] * moveSpeed, FIXED_POINT_SCALE);
  const newY = myY + intDiv(DIRECTION_DY[dir] * moveSpeed, FIXED_POINT_SCALE);
  const collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;

  const inBounds = isWithinBounds(newX, collisionY, centerX, gridSize);
  const canMove =
    inBounds && isTraversable(terrain, newX, collisionY, centerX, dir);

  if (canMove) {
    agent.x = newX;
    agent.y = newY;
  } else {
    // Turn around
    agent.direction = (dir + 2) % 4;
    agent.x =
      myX +
      intDiv(DIRECTION_DX[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
    agent.y =
      myY +
      intDiv(DIRECTION_DY[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
  }
}

function updateNormalAgent(agent, action, terrain, centerX, gridSize) {
  if (action <= 9) {
    moveAgent(agent, terrain, centerX, gridSize);
  } else if (action <= 12) {
    agent.direction = (agent.direction + 3) % 4;
  } else {
    agent.direction = (agent.direction + 1) % 4;
  }
}

function simulateRound(
  agents,
  dice,
  teamSpawnX,
  teamSpawnY,
  terrain,
  centerX,
  gridSize
) {
  for (let i = 0; i < agents.length; i++) {
    const action = dice.roll(16);
    const agent = agents[i];

    if (COMMS_RANGE[agent.vehicleType] > 0) {
      updateCommsUnit(
        agents,
        i,
        action,
        teamSpawnX,
        teamSpawnY,
        terrain,
        centerX,
        gridSize
      );
    } else {
      updateNormalAgent(agent, action, terrain, centerX, gridSize);
    }
  }
}

// ============ TEST ============

function runParityTest() {
  console.log("=== GameSimulator JS/Solidity Parity Test ===\n");

  const seed = keccak256(toHex("test-seed-123"));
  console.log("Seed:", seed);

  // Initialize dice
  const dice = new DeterministicDice(seed);

  // Initialize terrain (all ground)
  const terrain = createTerrainGrid(GRID_SIZE);

  // Team spawn points
  const teamSpawnX = new Array(12).fill(0);
  const teamSpawnY = new Array(12).fill(0);
  teamSpawnX[0] = 1000 * FIXED_POINT_SCALE;
  teamSpawnY[0] = 800 * FIXED_POINT_SCALE;
  teamSpawnX[1] = 1200 * FIXED_POINT_SCALE;
  teamSpawnY[1] = 900 * FIXED_POINT_SCALE;

  // Create agents
  const agents = [
    new Agent(1000, 800, 0, 0, 7), // light_harvester
    new Agent(1100, 850, 1, 0, 8), // light_military
    new Agent(1200, 900, 2, 1, 6), // light_comms
  ];

  console.log("\n--- Initial State ---");
  agents.forEach((a, i) => {
    console.log(
      `Agent ${i}: x=${a.x}, y=${a.y}, dir=${a.direction}, team=${a.team}, type=${a.vehicleType}`
    );
  });

  // Simulate 10 rounds
  const numRounds = 10;
  for (let round = 0; round < numRounds; round++) {
    simulateRound(
      agents,
      dice,
      teamSpawnX,
      teamSpawnY,
      terrain,
      CENTER_X,
      GRID_SIZE
    );
  }

  console.log(`\n--- After ${numRounds} Rounds ---`);
  agents.forEach((a, i) => {
    console.log(`Agent ${i}: x=${a.x}, y=${a.y}, dir=${a.direction}`);
  });

  // Output dice state for comparison with Solidity
  console.log("\n--- Dice State ---");
  console.log(`Entropy: ${dice.entropy}`);
  console.log(`Position: ${dice.position}`);

  console.log("\n=== Test Complete ===");
  console.log(
    "\nTo verify parity, compare these values with Solidity test output."
  );
  console.log("Run: forge test --match-test testParityWithJS -vvv");

  // Return final state for automated comparison
  return {
    agents: agents.map((a) => ({
      x: a.x,
      y: a.y,
      direction: a.direction,
      team: a.team,
      vehicleType: a.vehicleType,
    })),
    diceEntropy: dice.entropy,
    dicePosition: dice.position,
  };
}

// Run the test
runParityTest();

export { runParityTest };
