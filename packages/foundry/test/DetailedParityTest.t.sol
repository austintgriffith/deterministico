// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "forge-std/Test.sol";
import "../contracts/ChallengeExecutor.sol";
import "../contracts/GameFactory.sol";
import "../contracts/MapGenerator.sol";
import "../contracts/DeterministicDice.sol";
import "../contracts/AgentStorage.sol";

/**
 * @title DetailedParityTest
 * @notice Detailed comparison of Solidity vs JavaScript simulation
 */
contract DetailedParityTest is Test {
    using DeterministicDice for DeterministicDice.Dice;
    
    GameFactory public gameFactory;
    MapGenerator public mapGenerator;
    ChallengeExecutor public challengeExecutor;
    
    // Constants matching JS
    uint16 constant GRID_SIZE = 32;
    int32 constant TILE_X_SPACING = 89;
    int32 constant TILE_Y_SPACING = 47;
    int32 constant TILE_RENDER_WIDTH = 200;
    int32 constant FIXED_POINT_SCALE = 100;
    int32 constant TILE_CENTER_Y_OFFSET = 8796;
    
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
    
    function test_SpawnPointCalculation() public {
        bytes32 seed = 0x2ad604752bd7196a151f91c06e94003bd147fe90a61c08f01e5fd03aba066451;
        
        // Generate terrain
        MapGenerator.TerrainType[][] memory terrain = mapGenerator.generateMap(seed, GRID_SIZE);
        
        // Calculate centerX
        uint256 mapWidth = uint256(GRID_SIZE) * 2 * uint256(uint32(TILE_X_SPACING)) + uint256(uint32(TILE_RENDER_WIDTH));
        int32 centerXPixels = int32(int256(mapWidth / 2 - uint256(uint32(TILE_RENDER_WIDTH)) / 2));
        int32 centerX = centerXPixels * FIXED_POINT_SCALE;
        
        emit log_named_int("centerXPixels", centerXPixels);
        emit log_named_int("centerX (fixed-point)", centerX);
        
        // Generate spawn point
        bytes32 spawnSeed = keccak256(abi.encodePacked(seed, "spawn-points"));
        DeterministicDice.Dice memory dice = DeterministicDice.create(spawnSeed);
        
        uint16 centerTile = GRID_SIZE / 2;
        uint16 row = centerTile;
        uint16 col = centerTile;
        
        emit log_named_uint("Initial centerTile", centerTile);
        emit log_string(terrain[row][col] == MapGenerator.TerrainType.Ground ? "Center is GROUND" : "Center is NOT ground");
        
        // Find ground tile if needed
        if (terrain[row][col] != MapGenerator.TerrainType.Ground) {
            for (uint256 attempts = 0; attempts < 100; attempts++) {
                uint256 drRoll;
                uint256 dcRoll;
                (drRoll, dice) = dice.roll(11);
                (dcRoll, dice) = dice.roll(11);
                
                int16 dr = int16(uint16(drRoll)) - 5;
                int16 dc = int16(uint16(dcRoll)) - 5;
                int16 testRow = int16(centerTile) + dr;
                int16 testCol = int16(centerTile) + dc;
                
                if (testRow >= 0 && testRow < int16(GRID_SIZE) && testCol >= 0 && testCol < int16(GRID_SIZE)) {
                    if (terrain[uint16(testRow)][uint16(testCol)] == MapGenerator.TerrainType.Ground) {
                        row = uint16(testRow);
                        col = uint16(testCol);
                        emit log_named_uint("Found ground at attempt", attempts);
                        break;
                    }
                }
            }
        }
        
        emit log_named_uint("Spawn row", row);
        emit log_named_uint("Spawn col", col);
        
        // Convert to world coordinates
        (int32 spawnX, int32 spawnY) = _tileCenterToWorld(int32(uint32(row)), int32(uint32(col)), centerX);
        
        emit log_named_int("Spawn X (world, fixed-point)", spawnX);
        emit log_named_int("Spawn Y (world, fixed-point)", spawnY);
        
        // JS expected: tile(16,16) → world(294800, 159196)
        assertEq(row, 16, "Spawn row should be 16");
        assertEq(col, 16, "Spawn col should be 16");
        assertEq(spawnX, 294800, "Spawn X should be 294800");
        assertEq(spawnY, 159196, "Spawn Y should be 159196");
        
        // Now check initial agent direction/type
        bytes32 initSeed = keccak256(abi.encodePacked(seed, "agent-init"));
        DeterministicDice.Dice memory initDice = DeterministicDice.create(initSeed);
        
        uint256 dirRoll;
        uint256 typeRoll;
        (dirRoll, initDice) = initDice.roll(4);
        (typeRoll, initDice) = initDice.roll(2);
        
        emit log_named_uint("Initial direction roll", dirRoll);
        emit log_named_uint("Initial type roll", typeRoll);
        
        // JS expected: dir=3, type=0
        assertEq(dirRoll, 3, "Initial direction should be 3");
        assertEq(typeRoll, 0, "Initial type roll should be 0");
    }
    
    function _tileCenterToWorld(int32 row, int32 col, int32 centerX) internal pure returns (int32 x, int32 y) {
        x = centerX + ((col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * FIXED_POINT_SCALE;
        y = (col + row) * TILE_Y_SPACING * FIXED_POINT_SCALE + TILE_CENTER_Y_OFFSET;
    }
    
    function _worldToTile(int32 worldX, int32 worldY, int32 centerX) internal pure returns (int32 row, int32 col) {
        int32 tileRenderWidthHalf = (TILE_RENDER_WIDTH * FIXED_POINT_SCALE) / 2;
        
        int32 adjustedX = worldX - tileRenderWidthHalf;
        int32 adjustedY = worldY - TILE_CENTER_Y_OFFSET;
        
        int32 tileXSpacingScaled = TILE_X_SPACING * FIXED_POINT_SCALE;
        int32 tileYSpacingScaled = TILE_Y_SPACING * FIXED_POINT_SCALE;
        
        int32 colMinusRow = _roundedDiv(adjustedX - centerX, tileXSpacingScaled);
        int32 colPlusRow = _roundedDiv(adjustedY, tileYSpacingScaled);
        
        col = (colMinusRow + colPlusRow) >> 1;
        row = (colPlusRow - colMinusRow) >> 1;
    }
    
    function _roundedDiv(int32 a, int32 b) internal pure returns (int32) {
        if (a >= 0) {
            return (a + b / 2) / b;
        } else {
            return (a - b / 2) / b;
        }
    }
    
    function test_RoundSimulation() public {
        bytes32 seed = 0x2ad604752bd7196a151f91c06e94003bd147fe90a61c08f01e5fd03aba066451;
        
        // Test round 0 dice rolls
        bytes32 roundSeed = keccak256(abi.encodePacked(seed, "round", uint32(0)));
        DeterministicDice.Dice memory dice = DeterministicDice.create(roundSeed);
        
        emit log_named_bytes32("Round 0 seed", roundSeed);
        
        // First agent action
        uint256 action;
        (action, dice) = dice.roll(16);
        emit log_named_uint("Round 0, Agent 0, Action", action);
    }
    
    function test_MultiSeedParity() public {
        bytes32 seed1 = 0x0000000000000000000000000000000000000000000000000000000000000001;
        
        // Create game
        vm.prank(player);
        uint256 gameId = gameFactory.createGame{value: 0.001 ether}();
        vm.roll(block.number + 1);
        vm.prank(player);
        gameFactory.revealSeed(gameId);
        
        // Submit fake oracle result
        vm.prank(oracle);
        gameFactory.submitResult(gameId, bytes32(0), 0);
        
        vm.prank(challenger);
        gameFactory.challengeResult{value: 0.01 ether}(gameId);
        
        // We'll run with a fresh challenge using a different mechanism
        // Let's just verify the spawn and terrain for seed1
        MapGenerator.TerrainType[][] memory terrain = mapGenerator.generateMap(seed1, GRID_SIZE);
        
        uint256 groundCount = 0;
        for (uint16 r = 0; r < GRID_SIZE; r++) {
            for (uint16 c = 0; c < GRID_SIZE; c++) {
                if (terrain[r][c] == MapGenerator.TerrainType.Ground) groundCount++;
            }
        }
        
        emit log_named_uint("Ground tiles for seed1", groundCount);
        
        // Spawn point calculation
        bytes32 spawnSeed = keccak256(abi.encodePacked(seed1, "spawn-points"));
        DeterministicDice.Dice memory dice = DeterministicDice.create(spawnSeed);
        
        uint16 centerTile = GRID_SIZE / 2;
        uint16 row = centerTile;
        uint16 col = centerTile;
        
        if (terrain[row][col] != MapGenerator.TerrainType.Ground) {
            for (uint256 attempts = 0; attempts < 100; attempts++) {
                uint256 drRoll;
                uint256 dcRoll;
                (drRoll, dice) = dice.roll(11);
                (dcRoll, dice) = dice.roll(11);
                
                int16 dr = int16(uint16(drRoll)) - 5;
                int16 dc = int16(uint16(dcRoll)) - 5;
                int16 testRow = int16(centerTile) + dr;
                int16 testCol = int16(centerTile) + dc;
                
                if (testRow >= 0 && testRow < int16(GRID_SIZE) && testCol >= 0 && testCol < int16(GRID_SIZE)) {
                    if (terrain[uint16(testRow)][uint16(testCol)] == MapGenerator.TerrainType.Ground) {
                        row = uint16(testRow);
                        col = uint16(testCol);
                        break;
                    }
                }
            }
        }
        
        emit log_named_uint("Seed1 spawn row", row);
        emit log_named_uint("Seed1 spawn col", col);
    }
}

