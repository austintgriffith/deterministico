/**
 * Map Generation Parity Test
 * 
 * Compares TypeScript and Solidity map generation to verify they produce identical outputs.
 * 
 * Usage: node mapParityTest.js [gridSize] [numSeeds]
 * 
 * Example: node mapParityTest.js 11 5
 * 
 * This script:
 * 1. Generates maps using the TypeScript algorithm
 * 2. Compares with Solidity output (via forge test)
 * 3. Reports parity status for all test seeds
 */

import { execSync } from "child_process";
import { keccak256, encodePacked } from "viem";

// ============================================================================
// TypeScript Map Generation (matching packages/nextjs/lib/game/utils.ts)
// ============================================================================

// Terrain types - must match Solidity enum order
const TerrainTypes = ["Ground", "Mountain", "Liquid", "Mushroom", "RubyMountain"];
const TerrainChars = { Ground: "G", Mountain: "M", Liquid: "L", Mushroom: "S", RubyMountain: "R" };

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

/**
 * Convert grid to string format for comparison
 */
function gridToString(grid) {
  return grid.map(row => row.map(t => TerrainChars[t]).join(",")).join("\n");
}

/**
 * Parse Solidity output from forge test
 */
function parseSolidityOutput(output, seedLabel) {
  const lines = output.split("\n");
  const result = {};
  let currentSeed = null;
  let rows = [];
  
  for (const line of lines) {
    const seedMatch = line.match(/=== (SEED_\d+|PARITY TEST OUTPUT) ===/);
    if (seedMatch) {
      if (currentSeed && rows.length > 0) {
        result[currentSeed] = rows;
      }
      currentSeed = seedMatch[1];
      rows = [];
      continue;
    }
    
    const rowMatch = line.match(/Row \d+: (.+)/);
    if (rowMatch && currentSeed) {
      rows.push(rowMatch[1]);
    }
  }
  
  if (currentSeed && rows.length > 0) {
    result[currentSeed] = rows;
  }
  
  return result;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const gridSize = parseInt(process.argv[2]) || 11;
  
  console.log("═".repeat(70));
  console.log("  MAP GENERATION PARITY TEST - TypeScript vs Solidity");
  console.log("═".repeat(70));
  console.log(`  Grid Size: ${gridSize}x${gridSize}`);
  console.log("═".repeat(70));
  console.log();

  // Test seeds - must match the ones in MapGenerator.t.sol
  const testSeeds = [
    { label: "PARITY TEST OUTPUT", roll: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" },
    { label: "SEED_0", roll: "0x5b5ee78532e82467429bcf43d5f3c8aa93f5e74dd98f9da1e94bac36cbe5b239" },
    { label: "SEED_1", roll: "0xd285e050369454839a99ae311b1148479a668ce4fcff45301674e5d29d0bd6a6" },
    { label: "SEED_2", roll: "0x2cfcbe2b3f334995d5cace24ae66ae2e22c1b93ce36ddd21720e129883c67695" },
  ];

  // Run both Solidity tests to get all outputs
  console.log("Running Solidity tests...");
  let solidityOutput = "";
  try {
    const output1 = execSync(
      `forge test --match-test "test_ParityOutput" -vvv 2>&1`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    const output2 = execSync(
      `forge test --match-test "test_MultiSeedParity" -vvv 2>&1`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    solidityOutput = output1 + "\n" + output2;
  } catch (error) {
    console.log("⚠️  Could not run Solidity tests");
    console.log(error.message);
    return;
  }

  const solidityMaps = parseSolidityOutput(solidityOutput);

  let passCount = 0;
  let failCount = 0;

  for (const { label, roll } of testSeeds) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`TEST: ${label}`);
    console.log(`Roll: ${roll}`);
    console.log(`${"─".repeat(70)}`);

    // Generate TypeScript map
    const tsGrid = generateMapTS(roll, gridSize);
    const tsLines = gridToString(tsGrid).split("\n");

    console.log("\n📘 TypeScript Output:");
    tsLines.forEach((line, idx) => {
      console.log(`  Row ${idx.toString().padStart(2)}: ${line}`);
    });

    // Get Solidity output
    const solLines = solidityMaps[label];
    
    if (!solLines) {
      console.log("\n⚠️  No Solidity output found for this seed");
      continue;
    }

    console.log("\n📙 Solidity Output:");
    solLines.forEach((line, idx) => {
      console.log(`  Row ${idx.toString().padStart(2)}: ${line}`);
    });

    // Compare
    let matches = true;
    let diffCount = 0;

    for (let j = 0; j < Math.max(tsLines.length, solLines.length); j++) {
      if (tsLines[j] !== solLines[j]) {
        matches = false;
        diffCount++;
        if (diffCount <= 3) {
          console.log(`\n  ❌ Row ${j} MISMATCH:`);
          console.log(`     TS:  ${tsLines[j] || "(missing)"}`);
          console.log(`     Sol: ${solLines[j] || "(missing)"}`);
        }
      }
    }

    if (matches) {
      console.log("\n✅ PASS - Outputs are IDENTICAL!");
      passCount++;
    } else {
      console.log(`\n❌ FAIL - Found ${diffCount} row differences`);
      failCount++;
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Tests Run: ${testSeeds.length}`);
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log();

  if (passCount === testSeeds.length && failCount === 0) {
    console.log("  🎉 ALL TESTS PASSED!");
    console.log("  TypeScript and Solidity map generation are in PERFECT PARITY.");
  } else if (failCount > 0) {
    console.log("  ⚠️  PARITY FAILED - check for differences above.");
    process.exit(1);
  }

  console.log("═".repeat(70));
}

main();
