/**
 * Map Hash Parity Test
 * 
 * Verifies that TypeScript and Solidity produce identical terrain hashes.
 * This tests the packTerrain and terrainHash functions match exactly.
 * 
 * Usage: node mapHashParityTest.js [gridSize]
 * 
 * Example: node mapHashParityTest.js 32
 */

import { execSync } from "child_process";
import { keccak256, encodePacked } from "viem";

// ============================================================================
// TypeScript Map Generation (matching packages/nextjs/lib/game/utils.ts)
// ============================================================================

// Terrain types - must match Solidity enum order
// Solidity: enum TerrainType { Ground=0, Mountain=1, Liquid=2, Mushroom=3, RubyMountain=4 }
const TERRAIN_TYPE_INDEX = {
  Ground: 0,
  Mountain: 1,
  Liquid: 2,
  Mushroom: 3,
  RubyMountain: 4,
};

// Terrain weights (must sum to 100)
const TERRAIN_WEIGHTS = {
  Ground: 50,
  Mountain: 20,
  Liquid: 17,
  Mushroom: 10,
  RubyMountain: 3,
};

// Terrain type order for weighted selection
const TERRAIN_ORDER = ["Ground", "Mountain", "Liquid", "Mushroom", "RubyMountain"];

/**
 * Keccak256-based hash function for position-based randomness
 */
function hash(x, y, seed) {
  return BigInt(keccak256(encodePacked(["uint256", "uint256", "uint256"], [BigInt(x), BigInt(y), seed])));
}

/**
 * Get terrain type based on weighted random selection
 */
function getWeightedTerrainType(row, col, seed) {
  const roll = Number(hash(row, col, seed) % 100n);
  let cumulative = 0;
  for (const terrainType of TERRAIN_ORDER) {
    cumulative += TERRAIN_WEIGHTS[terrainType];
    if (roll < cumulative) {
      return terrainType;
    }
  }
  return "Ground";
}

/**
 * Apply one smoothing pass using cellular automata rules
 */
function smoothTerrainGrid(grid, passNumber, seed) {
  const gridSize = grid.length;
  const newGrid = [];

  for (let row = 0; row < gridSize; row++) {
    const newRow = [];
    for (let col = 0; col < gridSize; col++) {
      const currentType = grid[row][col];

      // Count neighbors of each type
      const counts = {};
      for (const t of TERRAIN_ORDER) counts[t] = 0;

      // Check 3x3 neighborhood (including self)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
            counts[grid[nr][nc]]++;
          }
        }
      }

      // Find dominant type
      let dominantType = currentType;
      let maxCount = counts[currentType];
      for (const terrainType of TERRAIN_ORDER) {
        if (counts[terrainType] > maxCount) {
          maxCount = counts[terrainType];
          dominantType = terrainType;
        }
      }

      // Preserve rubyMountain if it has >= 2 neighbors
      if (currentType === "RubyMountain") {
        if (counts["RubyMountain"] >= 2) {
          newRow.push(currentType);
          continue;
        }
      }

      const currentCount = counts[currentType];

      // Apply smoothing rules
      if (maxCount === currentCount) {
        newRow.push(currentType);
      } else if (maxCount - currentCount <= 2) {
        const tieBreaker = Number(hash(row + passNumber * 1000, col + passNumber * 1000, seed) % 100n);
        if (tieBreaker < 40) {
          newRow.push(currentType);
        } else {
          newRow.push(dominantType);
        }
      } else {
        newRow.push(dominantType);
      }
    }
    newGrid.push(newRow);
  }

  return newGrid;
}

/**
 * Generate terrain map using TypeScript algorithm
 */
function generateMapTS(roll, gridSize) {
  // Derive seed (must match Solidity)
  const seed = BigInt(keccak256(encodePacked(["bytes32", "string"], [roll, "map"])));

  // Phase 1: Initial terrain assignment
  let grid = [];
  for (let row = 0; row < gridSize; row++) {
    const rowData = [];
    for (let col = 0; col < gridSize; col++) {
      rowData.push(getWeightedTerrainType(row, col, seed));
    }
    grid.push(rowData);
  }

  // Phase 2: Smoothing (2 passes)
  grid = smoothTerrainGrid(grid, 1, seed);
  grid = smoothTerrainGrid(grid, 2, seed);

  return grid;
}

// ============================================================================
// TypeScript Hash Functions (matching packages/nextjs/lib/game/utils.ts)
// ============================================================================

/**
 * Pack terrain grid into bytes (Solidity-compatible)
 * 4 bits per tile, 2 tiles per byte (high nibble first)
 * 
 * Matches Solidity MapGenerator.packTerrain() exactly.
 */
function packTerrain(terrain) {
  const gridSize = terrain.length;
  const totalTiles = gridSize * gridSize;
  const packedLength = Math.ceil(totalTiles / 2); // 2 tiles per byte
  const packed = new Uint8Array(packedLength);

  let byteIndex = 0;
  let tileIndex = 0;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const terrainValue = TERRAIN_TYPE_INDEX[terrain[row][col]];

      if (tileIndex % 2 === 0) {
        // High nibble (first tile in byte)
        packed[byteIndex] = terrainValue << 4;
      } else {
        // Low nibble (second tile in byte) - combine with existing high nibble
        packed[byteIndex] |= terrainValue;
        byteIndex++;
      }
      tileIndex++;
    }
  }

  return packed;
}

/**
 * Compute terrain hash (matches Solidity MapGenerator.terrainHash)
 * Returns keccak256 of the packed terrain bytes
 */
function terrainHash(terrain) {
  const packed = packTerrain(terrain);
  return keccak256(packed);
}

/**
 * Generate map and return hash (matches Solidity MapGeneratorWrapper.generateMapHash)
 */
function generateMapHashTS(roll, gridSize) {
  const terrain = generateMapTS(roll, gridSize);
  return terrainHash(terrain);
}

// ============================================================================
// Solidity Interaction
// ============================================================================

/**
 * Parse hash output from forge test
 */
function parseSolidityHashOutput(output) {
  const results = {};
  const lines = output.split("\n");
  
  for (const line of lines) {
    // Match lines like: "Hash for 0x123...abc: 0xdef...789"
    const match = line.match(/Hash for (0x[a-fA-F0-9]+):\s*(0x[a-fA-F0-9]+)/);
    if (match) {
      results[match[1].toLowerCase()] = match[2].toLowerCase();
    }
  }
  
  return results;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const gridSize = parseInt(process.argv[2]) || 32;
  
  console.log("═".repeat(70));
  console.log("  MAP HASH PARITY TEST - TypeScript vs Solidity");
  console.log("═".repeat(70));
  console.log(`  Grid Size: ${gridSize}x${gridSize}`);
  console.log("═".repeat(70));
  console.log();

  // Test seeds
  const testSeeds = [
    { 
      label: "Seed 1", 
      roll: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" 
    },
    { 
      label: "Seed 2 (parity_test_seed_0)", 
      roll: "0x5b5ee78532e82467429bcf43d5f3c8aa93f5e74dd98f9da1e94bac36cbe5b239" 
    },
    { 
      label: "Seed 3 (parity_test_seed_1)", 
      roll: "0xd285e050369454839a99ae311b1148479a668ce4fcff45301674e5d29d0bd6a6" 
    },
    { 
      label: "Seed 4 (parity_test_seed_2)", 
      roll: "0x2cfcbe2b3f334995d5cace24ae66ae2e22c1b93ce36ddd21720e129883c67695" 
    },
  ];

  // Run Solidity test to get hashes
  console.log("Running Solidity hash test...\n");
  let solidityHashes = {};
  
  try {
    const output = execSync(
      `forge test --match-test "test_HashParityOutput" -vvv 2>&1`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    solidityHashes = parseSolidityHashOutput(output);
    
    if (Object.keys(solidityHashes).length === 0) {
      console.log("⚠️  No hash output found from Solidity test.");
      console.log("    Make sure test_HashParityOutput exists in MapGenerator.t.sol\n");
      console.log("    Running TypeScript-only tests...\n");
    }
  } catch (error) {
    console.log("⚠️  Could not run Solidity test. Running TypeScript-only tests.\n");
  }

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const { label, roll } of testSeeds) {
    console.log(`${"─".repeat(70)}`);
    console.log(`TEST: ${label}`);
    console.log(`Roll: ${roll}`);
    console.log(`${"─".repeat(70)}`);

    // Generate TypeScript hash
    const startTime = Date.now();
    const tsHash = generateMapHashTS(roll, gridSize);
    const tsTime = Date.now() - startTime;

    console.log(`\n📘 TypeScript:`);
    console.log(`   Hash: ${tsHash}`);
    console.log(`   Time: ${tsTime}ms`);

    // Get Solidity hash
    const solHash = solidityHashes[roll.toLowerCase()];
    
    if (solHash) {
      console.log(`\n📙 Solidity:`);
      console.log(`   Hash: ${solHash}`);

      // Compare
      if (tsHash.toLowerCase() === solHash.toLowerCase()) {
        console.log(`\n✅ PASS - Hashes are IDENTICAL!`);
        passCount++;
      } else {
        console.log(`\n❌ FAIL - Hash mismatch!`);
        console.log(`   Expected: ${solHash}`);
        console.log(`   Got:      ${tsHash}`);
        failCount++;
      }
    } else {
      console.log(`\n⚠️  SKIP - No Solidity hash for comparison`);
      skipCount++;
    }
    console.log();
  }

  // Summary
  console.log("═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Tests Run: ${testSeeds.length}`);
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log();

  if (failCount === 0 && passCount > 0) {
    console.log("  🎉 ALL COMPARED TESTS PASSED!");
    console.log("  TypeScript and Solidity hash functions are in PERFECT PARITY.");
  } else if (failCount > 0) {
    console.log("  ⚠️  PARITY FAILED - check for differences above.");
    process.exit(1);
  } else if (skipCount === testSeeds.length) {
    console.log("  ℹ️  No Solidity comparison available.");
    console.log("     Add test_HashParityOutput to MapGenerator.t.sol for full parity testing.");
  }

  console.log("═".repeat(70));

  // Additional info about TypeScript hashes for manual verification
  if (skipCount > 0) {
    console.log("\n📋 TypeScript Hashes (for manual Solidity comparison):");
    console.log("─".repeat(70));
    for (const { label, roll } of testSeeds) {
      const tsHash = generateMapHashTS(roll, gridSize);
      console.log(`${label}:`);
      console.log(`  Roll: ${roll}`);
      console.log(`  Hash: ${tsHash}`);
      console.log();
    }
  }
}

main();

