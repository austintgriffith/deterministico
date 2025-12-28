// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title AgentStorage
 * @notice Storage and management for game agents (vehicles).
 * @dev Matches the TypeScript AgentPool structure for JS/Solidity parity.
 *      All positions use fixed-point x100 math (1234.56 becomes 123456).
 *      
 *      Agent data is packed for gas efficiency:
 *      - Slot 1: x (int32) | y (int32) | direction (uint8) | team (uint8) | vehicleType (uint8)
 *      - Slot 2: spawnX (int32) | spawnY (int32) (for comms units)
 */
library AgentStorage {
    // ========== CONSTANTS ==========
    
    /// @notice Fixed-point scale factor (x100 precision)
    uint256 constant FIXED_POINT_SCALE = 100;
    
    /// @notice Maximum number of teams
    uint8 constant MAX_TEAMS = 12;
    
    /// @notice Number of vehicle types
    uint8 constant NUM_VEHICLE_TYPES = 12;
    
    // Direction vectors (x100 scaled) - matches TypeScript DIRECTION_DX/DY
    // Index: 0=north, 1=east, 2=south, 3=west
    int32 constant DIRECTION_DX_0 = 200;   // north
    int32 constant DIRECTION_DX_1 = 200;   // east
    int32 constant DIRECTION_DX_2 = -200;  // south
    int32 constant DIRECTION_DX_3 = -200;  // west
    
    int32 constant DIRECTION_DY_0 = -100;  // north
    int32 constant DIRECTION_DY_1 = 100;   // east
    int32 constant DIRECTION_DY_2 = 100;   // south
    int32 constant DIRECTION_DY_3 = -100;  // west
    
    // Movement speeds by vehicle type (x100 scaled)
    // Heavy vehicles (types 0-5): 3px * 100 = 300
    // Light vehicles (types 6-11): 5px * 100 = 500
    uint16 constant HEAVY_MOVE_SPEED = 300;
    uint16 constant LIGHT_MOVE_SPEED = 500;
    
    // Comms range (x100 scaled) - only types 0 and 6 are comms units
    // 800px * 100 = 80000
    uint32 constant COMMS_RANGE = 80000;
    
    // Comms behavior thresholds (ratios of commsRange)
    // Below range * 0.4 = repel, Above range * 0.8 = attract
    uint8 constant COMMS_REPEL_RATIO = 40;   // 0.4 * 100
    uint8 constant COMMS_ATTRACT_RATIO = 80; // 0.8 * 100
    
    // Collision constants (x100 scaled)
    uint8 constant VEHICLE_COLLISION_PADDING = 8;
    int32 constant VEHICLE_COLLISION_Y_OFFSET = 800; // 8px * 100
    
    // Tile constants (x100 scaled) - from TypeScript
    int32 constant TILE_X_SPACING = 89;      // pixels (not scaled, used for division)
    int32 constant TILE_Y_SPACING = 47;      // pixels (not scaled, used for division)
    int32 constant TILE_RENDER_WIDTH_HALF = 100; // 100px / 2 = 50 (scaled = 5000, but we use 100 in calc)
    // Calculated: ((34 * 200 / 166) + 47) * 100 = (40.96 + 47) * 100 = 8796
    // MUST match TypeScript simulation.ts TILE_CENTER_Y_OFFSET calculation
    int32 constant TILE_CENTER_Y_OFFSET = 8796;
    
    // ========== STRUCTS ==========
    
    /**
     * @notice Packed agent data structure
     * @dev Fits into 2 storage slots for gas efficiency
     */
    struct Agent {
        int32 x;           // World X position (fixed-point x100)
        int32 y;           // World Y position (fixed-point x100)
        uint8 direction;   // 0=north, 1=east, 2=south, 3=west
        uint8 team;        // Team index (0-11)
        uint8 vehicleType; // Vehicle type index (0-11)
        int32 spawnX;      // Spawn X position (for comms units)
        int32 spawnY;      // Spawn Y position (for comms units)
    }
    
    /**
     * @notice Game state containing all agents and map info
     */
    struct GameState {
        // Agent storage
        Agent[] agents;
        uint32 agentCount;
        
        // Team spawn points (home bases) - fixed-point x100
        int32[12] teamSpawnX;
        int32[12] teamSpawnY;
        
        // Map parameters
        int32 centerX;     // Map center X (fixed-point x100)
        uint16 gridSize;   // Grid size (e.g., 111)
        
        // Terrain grid - stored as packed bits (1 = ground, 0 = mountain)
        // Each uint256 stores 256 terrain bits
        mapping(uint256 => uint256) terrainBits;
        
        // Dice state
        bytes32 entropy;
        uint8 dicePosition;
        
        // Current round
        uint32 currentRound;
    }
    
    // ========== DIRECTION HELPERS ==========
    
    function getDirectionDX(uint8 dir) internal pure returns (int32) {
        if (dir == 0) return DIRECTION_DX_0;
        if (dir == 1) return DIRECTION_DX_1;
        if (dir == 2) return DIRECTION_DX_2;
        return DIRECTION_DX_3;
    }
    
    function getDirectionDY(uint8 dir) internal pure returns (int32) {
        if (dir == 0) return DIRECTION_DY_0;
        if (dir == 1) return DIRECTION_DY_1;
        if (dir == 2) return DIRECTION_DY_2;
        return DIRECTION_DY_3;
    }
    
    /**
     * @notice Get movement speed for a vehicle type
     * @param vehicleType Vehicle type index (0-11)
     * @return speed Movement speed (x100 scaled)
     */
    function getMoveSpeed(uint8 vehicleType) internal pure returns (uint16) {
        // Heavy vehicles (0-5) move slower than light vehicles (6-11)
        return vehicleType < 6 ? HEAVY_MOVE_SPEED : LIGHT_MOVE_SPEED;
    }
    
    /**
     * @notice Check if a vehicle type is a comms unit
     * @param vehicleType Vehicle type index (0-11)
     * @return isComms True if the vehicle is a comms unit
     */
    function isCommsUnit(uint8 vehicleType) internal pure returns (bool) {
        // Types 0 (heavy_comms) and 6 (light_comms) are comms units
        return vehicleType == 0 || vehicleType == 6;
    }
    
    /**
     * @notice Get comms range for a vehicle type
     * @param vehicleType Vehicle type index (0-11)
     * @return range Comms range (x100 scaled), 0 if not a comms unit
     */
    function getCommsRange(uint8 vehicleType) internal pure returns (uint32) {
        return isCommsUnit(vehicleType) ? COMMS_RANGE : 0;
    }
    
    /**
     * @notice Convert delta vector to direction index
     * @dev Matches TypeScript getDirectionFromDelta
     * @param dx X delta
     * @param dy Y delta
     * @return direction Direction index (0-3)
     */
    function getDirectionFromDelta(int32 dx, int32 dy) internal pure returns (uint8) {
        if (dx >= 0 && dy < 0) return 0;  // north (top-right)
        if (dx >= 0 && dy >= 0) return 1; // east (bottom-right)
        if (dx < 0 && dy >= 0) return 2;  // south (bottom-left)
        return 3; // west (top-left)
    }
    
    // ========== COORDINATE CONVERSION ==========
    
    /**
     * @notice Convert world coordinates to tile coordinates
     * @dev Matches TypeScript worldToTile exactly
     * @param worldX World X coordinate (fixed-point x100)
     * @param worldY World Y coordinate (fixed-point x100)
     * @param centerX Map center X (fixed-point x100)
     * @return row Tile row
     * @return col Tile column
     */
    function worldToTile(int32 worldX, int32 worldY, int32 centerX) 
        internal 
        pure 
        returns (int32 row, int32 col) 
    {
        // Account for tile center offsets
        int32 adjustedX = worldX - int32(TILE_RENDER_WIDTH_HALF * 100); // 10000
        int32 adjustedY = worldY - TILE_CENTER_Y_OFFSET;
        
        // Calculate colMinusRow and colPlusRow with rounding
        // Using 8900 for TILE_X_SPACING_SCALED and 4700 for TILE_Y_SPACING_SCALED
        int32 colMinusRow = roundedDiv(adjustedX - centerX, 8900);
        int32 colPlusRow = roundedDiv(adjustedY, 4700);
        
        // Integer divide by 2 using bit shift
        col = (colMinusRow + colPlusRow) >> 1;
        row = (colPlusRow - colMinusRow) >> 1;
    }
    
    /**
     * @notice Integer division with rounding (matches JS Math.floor behavior)
     * @param a Numerator
     * @param b Denominator (must be positive)
     * @return Rounded result matching JS: Math.floor((a ± b/2) / b)
     * @dev For negative division, we need floor (toward -infinity), not truncation (toward 0)
     */
    function roundedDiv(int32 a, int32 b) internal pure returns (int32) {
        if (a >= 0) {
            // For positive: truncation = floor, so this is fine
            return (a + b / 2) / b;
        } else {
            // For negative: Solidity truncates toward 0, but JS floors toward -infinity
            // To match JS: if there's a remainder, subtract 1 from quotient
            int32 numerator = a - b / 2;
            int32 quotient = numerator / b;
            int32 remainder = numerator % b;
            // Floor: if negative and has remainder, round down (more negative)
            if (remainder != 0) {
                quotient -= 1;
            }
            return quotient;
        }
    }
    
    // ========== TERRAIN HELPERS ==========
    
    /**
     * @notice Set terrain type for a tile
     * @param state Game state
     * @param row Tile row
     * @param col Tile column  
     * @param groundTerrain True if ground, false if mountain
     */
    function setTerrain(
        GameState storage state,
        uint16 row,
        uint16 col,
        bool groundTerrain
    ) internal {
        uint256 index = uint256(row) * state.gridSize + col;
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        
        if (groundTerrain) {
            state.terrainBits[wordIndex] |= (1 << bitIndex);
        } else {
            state.terrainBits[wordIndex] &= ~(1 << bitIndex);
        }
    }
    
    /**
     * @notice Check if a tile is ground terrain
     * @param state Game state
     * @param row Tile row
     * @param col Tile column
     * @return True if ground, false if mountain
     */
    function isGround(GameState storage state, int32 row, int32 col) internal view returns (bool) {
        // Bounds check
        if (row < 0 || col < 0 || uint32(row) >= state.gridSize || uint32(col) >= state.gridSize) {
            return false;
        }
        
        uint256 index = uint256(uint32(row)) * state.gridSize + uint256(uint32(col));
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        
        return (state.terrainBits[wordIndex] & (1 << bitIndex)) != 0;
    }
    
    /**
     * @notice Check if a world position is on ground terrain
     * @param state Game state
     * @param worldX World X coordinate (fixed-point x100)
     * @param worldY World Y coordinate (fixed-point x100)
     * @return True if on ground
     */
    function isPointOnGround(GameState storage state, int32 worldX, int32 worldY) internal view returns (bool) {
        (int32 row, int32 col) = worldToTile(worldX, worldY, state.centerX);
        return isGround(state, row, col);
    }
    
    /**
     * @notice Check if a world position is within map bounds
     * @param worldX World X coordinate (fixed-point x100)
     * @param worldY World Y coordinate (fixed-point x100)
     * @param centerX Map center X (fixed-point x100)
     * @param gridSize Grid size
     * @return True if within bounds
     */
    function isWithinBounds(int32 worldX, int32 worldY, int32 centerX, uint16 gridSize) 
        internal 
        pure 
        returns (bool) 
    {
        (int32 row, int32 col) = worldToTile(worldX, worldY, centerX);
        
        int32 margin = 2;
        int32 maxCoord = int32(uint32(gridSize)) - margin;
        
        return row >= margin && row < maxCoord && col >= margin && col < maxCoord;
    }
    
    /**
     * @notice Check if a position is traversable (within bounds and on ground)
     * @param state Game state
     * @param worldX World X coordinate (fixed-point x100)
     * @param worldY World Y coordinate (fixed-point x100)
     * @param direction Movement direction for lookahead
     * @return True if traversable
     */
    function isTraversable(
        GameState storage state,
        int32 worldX,
        int32 worldY,
        uint8 direction
    ) internal view returns (bool) {
        // Check center point
        if (!isPointOnGround(state, worldX, worldY)) {
            return false;
        }
        
        // Check padding distance ahead in movement direction
        int32 aheadX = worldX + getDirectionDX(direction) * int32(uint32(VEHICLE_COLLISION_PADDING));
        int32 aheadY = worldY + getDirectionDY(direction) * int32(uint32(VEHICLE_COLLISION_PADDING));
        
        return isPointOnGround(state, aheadX, aheadY);
    }
    
    // ========== AGENT MANAGEMENT ==========
    
    /**
     * @notice Add a new agent to the game
     * @param state Game state
     * @param x World X coordinate (will be converted to fixed-point)
     * @param y World Y coordinate (will be converted to fixed-point)
     * @param direction Direction index (0-3)
     * @param team Team index (0-11)
     * @param vehicleType Vehicle type index (0-11)
     * @return index Index of the new agent
     */
    function addAgent(
        GameState storage state,
        int256 x,
        int256 y,
        uint8 direction,
        uint8 team,
        uint8 vehicleType
    ) internal returns (uint32 index) {
        // Convert to fixed-point
        int32 fixedX = int32(x * int256(uint256(FIXED_POINT_SCALE)));
        int32 fixedY = int32(y * int256(uint256(FIXED_POINT_SCALE)));
        
        Agent memory agent = Agent({
            x: fixedX,
            y: fixedY,
            direction: direction,
            team: team,
            vehicleType: vehicleType,
            spawnX: fixedX,
            spawnY: fixedY
        });
        
        state.agents.push(agent);
        index = state.agentCount;
        state.agentCount++;
    }
    
    /**
     * @notice Add a new agent with fixed-point coordinates (already scaled)
     * @param state Game state
     * @param fixedX World X coordinate (already fixed-point x100)
     * @param fixedY World Y coordinate (already fixed-point x100)
     * @param direction Direction index (0-3)
     * @param team Team index (0-11)
     * @param vehicleType Vehicle type index (0-11)
     * @return index Index of the new agent
     */
    function addAgentFixed(
        GameState storage state,
        int32 fixedX,
        int32 fixedY,
        uint8 direction,
        uint8 team,
        uint8 vehicleType
    ) internal returns (uint32 index) {
        Agent memory agent = Agent({
            x: fixedX,
            y: fixedY,
            direction: direction,
            team: team,
            vehicleType: vehicleType,
            spawnX: fixedX,
            spawnY: fixedY
        });
        
        state.agents.push(agent);
        index = state.agentCount;
        state.agentCount++;
    }
    
    /**
     * @notice Set team spawn point (home base)
     * @param state Game state
     * @param teamIndex Team index (0-11)
     * @param x World X coordinate (will be converted to fixed-point)
     * @param y World Y coordinate (will be converted to fixed-point)
     */
    function setTeamSpawn(
        GameState storage state,
        uint8 teamIndex,
        int256 x,
        int256 y
    ) internal {
        require(teamIndex < MAX_TEAMS, "Invalid team index");
        state.teamSpawnX[teamIndex] = int32(x * int256(uint256(FIXED_POINT_SCALE)));
        state.teamSpawnY[teamIndex] = int32(y * int256(uint256(FIXED_POINT_SCALE)));
    }
    
    /**
     * @notice Set team spawn point with fixed-point coordinates
     * @param state Game state
     * @param teamIndex Team index (0-11)
     * @param fixedX World X coordinate (already fixed-point x100)
     * @param fixedY World Y coordinate (already fixed-point x100)
     */
    function setTeamSpawnFixed(
        GameState storage state,
        uint8 teamIndex,
        int32 fixedX,
        int32 fixedY
    ) internal {
        require(teamIndex < MAX_TEAMS, "Invalid team index");
        state.teamSpawnX[teamIndex] = fixedX;
        state.teamSpawnY[teamIndex] = fixedY;
    }
    
    /**
     * @notice Initialize map parameters
     * @param state Game state
     * @param centerX Map center X (will be converted to fixed-point)
     * @param gridSize Grid size (e.g., 111)
     */
    function initMap(
        GameState storage state,
        int256 centerX,
        uint16 gridSize
    ) internal {
        state.centerX = int32(centerX * int256(uint256(FIXED_POINT_SCALE)));
        state.gridSize = gridSize;
    }
    
    /**
     * @notice Initialize dice state
     * @param state Game state
     * @param seed Initial seed
     */
    function initDice(GameState storage state, bytes32 seed) internal {
        state.entropy = seed;
        state.dicePosition = 0;
    }
    
    /**
     * @notice Get agent data
     * @param state Game state
     * @param index Agent index
     * @return agent Agent data
     */
    function getAgent(GameState storage state, uint32 index) internal view returns (Agent memory) {
        require(index < state.agentCount, "Agent index out of bounds");
        return state.agents[index];
    }
    
    /**
     * @notice Get all agents (for external read)
     * @param state Game state
     * @return agents Array of all agents
     */
    function getAllAgents(GameState storage state) internal view returns (Agent[] memory) {
        return state.agents;
    }
    
    /**
     * @notice Reset game state (clear all agents)
     * @param state Game state
     */
    function reset(GameState storage state) internal {
        delete state.agents;
        state.agentCount = 0;
        state.currentRound = 0;
        state.dicePosition = 0;
        // Note: terrain and team spawns are not reset
    }
}

