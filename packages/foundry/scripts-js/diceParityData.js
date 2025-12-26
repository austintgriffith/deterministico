/**
 * Generates deterministic dice roll sequences for parity testing with Solidity.
 * 
 * Usage: node diceParityData.js <seed_hex>
 * 
 * Output: JSON array of roll results for the given seed
 * The test sequence uses various n values to exercise the algorithm thoroughly.
 */

import { DeterministicDice } from "deterministic-dice";

// Moderately large number that avoids JS library internal overflow
const LARGE_N = 65536; // 2^16 - 16 bits, safe for shift operations

// Test sequence: array of n values to roll
// This exercises different bit depths and edge cases
const TEST_SEQUENCE = [
  16, 16, 16, 16, 16,     // 4 bits - agent actions (0-15)
  100, 100, 100, 100,     // ~7 bits - percentages
  6, 6, 6, 6, 6, 6,       // ~3 bits - d6 rolls
  2, 2, 2, 2, 2,          // 1 bit - coin flips
  1000, 1000, 1000,       // ~10 bits - larger ranges
  256, 256, 256, 256,     // 8 bits - byte values
  16, 16, 16, 16, 16,     // more 4-bit rolls
  100, 100, 100, 100,     // more percentages
  16, 16, 16, 16, 16,     // more actions
  100, 100, 100, 100,     // more percentages
  16, 16, 16, 16, 16,     // more actions
  100, 100, 100, 100,     // more percentages
  16, 16, 16, 16, 16,     // more actions
  100, 100, 100, 100,     // more percentages
  16, 16, 16, 16, 16,     // more actions
  100, 100, 100, 100,     // more percentages (total ~80 rolls to cross entropy boundary)
  16, 16, 16, 16, 16, 16, 16, 16, 16, 16, // 10 more (exhausts first entropy, tests rehash)
  16, 16, 16, 16, 16, 16, 16, 16, 16, 16, // 10 more
  LARGE_N, LARGE_N, LARGE_N, LARGE_N, LARGE_N, // 10^15 - ~50 bits, 10 times
  LARGE_N, LARGE_N, LARGE_N, LARGE_N, LARGE_N,
];

function main() {
  const seed = process.argv[2];
  
  if (!seed) {
    console.error("Usage: node diceParityData.js <seed_hex>");
    console.error("Example: node diceParityData.js 0x1234...abcd");
    process.exit(1);
  }

  // Ensure seed is properly formatted
  const normalizedSeed = seed.startsWith("0x") ? seed : `0x${seed}`;
  
  // Create dice with the seed
  const dice = new DeterministicDice(normalizedSeed);
  
  // Roll the test sequence
  const results = TEST_SEQUENCE.map(n => dice.roll(n));
  
  // Output as JSON (n values and results interleaved for verification)
  const output = {
    seed: normalizedSeed,
    sequence: TEST_SEQUENCE,
    results: results
  };
  
  console.log(JSON.stringify(output));
}

main();

