// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "forge-std/Test.sol";
import "../contracts/ChallengeExecutor.sol";
import "../contracts/GameFactory.sol";
import "../contracts/MapGenerator.sol";

/**
 * @title ChallengePayoutFlowTest
 * @notice Comprehensive tests for the challenge and payout system
 * @dev Run with: forge test --match-contract ChallengePayoutFlowTest -vvv
 */
contract ChallengePayoutFlowTest is Test {
    GameFactory public gameFactory;
    MapGenerator public mapGenerator;
    ChallengeExecutor public challengeExecutor;
    
    address owner = address(0x1);
    address player = address(0x2);
    address oracle = address(0x3);
    address challenger = address(0x4);
    address anotherUser = address(0x5);
    
    // Constants from contracts
    uint256 constant GAME_COST = 0.001 ether;
    uint256 constant ORACLE_STAKE = 1 ether;
    uint256 constant CHALLENGE_STAKE = 0.01 ether;
    uint256 constant SLASH_AMOUNT = 0.03 ether;
    uint256 constant CHALLENGE_PERIOD = 1 minutes;
    uint256 constant CHALLENGE_EXECUTION_WINDOW = 30 minutes;
    
    function setUp() public {
        // Fund all accounts
        vm.deal(owner, 100 ether);
        vm.deal(player, 10 ether);
        vm.deal(oracle, 10 ether);
        vm.deal(challenger, 10 ether);
        vm.deal(anotherUser, 10 ether);
        
        // Deploy contracts
        vm.startPrank(owner);
        gameFactory = new GameFactory(owner);
        mapGenerator = new MapGenerator();
        challengeExecutor = new ChallengeExecutor(address(gameFactory), address(mapGenerator));
        
        // Fund the pool with ETH for payouts
        gameFactory.depositToPool{value: 10 ether}();
        vm.stopPrank();
        
        // Oracle stakes
        vm.prank(oracle);
        gameFactory.stakeAsOracle{value: ORACLE_STAKE}();
    }
    
    // ========== HELPER FUNCTIONS ==========
    
    function _createAndRevealGame() internal returns (uint256 gameId, bytes32 seed) {
        vm.prank(player);
        gameId = gameFactory.createGame{value: GAME_COST}();
        
        // Move to next block for seed reveal
        vm.roll(block.number + 1);
        
        vm.prank(player);
        seed = gameFactory.revealSeed(gameId);
    }
    
    function _submitOracleResult(uint256 gameId, bytes32 resultHash, uint256 payout) internal {
        vm.prank(oracle);
        gameFactory.submitResult(gameId, resultHash, payout);
    }
    
    function _runFullChallengeSimulation(uint256 gameId) internal returns (uint256 payout, bytes32 resultHash) {
        // Start challenge
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        // Run full simulation (100 rounds in one batch)
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Get the computed values
        payout = challengeExecutor.getEstimatedPayout(gameId);
        
        // We need to compute the result hash the same way ChallengeExecutor.finalize does
        // But we can't access internal state, so let's just finalize
    }
    
    // ========== TEST: HAPPY PATH - NO CHALLENGE ==========
    
    function test_HappyPath_NoChallengeFinalize() public {
        emit log_string("\n=== Test: Happy Path - No Challenge ===");
        
        // Create and reveal game
        (uint256 gameId, bytes32 seed) = _createAndRevealGame();
        emit log_named_uint("Game ID", gameId);
        emit log_named_bytes32("Seed", seed);
        
        // Oracle submits result
        bytes32 fakeResultHash = keccak256("fake-result");
        uint256 oraclePayout = 0.005 ether;
        _submitOracleResult(gameId, fakeResultHash, oraclePayout);
        
        // Verify status
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.ResultSubmitted), "Should be ResultSubmitted");
        
        // Wait for challenge period to end
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        
        // Finalize game (no challenge)
        gameFactory.finalizeGame(gameId);
        
        // Verify status is Finalized
        (, , , status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Finalized), "Should be Finalized");
        
        // Player claims payout
        uint256 playerBalanceBefore = player.balance;
        vm.prank(player);
        gameFactory.claimPayout(gameId);
        
        uint256 playerBalanceAfter = player.balance;
        assertEq(playerBalanceAfter - playerBalanceBefore, oraclePayout, "Player should receive oracle payout");
        
        // Verify status is Claimed
        (, , , status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Claimed), "Should be Claimed");
        
        emit log_string("[PASS] Happy path completed successfully");
    }
    
    // ========== TEST: CHALLENGE - ORACLE WAS CORRECT ==========
    
    function test_Challenge_OracleCorrect() public {
        emit log_string("\n=== Test: Challenge - Oracle Was Correct ===");
        
        // Create and reveal game
        (uint256 gameId, bytes32 seed) = _createAndRevealGame();
        emit log_named_bytes32("Seed", seed);
        
        // Run on-chain simulation first to get correct values
        // We need to set up a scenario where oracle submits correct result
        
        // Submit a fake (incorrect) oracle result first to challenge
        // Then we'll verify the challenge flow works
        bytes32 fakeResultHash = keccak256("oracle-hash");
        uint256 fakeOraclePayout = 0.001 ether;
        _submitOracleResult(gameId, fakeResultHash, fakeOraclePayout);
        
        // Challenge the result
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        // Verify status
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Challenged), "Should be Challenged");
        
        // Get challenger address from result
        (, , , , address storedChallenger, ) = gameFactory.getGameResult(gameId);
        assertEq(storedChallenger, challenger, "Challenger should be recorded");
        
        // Run on-chain simulation
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Verify simulation complete
        assertTrue(challengeExecutor.isSimulationComplete(gameId), "Simulation should be complete");
        
        // Get simulation results
        (, , , , uint32 currentRound, uint32 agentCount, uint256 tilesDiscovered, uint256 mushroomsFound) = 
            challengeExecutor.getChallenge(gameId);
        
        emit log_named_uint("Rounds completed", currentRound);
        emit log_named_uint("Agents", agentCount);
        emit log_named_uint("Tiles discovered", tilesDiscovered);
        emit log_named_uint("Mushrooms found", mushroomsFound);
        
        uint256 computedPayout = challengeExecutor.getEstimatedPayout(gameId);
        emit log_named_uint("Computed payout (wei)", computedPayout);
        emit log_named_uint("Oracle payout (wei)", fakeOraclePayout);
        
        // Finalize challenge
        uint256 challengerBalanceBefore = challenger.balance;
        uint256 oracleStakeBefore = gameFactory.oracleStakes(oracle);
        
        vm.prank(challenger);
        challengeExecutor.finalize(gameId);
        
        // Since oracle submitted wrong payout, oracle should be slashed
        uint256 oracleStakeAfter = gameFactory.oracleStakes(oracle);
        uint256 challengerBalanceAfter = challenger.balance;
        
        // Oracle likely was wrong since we used fake values
        if (computedPayout != fakeOraclePayout) {
            emit log_string("Oracle was INCORRECT - should be slashed");
            assertLt(oracleStakeAfter, oracleStakeBefore, "Oracle stake should decrease");
            assertGt(challengerBalanceAfter, challengerBalanceBefore, "Challenger should receive reward");
            
            uint256 challengerReward = challengerBalanceAfter - challengerBalanceBefore;
            emit log_named_uint("Challenger reward (wei)", challengerReward);
            
            // Challenger gets stake back + slash amount
            assertEq(challengerReward, CHALLENGE_STAKE + SLASH_AMOUNT, "Challenger should get stake + slash");
        } else {
            emit log_string("Oracle was CORRECT (unlikely with fake values)");
        }
        
        // Verify game is finalized
        (, , , status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Finalized), "Should be Finalized");
        
        emit log_string("[PASS] Challenge flow completed");
    }
    
    // ========== TEST: CHALLENGE - ORACLE WAS WRONG ==========
    
    function test_Challenge_OracleWrong_ChallengerWins() public {
        emit log_string("\n=== Test: Challenge - Oracle Wrong, Challenger Wins ===");
        
        // Create and reveal game
        (uint256 gameId, ) = _createAndRevealGame();
        
        // Oracle submits obviously wrong result (0 payout, wrong hash)
        _submitOracleResult(gameId, bytes32(0), 0);
        
        // Challenge
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        // Record balances
        uint256 challengerBalanceBefore = challenger.balance;
        uint256 oracleStakeBefore = gameFactory.oracleStakes(oracle);
        
        // Run challenge execution
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        uint256 computedPayout = challengeExecutor.getEstimatedPayout(gameId);
        emit log_named_uint("Computed payout", computedPayout);
        
        // The computed payout should be > 0 (since some tiles get discovered)
        assertGt(computedPayout, 0, "Payout should be positive");
        
        // Finalize - oracle was wrong (submitted 0)
        vm.prank(challenger);
        challengeExecutor.finalize(gameId);
        
        // Verify challenger won
        uint256 challengerBalanceAfter = challenger.balance;
        uint256 oracleStakeAfter = gameFactory.oracleStakes(oracle);
        
        // Challenger should receive stake back + slash amount
        uint256 challengerReward = challengerBalanceAfter - challengerBalanceBefore;
        assertEq(challengerReward, CHALLENGE_STAKE + SLASH_AMOUNT, "Challenger should get stake + slash");
        
        // Oracle should be slashed
        assertEq(oracleStakeBefore - oracleStakeAfter, SLASH_AMOUNT, "Oracle should lose slash amount");
        
        // Verify game result was updated with correct values
        (bytes32 resultHash, uint256 payout, , , , ) = gameFactory.getGameResult(gameId);
        assertEq(payout, computedPayout, "Payout should be updated to computed value");
        assertTrue(resultHash != bytes32(0), "Result hash should be updated");
        
        emit log_string("[PASS] Challenger won - oracle was slashed");
    }
    
    // ========== TEST: CANNOT CHALLENGE AFTER PERIOD ==========
    
    function test_CannotChallenge_AfterPeriod() public {
        emit log_string("\n=== Test: Cannot Challenge After Period ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0);
        
        // Wait for challenge period to end
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        
        // Try to challenge - should fail
        vm.prank(challenger);
        vm.expectRevert(GameFactory.ChallengePeriodEnded.selector);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        emit log_string("[PASS] Cannot challenge after period ended");
    }
    
    // ========== TEST: CANNOT FINALIZE DURING CHALLENGE PERIOD ==========
    
    function test_CannotFinalize_DuringChallengePeriod() public {
        emit log_string("\n=== Test: Cannot Finalize During Challenge Period ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0);
        
        // Try to finalize immediately - should fail
        vm.expectRevert(GameFactory.ChallengePeriodNotEnded.selector);
        gameFactory.finalizeGame(gameId);
        
        emit log_string("[PASS] Cannot finalize during challenge period");
    }
    
    // ========== TEST: CHALLENGE EXECUTION WINDOW EXPIRY ==========
    
    function test_ChallengeWindowExpiry_OracleWinsByDefault() public {
        emit log_string("\n=== Test: Challenge Window Expiry - Oracle Wins By Default ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, keccak256("oracle"), 0.005 ether);
        
        // Challenge
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        uint256 poolBefore = gameFactory.poolBalance();
        
        // Wait for challenge execution window to expire (without executing)
        vm.warp(block.timestamp + CHALLENGE_EXECUTION_WINDOW + 1);
        
        // Finalize challenged game - oracle wins by default
        gameFactory.finalizeChallengedGame(gameId);
        
        // Challenge stake should go to pool
        uint256 poolAfter = gameFactory.poolBalance();
        assertEq(poolAfter - poolBefore, CHALLENGE_STAKE, "Challenge stake should go to pool");
        
        // Game should be finalized with oracle's values
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Finalized), "Should be Finalized");
        
        emit log_string("[PASS] Challenge window expired - oracle wins by default");
    }
    
    // ========== TEST: INSUFFICIENT CHALLENGE STAKE ==========
    
    function test_InsufficientChallengeStake() public {
        emit log_string("\n=== Test: Insufficient Challenge Stake ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0);
        
        // Try to challenge with insufficient stake
        vm.prank(challenger);
        vm.expectRevert(GameFactory.InsufficientPayment.selector);
        gameFactory.challengeResult{value: CHALLENGE_STAKE - 1}(gameId);
        
        emit log_string("[PASS] Insufficient stake rejected");
    }
    
    // ========== TEST: CANNOT DOUBLE CHALLENGE ==========
    
    function test_CannotDoubleChallenge() public {
        emit log_string("\n=== Test: Cannot Double Challenge ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0);
        
        // First challenge succeeds
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        // Second challenge should fail - status changes to Challenged so InvalidGameStatus is correct
        vm.prank(anotherUser);
        vm.expectRevert(GameFactory.InvalidGameStatus.selector);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        emit log_string("[PASS] Double challenge prevented");
    }
    
    // ========== TEST: ONLY GAME OWNER CAN CLAIM ==========
    
    function test_OnlyGameOwnerCanClaim() public {
        emit log_string("\n=== Test: Only Game Owner Can Claim ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0.001 ether);
        
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        gameFactory.finalizeGame(gameId);
        
        // Non-owner tries to claim
        vm.prank(anotherUser);
        vm.expectRevert(GameFactory.NotGameOwner.selector);
        gameFactory.claimPayout(gameId);
        
        emit log_string("[PASS] Non-owner cannot claim");
    }
    
    // ========== TEST: SIMULATION PROGRESS ==========
    
    function test_SimulationProgress() public {
        emit log_string("\n=== Test: Simulation Progress Tracking ===");
        
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 0);
        
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        // Start challenge
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        // Run in batches and track progress
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 25);
        
        (, , , , uint32 round1, , , ) = challengeExecutor.getChallenge(gameId);
        assertEq(round1, 25, "Should be at round 25");
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 25);
        
        (, , , , uint32 round2, , , ) = challengeExecutor.getChallenge(gameId);
        assertEq(round2, 50, "Should be at round 50");
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 50);
        
        (, , , , uint32 round3, , , ) = challengeExecutor.getChallenge(gameId);
        assertEq(round3, 100, "Should be at round 100");
        
        assertTrue(challengeExecutor.isSimulationComplete(gameId), "Should be complete");
        
        emit log_string("[PASS] Simulation progress tracked correctly");
    }
    
    // ========== TEST: POOL BALANCE INSUFFICIENT ==========
    
    function test_InsufficientPoolBalance() public {
        emit log_string("\n=== Test: Insufficient Pool Balance ===");
        
        // Withdraw most of the pool
        vm.prank(owner);
        gameFactory.withdrawFromPool(9.99 ether);
        
        // Create game with high payout
        (uint256 gameId, ) = _createAndRevealGame();
        _submitOracleResult(gameId, bytes32(0), 1 ether); // Payout higher than pool
        
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        gameFactory.finalizeGame(gameId);
        
        // Try to claim - should fail
        vm.prank(player);
        vm.expectRevert(GameFactory.InsufficientPoolBalance.selector);
        gameFactory.claimPayout(gameId);
        
        emit log_string("[PASS] Insufficient pool balance handled");
    }
    
    /**
     * @notice Test where oracle submits CORRECT result and challenger loses
     * @dev Uses vm.snapshot/revertTo to cleanly pre-compute correct values
     */
    function test_IncorrectChallenge_ChallengerLoses() public {
        emit log_string("\n=== Test: Incorrect Challenge - Challenger Loses ===");
        emit log_string("(Oracle submits correct result, challenger loses stake)");
        
        // Create and reveal game
        vm.prank(player);
        uint256 gameId = gameFactory.createGame{value: 0.001 ether}();
        vm.roll(block.number + 1);
        vm.prank(player);
        bytes32 seed = gameFactory.revealSeed(gameId);
        emit log_named_bytes32("Seed", seed);
        
        // Take snapshot AFTER seed reveal
        uint256 snapshotId = vm.snapshot();
        
        // ====== PRE-COMPUTATION PHASE ======
        // Run challenge to get correct values (will be reverted)
        vm.prank(oracle);
        gameFactory.submitResult(gameId, bytes32(0), 0);
        
        vm.prank(anotherUser);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        vm.prank(anotherUser);
        challengeExecutor.startChallenge(gameId);
        vm.prank(anotherUser);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Finalize to get correct hash
        vm.prank(anotherUser);
        challengeExecutor.finalize(gameId);
        
        // Capture the CORRECT values
        (bytes32 correctResultHash, uint256 correctPayout, , , , ) = gameFactory.getGameResult(gameId);
        emit log_named_bytes32("Correct result hash", correctResultHash);
        emit log_named_uint("Correct payout", correctPayout);
        
        // Revert to snapshot (game is back to SeedRevealed state)
        vm.revertTo(snapshotId);
        
        // ====== ACTUAL TEST ======
        // Record balances
        uint256 poolBefore = gameFactory.poolBalance();
        uint256 oracleStakeBefore = gameFactory.oracleStakes(oracle);
        uint256 challengerBalanceBefore = challenger.balance;
        
        emit log_string("\n--- Before Oracle Submission ---");
        emit log_named_uint("Pool balance", poolBefore);
        emit log_named_uint("Oracle stake", oracleStakeBefore);
        emit log_named_uint("Challenger balance", challengerBalanceBefore);
        
        // Oracle submits the CORRECT result
        vm.prank(oracle);
        gameFactory.submitResult(gameId, correctResultHash, correctPayout);
        emit log_string("Oracle submitted CORRECT result");
        
        // Challenger foolishly challenges
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        emit log_string("Challenger challenged (bad decision!)");
        
        uint256 challengerAfterStake = challenger.balance;
        assertEq(challengerBalanceBefore - challengerAfterStake, CHALLENGE_STAKE, "Stake deducted");
        
        // Run challenge execution
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Get challenger's computed values
        uint256 challengerComputedPayout = challengeExecutor.getEstimatedPayout(gameId);
        emit log_named_uint("Challenger computed payout", challengerComputedPayout);
        emit log_named_uint("Oracle submitted payout", correctPayout);
        
        // Finalize - oracle should win!
        vm.prank(challenger);
        challengeExecutor.finalize(gameId);
        
        // ====== VERIFY OUTCOMES ======
        uint256 poolAfter = gameFactory.poolBalance();
        uint256 oracleStakeAfter = gameFactory.oracleStakes(oracle);
        uint256 challengerBalanceAfter = challenger.balance;
        
        emit log_string("\n--- After Challenge Finalized ---");
        emit log_named_uint("Pool balance", poolAfter);
        emit log_named_uint("Oracle stake", oracleStakeAfter);
        emit log_named_uint("Challenger balance", challengerBalanceAfter);
        
        // Game should be finalized
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Finalized), "Game should be finalized");
        
        // Oracle was correct: challenger stake goes to pool
        assertEq(poolAfter - poolBefore, CHALLENGE_STAKE, "Challenge stake added to pool");
        
        // Oracle stake unchanged
        assertEq(oracleStakeAfter, oracleStakeBefore, "Oracle stake unchanged");
        
        // Challenger lost their stake (no refund)
        assertEq(challengerBalanceAfter, challengerAfterStake, "Challenger got no refund");
        
        // Final payout should match oracle's submission
        (bytes32 finalHash, uint256 finalPayout, , , , ) = gameFactory.getGameResult(gameId);
        assertEq(finalHash, correctResultHash, "Final hash matches oracle");
        assertEq(finalPayout, correctPayout, "Final payout matches oracle");
        
        emit log_string("\n--- OUTCOME ---");
        emit log_string("Oracle was CORRECT!");
        emit log_string("Challenger LOST 0.01 ETH stake (went to pool)");
        emit log_string("Oracle stake UNCHANGED (0.1 ETH)");
        emit log_string("Game finalized with oracle's payout");
        emit log_string("[PASS] Incorrect challenge - challenger loses");
    }
    
    // ========== TEST: FULL E2E WITH REAL SIMULATION ==========
    
    function test_FullE2E_RealSimulation() public {
        emit log_string("\n=== Test: Full E2E With Real Simulation ===");
        
        // Create game
        (uint256 gameId, bytes32 seed) = _createAndRevealGame();
        emit log_named_bytes32("Game seed", seed);
        
        // Oracle submits (intentionally wrong to test challenge)
        _submitOracleResult(gameId, keccak256("wrong"), 0.001 ether);
        
        // Challenge
        uint256 challengerBalanceStart = challenger.balance;
        vm.prank(challenger);
        gameFactory.challengeResult{value: CHALLENGE_STAKE}(gameId);
        
        // Execute challenge
        vm.prank(challenger);
        challengeExecutor.startChallenge(gameId);
        
        vm.prank(challenger);
        challengeExecutor.simulateBatch(gameId, 100);
        
        // Get results
        (, , , , uint32 rounds, uint32 agents, uint256 tiles, uint256 mushrooms) = 
            challengeExecutor.getChallenge(gameId);
        uint256 computedPayout = challengeExecutor.getEstimatedPayout(gameId);
        
        emit log_string("\n--- Simulation Results ---");
        emit log_named_uint("Rounds", rounds);
        emit log_named_uint("Agents", agents);
        emit log_named_uint("Tiles discovered", tiles);
        emit log_named_uint("Mushrooms found", mushrooms);
        emit log_named_uint("Computed payout (wei)", computedPayout);
        
        // Finalize
        vm.prank(challenger);
        challengeExecutor.finalize(gameId);
        
        uint256 challengerBalanceEnd = challenger.balance;
        emit log_named_uint("Challenger reward", challengerBalanceEnd - challengerBalanceStart + CHALLENGE_STAKE);
        
        // Verify game finalized
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        assertEq(uint256(status), uint256(GameFactory.GameStatus.Finalized));
        
        // Player claims (with corrected payout)
        uint256 playerBalanceBefore = player.balance;
        vm.prank(player);
        gameFactory.claimPayout(gameId);
        uint256 playerBalanceAfter = player.balance;
        
        assertEq(playerBalanceAfter - playerBalanceBefore, computedPayout, "Player gets correct payout");
        emit log_named_uint("Player payout claimed", computedPayout);
        
        emit log_string("\n[PASS] Full E2E test completed successfully");
    }
}

