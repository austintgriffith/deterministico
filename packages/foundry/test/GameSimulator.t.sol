// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/GameSimulator.sol";
import "../contracts/AgentStorage.sol";

/**
 * @title GameSimulatorTest
 * @notice Tests for the GameSimulator contract
 * @dev Verifies that Solidity simulation matches TypeScript behavior
 */
contract GameSimulatorTest is Test {
    GameSimulator public simulator;
    
    // Test constants
    bytes32 constant TEST_SEED = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint16 constant GRID_SIZE = 21; // Small grid for testing
    int256 constant CENTER_X = 1869; // In world coords (will be scaled to fixed-point)
    
    function setUp() public {
        simulator = new GameSimulator();
    }
    
    function testInitialization() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        assertTrue(simulator.initialized());
        assertEq(simulator.gameSeed(), TEST_SEED);
        
        (int32 centerX, uint16 gridSize) = simulator.getMapParams();
        assertEq(centerX, int32(CENTER_X * 100)); // Fixed-point scaled
        assertEq(gridSize, GRID_SIZE);
    }
    
    function testCannotInitializeTwice() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        vm.expectRevert("Already initialized");
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
    }
    
    function testSetTerrainRow() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Set row 5 to all ground
        bool[] memory row = new bool[](GRID_SIZE);
        for (uint i = 0; i < GRID_SIZE; i++) {
            row[i] = true;
        }
        simulator.setTerrainRow(5, row);
        
        // Verify
        assertTrue(simulator.isGroundTile(5, 0));
        assertTrue(simulator.isGroundTile(5, 10));
        assertTrue(simulator.isGroundTile(5, 20));
        
        // Other rows should not be ground
        assertFalse(simulator.isGroundTile(4, 0));
        assertFalse(simulator.isGroundTile(6, 0));
    }
    
    function testSetTeamSpawn() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Set team 0 spawn
        simulator.setTeamSpawn(0, 500, 300);
        
        (int32 x, int32 y) = simulator.getTeamSpawn(0);
        assertEq(x, 50000); // 500 * 100 fixed-point
        assertEq(y, 30000); // 300 * 100 fixed-point
    }
    
    function testAddAgent() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        uint32 index = simulator.addAgent(1000, 800, 0, 0, 7); // light_harvester
        assertEq(index, 0);
        assertEq(simulator.getAgentCount(), 1);
        
        AgentStorage.Agent memory agent = simulator.getAgent(0);
        assertEq(agent.x, 100000); // 1000 * 100 fixed-point
        assertEq(agent.y, 80000);  // 800 * 100 fixed-point
        assertEq(agent.direction, 0);
        assertEq(agent.team, 0);
        assertEq(agent.vehicleType, 7);
    }
    
    function testSimulateRoundsNormalAgent() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Set up terrain - all ground in the center area
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            bool[] memory rowData = new bool[](GRID_SIZE);
            for (uint i = 0; i < GRID_SIZE; i++) {
                rowData[i] = true;
            }
            simulator.setTerrainRow(row, rowData);
        }
        
        // Add a normal agent (light_harvester, type 7)
        simulator.addAgent(1000, 800, 0, 0, 7);
        
        // Get initial state
        AgentStorage.Agent memory before = simulator.getAgent(0);
        
        // Simulate 1 round
        simulator.simulateRounds(1);
        
        // Get final state
        AgentStorage.Agent memory afterRound = simulator.getAgent(0);
        assertEq(simulator.getCurrentRound(), 1);
        
        // Agent should have moved or turned based on dice roll
        // We can't predict exact result without knowing dice sequence,
        // but we can verify state changed or stayed valid
        assertTrue(
            afterRound.x != before.x || 
            afterRound.y != before.y || 
            afterRound.direction != before.direction
        );
    }
    
    function testDiceStatePersistence() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Get initial dice state
        (bytes32 entropy1, uint8 pos1) = simulator.getDiceState();
        assertEq(entropy1, TEST_SEED);
        assertEq(pos1, 0);
        
        // Add agent and simulate
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            bool[] memory rowData = new bool[](GRID_SIZE);
            for (uint i = 0; i < GRID_SIZE; i++) {
                rowData[i] = true;
            }
            simulator.setTerrainRow(row, rowData);
        }
        simulator.addAgent(1000, 800, 0, 0, 7);
        simulator.simulateRounds(1);
        
        // Dice state should have changed
        (bytes32 entropy2, uint8 pos2) = simulator.getDiceState();
        assertTrue(pos2 > pos1 || entropy2 != entropy1);
    }
    
    function testMultipleRounds() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Set up terrain
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            bool[] memory rowData = new bool[](GRID_SIZE);
            for (uint i = 0; i < GRID_SIZE; i++) {
                rowData[i] = true;
            }
            simulator.setTerrainRow(row, rowData);
        }
        
        // Add multiple agents
        simulator.addAgent(1000, 800, 0, 0, 7); // normal
        simulator.addAgent(1200, 900, 1, 1, 8); // normal
        
        // Simulate multiple rounds
        simulator.simulateRounds(5);
        assertEq(simulator.getCurrentRound(), 5);
        
        simulator.simulateRounds(5);
        assertEq(simulator.getCurrentRound(), 10);
    }
    
    function testCommsUnitBehavior() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        // Set up terrain
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            bool[] memory rowData = new bool[](GRID_SIZE);
            for (uint i = 0; i < GRID_SIZE; i++) {
                rowData[i] = true;
            }
            simulator.setTerrainRow(row, rowData);
        }
        
        // Set team spawn (home base)
        simulator.setTeamSpawn(0, 1000, 800);
        
        // Add a comms unit (light_comms, type 6)
        simulator.addAgent(1200, 900, 0, 0, 6);
        
        // Simulate
        simulator.simulateRounds(10);
        
        // Comms unit should have moved based on gravity toward/from home base
        AgentStorage.Agent memory agent = simulator.getAgent(0);
        // Just verify it's still a valid state
        assertTrue(agent.direction < 4);
    }
    
    function testGetAllAgents() public {
        simulator.initGame(TEST_SEED, GRID_SIZE, CENTER_X);
        
        simulator.addAgent(1000, 800, 0, 0, 7);
        simulator.addAgent(1200, 900, 1, 1, 8);
        simulator.addAgent(1400, 1000, 2, 2, 6);
        
        AgentStorage.Agent[] memory agents = simulator.getAllAgents();
        assertEq(agents.length, 3);
        assertEq(agents[0].team, 0);
        assertEq(agents[1].team, 1);
        assertEq(agents[2].team, 2);
    }
    
    /**
     * @notice Parity test with JS simulation
     * @dev This test uses the same seed, terrain, agents, and round count as
     *      the JS parity test script (gameSimulatorParity.js).
     *      
     *      Expected JS results after 10 rounds (with roundedDiv floor fix):
     *      - Agent 0: x=104000, y=83000, dir=0
     *      - Agent 1: x=115000, y=86500, dir=0
     *      - Agent 2: x=130000, y=85000, dir=0
     *      - Dice position: 30
     */
    function testParityWithJS() public {
        // Same seed as JS test: keccak256("test-seed-123")
        bytes32 pSeed = keccak256("test-seed-123");
        assertEq(pSeed, 0xc76882c135e1ddf1ba5cb59e5c7a7d64b1bb457523bcdf1355fcb66cd07b6dad);
        
        // Initialize with same parameters
        simulator.initGame(pSeed, GRID_SIZE, CENTER_X);
        
        // Set up terrain (all ground)
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            bool[] memory rowData = new bool[](GRID_SIZE);
            for (uint i = 0; i < GRID_SIZE; i++) {
                rowData[i] = true;
            }
            simulator.setTerrainRow(row, rowData);
        }
        
        // Set team spawn points (same as JS)
        simulator.setTeamSpawn(0, 1000, 800);
        simulator.setTeamSpawn(1, 1200, 900);
        
        // Add agents (same as JS)
        simulator.addAgent(1000, 800, 0, 0, 7);  // light_harvester
        simulator.addAgent(1100, 850, 1, 0, 8);  // light_military  
        simulator.addAgent(1200, 900, 2, 1, 6);  // light_comms
        
        // Verify initial state
        AgentStorage.Agent memory a0 = simulator.getAgent(0);
        assertEq(a0.x, 100000, "Agent 0 initial x");
        assertEq(a0.y, 80000, "Agent 0 initial y");
        
        // Simulate 10 rounds
        simulator.simulateRounds(10);
        
        // Get final state
        AgentStorage.Agent memory f0 = simulator.getAgent(0);
        AgentStorage.Agent memory f1 = simulator.getAgent(1);
        AgentStorage.Agent memory f2 = simulator.getAgent(2);
        
        // Log actual values for debugging
        emit log_named_int("Agent 0 x", f0.x);
        emit log_named_int("Agent 0 y", f0.y);
        emit log_named_uint("Agent 0 dir", f0.direction);
        emit log_named_int("Agent 1 x", f1.x);
        emit log_named_int("Agent 1 y", f1.y);
        emit log_named_uint("Agent 1 dir", f1.direction);
        emit log_named_int("Agent 2 x", f2.x);
        emit log_named_int("Agent 2 y", f2.y);
        emit log_named_uint("Agent 2 dir", f2.direction);
        
        (bytes32 entropy, uint8 position) = simulator.getDiceState();
        emit log_named_bytes32("Dice entropy", entropy);
        emit log_named_uint("Dice position", position);
        
        // PERFECT PARITY - All values match JS exactly!
        assertEq(simulator.getCurrentRound(), 10, "Round count");
        assertEq(position, 30, "Dice position should match JS");
        
        // Agent 0 - exact match with JS (updated after roundedDiv floor fix)
        assertEq(f0.x, 104000, "Agent 0 x matches JS");
        assertEq(f0.y, 83000, "Agent 0 y matches JS");
        assertEq(f0.direction, 0, "Agent 0 dir matches JS");
        
        // Agent 1 - exact match with JS
        assertEq(f1.x, 115000, "Agent 1 x matches JS");
        assertEq(f1.y, 86500, "Agent 1 y matches JS");
        assertEq(f1.direction, 0, "Agent 1 dir matches JS");
        
        // Agent 2 - exact match with JS
        assertEq(f2.x, 130000, "Agent 2 x matches JS");
        assertEq(f2.y, 85000, "Agent 2 y matches JS");
        assertEq(f2.direction, 0, "Agent 2 dir matches JS");
    }
}

