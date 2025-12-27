// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/MapGenerator.sol";
import "../contracts/MapGeneratorWrapper.sol";

contract MapGeneratorTest is Test {
    MapGeneratorWrapper public wrapper;

    function setUp() public {
        wrapper = new MapGeneratorWrapper();
    }

    /// @notice Test that map generation is deterministic (same seed = same output)
    function test_Determinism() public view {
        bytes32 roll = keccak256("test_seed_1");
        uint256 gridSize = 21; // Small grid for gas efficiency

        MapGenerator.TerrainType[][] memory map1 = wrapper.generateMap(roll, gridSize);
        MapGenerator.TerrainType[][] memory map2 = wrapper.generateMap(roll, gridSize);

        // Verify all tiles match
        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                assertEq(uint256(map1[row][col]), uint256(map2[row][col]), "Maps should be identical");
            }
        }
    }

    /// @notice Test that different seeds produce different maps
    function test_DifferentSeeds() public view {
        bytes32 roll1 = keccak256("seed_alpha");
        bytes32 roll2 = keccak256("seed_beta");
        uint256 gridSize = 21;

        MapGenerator.TerrainType[][] memory map1 = wrapper.generateMap(roll1, gridSize);
        MapGenerator.TerrainType[][] memory map2 = wrapper.generateMap(roll2, gridSize);

        // Count differences - should have at least some
        uint256 differences = 0;
        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                if (map1[row][col] != map2[row][col]) {
                    differences++;
                }
            }
        }

        // With different seeds, we expect significant differences
        assertTrue(differences > gridSize, "Different seeds should produce different maps");
    }

    /// @notice Test that terrain types are within valid range
    function test_ValidTerrainTypes() public view {
        bytes32 roll = keccak256("terrain_test");
        uint256 gridSize = 31;

        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);

        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                uint256 terrainValue = uint256(map[row][col]);
                assertTrue(terrainValue <= 4, "Terrain type should be 0-4");
            }
        }
    }

    /// @notice Test terrain distribution roughly matches expected weights
    function test_TerrainDistribution() public {
        bytes32 roll = keccak256("distribution_test");
        uint256 gridSize = 51; // Larger grid for better statistics
        uint256 totalTiles = gridSize * gridSize;

        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);

        // Count each terrain type
        uint256[5] memory counts;
        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                counts[uint256(map[row][col])]++;
            }
        }

        // After smoothing, distributions will shift, but ground should still be most common
        // and rubyMountain should be rare
        assertTrue(counts[0] > counts[4], "Ground should be more common than RubyMountain");
        
        // Log distribution for debugging
        emit log_named_uint("Ground count", counts[0]);
        emit log_named_uint("Mountain count", counts[1]);
        emit log_named_uint("Liquid count", counts[2]);
        emit log_named_uint("Mushroom count", counts[3]);
        emit log_named_uint("RubyMountain count", counts[4]);
        emit log_named_uint("Total tiles", totalTiles);
    }

    /// @notice Test getTileAt matches generateMap at same position
    function test_GetTileAtConsistency() public view {
        bytes32 roll = keccak256("tile_at_test");
        uint256 gridSize = 21;

        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);

        // Check several random positions
        uint256[] memory testRows = new uint256[](5);
        uint256[] memory testCols = new uint256[](5);
        testRows[0] = 0; testCols[0] = 0;
        testRows[1] = 10; testCols[1] = 10;
        testRows[2] = 20; testCols[2] = 20;
        testRows[3] = 5; testCols[3] = 15;
        testRows[4] = 15; testCols[4] = 5;

        for (uint256 i = 0; i < 5; i++) {
            MapGenerator.TerrainType tile = wrapper.getTileAt(roll, testRows[i], testCols[i], gridSize);
            assertEq(
                uint256(tile), 
                uint256(map[testRows[i]][testCols[i]]), 
                "getTileAt should match generateMap"
            );
        }
    }

    /// @notice Test packed terrain format
    function test_PackedTerrain() public view {
        bytes32 roll = keccak256("packed_test");
        uint256 gridSize = 21;

        bytes memory packed = wrapper.generateMapPacked(roll, gridSize);
        
        // 21x21 = 441 tiles, 2 tiles per byte = 221 bytes (rounded up)
        uint256 expectedLength = (gridSize * gridSize + 1) / 2;
        assertEq(packed.length, expectedLength, "Packed length should be correct");
    }

    /// @notice Test terrain hash is deterministic
    function test_TerrainHashDeterminism() public view {
        bytes32 roll = keccak256("hash_test");
        uint256 gridSize = 21;

        bytes32 hash1 = wrapper.generateMapHash(roll, gridSize);
        bytes32 hash2 = wrapper.generateMapHash(roll, gridSize);

        assertEq(hash1, hash2, "Terrain hash should be deterministic");
    }

    /// @notice Test terrain hash changes with different seeds
    function test_TerrainHashUniqueness() public view {
        bytes32 roll1 = keccak256("hash_seed_1");
        bytes32 roll2 = keccak256("hash_seed_2");
        uint256 gridSize = 21;

        bytes32 hash1 = wrapper.generateMapHash(roll1, gridSize);
        bytes32 hash2 = wrapper.generateMapHash(roll2, gridSize);

        assertTrue(hash1 != hash2, "Different seeds should produce different hashes");
    }

    /// @notice Test edge case: 1x1 grid
    function test_MinimalGrid() public view {
        bytes32 roll = keccak256("minimal_test");
        uint256 gridSize = 1;

        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);
        
        assertEq(map.length, 1, "Grid should have 1 row");
        assertEq(map[0].length, 1, "Grid should have 1 column");
        assertTrue(uint256(map[0][0]) <= 4, "Terrain type should be valid");
    }

    /// @notice Test with a specific known seed for parity testing
    /// @dev This test outputs values that can be compared with TypeScript
    function test_ParityOutput() public {
        // Use a well-known seed that we'll also test in TypeScript
        bytes32 roll = bytes32(uint256(0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef));
        uint256 gridSize = 32; // Matches TypeScript GRID_SIZE

        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);

        // Output the terrain grid for comparison
        emit log("=== PARITY TEST OUTPUT ===");
        emit log_named_bytes32("Roll", roll);
        emit log_named_uint("Grid Size", gridSize);
        
        // Output each row as a string of terrain values
        for (uint256 row = 0; row < gridSize; row++) {
            string memory rowStr = "";
            for (uint256 col = 0; col < gridSize; col++) {
                if (col > 0) rowStr = string(abi.encodePacked(rowStr, ","));
                rowStr = string(abi.encodePacked(rowStr, _terrainToString(map[row][col])));
            }
            emit log_named_string(string(abi.encodePacked("Row ", _uintToString(row))), rowStr);
        }
    }

    /// @notice Test multiple seeds for comprehensive parity verification
    function test_MultiSeedParity() public {
        uint256 gridSize = 32;
        
        // Test seed 1: keccak256("parity_test_seed_0")
        bytes32 roll1 = 0x5b5ee78532e82467429bcf43d5f3c8aa93f5e74dd98f9da1e94bac36cbe5b239;
        _outputMapForParity(roll1, gridSize, "SEED_0");
        
        // Test seed 2: keccak256("parity_test_seed_1") 
        bytes32 roll2 = 0xd285e050369454839a99ae311b1148479a668ce4fcff45301674e5d29d0bd6a6;
        _outputMapForParity(roll2, gridSize, "SEED_1");
        
        // Test seed 3: keccak256("parity_test_seed_2")
        bytes32 roll3 = 0x2cfcbe2b3f334995d5cace24ae66ae2e22c1b93ce36ddd21720e129883c67695;
        _outputMapForParity(roll3, gridSize, "SEED_2");
    }

    function _outputMapForParity(bytes32 roll, uint256 gridSize, string memory label) internal {
        MapGenerator.TerrainType[][] memory map = wrapper.generateMap(roll, gridSize);
        
        emit log(string(abi.encodePacked("=== ", label, " ===")));
        emit log_named_bytes32("Roll", roll);
        
        for (uint256 row = 0; row < gridSize; row++) {
            string memory rowStr = "";
            for (uint256 col = 0; col < gridSize; col++) {
                if (col > 0) rowStr = string(abi.encodePacked(rowStr, ","));
                rowStr = string(abi.encodePacked(rowStr, _terrainToString(map[row][col])));
            }
            emit log_named_string(string(abi.encodePacked("Row ", _uintToString(row))), rowStr);
        }
    }

    // Helper to convert terrain type to single char for logging
    function _terrainToString(MapGenerator.TerrainType t) internal pure returns (string memory) {
        if (t == MapGenerator.TerrainType.Ground) return "G";
        if (t == MapGenerator.TerrainType.Mountain) return "M";
        if (t == MapGenerator.TerrainType.Liquid) return "L";
        if (t == MapGenerator.TerrainType.Mushroom) return "S"; // S for shroom
        return "R"; // RubyMountain
    }

    // Helper to convert uint to string
    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /// @notice Gas benchmark for different grid sizes
    function test_GasBenchmark() public {
        bytes32 roll = keccak256("gas_test");
        
        // Test small grid
        uint256 startGas = gasleft();
        wrapper.generateMap(roll, 11);
        uint256 gas11 = startGas - gasleft();
        emit log_named_uint("Gas for 11x11 grid", gas11);

        // Test medium grid  
        startGas = gasleft();
        wrapper.generateMap(roll, 21);
        uint256 gas21 = startGas - gasleft();
        emit log_named_uint("Gas for 21x21 grid", gas21);

        // Test larger grid
        startGas = gasleft();
        wrapper.generateMap(roll, 31);
        uint256 gas31 = startGas - gasleft();
        emit log_named_uint("Gas for 31x31 grid", gas31);
    }

    /// @notice Output terrain hashes for parity testing with TypeScript
    /// @dev Run with: forge test --match-test "test_HashParityOutput" -vvv
    function test_HashParityOutput() public {
        uint256 gridSize = 32;
        
        // Test seeds - must match mapHashParityTest.js
        bytes32[4] memory rolls = [
            bytes32(uint256(0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef)),
            bytes32(0x5b5ee78532e82467429bcf43d5f3c8aa93f5e74dd98f9da1e94bac36cbe5b239),
            bytes32(0xd285e050369454839a99ae311b1148479a668ce4fcff45301674e5d29d0bd6a6),
            bytes32(0x2cfcbe2b3f334995d5cace24ae66ae2e22c1b93ce36ddd21720e129883c67695)
        ];

        emit log("=== MAP HASH PARITY TEST ===");
        emit log_named_uint("Grid Size", gridSize);
        
        for (uint256 i = 0; i < rolls.length; i++) {
            bytes32 roll = rolls[i];
            bytes32 mapHash = wrapper.generateMapHash(roll, gridSize);
            
            // Output in format that mapHashParityTest.js can parse
            // Format: "Hash for 0x...: 0x..."
            emit log(string(abi.encodePacked(
                "Hash for ",
                _bytes32ToHexString(roll),
                ": ",
                _bytes32ToHexString(mapHash)
            )));
        }
    }

    /// @notice Helper to convert bytes32 to hex string for logging
    function _bytes32ToHexString(bytes32 value) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory str = new bytes(66); // "0x" + 64 hex chars
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            str[2 + i * 2] = hexChars[uint8(value[i] >> 4)];
            str[3 + i * 2] = hexChars[uint8(value[i] & 0x0f)];
        }
        return string(str);
    }
}

