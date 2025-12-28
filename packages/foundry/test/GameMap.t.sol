// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/GameMap.sol";
import "../contracts/MapGenerator.sol";

contract GameMapTest is Test {
    MapGenerator public mapGenerator;
    GameMap public gameMap;
    GameMapFactory public factory;

    function setUp() public {
        mapGenerator = new MapGenerator();
        gameMap = new GameMap(mapGenerator);
        factory = new GameMapFactory(mapGenerator);
    }

    // =========================================================================
    // Gas Benchmarks
    // =========================================================================

    /// @notice Benchmark: Generate and store 11x11 map
    function test_GasBenchmark_11x11() public {
        bytes32 roll = keccak256("test_11x11");
        
        uint256 gasBefore = gasleft();
        gameMap.generateAndStoreMap(roll, 11);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 11x11 map generation + storage", gasUsed);
        emit log_named_uint("Storage slots used", gameMap.calculateStorageSlots(11));
    }

    /// @notice Benchmark: Generate and store 21x21 map
    function test_GasBenchmark_21x21() public {
        bytes32 roll = keccak256("test_21x21");
        
        uint256 gasBefore = gasleft();
        gameMap.generateAndStoreMap(roll, 21);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 21x21 map generation + storage", gasUsed);
        emit log_named_uint("Storage slots used", gameMap.calculateStorageSlots(21));
    }

    /// @notice Benchmark: Generate and store 31x31 map
    function test_GasBenchmark_31x31() public {
        bytes32 roll = keccak256("test_31x31");
        
        uint256 gasBefore = gasleft();
        gameMap.generateAndStoreMap(roll, 31);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 31x31 map generation + storage", gasUsed);
        emit log_named_uint("Storage slots used", gameMap.calculateStorageSlots(31));
    }

    /// @notice Benchmark: Generate and store 51x51 map
    function test_GasBenchmark_51x51() public {
        bytes32 roll = keccak256("test_51x51");
        
        uint256 gasBefore = gasleft();
        gameMap.generateAndStoreMap(roll, 51);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 51x51 map generation + storage", gasUsed);
        emit log_named_uint("Storage slots used", gameMap.calculateStorageSlots(51));
    }

    /// @notice Benchmark: Generate and store 111x111 map (full size)
    function test_GasBenchmark_111x111() public {
        bytes32 roll = keccak256("test_111x111");
        
        uint256 gasBefore = gasleft();
        gameMap.generateAndStoreMap(roll, 111);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 111x111 map generation + storage", gasUsed);
        emit log_named_uint("Storage slots used", gameMap.calculateStorageSlots(111));
        emit log_named_uint("Total tiles", 111 * 111);
    }

    // =========================================================================
    // Read Gas Benchmarks
    // =========================================================================

    /// @notice Benchmark: Single tile read
    function test_GasBenchmark_SingleRead() public {
        bytes32 roll = keccak256("test_read");
        gameMap.generateAndStoreMap(roll, 21);

        uint256 gasBefore = gasleft();
        gameMap.getTerrain(10, 10);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for single tile read", gasUsed);
    }

    /// @notice Benchmark: Multiple tile reads
    function test_GasBenchmark_MultipleReads() public {
        bytes32 roll = keccak256("test_multi_read");
        gameMap.generateAndStoreMap(roll, 21);

        // Read 10 tiles
        uint256 gasBefore = gasleft();
        for (uint256 i = 0; i < 10; i++) {
            gameMap.getTerrain(i, i);
        }
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 10 tile reads (loop)", gasUsed);

        // Batch read
        uint256[] memory rows = new uint256[](10);
        uint256[] memory cols = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            rows[i] = i;
            cols[i] = i;
        }

        gasBefore = gasleft();
        gameMap.getTerrainBatch(rows, cols);
        gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for 10 tile reads (batch)", gasUsed);
    }

    /// @notice Benchmark: isTraversable check
    function test_GasBenchmark_IsTraversable() public {
        bytes32 roll = keccak256("test_traversable");
        gameMap.generateAndStoreMap(roll, 21);

        uint256 gasBefore = gasleft();
        gameMap.isTraversable(10, 10);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas for isTraversable check", gasUsed);
    }

    // =========================================================================
    // Correctness Tests
    // =========================================================================

    /// @notice Test that stored map matches generated map
    function test_StoredMapMatchesGenerated() public {
        bytes32 roll = keccak256("test_correctness");
        uint256 gridSize = 11;
        
        // Generate expected map using MapGenerator contract
        MapGenerator.TerrainType[][] memory expected = mapGenerator.generateMap(roll, gridSize);
        
        // Store map
        gameMap.generateAndStoreMap(roll, gridSize);
        
        // Verify all tiles match
        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                MapGenerator.TerrainType stored = gameMap.getTerrain(row, col);
                assertEq(uint256(stored), uint256(expected[row][col]), "Stored terrain mismatch");
            }
        }
    }

    /// @notice Test isTraversable returns correct values
    function test_IsTraversable() public {
        bytes32 roll = keccak256("test_traversable_correctness");
        uint256 gridSize = 21;
        
        // Generate and store map
        MapGenerator.TerrainType[][] memory terrain = mapGenerator.generateMap(roll, gridSize);
        gameMap.generateAndStoreMap(roll, gridSize);
        
        // Check several positions
        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                bool expected = terrain[row][col] == MapGenerator.TerrainType.Ground;
                bool actual = gameMap.isTraversable(row, col);
                assertEq(actual, expected, "isTraversable mismatch");
            }
        }
    }

    /// @notice Test cannot initialize twice
    function test_RevertOnDoubleInit() public {
        bytes32 roll = keccak256("test_double_init");
        gameMap.generateAndStoreMap(roll, 11);
        
        vm.expectRevert(GameMap.MapAlreadyInitialized.selector);
        gameMap.generateAndStoreMap(roll, 11);
    }

    /// @notice Test out of bounds access
    function test_RevertOnOutOfBounds() public {
        bytes32 roll = keccak256("test_bounds");
        gameMap.generateAndStoreMap(roll, 11);
        
        vm.expectRevert(abi.encodeWithSelector(GameMap.CoordinatesOutOfBounds.selector, 11, 0, 11));
        gameMap.getTerrain(11, 0);
    }

    /// @notice Test game state
    function test_GameState() public {
        bytes32 roll = keccak256("test_state");
        gameMap.generateAndStoreMap(roll, 21);
        
        (bytes32 storedRoll, uint256 gridSize, uint256 round, bool initialized) = gameMap.game();
        
        assertEq(storedRoll, roll, "Roll mismatch");
        assertEq(gridSize, 21, "Grid size mismatch");
        assertEq(round, 0, "Initial round should be 0");
        assertTrue(initialized, "Should be initialized");
        
        // Advance round
        gameMap.advanceRound();
        (, , round, ) = gameMap.game();
        assertEq(round, 1, "Round should be 1");
    }

    // =========================================================================
    // Factory Tests
    // =========================================================================

    /// @notice Test factory creates games
    function test_FactoryCreatesGames() public {
        (uint256 gameId, address gameAddress) = factory.createGame();
        
        assertEq(gameId, 0, "First game ID should be 0");
        assertTrue(gameAddress != address(0), "Game address should be set");
        assertEq(factory.gameCount(), 1, "Game count should be 1");
        
        // Create another game
        (uint256 gameId2, ) = factory.createGame();
        assertEq(gameId2, 1, "Second game ID should be 1");
        assertEq(factory.gameCount(), 2, "Game count should be 2");
    }

    // =========================================================================
    // Storage Analysis
    // =========================================================================

    /// @notice Print storage analysis for various grid sizes
    function test_StorageAnalysis() public {
        emit log("=== STORAGE ANALYSIS ===");
        emit log("");
        
        uint256[] memory sizes = new uint256[](6);
        sizes[0] = 11;
        sizes[1] = 21;
        sizes[2] = 31;
        sizes[3] = 51;
        sizes[4] = 81;
        sizes[5] = 111;
        
        for (uint256 i = 0; i < sizes.length; i++) {
            uint256 size = sizes[i];
            uint256 tiles = size * size;
            uint256 slots = gameMap.calculateStorageSlots(size);
            uint256 estimatedGas = gameMap.estimateStorageGas(size);
            
            emit log_named_uint("Grid size", size);
            emit log_named_uint("  Total tiles", tiles);
            emit log_named_uint("  Storage slots", slots);
            emit log_named_uint("  Est. gas", estimatedGas);
            emit log("");
        }
    }
}
