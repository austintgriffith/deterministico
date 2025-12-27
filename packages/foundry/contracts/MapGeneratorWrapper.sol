// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./MapGenerator.sol";

/**
 * @title MapGeneratorWrapper
 * @notice Wrapper contract to expose MapGenerator library functions
 * @dev This contract allows external calls to the library functions for testing and verification
 */
contract MapGeneratorWrapper {
    using MapGenerator for bytes32;

    /**
     * @notice Generate a terrain map from a roll hash
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return terrain 2D array of terrain types
     */
    function generateMap(bytes32 roll, uint256 gridSize) external pure returns (MapGenerator.TerrainType[][] memory terrain) {
        return MapGenerator.generateMap(roll, gridSize);
    }

    /**
     * @notice Generate a terrain map with default grid size (111x111)
     * @param roll The bytes32 roll hash
     * @return terrain 2D array of terrain types
     */
    function generateMapDefault(bytes32 roll) external pure returns (MapGenerator.TerrainType[][] memory terrain) {
        return MapGenerator.generateMap(roll);
    }

    /**
     * @notice Get a single tile's terrain type
     * @param roll The bytes32 roll hash
     * @param row Tile row index
     * @param col Tile column index
     * @param gridSize Size of the grid
     * @return The terrain type at the specified position
     */
    function getTileAt(bytes32 roll, uint256 row, uint256 col, uint256 gridSize) external pure returns (MapGenerator.TerrainType) {
        return MapGenerator.getTileAt(roll, row, col, gridSize);
    }

    /**
     * @notice Generate and pack terrain map for efficient transmission
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return packed Packed bytes representation (2 tiles per byte)
     */
    function generateMapPacked(bytes32 roll, uint256 gridSize) external pure returns (bytes memory packed) {
        MapGenerator.TerrainType[][] memory terrain = MapGenerator.generateMap(roll, gridSize);
        return MapGenerator.packTerrain(terrain);
    }

    /**
     * @notice Generate terrain hash for verification
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return Hash of the terrain grid
     */
    function generateMapHash(bytes32 roll, uint256 gridSize) external pure returns (bytes32) {
        MapGenerator.TerrainType[][] memory terrain = MapGenerator.generateMap(roll, gridSize);
        return MapGenerator.terrainHash(terrain);
    }
}

