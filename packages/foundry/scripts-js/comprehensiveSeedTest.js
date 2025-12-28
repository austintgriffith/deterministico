#!/usr/bin/env node
/**
 * Comprehensive Seed Test - Tests many different seed hashes
 * 
 * This script runs the full simulation with many different seeds
 * to verify consistent behavior across various inputs.
 * 
 * Usage: node scripts-js/comprehensiveSeedTest.js [count]
 */

import { keccak256, encodePacked, toHex, formatEther } from 'viem';

// ============================================================================
// Constants (must match Solidity exactly)
// ============================================================================

const GRID_SIZE = 32;
const MAX_ROUNDS = 100;
const SPAWN_INTERVAL = 5;
const MAX_AGENTS = 21;
const NUM_TEAMS = 1;

const TILE_X_SPACING = 89;
const TILE_Y_SPACING = 47;
const TILE_RENDER_WIDTH = 200;
const FIXED_POINT_SCALE = 100;
const TILE_CENTER_Y_OFFSET = 8796;

const PAYOUT_PER_TILE = BigInt("10000000000000");
const PAYOUT_PER_MUSHROOM = BigInt("100000000000000");

const DIRECTION_DX = [200, 200, -200, -200];
const DIRECTION_DY = [-100, 100, 100, -100];
const MOVE_SPEED_BY_TYPE = [300, 300, 300, 300, 300, 300, 500, 500, 500, 500, 500, 500];
const COMMS_RANGE = [80000, 0, 0, 0, 0, 0, 80000, 0, 0, 0, 0, 0];
const COMMS_REPEL_RATIO = 0.4;
const COMMS_ATTRACT_RATIO = 0.8;
const VEHICLE_COLLISION_Y_OFFSET = 800;
const VEHICLE_COLLISION_PADDING = 8;

// ============================================================================
// DeterministicDice
// ============================================================================

class DeterministicDice {
  constructor(seed) {
    this.entropy = seed;
    this.position = 0;
  }

  roll(n) {
    if (n <= 0) throw new Error('n must be > 0');
    if (n === 1) return 0;

    const bitsNeeded = Math.ceil(Math.log2(n));
    const hexCharsNeeded = Math.max(1, Math.ceil(bitsNeeded / 4));
    const maxValue = 16 ** hexCharsNeeded;
    const threshold = maxValue - (maxValue % n);

    let value;
    do {
      value = this._consumeNibbles(hexCharsNeeded);
    } while (value >= threshold);

    return value % n;
  }

  _consumeNibbles(count) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (this.position >= 64) {
        this.entropy = keccak256(encodePacked(['bytes32'], [this.entropy]));
        this.position = 0;
      }
      const nibble = this._getNibble(this.entropy, this.position);
      value = (value << 4) + nibble;
      this.position++;
    }
    return value;
  }

  _getNibble(data, pos) {
    const byteIndex = Math.floor(pos / 2);
    const byteHex = data.slice(2 + byteIndex * 2, 2 + byteIndex * 2 + 2);
    const byteValue = parseInt(byteHex, 16);
    return pos % 2 === 0 ? byteValue >> 4 : byteValue & 0x0f;
  }
}

// ============================================================================
// Map Generation
// ============================================================================

function hash(row, col, seed) {
  return BigInt(keccak256(encodePacked(['uint256', 'uint256', 'uint256'], [BigInt(row), BigInt(col), seed])));
}

const TERRAIN_TYPES = ['ground', 'mountain', 'liquid', 'mushroom', 'rubyMountain'];
const TERRAIN_WEIGHTS = { ground: 50, mountain: 20, liquid: 17, mushroom: 10, rubyMountain: 3 };

function getWeightedTerrainType(row, col, seed) {
  const roll = Number(hash(row, col, seed) % 100n);
  let cumulative = 0;
  for (const terrainType of TERRAIN_TYPES) {
    cumulative += TERRAIN_WEIGHTS[terrainType];
    if (roll < cumulative) return terrainType;
  }
  return 'ground';
}

function smoothTerrainGrid(grid, passNumber, seed) {
  const newGrid = [];
  for (let row = 0; row < grid.length; row++) {
    const newRow = [];
    for (let col = 0; col < grid[row].length; col++) {
      const currentType = grid[row][col];
      const counts = { ground: 0, mountain: 0, liquid: 0, mushroom: 0, rubyMountain: 0 };

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[nr].length) {
            counts[grid[nr][nc]]++;
          }
        }
      }

      let dominantType = currentType;
      let maxCount = counts[currentType];
      for (const terrainType of TERRAIN_TYPES) {
        if (counts[terrainType] > maxCount) {
          maxCount = counts[terrainType];
          dominantType = terrainType;
        }
      }

      if (currentType === 'rubyMountain' && counts.rubyMountain >= 2) {
        newRow.push(currentType);
        continue;
      }

      if (maxCount === counts[currentType]) {
        newRow.push(currentType);
      } else if (maxCount - counts[currentType] <= 2) {
        const tieBreaker = Number(hash(row + passNumber * 1000, col + passNumber * 1000, seed) % 100n);
        newRow.push(tieBreaker < 40 ? currentType : dominantType);
      } else {
        newRow.push(dominantType);
      }
    }
    newGrid.push(newRow);
  }
  return newGrid;
}

function generateTerrain(seed) {
  const mapSeed = BigInt(keccak256(encodePacked(['bytes32', 'string'], [seed, 'map'])));
  
  let terrain = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    const rowTypes = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      rowTypes.push(getWeightedTerrainType(row, col, mapSeed));
    }
    terrain.push(rowTypes);
  }

  terrain = smoothTerrainGrid(terrain, 1, mapSeed);
  terrain = smoothTerrainGrid(terrain, 2, mapSeed);

  return terrain;
}

// ============================================================================
// Coordinate Conversion
// ============================================================================

function tileCenterToWorld(row, col, centerX) {
  const x = (centerX + (col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * FIXED_POINT_SCALE;
  const y = (col + row) * TILE_Y_SPACING * FIXED_POINT_SCALE + TILE_CENTER_Y_OFFSET;
  return { x, y };
}

function worldToTile(worldX, worldY, centerX) {
  const tileRenderWidthHalf = (TILE_RENDER_WIDTH * FIXED_POINT_SCALE) / 2;
  const tileXSpacingScaled = TILE_X_SPACING * FIXED_POINT_SCALE;
  const tileYSpacingScaled = TILE_Y_SPACING * FIXED_POINT_SCALE;

  const adjustedX = worldX - tileRenderWidthHalf;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const roundedDiv = (a, b) => {
    if (a >= 0) return Math.floor((a + Math.floor(b / 2)) / b);
    return Math.floor((a - Math.floor(b / 2)) / b);
  };

  const colMinusRow = roundedDiv(adjustedX - centerX, tileXSpacingScaled);
  const colPlusRow = roundedDiv(adjustedY, tileYSpacingScaled);

  const col = (colMinusRow + colPlusRow) >> 1;
  const row = (colPlusRow - colMinusRow) >> 1;

  return { row, col };
}

// ============================================================================
// Agent Simulation
// ============================================================================

function intDiv(a, b) {
  return Math.trunc(a / b);
}

function getDirectionFromDelta(dx, dy) {
  if (dx >= 0 && dy < 0) return 0;
  if (dx >= 0 && dy >= 0) return 1;
  if (dx < 0 && dy >= 0) return 2;
  return 3;
}

function isWithinBounds(worldX, worldY, centerXFP, gridSize) {
  const { row, col } = worldToTile(worldX, worldY, centerXFP);
  const margin = 2;
  return row >= margin && row < gridSize - margin && col >= margin && col < gridSize - margin;
}

function isPointOnGround(worldX, worldY, centerXFP, terrain) {
  const { row, col } = worldToTile(worldX, worldY, centerXFP);
  if (row < 0 || row >= terrain.length || col < 0 || col >= terrain[0].length) return false;
  return terrain[row][col] === 'ground';
}

function isTraversable(worldX, worldY, centerXFP, terrain, direction) {
  if (!terrain || terrain.length === 0) return false;
  if (!isPointOnGround(worldX, worldY, centerXFP, terrain)) return false;
  
  const aheadX = worldX + DIRECTION_DX[direction] * VEHICLE_COLLISION_PADDING;
  const aheadY = worldY + DIRECTION_DY[direction] * VEHICLE_COLLISION_PADDING;
  return isPointOnGround(aheadX, aheadY, centerXFP, terrain);
}

function moveAgent(agent, centerXFP, terrain) {
  const moveSpeed = MOVE_SPEED_BY_TYPE[agent.vehicleType];
  const newX = agent.x + intDiv(DIRECTION_DX[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
  const newY = agent.y + intDiv(DIRECTION_DY[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
  const collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;

  const inBounds = isWithinBounds(newX, collisionY, centerXFP, GRID_SIZE);
  const canMove = inBounds && isTraversable(newX, collisionY, centerXFP, terrain, agent.direction);

  if (canMove) {
    agent.x = newX;
    agent.y = newY;
  } else {
    agent.direction = (agent.direction + 2) % 4;
    agent.x = agent.x + intDiv(DIRECTION_DX[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
    agent.y = agent.y + intDiv(DIRECTION_DY[agent.direction] * moveSpeed, FIXED_POINT_SCALE);
  }
}

function updateCommsUnit(agents, index, action, spawnX, spawnY, centerXFP, terrain) {
  const agent = agents[index];
  const commsRange = COMMS_RANGE[agent.vehicleType];
  const commsRangeSq = commsRange * commsRange;
  const repelDistSq = (commsRange * COMMS_REPEL_RATIO) ** 2;
  const attractDistSq = (commsRange * COMMS_ATTRACT_RATIO) ** 2;

  let totalDx = 0, totalDy = 0;

  const processConn = (connX, connY) => {
    const dx = connX - agent.x;
    const dy = connY - agent.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < 10000) {
      const randomDir = action % 4;
      totalDx -= DIRECTION_DX[randomDir];
      totalDy -= DIRECTION_DY[randomDir];
      return;
    }
    if (distSq > commsRangeSq) return;

    if (distSq < repelDistSq) {
      totalDx -= dx > 0 ? 1 : dx < 0 ? -1 : 0;
      totalDy -= dy > 0 ? 1 : dy < 0 ? -1 : 0;
    } else if (distSq > attractDistSq) {
      totalDx += dx > 0 ? 1 : dx < 0 ? -1 : 0;
      totalDy += dy > 0 ? 1 : dy < 0 ? -1 : 0;
    }
  };

  processConn(spawnX, spawnY);

  for (let j = 0; j < agents.length; j++) {
    if (j === index) continue;
    const other = agents[j];
    if (other.team !== agent.team || COMMS_RANGE[other.vehicleType] === 0) continue;
    processConn(other.x, other.y);
  }

  if (totalDx !== 0 || totalDy !== 0) {
    agent.direction = getDirectionFromDelta(totalDx, totalDy);
    moveAgent(agent, centerXFP, terrain);
  }
}

function updateNormalAgent(agent, action, centerXFP, terrain) {
  if (action <= 9) {
    moveAgent(agent, centerXFP, terrain);
  } else if (action <= 12) {
    agent.direction = (agent.direction + 3) % 4;
  } else {
    agent.direction = (agent.direction + 1) % 4;
  }
}

// ============================================================================
// Full Simulation
// ============================================================================

function runSimulation(seed, verbose = false) {
  const terrain = generateTerrain(seed);
  
  const terrainCounts = { ground: 0, mountain: 0, liquid: 0, mushroom: 0, rubyMountain: 0 };
  for (const row of terrain) {
    for (const tile of row) {
      terrainCounts[tile]++;
    }
  }

  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_RENDER_WIDTH;
  const centerX = mapWidth / 2 - TILE_RENDER_WIDTH / 2;
  const centerXFP = centerX * FIXED_POINT_SCALE;

  const spawnDice = new DeterministicDice(keccak256(encodePacked(['bytes32', 'string'], [seed, 'spawn-points'])));
  const centerTile = Math.floor(GRID_SIZE / 2);
  let spawnRow = centerTile, spawnCol = centerTile;

  if (terrain[spawnRow][spawnCol] !== 'ground') {
    for (let attempts = 0; attempts < 100; attempts++) {
      const dr = spawnDice.roll(11) - 5;
      const dc = spawnDice.roll(11) - 5;
      const testRow = centerTile + dr;
      const testCol = centerTile + dc;
      if (testRow >= 0 && testRow < GRID_SIZE && testCol >= 0 && testCol < GRID_SIZE) {
        if (terrain[testRow][testCol] === 'ground') {
          spawnRow = testRow;
          spawnCol = testCol;
          break;
        }
      }
    }
  }

  const spawn = tileCenterToWorld(spawnRow, spawnCol, centerX);

  const agents = [];
  const COMMS_TYPES = [0, 6];
  const initDice = new DeterministicDice(keccak256(encodePacked(['bytes32', 'string'], [seed, 'agent-init'])));

  for (let team = 0; team < NUM_TEAMS; team++) {
    const direction = initDice.roll(4);
    const vehicleType = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
    agents.push({ x: spawn.x, y: spawn.y, direction, team, vehicleType });
  }

  const exploredTiles = new Set();

  function revealTilesAround(worldX, worldY) {
    const { row, col } = worldToTile(worldX, worldY, centerXFP);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
          exploredTiles.add(`${nr},${nc}`);
        }
      }
    }
  }

  for (const agent of agents) {
    revealTilesAround(agent.x, agent.y);
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundDice = new DeterministicDice(
      keccak256(encodePacked(['bytes32', 'string', 'uint32'], [seed, 'round', round]))
    );

    for (let i = 0; i < agents.length; i++) {
      const action = roundDice.roll(16);
      const agent = agents[i];

      if (COMMS_RANGE[agent.vehicleType] > 0) {
        updateCommsUnit(agents, i, action, spawn.x, spawn.y, centerXFP, terrain);
      } else {
        updateNormalAgent(agent, action, centerXFP, terrain);
      }

      revealTilesAround(agent.x, agent.y);
    }

    const nextRound = round + 1;
    if (nextRound % SPAWN_INTERVAL === 0 && agents.length < MAX_AGENTS) {
      const spawnRoundDice = new DeterministicDice(
        keccak256(encodePacked(['bytes32', 'string', 'uint32'], [seed, 'spawn', round]))
      );

      for (let team = 0; team < NUM_TEAMS; team++) {
        if (agents.length >= MAX_AGENTS) break;
        const direction = spawnRoundDice.roll(4);
        const vehicleType = COMMS_TYPES[spawnRoundDice.roll(COMMS_TYPES.length)];
        agents.push({ x: spawn.x, y: spawn.y, direction, team, vehicleType });
        revealTilesAround(spawn.x, spawn.y);
      }
    }
  }

  let mushroomsFound = 0;
  for (const tileKey of exploredTiles) {
    const [rowStr, colStr] = tileKey.split(',');
    const row = parseInt(rowStr), col = parseInt(colStr);
    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
      if (terrain[row][col] === 'mushroom') {
        mushroomsFound++;
      }
    }
  }

  const tilesDiscovered = exploredTiles.size;
  const payout = BigInt(tilesDiscovered) * PAYOUT_PER_TILE + BigInt(mushroomsFound) * PAYOUT_PER_MUSHROOM;

  return {
    seed,
    tilesDiscovered,
    mushroomsFound,
    payout,
    agentCount: agents.length,
    terrainCounts,
    spawnRow,
    spawnCol,
  };
}

// ============================================================================
// Test Seeds
// ============================================================================

const TEST_SEEDS = [
  // Standard test seeds
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  '0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
  
  // Hash-based seeds
  '0x5b5ee78532e82467429bcf43d5f3c8aa93f5e74dd98f9da1e94bac36cbe5b239',
  '0xd285e050369454839a99ae311b1148479a668ce4fcff45301674e5d29d0bd6a6',
  '0x2cfcbe2b3f334995d5cace24ae66ae2e22c1b93ce36ddd21720e129883c67695',
  '0xa3e101fc98fba11d0060f2c2e25f3b3e4c6b9f00b5ed945c9e4259fcf9a37121',
  '0x600badb8448d4de7e34d9f905ea4fde1072e60c8bcdd75f32cbe65f8881c270c',
  
  // Additional variety
  '0x0101010101010101010101010101010101010101010101010101010101010101',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0x5555555555555555555555555555555555555555555555555555555555555555',
  '0xfefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefe',
  '0x1111111111111111111111111111111111111111111111111111111111111111',
];

// ============================================================================
// Main
// ============================================================================

const numTests = parseInt(process.argv[2]) || 20;

console.log(`\n${'='.repeat(80)}`);
console.log(`COMPREHENSIVE SEED TEST - Running ${numTests} seeds`);
console.log(`${'='.repeat(80)}\n`);

let passed = 0;
let failed = 0;
const results = [];

// Run fixed test seeds first
console.log(`Running ${TEST_SEEDS.length} fixed test seeds...\n`);

for (const seed of TEST_SEEDS) {
  try {
    const result = runSimulation(seed);
    results.push(result);
    
    // Validate results
    if (result.agentCount !== 21) {
      console.log(`✗ FAIL: ${seed.slice(0, 18)}... - Wrong agent count: ${result.agentCount}`);
      failed++;
    } else if (result.tilesDiscovered < 9) {
      console.log(`✗ FAIL: ${seed.slice(0, 18)}... - Too few tiles: ${result.tilesDiscovered}`);
      failed++;
    } else {
      console.log(`✓ PASS: ${seed.slice(0, 18)}... - Tiles: ${result.tilesDiscovered.toString().padStart(3)}, Mushrooms: ${result.mushroomsFound.toString().padStart(2)}, Payout: ${formatEther(result.payout)} ETH`);
      passed++;
    }
  } catch (e) {
    console.log(`✗ ERROR: ${seed.slice(0, 18)}... - ${e.message}`);
    failed++;
  }
}

// Generate and run additional random seeds
const additionalCount = Math.max(0, numTests - TEST_SEEDS.length);
if (additionalCount > 0) {
  console.log(`\nRunning ${additionalCount} random test seeds...\n`);
  
  for (let i = 0; i < additionalCount; i++) {
    // Generate random seed
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const seed = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    try {
      const result = runSimulation(seed);
      results.push(result);
      
      if (result.agentCount !== 21) {
        console.log(`✗ FAIL: ${seed.slice(0, 18)}... - Wrong agent count: ${result.agentCount}`);
        failed++;
      } else if (result.tilesDiscovered < 9) {
        console.log(`✗ FAIL: ${seed.slice(0, 18)}... - Too few tiles: ${result.tilesDiscovered}`);
        failed++;
      } else {
        console.log(`✓ PASS: ${seed.slice(0, 18)}... - Tiles: ${result.tilesDiscovered.toString().padStart(3)}, Mushrooms: ${result.mushroomsFound.toString().padStart(2)}, Payout: ${formatEther(result.payout)} ETH`);
        passed++;
      }
    } catch (e) {
      console.log(`✗ ERROR: ${seed.slice(0, 18)}... - ${e.message}`);
      failed++;
    }
  }
}

// Statistics
console.log(`\n${'='.repeat(80)}`);
console.log(`SUMMARY`);
console.log(`${'='.repeat(80)}`);
console.log(`Total tests: ${passed + failed}`);
console.log(`Passed:      ${passed}`);
console.log(`Failed:      ${failed}`);

if (results.length > 0) {
  const tilesArr = results.map(r => r.tilesDiscovered);
  const mushroomsArr = results.map(r => r.mushroomsFound);
  const payoutsArr = results.map(r => Number(r.payout));
  
  console.log(`\n--- Statistics ---`);
  console.log(`Tiles discovered:  min=${Math.min(...tilesArr)}, max=${Math.max(...tilesArr)}, avg=${(tilesArr.reduce((a, b) => a + b, 0) / tilesArr.length).toFixed(1)}`);
  console.log(`Mushrooms found:   min=${Math.min(...mushroomsArr)}, max=${Math.max(...mushroomsArr)}, avg=${(mushroomsArr.reduce((a, b) => a + b, 0) / mushroomsArr.length).toFixed(1)}`);
  console.log(`Payouts:           min=${formatEther(BigInt(Math.min(...payoutsArr)))}, max=${formatEther(BigInt(Math.max(...payoutsArr)))}, avg=${formatEther(BigInt(Math.floor(payoutsArr.reduce((a, b) => a + b, 0) / payoutsArr.length)))}`);
}

console.log(`\n${'='.repeat(80)}\n`);

// Exit with error code if any failed
process.exit(failed > 0 ? 1 : 0);

