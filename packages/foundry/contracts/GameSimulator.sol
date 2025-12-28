// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./AgentStorage.sol";
import "./DeterministicDice.sol";

/**
 * @title GameSimulator
 * @notice Simulates game rounds deterministically, matching TypeScript logic exactly.
 * @dev Uses fixed-point x100 math and deterministic dice for JS/Solidity parity.
 *      
 *      The simulation can be run in batches to avoid gas limits:
 *      1. Initialize game with seed, terrain, and spawn points
 *      2. Call simulateRounds(n) to simulate n rounds
 *      3. State is persisted between calls
 *      4. Continue calling simulateRounds until complete
 */
contract GameSimulator {
    using AgentStorage for AgentStorage.GameState;
    using DeterministicDice for DeterministicDice.Dice;
    
    // ========== CONSTANTS ==========
    
    /// @notice Fixed-point scale factor
    int32 constant FIXED_POINT_SCALE = 100;
    
    /// @notice Collision Y offset (8px * 100)
    int32 constant VEHICLE_COLLISION_Y_OFFSET = 800;
    
    // ========== STATE ==========
    
    /// @notice The game state (agents, terrain, etc.)
    AgentStorage.GameState public gameState;
    
    /// @notice Game seed for verification
    bytes32 public gameSeed;
    
    /// @notice Whether the game has been initialized
    bool public initialized;
    
    // ========== EVENTS ==========
    
    event GameInitialized(bytes32 indexed seed, uint16 gridSize, uint32 numTeams);
    event RoundsSimulated(uint32 fromRound, uint32 toRound, uint32 agentCount);
    event AgentSpawned(uint32 indexed agentIndex, uint8 team, uint8 vehicleType, int32 x, int32 y);
    
    // ========== INITIALIZATION ==========
    
    /**
     * @notice Initialize a new game
     * @param seed The game seed (determines all random outcomes)
     * @param gridSize Size of the terrain grid (e.g., 111)
     * @param centerX Map center X coordinate (world coordinates, not scaled)
     */
    function initGame(
        bytes32 seed,
        uint16 gridSize,
        int256 centerX
    ) external {
        require(!initialized, "Already initialized");
        
        gameSeed = seed;
        gameState.initMap(centerX, gridSize);
        gameState.initDice(seed);
        
        initialized = true;
        emit GameInitialized(seed, gridSize, 0);
    }
    
    /**
     * @notice Set terrain for a batch of tiles
     * @dev Call multiple times if terrain is large
     * @param startRow Starting row
     * @param startCol Starting column
     * @param terrainData Packed terrain data (1 bit per tile, 1=ground, 0=mountain)
     * @param width Number of columns in this batch
     */
    function setTerrainBatch(
        uint16 startRow,
        uint16 startCol,
        bytes calldata terrainData,
        uint16 width
    ) external {
        require(initialized, "Not initialized");
        
        uint256 bitIndex = 0;
        for (uint16 r = startRow; r < startRow + uint16(terrainData.length * 8 / width); r++) {
            for (uint16 c = startCol; c < startCol + width && bitIndex < terrainData.length * 8; c++) {
                uint256 byteIndex = bitIndex / 8;
                uint256 bitOffset = bitIndex % 8;
                bool isGround = (uint8(terrainData[byteIndex]) & (1 << bitOffset)) != 0;
                gameState.setTerrain(r, c, isGround);
                bitIndex++;
            }
        }
    }
    
    /**
     * @notice Set terrain for a single row (easier to call from tests)
     * @param row Row index
     * @param terrainData Array of bools (true=ground, false=mountain)
     */
    function setTerrainRow(uint16 row, bool[] calldata terrainData) external {
        require(initialized, "Not initialized");
        
        for (uint16 col = 0; col < terrainData.length; col++) {
            gameState.setTerrain(row, col, terrainData[col]);
        }
    }
    
    /**
     * @notice Set a team's spawn point
     * @param teamIndex Team index (0-11)
     * @param x World X coordinate (not scaled)
     * @param y World Y coordinate (not scaled)
     */
    function setTeamSpawn(uint8 teamIndex, int256 x, int256 y) external {
        require(initialized, "Not initialized");
        gameState.setTeamSpawn(teamIndex, x, y);
    }
    
    /**
     * @notice Add an agent to the game
     * @param x World X coordinate (not scaled)
     * @param y World Y coordinate (not scaled)
     * @param direction Initial direction (0-3)
     * @param team Team index (0-11)
     * @param vehicleType Vehicle type index (0-11)
     */
    function addAgent(
        int256 x,
        int256 y,
        uint8 direction,
        uint8 team,
        uint8 vehicleType
    ) external returns (uint32) {
        require(initialized, "Not initialized");
        
        uint32 index = gameState.addAgent(x, y, direction, team, vehicleType);
        
        int32 fixedX = int32(x * int256(uint256(uint32(FIXED_POINT_SCALE))));
        int32 fixedY = int32(y * int256(uint256(uint32(FIXED_POINT_SCALE))));
        emit AgentSpawned(index, team, vehicleType, fixedX, fixedY);
        
        return index;
    }
    
    // ========== SIMULATION ==========
    
    /**
     * @notice Simulate a batch of rounds
     * @param numRounds Number of rounds to simulate
     */
    function simulateRounds(uint32 numRounds) external {
        require(initialized, "Not initialized");
        
        uint32 startRound = gameState.currentRound;
        uint32 endRound = startRound + numRounds;
        
        // Create dice from current state
        DeterministicDice.Dice memory dice = DeterministicDice.Dice({
            entropy: gameState.entropy,
            position: gameState.dicePosition
        });
        
        // Simulate each round
        for (uint32 round = startRound; round < endRound; round++) {
            dice = _simulateSingleRound(dice);
        }
        
        // Save dice state back
        gameState.entropy = dice.entropy;
        gameState.dicePosition = dice.position;
        gameState.currentRound = endRound;
        
        emit RoundsSimulated(startRound, endRound, gameState.agentCount);
    }
    
    /**
     * @notice Simulate a single round (updates all agents once)
     * @param dice Current dice state
     * @return Updated dice state
     */
    function _simulateSingleRound(DeterministicDice.Dice memory dice) 
        internal 
        returns (DeterministicDice.Dice memory) 
    {
        uint32 count = gameState.agentCount;
        
        for (uint32 i = 0; i < count; i++) {
            // Always roll dice for determinism
            uint256 action;
            (action, dice) = dice.roll(16);
            
            // Update agent based on type
            AgentStorage.Agent storage agent = gameState.agents[i];
            
            if (AgentStorage.isCommsUnit(agent.vehicleType)) {
                _updateCommsUnit(i, uint8(action));
            } else {
                _updateNormalAgent(i, uint8(action));
            }
        }
        
        return dice;
    }
    
    /// @notice Comms distance thresholds (packed to reduce stack)
    struct CommsThresholds {
        uint64 rangeSq;
        uint64 repelDistSq;
        uint64 attractDistSq;
    }
    
    /**
     * @notice Update a comms unit using gravity-based behavior
     * @dev Uses squared distances to avoid sqrt operations. 
     */
    function _updateCommsUnit(uint32 agentIndex, uint8 action) internal {
        AgentStorage.Agent storage agent = gameState.agents[agentIndex];
        
        // Get accumulated direction from all connections
        (int32 totalDx, int32 totalDy) = _getCommsDirection(agentIndex, action);
        
        // Apply movement if there's a net direction
        if (totalDx != 0 || totalDy != 0) {
            agent.direction = AgentStorage.getDirectionFromDelta(totalDx, totalDy);
            _moveAgent(agent);
        }
    }
    
    /**
     * @notice Calculate comms distance thresholds
     */
    function _getCommsThresholds(uint32 commsRange) internal pure returns (CommsThresholds memory t) {
        uint64 r = uint64(commsRange);
        t.rangeSq = r * r;
        t.repelDistSq = ((r * 40) / 100) * ((r * 40) / 100);
        t.attractDistSq = ((r * 80) / 100) * ((r * 80) / 100);
    }
    
    /**
     * @notice Calculate the net direction for a comms unit from all connections
     */
    function _getCommsDirection(uint32 agentIndex, uint8 action) 
        internal 
        view 
        returns (int32 totalDx, int32 totalDy) 
    {
        AgentStorage.Agent storage agent = gameState.agents[agentIndex];
        CommsThresholds memory t = _getCommsThresholds(AgentStorage.getCommsRange(agent.vehicleType));
        
        // Process home base
        (totalDx, totalDy) = _processConn(
            agent.x, agent.y,
            gameState.teamSpawnX[agent.team],
            gameState.teamSpawnY[agent.team],
            t, action
        );
        
        // Process other comms units on same team
        for (uint32 j = 0; j < gameState.agentCount; j++) {
            if (j == agentIndex) continue;
            AgentStorage.Agent storage other = gameState.agents[j];
            if (other.team != agent.team || !AgentStorage.isCommsUnit(other.vehicleType)) continue;
            
            (int32 dx, int32 dy) = _processConn(agent.x, agent.y, other.x, other.y, t, action);
            totalDx += dx;
            totalDy += dy;
        }
    }
    
    /**
     * @notice Process a single connection point for comms gravity
     */
    function _processConn(
        int32 myX, int32 myY, int32 connX, int32 connY,
        CommsThresholds memory t, uint8 action
    ) internal pure returns (int32 dx, int32 dy) {
        int64 deltaX = int64(connX) - int64(myX);
        int64 deltaY = int64(connY) - int64(myY);
        uint64 distSq = uint64(deltaX * deltaX + deltaY * deltaY);
        
        // On top of connection - random push
        if (distSq < 10000) {
            uint8 randomDir = action % 4;
            return (-AgentStorage.getDirectionDX(randomDir), -AgentStorage.getDirectionDY(randomDir));
        }
        
        // Out of range
        if (distSq > t.rangeSq) return (0, 0);
        
        // Repel if too close
        if (distSq < t.repelDistSq) {
            dx = deltaX > 0 ? int32(-1) : deltaX < 0 ? int32(1) : int32(0);
            dy = deltaY > 0 ? int32(-1) : deltaY < 0 ? int32(1) : int32(0);
        } 
        // Attract if too far
        else if (distSq > t.attractDistSq) {
            dx = deltaX > 0 ? int32(1) : deltaX < 0 ? int32(-1) : int32(0);
            dy = deltaY > 0 ? int32(1) : deltaY < 0 ? int32(-1) : int32(0);
        }
    }
    
    /**
     * @notice Move an agent forward in its current direction
     */
    function _moveAgent(AgentStorage.Agent storage agent) internal {
        int32 myX = agent.x;
        int32 myY = agent.y;
        uint8 dir = agent.direction;
        int32 moveSpeed = int32(uint32(AgentStorage.getMoveSpeed(agent.vehicleType)));
        
        int32 newX = myX + (AgentStorage.getDirectionDX(dir) * moveSpeed) / FIXED_POINT_SCALE;
        int32 newY = myY + (AgentStorage.getDirectionDY(dir) * moveSpeed) / FIXED_POINT_SCALE;
        int32 collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;
        
        bool inBounds = AgentStorage.isWithinBounds(newX, collisionY, gameState.centerX, gameState.gridSize);
        bool canMove = inBounds && gameState.isTraversable(newX, collisionY, dir);
        
        if (canMove) {
            agent.x = newX;
            agent.y = newY;
        } else {
            // Turn around and move
            agent.direction = (dir + 2) % 4;
            agent.x = myX + (AgentStorage.getDirectionDX(agent.direction) * moveSpeed) / FIXED_POINT_SCALE;
            agent.y = myY + (AgentStorage.getDirectionDY(agent.direction) * moveSpeed) / FIXED_POINT_SCALE;
        }
    }
    
    /**
     * @notice Update a normal (non-comms) agent
     */
    function _updateNormalAgent(uint32 agentIndex, uint8 action) internal {
        AgentStorage.Agent storage agent = gameState.agents[agentIndex];
        
        if (action <= 9) {
            // Move forward (62.5% chance)
            _moveAgent(agent);
        } else if (action <= 12) {
            // Turn left (18.75% chance)
            agent.direction = (agent.direction + 3) % 4;
        } else {
            // Turn right (18.75% chance)
            agent.direction = (agent.direction + 1) % 4;
        }
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    function getCurrentRound() external view returns (uint32) {
        return gameState.currentRound;
    }
    
    function getAgentCount() external view returns (uint32) {
        return gameState.agentCount;
    }
    
    function getAgent(uint32 index) external view returns (AgentStorage.Agent memory) {
        return gameState.getAgent(index);
    }
    
    function getAllAgents() external view returns (AgentStorage.Agent[] memory) {
        return gameState.getAllAgents();
    }
    
    function getDiceState() external view returns (bytes32 entropy, uint8 position) {
        return (gameState.entropy, gameState.dicePosition);
    }
    
    function isGroundTile(int32 row, int32 col) external view returns (bool) {
        return gameState.isGround(row, col);
    }
    
    function getMapParams() external view returns (int32 centerX, uint16 gridSize) {
        return (gameState.centerX, gameState.gridSize);
    }
    
    function getTeamSpawn(uint8 teamIndex) external view returns (int32 x, int32 y) {
        require(teamIndex < 12, "Invalid team index");
        return (gameState.teamSpawnX[teamIndex], gameState.teamSpawnY[teamIndex]);
    }
}
