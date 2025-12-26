// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/DeterministicDice.sol";

contract DeterministicDiceTest is Test {
    using DeterministicDice for DeterministicDice.Dice;

    /// @notice Test that same seed produces same sequence of rolls
    function test_Determinism() public pure {
        bytes32 seed = keccak256("test seed");
        
        // First sequence
        DeterministicDice.Dice memory dice1 = DeterministicDice.create(seed);
        uint256 roll1a;
        uint256 roll1b;
        uint256 roll1c;
        (roll1a, dice1) = DeterministicDice.roll(dice1, 16);
        (roll1b, dice1) = DeterministicDice.roll(dice1, 100);
        (roll1c, dice1) = DeterministicDice.roll(dice1, 1000);
        
        // Second sequence with same seed
        DeterministicDice.Dice memory dice2 = DeterministicDice.create(seed);
        uint256 roll2a;
        uint256 roll2b;
        uint256 roll2c;
        (roll2a, dice2) = DeterministicDice.roll(dice2, 16);
        (roll2b, dice2) = DeterministicDice.roll(dice2, 100);
        (roll2c, dice2) = DeterministicDice.roll(dice2, 1000);
        
        // Must be identical
        assertEq(roll1a, roll2a, "First roll mismatch");
        assertEq(roll1b, roll2b, "Second roll mismatch");
        assertEq(roll1c, roll2c, "Third roll mismatch");
    }

    /// @notice Test that different seeds produce different sequences
    function test_DifferentSeeds() public pure {
        bytes32 seed1 = keccak256("seed one");
        bytes32 seed2 = keccak256("seed two");
        
        DeterministicDice.Dice memory dice1 = DeterministicDice.create(seed1);
        DeterministicDice.Dice memory dice2 = DeterministicDice.create(seed2);
        
        uint256 roll1;
        uint256 roll2;
        (roll1, ) = DeterministicDice.roll(dice1, 1000000);
        (roll2, ) = DeterministicDice.roll(dice2, 1000000);
        
        // Very unlikely to be equal with different seeds
        assertTrue(roll1 != roll2, "Different seeds produced same roll");
    }

    /// @notice Test that rolls stay within bounds
    function test_RollBounds() public pure {
        bytes32 seed = keccak256("bounds test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        uint256 result;
        
        // Test various ranges
        for (uint256 i = 0; i < 100; i++) {
            // Roll 0-15
            (result, dice) = DeterministicDice.roll(dice, 16);
            assertTrue(result < 16, "Roll exceeded 16");
            
            // Roll 0-99
            (result, dice) = DeterministicDice.roll(dice, 100);
            assertTrue(result < 100, "Roll exceeded 100");
            
            // Roll 0-5
            (result, dice) = DeterministicDice.roll(dice, 6);
            assertTrue(result < 6, "Roll exceeded 6");
        }
    }

    /// @notice Test distribution is roughly uniform (chi-squared style check)
    function test_Distribution() public pure {
        bytes32 seed = keccak256("distribution test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        uint256 n = 16; // Testing 0-15
        uint256 numRolls = 1600; // 100 rolls per bucket expected
        uint256[] memory buckets = new uint256[](n);
        
        uint256 result;
        for (uint256 i = 0; i < numRolls; i++) {
            (result, dice) = DeterministicDice.roll(dice, n);
            buckets[result]++;
        }
        
        // Each bucket should have roughly numRolls/n = 100 entries
        // Allow ±50% variance (50-150 per bucket)
        uint256 expected = numRolls / n;
        uint256 minAllowed = expected / 2;
        uint256 maxAllowed = expected + expected / 2;
        
        for (uint256 i = 0; i < n; i++) {
            assertTrue(buckets[i] >= minAllowed, "Bucket too low - distribution skewed");
            assertTrue(buckets[i] <= maxAllowed, "Bucket too high - distribution skewed");
        }
    }

    /// @notice Test that entropy exhaustion and re-hashing works correctly
    function test_EntropyExhaustion() public pure {
        bytes32 seed = keccak256("exhaustion test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        // bytes32 has 64 nibbles. If we roll(16) each time, we consume 1 nibble per roll
        // After 64 rolls, we should exhaust and re-hash
        // After 128 rolls, we should exhaust and re-hash again
        
        uint256 result;
        uint256[] memory results = new uint256[](200);
        
        for (uint256 i = 0; i < 200; i++) {
            (result, dice) = DeterministicDice.roll(dice, 16);
            results[i] = result;
        }
        
        // Verify determinism still holds after exhaustion
        dice = DeterministicDice.create(seed);
        for (uint256 i = 0; i < 200; i++) {
            (result, dice) = DeterministicDice.roll(dice, 16);
            assertEq(result, results[i], "Mismatch after entropy exhaustion");
        }
    }

    /// @notice Test edge case: rolling with n=1 always returns 0
    function test_RollOne() public pure {
        bytes32 seed = keccak256("roll one test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        uint256 result;
        for (uint256 i = 0; i < 10; i++) {
            (result, dice) = DeterministicDice.roll(dice, 1);
            assertEq(result, 0, "Roll(1) should always be 0");
        }
    }

    /// @notice Test edge case: rolling with n=2 (coin flip)
    function test_CoinFlip() public pure {
        bytes32 seed = keccak256("coin flip test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        uint256 heads = 0;
        uint256 tails = 0;
        uint256 numFlips = 1000;
        
        uint256 result;
        for (uint256 i = 0; i < numFlips; i++) {
            (result, dice) = DeterministicDice.roll(dice, 2);
            if (result == 0) heads++;
            else tails++;
        }
        
        // Should be roughly 50/50, allow ±15% variance
        assertTrue(heads > 350 && heads < 650, "Coin flip distribution skewed");
        assertTrue(tails > 350 && tails < 650, "Coin flip distribution skewed");
    }

    /// @notice Test large range values
    function test_LargeRange() public pure {
        bytes32 seed = keccak256("large range test");
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        
        uint256 result;
        
        // Test with 10000
        (result, dice) = DeterministicDice.roll(dice, 10000);
        assertTrue(result < 10000, "Roll exceeded 10000");
        
        // Test with 1000000
        (result, dice) = DeterministicDice.roll(dice, 1000000);
        assertTrue(result < 1000000, "Roll exceeded 1000000");
        
        // Test with max uint32
        (result, dice) = DeterministicDice.roll(dice, type(uint32).max);
        assertTrue(result < type(uint32).max, "Roll exceeded uint32 max");
    }

    /// @notice Test that rolling with n=0 reverts
    function test_RevertOnZero() public {
        bytes32 seed = keccak256("revert test");
        
        // Use try/catch since vm.expectRevert doesn't work well with pure library calls
        DiceRollHelper helper = new DiceRollHelper();
        vm.expectRevert("DeterministicDice: n must be > 0");
        helper.rollWithZero(seed);
    }

    /// @notice Fuzz test: rolls always stay within bounds
    function testFuzz_RollBounds(bytes32 seed, uint256 n) public pure {
        vm.assume(n > 0 && n < 1000000); // Reasonable range for fuzzing
        
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint256 result;
        (result, ) = DeterministicDice.roll(dice, n);
        
        assertTrue(result < n, "Roll exceeded n");
    }

    /// @notice Fuzz test: determinism holds for any seed
    function testFuzz_Determinism(bytes32 seed) public pure {
        DeterministicDice.Dice memory dice1 = DeterministicDice.create(seed);
        DeterministicDice.Dice memory dice2 = DeterministicDice.create(seed);
        
        uint256 roll1;
        uint256 roll2;
        
        for (uint256 i = 0; i < 10; i++) {
            (roll1, dice1) = DeterministicDice.roll(dice1, 100);
            (roll2, dice2) = DeterministicDice.roll(dice2, 100);
            assertEq(roll1, roll2, "Determinism failed in fuzz test");
        }
    }
}

/// @notice Helper contract to test reverts in library calls
contract DiceRollHelper {
    function rollWithZero(bytes32 seed) external pure returns (uint256) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        (uint256 result, ) = DeterministicDice.roll(dice, 0);
        return result;
    }
}

