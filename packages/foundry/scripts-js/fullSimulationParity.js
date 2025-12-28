#!/usr/bin/env node
/**
 * Full Simulation Parity Test
 * 
 * This script compares the Oracle's JavaScript simulation with what the
 * ChallengeExecutor contract would compute on-chain, verifying they produce
 * identical results (tiles discovered, mushrooms found, payout).
 * 
 * Usage: node scripts-js/fullSimulationParity.js [seed]
 *        If no seed provided, uses a default test seed.
 */

import { keccak256, encodePacked, toHex, parseEther, formatEther } from 'viem';

// ============================================================================
// Constants (must match Solidity exactly)
// ============================================================================

const GRID_SIZE = 32;
const MAX_ROUNDS = 100;
const SPAWN_INTERVAL = 5;
const MAX_AGENTS = 21; // 1 initial + 20 spawns
const NUM_TEAMS = 1;

const TILE_X_SPACING = 89;
const TILE_Y_SPACING = 47;
const TILE_RENDER_WIDTH = 200;
const FIXED_POINT_SCALE = 100;

// Corrected value: ((34 * 200 / 166) + 47) * 100 = 8796
const TILE_CENTER_Y_OFFSET = 8796;

// Payout constants
const PAYOUT_PER_TILE = BigInt("10000000000000"); // 0.00001 ether
const PAYOUT_PER_MUSHROOM = BigInt("100000000000000"); // 0.0001 ether

// Direction vectors (fixed-point x100)
const DIRECTION_DX = [200, 200, -200, -200]; // north, east, south, west
const DIRECTION_DY = [-100, 100, 100, -100];

// Movement speeds (heavy = 300, light = 500)
const MOVE_SPEED_BY_TYPE = [300, 300, 300, 300, 300, 300, 500, 500, 500, 500, 500, 500];

// Comms range (80000 for comms units, 0 for others)
const COMMS_RANGE = [80000, 0, 0, 0, 0, 0, 80000, 0, 0, 0, 0, 0];

// Comms behavior
const COMMS_REPEL_RATIO = 0.4;
const COMMS_ATTRACT_RATIO = 0.8;

// Collision
const VEHICLE_COLLISION_Y_OFFSET = 800;
const VEHICLE_COLLISION_PADDING = 8;

// ============================================================================
// DeterministicDice (matches Solidity exactly)
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
// Map Generation (matches MapGenerator.sol)
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
// Coordinate Conversion (matches Solidity exactly)
// ============================================================================

function tileCenterToWorld(row, col, centerX) {
  // centerX is in pixels (not scaled)
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

  // Rounded division matching Solidity
  const roundedDiv = (a, b) => {
    if (a >= 0) return Math.floor((a + Math.floor(b / 2)) / b);
    return Math.floor((a - Math.floor(b / 2)) / b);
  };

  const colMinusRow = roundedDiv(adjustedX - centerX, tileXSpacingScaled);
  const colPlusRow = roundedDiv(adjustedY, tileYSpacingScaled);

  // Use arithmetic right shift to match Solidity >> 1
  const col = (colMinusRow + colPlusRow) >> 1;
  const row = (colPlusRow - colMinusRow) >> 1;

  return { row, col };
}

// ============================================================================
// Agent Simulation (matches Solidity exactly)
// ============================================================================

function intDiv(a, b) {
  return Math.trunc(a / b);
}

function getDirectionFromDelta(dx, dy) {
  if (dx >= 0 && dy < 0) return 0; // north
  if (dx >= 0 && dy >= 0) return 1; // east
  if (dx < 0 && dy >= 0) return 2; // south
  return 3; // west
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

  // Process home base
  processConn(spawnX, spawnY);

  // Process other comms units on same team
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

function runSimulation(seed) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FULL SIMULATION PARITY TEST`);
  console.log(`Seed: ${seed}`);
  console.log(`${'='.repeat(70)}\n`);

  // Generate terrain
  const terrain = generateTerrain(seed);
  console.log(`✓ Generated ${GRID_SIZE}x${GRID_SIZE} terrain grid`);

  // Count terrain types
  const terrainCounts = { ground: 0, mountain: 0, liquid: 0, mushroom: 0, rubyMountain: 0 };
  for (const row of terrain) {
    for (const tile of row) {
      terrainCounts[tile]++;
    }
  }
  console.log(`  Terrain counts: ${JSON.stringify(terrainCounts)}`);

  // Calculate map center
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_RENDER_WIDTH;
  const centerX = mapWidth / 2 - TILE_RENDER_WIDTH / 2; // pixels, unscaled
  const centerXFP = centerX * FIXED_POINT_SCALE; // fixed-point
  console.log(`✓ Map center: ${centerX}px (FP: ${centerXFP})`);

  // Generate spawn point (matches Oracle/ChallengeExecutor)
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
  console.log(`✓ Spawn point: tile(${spawnRow},${spawnCol}) → world(${spawn.x}, ${spawn.y})`);

  // Initialize agents
  const agents = [];
  const COMMS_TYPES = [0, 6]; // heavy_comms, light_comms
  const initDice = new DeterministicDice(keccak256(encodePacked(['bytes32', 'string'], [seed, 'agent-init'])));

  for (let team = 0; team < NUM_TEAMS; team++) {
    const direction = initDice.roll(4);
    const vehicleType = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
    agents.push({
      x: spawn.x,
      y: spawn.y,
      direction,
      team,
      vehicleType
    });
  }
  console.log(`✓ Initial agent: dir=${agents[0].direction}, type=${agents[0].vehicleType}`);

  // Track explored tiles
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

  // Reveal initial tiles
  for (const agent of agents) {
    revealTilesAround(agent.x, agent.y);
  }
  console.log(`✓ Initial tiles revealed: ${exploredTiles.size}`);

  // Run simulation
  console.log(`\n--- Running ${MAX_ROUNDS} rounds ---`);
  
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Create round dice
    const roundDice = new DeterministicDice(
      keccak256(encodePacked(['bytes32', 'string', 'uint32'], [seed, 'round', round]))
    );

    // Update all agents
    for (let i = 0; i < agents.length; i++) {
      const action = roundDice.roll(16);
      const agent = agents[i];

      if (COMMS_RANGE[agent.vehicleType] > 0) {
        updateCommsUnit(agents, i, action, spawn.x, spawn.y, centerXFP, terrain);
      } else {
        updateNormalAgent(agent, action, centerXFP, terrain);
      }

      // Reveal tiles
      revealTilesAround(agent.x, agent.y);
    }

    // Spawn new agents
    const nextRound = round + 1;
    if (nextRound % SPAWN_INTERVAL === 0 && agents.length < MAX_AGENTS) {
      const spawnRoundDice = new DeterministicDice(
        keccak256(encodePacked(['bytes32', 'string', 'uint32'], [seed, 'spawn', round]))
      );

      for (let team = 0; team < NUM_TEAMS; team++) {
        if (agents.length >= MAX_AGENTS) break;
        const direction = spawnRoundDice.roll(4);
        const vehicleType = COMMS_TYPES[spawnRoundDice.roll(COMMS_TYPES.length)];
        agents.push({
          x: spawn.x,
          y: spawn.y,
          direction,
          team,
          vehicleType
        });
        revealTilesAround(spawn.x, spawn.y);
      }
    }

    // Progress logging
    if ((round + 1) % 20 === 0) {
      console.log(`  Round ${round + 1}: ${agents.length} agents, ${exploredTiles.size} tiles`);
    }
  }

  // Calculate final stats
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

  console.log(`\n${'='.repeat(70)}`);
  console.log(`SIMULATION RESULTS`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Final agent count: ${agents.length}`);
  console.log(`  Tiles discovered:  ${tilesDiscovered}`);
  console.log(`  Mushrooms found:   ${mushroomsFound}`);
  console.log(`  Payout:            ${formatEther(payout)} ETH`);
  console.log(`  (${payout.toString()} wei)`);

  // Output final agent positions for verification
  console.log(`\n--- Final Agent Positions (first 5) ---`);
  for (let i = 0; i < Math.min(5, agents.length); i++) {
    const a = agents[i];
    console.log(`  Agent ${i}: x=${a.x}, y=${a.y}, dir=${a.direction}, type=${a.vehicleType}`);
  }

  // Output for Solidity test comparison
  console.log(`\n--- For Solidity Test Verification ---`);
  console.log(`bytes32 seed = ${seed};`);
  console.log(`uint256 expectedTiles = ${tilesDiscovered};`);
  console.log(`uint256 expectedMushrooms = ${mushroomsFound};`);
  console.log(`uint256 expectedPayout = ${payout.toString()};`);
  console.log(`uint32 expectedAgentCount = ${agents.length};`);
  
  return {
    seed,
    tilesDiscovered,
    mushroomsFound,
    payout,
    agentCount: agents.length,
    finalAgents: agents.slice(0, 5)
  };
}

// ============================================================================
// Main
// ============================================================================

const seed = process.argv[2] || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// Validate seed format
if (!seed.match(/^0x[0-9a-fA-F]{64}$/)) {
  console.error('Invalid seed format. Expected 0x followed by 64 hex characters.');
  process.exit(1);
}

const result = runSimulation(seed);

// Output JSON for programmatic use
console.log(`\n--- JSON Output ---`);
console.log(JSON.stringify({
  seed: result.seed,
  tilesDiscovered: result.tilesDiscovered,
  mushroomsFound: result.mushroomsFound,
  payout: result.payout.toString(),
  agentCount: result.agentCount
}, null, 2));

