// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "forge-std/Test.sol";
import "../contracts/ChallengeExecutor.sol";
import "../contracts/GameFactory.sol";
import "../contracts/MapGenerator.sol";

/**
 * @title SeedParityTest
 * @notice Test specific seeds to verify JS <-> Solidity parity
 * @dev Run with: forge test --match-contract SeedParityTest -vvv
 * 
 *      Use this to test specific seeds and verify they produce the same
 *      results as the JavaScript simulation.
 */
contract SeedParityTest is Test {
    GameFactory public gameFactory;
    MapGenerator public mapGenerator;
    ChallengeExecutor public challengeExecutor;
    
    address owner = address(0x1);
    address player = address(0x2);
    address oracle = address(0x3);
    address challenger = address(0x4);
    
    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(player, 10 ether);
        vm.deal(oracle, 10 ether);
        vm.deal(challenger, 10 ether);
        
        vm.startPrank(owner);
        gameFactory = new GameFactory(owner);
        mapGenerator = new MapGenerator();
        challengeExecutor = new ChallengeExecutor(address(gameFactory), address(mapGenerator));
        gameFactory.depositToPool{value: 10 ether}();
        vm.stopPrank();
        
        vm.prank(oracle);
        gameFactory.stakeAsOracle{value: 1 ether}();
    }
    
    /**
     * @notice Run a full challenge simulation with a specific seed
     */
    function _runSimulationWithSeed(bytes32 seed) internal returns (
        uint256 tilesDiscovered,
        uint256 mushroomsFound,
        uint32 agentCount,
        uint256 payout
    ) {
        // Create game
        vm.prank(player);
        uint256 gameId = gameFactory.createGame{value: 0.001 ether}();
        
        vm.roll(block.number + 1);
        vm.prank(player);
        gameFactory.revealSeed(gameId);
        
        // Override seed using storage manipulation
        // This is a test helper - in production, seeds come from blockhash
        (, , bytes32 actualSeed, ) = gameFactory.getGame(gameId);
        
        // For testing, we use the game's generated seed
        // If you need to test a specific seed, you'd need to mock the blockhash
        emit log_named_bytes32("Testing with seed", actualSeed);
        
        // Oracle submits (intentionally wrong to force challenge)
        vm.prank(oracle);
        gameFactory.submitResult(gameId, bytes32(0), 0);
        
        // Challenge
        vm.prank(challenger);
        gameFactory.challengeResult{value: 0.01 ether}(gameId);
        
        // Run challenge simulation
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Get results
        (, , , , , agentCount, tilesDiscovered, mushroomsFound) = 
            challengeExecutor.getChallenge(gameId);
        payout = challengeExecutor.getEstimatedPayout(gameId);
        
        return (tilesDiscovered, mushroomsFound, agentCount, payout);
    }
    
    /**
     * @notice Test with random seed and output results
     * @dev Run this test and compare output with JS simulation
     */
    function test_OutputResultsForParity() public {
        // Create and reveal game to get a seed
        vm.prank(player);
        uint256 gameId = gameFactory.createGame{value: 0.001 ether}();
        
        vm.roll(block.number + 1);
        vm.prank(player);
        gameFactory.revealSeed(gameId);
        
        (, , bytes32 seed, ) = gameFactory.getGame(gameId);
        
        emit log_string("\n========================================");
        emit log_string("SOLIDITY SIMULATION RESULTS");
        emit log_string("========================================");
        emit log_named_bytes32("Seed", seed);
        
        // Oracle submits wrong result
        vm.prank(oracle);
        gameFactory.submitResult(gameId, bytes32(0), 0);
        
        // Challenge and run simulation
        vm.prank(challenger);
        gameFactory.challengeResult{value: 0.01 ether}(gameId);
        
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Get and output results
        (, , , , uint32 currentRound, uint32 agentCount, uint256 tilesDiscovered, uint256 mushroomsFound) = 
            challengeExecutor.getChallenge(gameId);
        uint256 payout = challengeExecutor.getEstimatedPayout(gameId);
        
        emit log_named_uint("Rounds completed", currentRound);
        emit log_named_uint("Agent count", agentCount);
        emit log_named_uint("Tiles discovered", tilesDiscovered);
        emit log_named_uint("Mushrooms found", mushroomsFound);
        emit log_named_uint("Payout (wei)", payout);
        
        emit log_string("\n========================================");
        emit log_string("TO VERIFY PARITY, RUN:");
        emit log_string("========================================");
        emit log_string("node scripts-js/parityTestAll.js <seed>");
        emit log_string("\nReplace <seed> with the seed shown above");
        emit log_string("Results should match exactly!");
        
        // Basic sanity checks
        assertEq(currentRound, 100, "Should complete 100 rounds");
        assertEq(agentCount, 21, "Should have 21 agents");
        assertGt(tilesDiscovered, 0, "Should discover tiles");
    }
    
    /**
     * @notice Test multiple seeds and output all results
     */
    function test_MultipleSeeds() public {
        emit log_string("\n========================================");
        emit log_string("TESTING MULTIPLE SEEDS");
        emit log_string("========================================\n");
        
        for (uint256 i = 0; i < 3; i++) {
            // Create game
            vm.prank(player);
            uint256 gameId = gameFactory.createGame{value: 0.001 ether}();
            
            vm.roll(block.number + 1 + i);
            vm.prank(player);
            gameFactory.revealSeed(gameId);
            
            (, , bytes32 seed, ) = gameFactory.getGame(gameId);
            
            // Oracle submits wrong result
            vm.prank(oracle);
            gameFactory.submitResult(gameId, bytes32(0), 0);
            
            // Challenge and run simulation
            vm.prank(challenger);
            gameFactory.challengeResult{value: 0.01 ether}(gameId);
            
            vm.prank(challenger);
            challengeExecutor.startChallenge(gameId);
            
            vm.prank(challenger);
            challengeExecutor.simulateBatch(gameId, 100);
            
            // Get results
            (, , , , , uint32 agentCount, uint256 tilesDiscovered, uint256 mushroomsFound) = 
                challengeExecutor.getChallenge(gameId);
            uint256 payout = challengeExecutor.getEstimatedPayout(gameId);
            
            emit log_string("---");
            emit log_named_uint("Game", i + 1);
            emit log_named_bytes32("Seed", seed);
            emit log_named_uint("Agents", agentCount);
            emit log_named_uint("Tiles", tilesDiscovered);
            emit log_named_uint("Mushrooms", mushroomsFound);
            emit log_named_uint("Payout (wei)", payout);
        }
    }
}

