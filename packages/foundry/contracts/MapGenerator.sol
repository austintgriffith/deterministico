// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title MapGenerator
 * @notice Deterministic map generation that matches the TypeScript implementation.
 * @dev Generates terrain grids using keccak256-based randomness and cellular automata smoothing.
 *      
 *      The algorithm has three phases:
 *      1. Seed derivation from roll hash
 *      2. Weighted terrain type assignment per tile
 *      3. Cellular automata smoothing (2 passes)
 */
contract MapGenerator {
    /// @notice Terrain types matching TypeScript TerrainType
    /// @dev Order matters - must match: ground=0, mountain=1, liquid=2, mushroom=3, rubyMountain=4
    enum TerrainType { Ground, Mountain, Liquid, Mushroom, RubyMountain }

    /// @notice Number of terrain types used in generation (excludes "undiscovered" which is render-only)
    uint256 constant NUM_TERRAIN_TYPES = 5;

    /// @notice Terrain weights (must sum to 100)
    /// @dev Matches TypeScript: ground=50, mountain=20, liquid=17, mushroom=10, rubyMountain=3
    uint256 constant WEIGHT_GROUND = 50;
    uint256 constant WEIGHT_MOUNTAIN = 20;
    uint256 constant WEIGHT_LIQUID = 17;
    uint256 constant WEIGHT_MUSHROOM = 10;
    uint256 constant WEIGHT_RUBY_MOUNTAIN = 3;

    /// @notice Default grid size matching TypeScript GRID_SIZE
    uint256 constant DEFAULT_GRID_SIZE = 32;

    /**
     * @notice Keccak256-based hash function for position-based randomness
     * @dev Matches TypeScript: keccak256(encodePacked(uint256(x), uint256(y), uint256(seed)))
     * @param x Row coordinate
     * @param y Column coordinate  
     * @param seed The seed value
     * @return Hash as uint256
     */
    function _hash(uint256 x, uint256 y, uint256 seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(x, y, seed)));
    }

    /**
     * @notice Get terrain type based on weighted random selection
     * @dev Uses keccak256 hash for position-based randomness
     *      Weights: ground=50, mountain=20, liquid=17, mushroom=10, rubyMountain=3
     * @param row Tile row index
     * @param col Tile column index
     * @param seed The generation seed
     * @return The terrain type for this position
     */
    function _getWeightedTerrainType(uint256 row, uint256 col, uint256 seed) internal pure returns (TerrainType) {
        uint256 roll = _hash(row, col, seed) % 100; // 0-99

        // Cumulative weight selection (matches TypeScript exactly)
        // ground: 0-49 (50%), mountain: 50-69 (20%), liquid: 70-86 (17%), 
        // mushroom: 87-96 (10%), rubyMountain: 97-99 (3%)
        if (roll < WEIGHT_GROUND) {
            return TerrainType.Ground;
        }
        if (roll < WEIGHT_GROUND + WEIGHT_MOUNTAIN) {
            return TerrainType.Mountain;
        }
        if (roll < WEIGHT_GROUND + WEIGHT_MOUNTAIN + WEIGHT_LIQUID) {
            return TerrainType.Liquid;
        }
        if (roll < WEIGHT_GROUND + WEIGHT_MOUNTAIN + WEIGHT_LIQUID + WEIGHT_MUSHROOM) {
            return TerrainType.Mushroom;
        }
        return TerrainType.RubyMountain;
    }

    /**
     * @notice Apply one smoothing pass using cellular automata rules
     * @dev Groups similar terrain types together for a more natural look.
     *      Matches TypeScript smoothTerrainGrid function exactly.
     * @param grid The current terrain grid
     * @param gridSize Size of the grid
     * @param passNumber The smoothing pass number (1 or 2)
     * @param seed The generation seed
     * @return The smoothed terrain grid
     */
    function _smoothTerrainGrid(
        TerrainType[][] memory grid,
        uint256 gridSize,
        uint256 passNumber,
        uint256 seed
    ) internal pure returns (TerrainType[][] memory) {
        TerrainType[][] memory newGrid = new TerrainType[][](gridSize);

        for (uint256 row = 0; row < gridSize; row++) {
            newGrid[row] = new TerrainType[](gridSize);
            
            for (uint256 col = 0; col < gridSize; col++) {
                TerrainType currentType = grid[row][col];

                // Count neighbors of each type (including self) in 3x3 neighborhood
                uint256[5] memory counts; // One count per terrain type

                for (int256 dr = -1; dr <= 1; dr++) {
                    for (int256 dc = -1; dc <= 1; dc++) {
                        int256 nr = int256(row) + dr;
                        int256 nc = int256(col) + dc;
                        
                        if (nr >= 0 && nr < int256(gridSize) && nc >= 0 && nc < int256(gridSize)) {
                            counts[uint256(grid[uint256(nr)][uint256(nc)])]++;
                        }
                    }
                }

                // Find dominant type (most neighbors)
                TerrainType dominantType = currentType;
                uint256 maxCount = counts[uint256(currentType)];

                for (uint256 t = 0; t < NUM_TERRAIN_TYPES; t++) {
                    if (counts[t] > maxCount) {
                        maxCount = counts[t];
                        dominantType = TerrainType(t);
                    }
                }

                // Preserve rare types (rubyMountain) - only change if very isolated (0-1 neighbors)
                if (currentType == TerrainType.RubyMountain) {
                    if (counts[uint256(TerrainType.RubyMountain)] >= 2) {
                        newGrid[row][col] = currentType;
                        continue;
                    }
                }

                uint256 currentCount = counts[uint256(currentType)];

                // For ties or close counts, use deterministic roll to decide
                if (maxCount == currentCount) {
                    // Keep current type if it's tied
                    newGrid[row][col] = currentType;
                } else if (maxCount - currentCount <= 2) {
                    // Close call - use deterministic roll
                    // Matches TypeScript: hash(row + passNumber * 1000, col + passNumber * 1000, seed) % 100
                    uint256 tieBreaker = _hash(row + passNumber * 1000, col + passNumber * 1000, seed) % 100;
                    if (tieBreaker < 40) {
                        newGrid[row][col] = currentType; // 40% chance to keep current
                    } else {
                        newGrid[row][col] = dominantType;
                    }
                } else {
                    // Clear majority - switch to dominant type
                    newGrid[row][col] = dominantType;
                }
            }
        }

        return newGrid;
    }

    /**
     * @notice Generate a terrain map from a roll hash
     * @dev Three-phase generation matching TypeScript:
     *      1. Derive seed from roll
     *      2. Weighted terrain type assignment
     *      3. Two smoothing passes
     * @param roll The bytes32 roll hash (e.g., from game state)
     * @param gridSize Size of the grid to generate
     * @return terrain 2D array of terrain types
     */
    function generateMap(bytes32 roll, uint256 gridSize) external pure returns (TerrainType[][] memory terrain) {
        return _generateMap(roll, gridSize);
    }

    /**
     * @notice Generate a terrain map with default grid size (32x32)
     * @param roll The bytes32 roll hash
     * @return terrain 2D array of terrain types
     */
    function generateMapDefault(bytes32 roll) external pure returns (TerrainType[][] memory terrain) {
        return _generateMap(roll, DEFAULT_GRID_SIZE);
    }

    /**
     * @notice Internal map generation logic
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return terrain 2D array of terrain types
     */
    function _generateMap(bytes32 roll, uint256 gridSize) internal pure returns (TerrainType[][] memory terrain) {
        // Phase 1: Derive seed from roll hash (matches TypeScript exactly)
        // TypeScript: keccak256(encodePacked(roll, "map"))
        uint256 seed = uint256(keccak256(abi.encodePacked(roll, "map")));

        // Phase 2: Generate initial terrain grid with weighted random selection
        terrain = new TerrainType[][](gridSize);
        for (uint256 row = 0; row < gridSize; row++) {
            terrain[row] = new TerrainType[](gridSize);
            for (uint256 col = 0; col < gridSize; col++) {
                terrain[row][col] = _getWeightedTerrainType(row, col, seed);
            }
        }

        // Phase 3: Apply smoothing passes (2 passes for natural clustering)
        terrain = _smoothTerrainGrid(terrain, gridSize, 1, seed);
        terrain = _smoothTerrainGrid(terrain, gridSize, 2, seed);

        return terrain;
    }

    /**
     * @notice Get a single tile's terrain type
     * @dev Useful for on-chain queries without generating the full map.
     *      Note: This applies full generation + smoothing for accuracy,
     *      so it's still expensive. For frequent queries, generate once and cache.
     * @param roll The bytes32 roll hash
     * @param row Tile row index
     * @param col Tile column index
     * @param gridSize Size of the grid
     * @return The terrain type at the specified position
     */
    function getTileAt(bytes32 roll, uint256 row, uint256 col, uint256 gridSize) external pure returns (TerrainType) {
        TerrainType[][] memory terrain = _generateMap(roll, gridSize);
        require(row < gridSize && col < gridSize, "MapGenerator: coordinates out of bounds");
        return terrain[row][col];
    }

    /**
     * @notice Generate and pack terrain map for efficient transmission
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return packed Packed bytes representation (2 tiles per byte)
     */
    function generateMapPacked(bytes32 roll, uint256 gridSize) external pure returns (bytes memory packed) {
        TerrainType[][] memory terrain = _generateMap(roll, gridSize);
        return _packTerrain(terrain);
    }

    /**
     * @notice Generate terrain hash for verification
     * @param roll The bytes32 roll hash
     * @param gridSize Size of the grid to generate
     * @return Hash of the terrain grid
     */
    function generateMapHash(bytes32 roll, uint256 gridSize) external pure returns (bytes32) {
        TerrainType[][] memory terrain = _generateMap(roll, gridSize);
        return keccak256(_packTerrain(terrain));
    }

    /**
     * @notice Pack terrain grid into bytes for efficient storage/transmission
     * @dev Each terrain type (0-4) fits in 3 bits, but we use 4 bits (nibble) for simplicity.
     *      This packs 2 tiles per byte.
     * @param terrain The terrain grid to pack
     * @return packed Packed bytes representation
     */
    function _packTerrain(TerrainType[][] memory terrain) internal pure returns (bytes memory packed) {
        uint256 gridSize = terrain.length;
        uint256 totalTiles = gridSize * gridSize;
        uint256 packedLength = (totalTiles + 1) / 2; // 2 tiles per byte
        
        packed = new bytes(packedLength);
        uint256 byteIndex = 0;
        uint256 tileIndex = 0;

        for (uint256 row = 0; row < gridSize; row++) {
            for (uint256 col = 0; col < gridSize; col++) {
                uint8 terrainValue = uint8(terrain[row][col]);
                
                if (tileIndex % 2 == 0) {
                    // High nibble
                    packed[byteIndex] = bytes1(terrainValue << 4);
                } else {
                    // Low nibble - combine with existing high nibble
                    packed[byteIndex] = bytes1(uint8(packed[byteIndex]) | terrainValue);
                    byteIndex++;
                }
                tileIndex++;
            }
        }

        return packed;
    }
}
