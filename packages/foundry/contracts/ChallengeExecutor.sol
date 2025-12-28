// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./AgentStorage.sol";
import "./DeterministicDice.sol";
import "./MapGenerator.sol";
import "./GameFactory.sol";

/**
 * @title ChallengeExecutor
 * @notice Executes on-chain game simulations for challenge verification.
 * @dev Simplified single-team version. Uses mushroom bitmap for gas efficiency.
 *      
 *      Security: The terrain hash is computed once in startChallenge() and stored.
 *      Mushroom locations are stored as a bitmap (4 x uint256 = 1024 bits).
 *      This eliminates expensive terrain regeneration during simulation batches.
 *      
 *      Challenge flow:
 *      1. Challenger calls GameFactory.challengeResult(gameId) with stake
 *      2. Challenger calls startChallenge(gameId) - generates terrain, stores mushroom bitmap
 *      3. Challenger calls simulateBatch() multiple times - uses bitmap, no terrain regen
 *      4. Challenger calls finalize() to resolve challenge
 */
contract ChallengeExecutor {
    using AgentStorage for AgentStorage.GameState;
    using DeterministicDice for DeterministicDice.Dice;
    
    // ========== CONSTANTS ==========
    
    int32 constant FIXED_POINT_SCALE = 100;
    int32 constant VEHICLE_COLLISION_Y_OFFSET = 800;
    uint16 constant GRID_SIZE = 32;
    uint32 constant MAX_ROUNDS = 100;
    uint32 constant SPAWN_INTERVAL = 5;
    // Must match Oracle: 1 initial agent + 20 spawns (at rounds 5,10,15,...,100) = 21 total
    uint32 constant MAX_AGENTS = 21;
    
    int32 constant TILE_X_SPACING = 89;
    int32 constant TILE_Y_SPACING = 47;
    int32 constant TILE_RENDER_WIDTH = 200;
    
    uint8 constant HEAVY_COMMS = 0;
    uint8 constant LIGHT_COMMS = 6;
    
    // ========== STATE ==========
    
    GameFactory public immutable gameFactory;
    MapGenerator public immutable mapGenerator;
    
    struct ChallengeState {
        bool initialized;
        bool finalized;
        address challenger;
        bytes32 seed;
        int32 spawnX;
        int32 spawnY;
        int32 centerX;
        uint32 currentRound;
        uint32 agentCount;
        bytes32 terrainHash;
        uint256 tilesDiscovered;
        uint256 mushroomsFound;
    }
    
    mapping(uint256 => ChallengeState) public challenges;
    mapping(uint256 => AgentStorage.GameState) internal gameStates;
    mapping(uint256 => mapping(uint256 => bool)) internal discoveredTiles;
    
    // Mushroom bitmap: 4 x uint256 = 1024 bits for 32x32 grid
    // Bit index = row * 32 + col
    mapping(uint256 => uint256[4]) internal mushroomBitmap;
    
    // ========== EVENTS ==========
    
    event ChallengeStarted(uint256 indexed gameId, address indexed challenger, bytes32 seed);
    event BatchSimulated(uint256 indexed gameId, uint32 fromRound, uint32 toRound, uint32 agentCount);
    event ChallengeFinalized(uint256 indexed gameId, bytes32 resultHash, uint256 payout, bool oracleCorrect);
    
    // ========== ERRORS ==========
    
    error ChallengeAlreadyInitialized();
    error ChallengeNotInitialized();
    error ChallengeAlreadyFinalized();
    error GameNotChallenged();
    error SimulationNotComplete();
    
    // ========== CONSTRUCTOR ==========
    
    constructor(address _gameFactory, address _mapGenerator) {
        gameFactory = GameFactory(payable(_gameFactory));
        mapGenerator = MapGenerator(_mapGenerator);
    }
    
    // ========== CHALLENGE FUNCTIONS ==========
    
    /**
     * @notice Start a challenge - initializes state, computes terrain hash, stores mushroom bitmap
     * @dev Terrain is generated once here. Mushroom locations are stored as bitmap for efficient lookup.
     *      Spawn point is generated using same dice pattern as Oracle for parity.
     */
    function startChallenge(uint256 gameId) external {
        (, , , GameFactory.GameStatus status) = gameFactory.getGame(gameId);
        if (status != GameFactory.GameStatus.Challenged) revert GameNotChallenged();
        
        ChallengeState storage challenge = challenges[gameId];
        if (challenge.initialized) revert ChallengeAlreadyInitialized();
        
        (, , bytes32 seed, ) = gameFactory.getGame(gameId);
        (, , , , address challenger, ) = gameFactory.getGameResult(gameId);
        
        // Calculate map center (in fixed-point, scaled by 100)
        // mapWidth in pixels: GRID_SIZE * 2 * TILE_X_SPACING + TILE_RENDER_WIDTH = 32 * 2 * 89 + 200 = 5896
        // centerX in pixels: mapWidth / 2 - TILE_RENDER_WIDTH / 2 = 5896/2 - 100 = 2848
        // centerX in fixed-point: 2848 * 100 = 284800
        uint256 mapWidth = uint256(GRID_SIZE) * 2 * uint256(uint32(TILE_X_SPACING)) + uint256(uint32(TILE_RENDER_WIDTH));
        int32 centerXPixels = int32(int256(mapWidth / 2 - uint256(uint32(TILE_RENDER_WIDTH)) / 2));
        int32 centerX = centerXPixels * FIXED_POINT_SCALE; // Convert to fixed-point
        
        // Generate terrain to compute hash and build mushroom bitmap
        MapGenerator.TerrainType[][] memory terrain = mapGenerator.generateMap(seed, GRID_SIZE);
        bytes32 terrainHash = keccak256(abi.encode(terrain));
        
        // Generate spawn point using same dice pattern as Oracle
        // Oracle: keccak256(encodePacked(['bytes32', 'string'], [seed, 'spawn-points']))
        bytes32 spawnDiceSeed = keccak256(abi.encodePacked(seed, "spawn-points"));
        (int32 spawnX, int32 spawnY) = _generateSpawnPoint(spawnDiceSeed, centerX, terrain);
        
        // Store mushroom locations as bitmap (4 x uint256 = 1024 bits)
        _buildMushroomBitmap(gameId, terrain);
        
        // Initialize challenge state
        challenge.initialized = true;
        challenge.challenger = challenger;
        challenge.seed = seed;
        challenge.spawnX = spawnX;
        challenge.spawnY = spawnY;
        challenge.centerX = centerX;
        challenge.currentRound = 0;
        challenge.terrainHash = terrainHash;
        
        // Initialize game state
        AgentStorage.GameState storage state = gameStates[gameId];
        // Note: initMap multiplies centerX by FIXED_POINT_SCALE, so pass pixels not fixed-point
        state.initMap(int256(centerXPixels), GRID_SIZE);
        state.initDice(seed);
        state.setTeamSpawnFixed(0, spawnX, spawnY);
        
        // Build terrain bitmap (ground tiles) - CRITICAL for agent movement!
        _buildTerrainBitmap(gameId, terrain);
        
        // Spawn first agent and reveal initial tiles
        _spawnFirstAgent(gameId, terrain);
        challenge.agentCount = state.agentCount;
        
        emit ChallengeStarted(gameId, challenger, seed);
    }
    
    /**
     * @notice Build mushroom bitmap from terrain
     * @dev Packs 256 tiles per uint256 slot
     */
    function _buildMushroomBitmap(uint256 gameId, MapGenerator.TerrainType[][] memory terrain) internal {
        uint256[4] storage bitmap = mushroomBitmap[gameId];
        
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            for (uint16 col = 0; col < GRID_SIZE; col++) {
                if (terrain[row][col] == MapGenerator.TerrainType.Mushroom) {
                    uint256 bitIndex = uint256(row) * GRID_SIZE + uint256(col);
                    uint256 slotIndex = bitIndex / 256;
                    uint256 bitPosition = bitIndex % 256;
                    bitmap[slotIndex] |= (1 << bitPosition);
                }
            }
        }
    }
    
    /**
     * @notice Build terrain bitmap (ground tiles) from terrain
     * @dev Stores which tiles are ground (traversable) in GameState.terrainBits
     *      This is CRITICAL for agent movement - without it, isGround() always returns false!
     */
    function _buildTerrainBitmap(uint256 gameId, MapGenerator.TerrainType[][] memory terrain) internal {
        AgentStorage.GameState storage state = gameStates[gameId];
        
        for (uint16 row = 0; row < GRID_SIZE; row++) {
            for (uint16 col = 0; col < GRID_SIZE; col++) {
                // Ground tiles are traversable
                bool isGround = terrain[row][col] == MapGenerator.TerrainType.Ground;
                state.setTerrain(row, col, isGround);
            }
        }
    }
    
    /**
     * @notice Check if a tile is a mushroom using bitmap
     */
    function _isMushroom(uint256 gameId, uint16 row, uint16 col) internal view returns (bool) {
        uint256 bitIndex = uint256(row) * GRID_SIZE + uint256(col);
        uint256 slotIndex = bitIndex / 256;
        uint256 bitPosition = bitIndex % 256;
        return (mushroomBitmap[gameId][slotIndex] & (1 << bitPosition)) != 0;
    }
    
    /**
     * @notice Generate a spawn point - simple: start at center, find ground tile
     * @dev Start at center tile, if not ground, search randomly nearby
     */
    function _generateSpawnPoint(
        bytes32 spawnDiceSeed,
        int32 centerX,
        MapGenerator.TerrainType[][] memory terrain
    ) internal pure returns (int32 spawnX, int32 spawnY) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(spawnDiceSeed);
        
        // Start at center tile
        uint16 centerTile = GRID_SIZE / 2;
        uint16 row = centerTile;
        uint16 col = centerTile;
        
        // If center isn't ground, search randomly for a ground tile
        if (terrain[row][col] != MapGenerator.TerrainType.Ground) {
            for (uint256 attempts = 0; attempts < 100; attempts++) {
                // Random offset from center (-5 to +5)
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
        
        // Convert to world coordinates
        (spawnX, spawnY) = _tileCenterToWorld(int32(uint32(row)), int32(uint32(col)), centerX);
    }
    
    /**
     * @notice Simulate a batch of rounds
     * @dev NO terrain regeneration - uses stored mushroom bitmap for efficiency
     *      IMPORTANT: Creates a NEW dice per round to match Oracle behavior!
     *      Oracle uses: new DeterministicDice(keccak256(seed + "round" + round))
     */
    function simulateBatch(uint256 gameId, uint32 numRounds) external {
        ChallengeState storage challenge = challenges[gameId];
        if (!challenge.initialized) revert ChallengeNotInitialized();
        if (challenge.finalized) revert ChallengeAlreadyFinalized();
        
        AgentStorage.GameState storage state = gameStates[gameId];
        
        uint32 startRound = challenge.currentRound;
        uint32 endRound = startRound + numRounds;
        if (endRound > MAX_ROUNDS) {
            endRound = MAX_ROUNDS;
        }
        
        // Simulate rounds - NO terrain regeneration needed!
        // Create a NEW dice per round to match Oracle behavior
        for (uint32 round = startRound; round < endRound; round++) {
            // Oracle creates: new DeterministicDice(keccak256(toHex(seed + "round" + round)))
            bytes32 roundSeed = _makeRoundSeed(challenge.seed, round, "round");
            DeterministicDice.Dice memory roundDice = DeterministicDice.create(roundSeed);
            
            _simulateRoundWithDice(gameId, state, roundDice);
            
            // Spawn new agent every SPAWN_INTERVAL rounds (up to MAX_AGENTS)
            uint32 nextRound = round + 1;
            if (nextRound % SPAWN_INTERVAL == 0 && state.agentCount < MAX_AGENTS) {
                // Oracle creates: new DeterministicDice(keccak256(toHex(seed + "spawn" + round)))
                bytes32 spawnSeed = _makeRoundSeed(challenge.seed, round, "spawn");
                DeterministicDice.Dice memory spawnDice = DeterministicDice.create(spawnSeed);
                _spawnAgentWithDice(gameId, state, spawnDice);
            }
        }
        
        challenge.currentRound = endRound;
        challenge.agentCount = state.agentCount;
        
        emit BatchSimulated(gameId, startRound, endRound, state.agentCount);
    }
    
    /**
     * @notice Finalize the challenge and execute on GameFactory
     */
    function finalize(uint256 gameId) external {
        ChallengeState storage challenge = challenges[gameId];
        if (!challenge.initialized) revert ChallengeNotInitialized();
        if (challenge.finalized) revert ChallengeAlreadyFinalized();
        if (challenge.currentRound < MAX_ROUNDS) revert SimulationNotComplete();
        
        AgentStorage.GameState storage state = gameStates[gameId];
        
        bytes32 positionsHash = _computePositionsHash(state);
        uint256 payout = gameFactory.calculatePayout(challenge.tilesDiscovered, challenge.mushroomsFound);
        bytes32 resultHash = gameFactory.computeResultHash(challenge.terrainHash, positionsHash, payout);
        
        challenge.finalized = true;
        gameFactory.executeChallenge(gameId, resultHash, payout);
        
        (bytes32 oracleResultHash, uint256 oraclePayout, , , , ) = gameFactory.getGameResult(gameId);
        bool oracleCorrect = (oracleResultHash == resultHash && oraclePayout == payout);
        
        emit ChallengeFinalized(gameId, resultHash, payout, oracleCorrect);
    }
    
    // ========== INTERNAL HELPERS ==========
    
    /**
     * @notice Spawn first agent using terrain (only called once in startChallenge)
     */
    function _spawnFirstAgent(uint256 gameId, MapGenerator.TerrainType[][] memory terrain) internal {
        ChallengeState storage challenge = challenges[gameId];
        AgentStorage.GameState storage state = gameStates[gameId];
        
        bytes32 initSeed = keccak256(abi.encodePacked(challenge.seed, "agent-init"));
        DeterministicDice.Dice memory dice = DeterministicDice.create(initSeed);
        
        uint256 dirRoll;
        uint256 typeRoll;
        (dirRoll, dice) = dice.roll(4);
        (typeRoll, dice) = dice.roll(2);
        
        uint8[2] memory commsTypes = [HEAVY_COMMS, LIGHT_COMMS];
        state.addAgentFixed(challenge.spawnX, challenge.spawnY, uint8(dirRoll), 0, commsTypes[typeRoll]);
        
        // Reveal tiles using terrain (only during startChallenge)
        _revealTilesWithTerrain(gameId, terrain, challenge.spawnX, challenge.spawnY, challenge.centerX);
        
        state.entropy = dice.entropy;
        state.dicePosition = dice.position;
    }
    
    /**
     * @notice Spawn agent during simulation with a separate spawn dice
     * @dev Uses a fresh dice to match Oracle behavior (new DeterministicDice per spawn round)
     */
    function _spawnAgentWithDice(
        uint256 gameId,
        AgentStorage.GameState storage state,
        DeterministicDice.Dice memory dice
    ) internal {
        ChallengeState storage challenge = challenges[gameId];
        
        uint256 dirRoll;
        uint256 typeRoll;
        (dirRoll, dice) = dice.roll(4);
        (typeRoll, dice) = dice.roll(2);
        
        uint8[2] memory commsTypes = [HEAVY_COMMS, LIGHT_COMMS];
        state.addAgentFixed(challenge.spawnX, challenge.spawnY, uint8(dirRoll), 0, commsTypes[typeRoll]);
        
        // Reveal tiles using bitmap (no terrain needed)
        _revealTilesWithBitmap(gameId, challenge.spawnX, challenge.spawnY, challenge.centerX);
    }
    
    /**
     * @notice Simulate a single round with a fresh dice (uses bitmap for mushroom detection)
     * @dev The dice is created fresh per round to match Oracle behavior
     */
    function _simulateRoundWithDice(
        uint256 gameId,
        AgentStorage.GameState storage state,
        DeterministicDice.Dice memory dice
    ) internal {
        ChallengeState storage challenge = challenges[gameId];
        uint32 count = state.agentCount;
        
        for (uint32 i = 0; i < count; i++) {
            uint256 action;
            (action, dice) = dice.roll(16);
            
            AgentStorage.Agent storage agent = state.agents[i];
            
            if (AgentStorage.isCommsUnit(agent.vehicleType)) {
                _updateCommsUnit(state, i, uint8(action));
            } else {
                _updateNormalAgent(state, agent, uint8(action));
            }
            
            // Reveal tiles using bitmap (no terrain regeneration)
            _revealTilesWithBitmap(gameId, agent.x, agent.y, challenge.centerX);
        }
        // Note: dice is consumed but not returned - each round uses a fresh dice
    }
    
    /**
     * @notice Reveal tiles using in-memory terrain (only for startChallenge)
     */
    function _revealTilesWithTerrain(
        uint256 gameId,
        MapGenerator.TerrainType[][] memory terrain,
        int32 worldX,
        int32 worldY,
        int32 centerX
    ) internal {
        (int32 row, int32 col) = _worldToTile(worldX, worldY, centerX);
        ChallengeState storage challenge = challenges[gameId];
        
        for (int32 dr = -1; dr <= 1; dr++) {
            for (int32 dc = -1; dc <= 1; dc++) {
                int32 nr = row + dr;
                int32 nc = col + dc;
                
                if (nr >= 0 && nr < int32(uint32(GRID_SIZE)) && nc >= 0 && nc < int32(uint32(GRID_SIZE))) {
                    uint256 tileKey = uint256(uint32(nr)) * GRID_SIZE + uint256(uint32(nc));
                    
                    if (!discoveredTiles[gameId][tileKey]) {
                        discoveredTiles[gameId][tileKey] = true;
                        challenge.tilesDiscovered++;
                        
                        if (terrain[uint16(uint32(nr))][uint16(uint32(nc))] == MapGenerator.TerrainType.Mushroom) {
                            challenge.mushroomsFound++;
                        }
                    }
                }
            }
        }
    }
    
    /**
     * @notice Reveal tiles using stored bitmap (for simulateBatch - gas efficient)
     */
    function _revealTilesWithBitmap(
        uint256 gameId,
        int32 worldX,
        int32 worldY,
        int32 centerX
    ) internal {
        (int32 row, int32 col) = _worldToTile(worldX, worldY, centerX);
        ChallengeState storage challenge = challenges[gameId];
        
        for (int32 dr = -1; dr <= 1; dr++) {
            for (int32 dc = -1; dc <= 1; dc++) {
                int32 nr = row + dr;
                int32 nc = col + dc;
                
                if (nr >= 0 && nr < int32(uint32(GRID_SIZE)) && nc >= 0 && nc < int32(uint32(GRID_SIZE))) {
                    uint256 tileKey = uint256(uint32(nr)) * GRID_SIZE + uint256(uint32(nc));
                    
                    if (!discoveredTiles[gameId][tileKey]) {
                        discoveredTiles[gameId][tileKey] = true;
                        challenge.tilesDiscovered++;
                        
                        // Check mushroom using bitmap (no terrain needed!)
                        if (_isMushroom(gameId, uint16(uint32(nr)), uint16(uint32(nc)))) {
                            challenge.mushroomsFound++;
                        }
                    }
                }
            }
        }
    }
    
    function _tileCenterToWorld(int32 row, int32 col, int32 centerX) internal pure returns (int32 x, int32 y) {
        // centerX is in fixed-point (already scaled by 100)
        // Matches Oracle: x = (centerX_pixels + (col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * 100
        // Since centerX is already fixed-point: x = centerX + ((col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * 100
        x = centerX + ((col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * FIXED_POINT_SCALE;
        
        // y = (col + row) * TILE_Y_SPACING * 100 + tileCenterYOffset
        // tileCenterYOffset = 8796 (pre-calculated from TypeScript: ((34 * 200 / 166) + 47) * 100)
        int32 tileCenterYOffset = 8796;
        y = (col + row) * TILE_Y_SPACING * FIXED_POINT_SCALE + tileCenterYOffset;
    }
    
    function _worldToTile(int32 worldX, int32 worldY, int32 centerX) internal pure returns (int32 row, int32 col) {
        // Calculated: ((34 * 200 / 166) + 47) * 100 = 8796 - MUST match TypeScript
        int32 tileCenterYOffset = 8796;
        int32 tileRenderWidthHalf = (TILE_RENDER_WIDTH * FIXED_POINT_SCALE) / 2;
        
        int32 adjustedX = worldX - tileRenderWidthHalf;
        int32 adjustedY = worldY - tileCenterYOffset;
        
        int32 tileXSpacingScaled = TILE_X_SPACING * FIXED_POINT_SCALE;
        int32 tileYSpacingScaled = TILE_Y_SPACING * FIXED_POINT_SCALE;
        
        int32 colMinusRow = _roundedDiv(adjustedX - centerX, tileXSpacingScaled);
        int32 colPlusRow = _roundedDiv(adjustedY, tileYSpacingScaled);
        
        // Use arithmetic right shift (>> 1) to match TypeScript behavior
        // Note: For negative numbers, >> 1 rounds toward negative infinity,
        // while / 2 truncates toward zero. TypeScript uses >> 1.
        col = (colMinusRow + colPlusRow) >> 1;
        row = (colPlusRow - colMinusRow) >> 1;
    }
    
    /**
     * @notice Integer division with rounding (matches JS Math.floor behavior)
     * @dev For negative division, we need floor (toward -infinity), not truncation (toward 0)
     */
    function _roundedDiv(int32 a, int32 b) internal pure returns (int32) {
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
    
    function _computePositionsHash(AgentStorage.GameState storage state) internal view returns (bytes32) {
        AgentStorage.Agent[] memory agents = state.getAllAgents();
        return keccak256(abi.encode(agents));
    }
    
    /**
     * @notice Generate round seed matching Oracle pattern
     * @dev Uses abi.encodePacked which matches viem's encodePacked:
     *      JS:  keccak256(encodePacked(['bytes32', 'string', 'uint32'], [seed, 'round', round]))
     *      Sol: keccak256(abi.encodePacked(seed, "round", uint32(round)))
     */
    function _makeRoundSeed(bytes32 seed, uint32 round, string memory prefix) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(seed, prefix, round));
    }
    
    // ========== COMMS UNIT LOGIC ==========
    
    function _updateCommsUnit(AgentStorage.GameState storage state, uint32 agentIndex, uint8 action) internal {
        AgentStorage.Agent storage agent = state.agents[agentIndex];
        
        (int32 totalDx, int32 totalDy) = _getCommsDirection(state, agentIndex, action);
        
        if (totalDx != 0 || totalDy != 0) {
            agent.direction = AgentStorage.getDirectionFromDelta(totalDx, totalDy);
            _moveAgent(state, agent);
        }
    }
    
    function _getCommsDirection(AgentStorage.GameState storage state, uint32 agentIndex, uint8 action) 
        internal view returns (int32 totalDx, int32 totalDy) 
    {
        AgentStorage.Agent storage agent = state.agents[agentIndex];
        uint32 commsRange = AgentStorage.getCommsRange(agent.vehicleType);
        uint64 rangeSq = uint64(commsRange) * uint64(commsRange);
        uint64 repelDistSq = ((uint64(commsRange) * 40) / 100) * ((uint64(commsRange) * 40) / 100);
        uint64 attractDistSq = ((uint64(commsRange) * 80) / 100) * ((uint64(commsRange) * 80) / 100);
        
        // Process home base
        (totalDx, totalDy) = _processConn(
            agent.x, agent.y,
            state.teamSpawnX[0],
            state.teamSpawnY[0],
            rangeSq, repelDistSq, attractDistSq, action
        );
        
        // Process other comms units
        for (uint32 j = 0; j < state.agentCount; j++) {
            if (j == agentIndex) continue;
            AgentStorage.Agent storage other = state.agents[j];
            if (!AgentStorage.isCommsUnit(other.vehicleType)) continue;
            
            (int32 dx, int32 dy) = _processConn(agent.x, agent.y, other.x, other.y, rangeSq, repelDistSq, attractDistSq, action);
            totalDx += dx;
            totalDy += dy;
        }
    }
    
    function _processConn(
        int32 myX, int32 myY, int32 connX, int32 connY,
        uint64 rangeSq, uint64 repelDistSq, uint64 attractDistSq, uint8 action
    ) internal pure returns (int32 dx, int32 dy) {
        int64 deltaX = int64(connX) - int64(myX);
        int64 deltaY = int64(connY) - int64(myY);
        uint64 distSq = uint64(deltaX * deltaX + deltaY * deltaY);
        
        if (distSq < 10000) {
            uint8 randomDir = action % 4;
            return (-AgentStorage.getDirectionDX(randomDir), -AgentStorage.getDirectionDY(randomDir));
        }
        
        if (distSq > rangeSq) return (0, 0);
        
        if (distSq < repelDistSq) {
            dx = deltaX > 0 ? int32(-1) : deltaX < 0 ? int32(1) : int32(0);
            dy = deltaY > 0 ? int32(-1) : deltaY < 0 ? int32(1) : int32(0);
        } else if (distSq > attractDistSq) {
            dx = deltaX > 0 ? int32(1) : deltaX < 0 ? int32(-1) : int32(0);
            dy = deltaY > 0 ? int32(1) : deltaY < 0 ? int32(-1) : int32(0);
        }
    }
    
    // ========== AGENT MOVEMENT ==========
    
    function _moveAgent(AgentStorage.GameState storage state, AgentStorage.Agent storage agent) internal {
        int32 myX = agent.x;
        int32 myY = agent.y;
        uint8 dir = agent.direction;
        int32 moveSpeed = int32(uint32(AgentStorage.getMoveSpeed(agent.vehicleType)));
        
        int32 newX = myX + (AgentStorage.getDirectionDX(dir) * moveSpeed) / FIXED_POINT_SCALE;
        int32 newY = myY + (AgentStorage.getDirectionDY(dir) * moveSpeed) / FIXED_POINT_SCALE;
        int32 collisionY = newY + VEHICLE_COLLISION_Y_OFFSET;
        
        bool inBounds = AgentStorage.isWithinBounds(newX, collisionY, state.centerX, state.gridSize);
        bool canMove = inBounds && state.isTraversable(newX, collisionY, dir);
        
        if (canMove) {
            agent.x = newX;
            agent.y = newY;
        } else {
            agent.direction = (dir + 2) % 4;
            agent.x = myX + (AgentStorage.getDirectionDX(agent.direction) * moveSpeed) / FIXED_POINT_SCALE;
            agent.y = myY + (AgentStorage.getDirectionDY(agent.direction) * moveSpeed) / FIXED_POINT_SCALE;
        }
    }
    
    function _updateNormalAgent(AgentStorage.GameState storage state, AgentStorage.Agent storage agent, uint8 action) internal {
        if (action <= 9) {
            _moveAgent(state, agent);
        } else if (action <= 12) {
            agent.direction = (agent.direction + 3) % 4;
        } else {
            agent.direction = (agent.direction + 1) % 4;
        }
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    function getChallenge(uint256 gameId) external view returns (
        bool initialized,
        bool finalized,
        address challenger,
        bytes32 seed,
        uint32 currentRound,
        uint32 agentCount,
        uint256 tilesDiscovered,
        uint256 mushroomsFound
    ) {
        ChallengeState storage c = challenges[gameId];
        return (
            c.initialized,
            c.finalized,
            c.challenger,
            c.seed,
            c.currentRound,
            c.agentCount,
            c.tilesDiscovered,
            c.mushroomsFound
        );
    }
    
    function getEstimatedPayout(uint256 gameId) external view returns (uint256) {
        ChallengeState storage c = challenges[gameId];
        return gameFactory.calculatePayout(c.tilesDiscovered, c.mushroomsFound);
    }
    
    function isSimulationComplete(uint256 gameId) external view returns (bool) {
        return challenges[gameId].currentRound >= MAX_ROUNDS;
    }
    
    /**
     * @notice Get agent position for debugging
     */
    function getAgentPosition(uint256 gameId, uint32 agentIndex) external view returns (
        int32 x,
        int32 y,
        uint8 direction,
        uint8 vehicleType
    ) {
        AgentStorage.GameState storage state = gameStates[gameId];
        require(agentIndex < state.agentCount, "Agent index out of bounds");
        AgentStorage.Agent storage agent = state.agents[agentIndex];
        return (agent.x, agent.y, agent.direction, agent.vehicleType);
    }
    
    function canStartChallenge(uint256 gameId) external view returns (bool canStart, string memory reason) {
        try gameFactory.getGame(gameId) returns (address, uint256, bytes32, GameFactory.GameStatus status) {
            if (status != GameFactory.GameStatus.Challenged) {
                if (status == GameFactory.GameStatus.Created) {
                    return (false, "Game status is Created (need seed reveal)");
                } else if (status == GameFactory.GameStatus.SeedRevealed) {
                    return (false, "Game status is SeedRevealed (need oracle result)");
                } else if (status == GameFactory.GameStatus.ResultSubmitted) {
                    return (false, "Game status is ResultSubmitted (need to challenge first)");
                } else if (status == GameFactory.GameStatus.Finalized) {
                    return (false, "Game status is Finalized (too late to challenge)");
                } else if (status == GameFactory.GameStatus.Claimed) {
                    return (false, "Game status is Claimed (already finished)");
                }
                return (false, "Game not in Challenged status");
            }
        } catch {
            return (false, "Failed to get game from GameFactory");
        }
        
        ChallengeState storage challenge = challenges[gameId];
        if (challenge.initialized) {
            return (false, "Challenge already initialized");
        }
        
        return (true, "Ready to start");
    }
}
