// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./MapGenerator.sol";

/**
 * @title GameMap
 * @notice Stores and manages terrain maps for the game with gas-optimized storage.
 * @dev Uses nibble-packing (4 bits per tile) to minimize storage costs.
 *      
 *      Storage comparison for 111x111 grid (12,321 tiles):
 *      - Naive (1 slot per tile): 12,321 slots × 20,000 gas = 246M gas ❌
 *      - uint8 array: 12,321 bytes = 386 slots × 20,000 gas = 7.7M gas
 *      - Nibble-packed (4 bits): 6,161 bytes = 193 slots × 20,000 gas = 3.86M gas ✓
 *      - 3-bit packed: ~145 slots, but complex bit math
 *      
 *      We use nibble-packing for a good balance of gas efficiency and code simplicity.
 */
contract GameMap {
    using MapGenerator for bytes32;

    /// @notice Game state
    struct Game {
        bytes32 roll;           // Original roll hash for the game
        uint256 gridSize;       // Size of the grid (e.g., 111)
        uint256 round;          // Current game round
        bool initialized;       // Whether the map has been generated
    }

    /// @notice Current game state
    Game public game;

    /// @notice Packed terrain storage
    /// @dev Maps slot index to packed terrain data (64 tiles per slot using nibbles)
    mapping(uint256 => uint256) private terrainSlots;

    /// @notice Events
    event MapGenerated(bytes32 indexed roll, uint256 gridSize, uint256 gasUsed);
    event RoundAdvanced(uint256 round);

    /// @notice Errors
    error MapAlreadyInitialized();
    error MapNotInitialized();
    error CoordinatesOutOfBounds(uint256 row, uint256 col, uint256 gridSize);

    /**
     * @notice Generate and store a map from a roll hash
     * @param roll The bytes32 roll hash to generate the map from
     * @param gridSize Size of the grid to generate
     */
    function generateAndStoreMap(bytes32 roll, uint256 gridSize) external {
        if (game.initialized) revert MapAlreadyInitialized();

        uint256 startGas = gasleft();

        // Generate the map in memory
        MapGenerator.TerrainType[][] memory terrain = MapGenerator.generateMap(roll, gridSize);

        // Store packed terrain data
        _storePackedTerrain(terrain, gridSize);

        // Initialize game state
        game = Game({
            roll: roll,
            gridSize: gridSize,
            round: 0,
            initialized: true
        });

        uint256 gasUsed = startGas - gasleft();
        emit MapGenerated(roll, gridSize, gasUsed);
    }

    /**
     * @notice Get terrain type at a specific position
     * @param row Tile row index
     * @param col Tile column index
     * @return The terrain type at the position
     */
    function getTerrain(uint256 row, uint256 col) external view returns (MapGenerator.TerrainType) {
        if (!game.initialized) revert MapNotInitialized();
        if (row >= game.gridSize || col >= game.gridSize) {
            revert CoordinatesOutOfBounds(row, col, game.gridSize);
        }

        return _getPackedTerrain(row, col, game.gridSize);
    }

    /**
     * @notice Check if a position is traversable (ground only)
     * @param row Tile row index
     * @param col Tile column index
     * @return True if the tile is ground terrain
     */
    function isTraversable(uint256 row, uint256 col) external view returns (bool) {
        if (!game.initialized) revert MapNotInitialized();
        if (row >= game.gridSize || col >= game.gridSize) {
            return false; // Out of bounds is not traversable
        }

        return _getPackedTerrain(row, col, game.gridSize) == MapGenerator.TerrainType.Ground;
    }

    /**
     * @notice Get terrain types for multiple positions (batch read)
     * @param rows Array of row indices
     * @param cols Array of column indices
     * @return terrains Array of terrain types
     */
    function getTerrainBatch(uint256[] calldata rows, uint256[] calldata cols) 
        external 
        view 
        returns (MapGenerator.TerrainType[] memory terrains) 
    {
        if (!game.initialized) revert MapNotInitialized();
        require(rows.length == cols.length, "Array length mismatch");

        terrains = new MapGenerator.TerrainType[](rows.length);
        for (uint256 i = 0; i < rows.length; i++) {
            if (rows[i] >= game.gridSize || cols[i] >= game.gridSize) {
                revert CoordinatesOutOfBounds(rows[i], cols[i], game.gridSize);
            }
            terrains[i] = _getPackedTerrain(rows[i], cols[i], game.gridSize);
        }
    }

    /**
     * @notice Get the entire map as a 2D array (expensive, for off-chain use)
     * @return terrain 2D array of terrain types
     */
    function getFullMap() external view returns (MapGenerator.TerrainType[][] memory terrain) {
        if (!game.initialized) revert MapNotInitialized();

        uint256 gridSize = game.gridSize;
        terrain = new MapGenerator.TerrainType[][](gridSize);

        for (uint256 row = 0; row < gridSize; row++) {
            terrain[row] = new MapGenerator.TerrainType[](gridSize);
            for (uint256 col = 0; col < gridSize; col++) {
                terrain[row][col] = _getPackedTerrain(row, col, gridSize);
            }
        }
    }

    /**
     * @notice Advance to the next round
     */
    function advanceRound() external {
        if (!game.initialized) revert MapNotInitialized();
        game.round++;
        emit RoundAdvanced(game.round);
    }

    // =========================================================================
    // Internal: Nibble-packed storage
    // =========================================================================

    /**
     * @notice Store terrain data in packed format
     * @dev Packs 64 tiles per 256-bit slot (4 bits per tile)
     */
    function _storePackedTerrain(MapGenerator.TerrainType[][] memory terrain, uint256 gridSize) internal {
        uint256 currentSlot = 0;
        uint256 packedValue = 0;
        uint256 nibbleIndex = 0;

        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                // Add terrain value (0-4) to packed value
                uint256 terrainValue = uint256(terrain[row][col]);
                packedValue |= (terrainValue << (nibbleIndex * 4));
                nibbleIndex++;

                // When we've packed 64 nibbles (256 bits), store and reset
                if (nibbleIndex == 64) {
                    terrainSlots[currentSlot] = packedValue;
                    currentSlot++;
                    packedValue = 0;
                    nibbleIndex = 0;
                }
            }
        }

        // Store any remaining packed data
        if (nibbleIndex > 0) {
            terrainSlots[currentSlot] = packedValue;
        }
    }

    /**
     * @notice Read terrain from packed storage
     * @param row Tile row index
     * @param col Tile column index
     * @param gridSize Size of the grid
     * @return The terrain type at the position
     */
    function _getPackedTerrain(uint256 row, uint256 col, uint256 gridSize) internal view returns (MapGenerator.TerrainType) {
        // Calculate tile index in linear array
        uint256 tileIndex = row * gridSize + col;
        
        // Calculate which slot and which nibble within the slot
        uint256 slotIndex = tileIndex / 64;
        uint256 nibbleIndex = tileIndex % 64;

        // Read the slot and extract the nibble
        uint256 packedValue = terrainSlots[slotIndex];
        uint256 terrainValue = (packedValue >> (nibbleIndex * 4)) & 0xF;

        return MapGenerator.TerrainType(terrainValue);
    }

    // =========================================================================
    // View functions for gas analysis
    // =========================================================================

    /**
     * @notice Calculate storage slots needed for a grid size
     * @param gridSize Size of the grid
     * @return Number of storage slots needed
     */
    function calculateStorageSlots(uint256 gridSize) external pure returns (uint256) {
        uint256 totalTiles = gridSize * gridSize;
        return (totalTiles + 63) / 64; // 64 tiles per slot, round up
    }

    /**
     * @notice Estimate gas cost for storing a map
     * @dev Rough estimate: 20,000 gas per new storage slot + generation overhead
     * @param gridSize Size of the grid
     * @return Estimated gas cost
     */
    function estimateStorageGas(uint256 gridSize) external pure returns (uint256) {
        uint256 slots = (gridSize * gridSize + 63) / 64;
        // 20,000 gas per SSTORE (cold) + overhead for generation
        return slots * 20000 + gridSize * gridSize * 500; // ~500 gas per tile generation
    }
}

/**
 * @title GameMapFactory
 * @notice Factory for creating GameMap instances
 * @dev Allows creating multiple game instances
 */
contract GameMapFactory {
    /// @notice All created games
    GameMap[] public games;

    /// @notice Event when a new game is created
    event GameCreated(address indexed gameAddress, uint256 indexed gameId);

    /**
     * @notice Create a new game map
     * @return gameId The ID of the new game
     * @return gameAddress The address of the new GameMap contract
     */
    function createGame() external returns (uint256 gameId, address gameAddress) {
        GameMap newGame = new GameMap();
        gameId = games.length;
        games.push(newGame);
        gameAddress = address(newGame);
        emit GameCreated(gameAddress, gameId);
    }

    /**
     * @notice Get the number of games created
     */
    function gameCount() external view returns (uint256) {
        return games.length;
    }
}

