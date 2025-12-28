// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title GameFactory
 * @notice Pay-to-play game creation with optimistic oracle resolution
 * @dev Players pay to create a game, oracles submit results off-chain,
 *      and results can be challenged with on-chain verification.
 * 
 *      Flow:
 *      1. Player creates game (pays GAME_COST)
 *      2. Player reveals seed (next block)
 *      3. Oracle submits result (resultHash + payout)
 *      4. 5-minute challenge period begins
 *      5a. No challenge -> game finalized, player claims payout
 *      5b. Challenge -> 30-min window to run game on-chain
 *          - If result differs: oracle slashed, challenger rewarded
 *          - If result matches: challenger loses stake
 */
contract GameFactory {
    // ========== CONSTANTS ==========
    
    /// @notice Cost to create a game
    uint256 public constant GAME_COST = 0.001 ether;
    
    /// @notice Required stake to become an oracle
    uint256 public constant ORACLE_STAKE = 1 ether;
    
    /// @notice Stake required to challenge a result
    uint256 public constant CHALLENGE_STAKE = 0.01 ether;
    
    /// @notice Amount slashed from oracle on successful challenge (paid to challenger)
    uint256 public constant SLASH_AMOUNT = 0.03 ether;
    
    /// @notice Challenge period duration after result submission
    uint256 public constant CHALLENGE_PERIOD = 1 minutes;
    
    /// @notice Window for challenger to execute on-chain verification
    uint256 public constant CHALLENGE_EXECUTION_WINDOW = 30 minutes;
    
    /// @notice Payout per tile discovered (in wei)
    uint256 public constant PAYOUT_PER_TILE = 0.00001 ether;
    
    /// @notice Payout per mushroom found (in wei)
    uint256 public constant PAYOUT_PER_MUSHROOM = 0.0001 ether;
    
    // ========== ENUMS ==========
    
    /// @notice Game states
    enum GameStatus {
        Created,           // Game created, waiting for seed reveal
        SeedRevealed,      // Seed revealed, waiting for oracle
        ResultSubmitted,   // Oracle submitted result, in challenge period
        Challenged,        // Result challenged, waiting for on-chain execution
        Finalized,         // Game complete, payout available
        Claimed            // Payout claimed by player
    }
    
    // ========== STRUCTS ==========
    
    /// @notice Game data structure
    struct Game {
        address player;
        uint256 createdAtBlock;
        bytes32 seed;
        GameStatus status;
    }
    
    /// @notice Result submitted by oracle
    struct GameResult {
        bytes32 resultHash;       // keccak256(mapHash, positionsHash, payout)
        uint256 payout;           // ETH owed to player
        address oracle;           // Oracle who submitted
        uint256 submittedAt;      // Timestamp for challenge period
        address challenger;       // Who challenged (address(0) if none)
        uint256 challengedAt;     // When challenge started
        bytes32 challengeResultHash; // Result from on-chain execution
        uint256 challengePayout;  // Payout from on-chain execution
    }
    
    // ========== STATE ==========
    
    /// @notice Counter for unique game IDs
    uint256 public nextGameId;
    
    /// @notice Mapping from game ID to game data
    mapping(uint256 => Game) public games;
    
    /// @notice Mapping from game ID to result data
    mapping(uint256 => GameResult) public gameResults;
    
    /// @notice Mapping from player address to their game IDs
    mapping(address => uint256[]) public playerGames;
    
    /// @notice Contract owner (for admin functions)
    address public immutable owner;
    
    // ========== ORACLE STATE ==========
    
    /// @notice Oracle stake amounts
    mapping(address => uint256) public oracleStakes;
    
    /// @notice Whether an address is an active oracle
    mapping(address => bool) public isOracle;
    
    /// @notice Count of pending resolutions per oracle (games they submitted but not finalized)
    mapping(address => uint256) public oraclePendingCount;
    
    /// @notice List of all oracle addresses (for enumeration)
    address[] public oracleList;
    
    // ========== HOUSE POOL ==========
    
    /// @notice Pool balance for player payouts
    uint256 public poolBalance;
    
    // ========== EVENTS ==========
    
    event GameCreated(uint256 indexed gameId, address indexed player, uint256 createdAtBlock);
    event SeedRevealed(uint256 indexed gameId, address indexed player, bytes32 seed);
    event Withdrawal(address indexed to, uint256 amount);
    
    // Oracle events
    event OracleStaked(address indexed oracle, uint256 amount);
    event OracleUnstaked(address indexed oracle, uint256 amount);
    event OracleSlashed(address indexed oracle, uint256 amount, uint256 indexed gameId);
    
    // Pool events
    event PoolDeposit(address indexed from, uint256 amount);
    event PoolWithdrawal(address indexed to, uint256 amount);
    
    // Result events
    event ResultSubmitted(uint256 indexed gameId, address indexed oracle, bytes32 resultHash, uint256 payout);
    event ResultChallenged(uint256 indexed gameId, address indexed challenger);
    event ChallengeExecuted(uint256 indexed gameId, bytes32 computedHash, uint256 computedPayout, bool oracleCorrect);
    event GameFinalized(uint256 indexed gameId, uint256 finalPayout);
    event PayoutClaimed(uint256 indexed gameId, address indexed player, uint256 amount);
    
    // ========== ERRORS ==========
    
    error InsufficientPayment();
    error GameDoesNotExist();
    error NotGameOwner();
    error SeedAlreadyRevealed();
    error TooEarlyToReveal();
    error BlockHashNotAvailable();
    error WithdrawalFailed();
    error NotOwner();
    
    // Oracle errors
    error InsufficientOracleStake();
    error AlreadyOracle();
    error NotOracle();
    error OracleHasPendingResolutions();
    error InsufficientOracleBalance();
    
    // Result errors
    error InvalidGameStatus();
    error ResultAlreadySubmitted();
    error ChallengePeriodNotEnded();
    error ChallengePeriodEnded();
    error ChallengeWindowExpired();
    error AlreadyChallenged();
    error NotChallenger();
    error GameNotFinalized();
    error AlreadyClaimed();
    error InsufficientPoolBalance();
    
    // ========== CONSTRUCTOR ==========
    
    constructor(address _owner) {
        owner = _owner;
    }
    
    // ========== MODIFIERS ==========
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    
    modifier onlyOracle() {
        if (!isOracle[msg.sender]) revert NotOracle();
        _;
    }
    
    // ========== ORACLE FUNCTIONS ==========
    
    /**
     * @notice Stake ETH to become an oracle
     * @dev Requires exactly ORACLE_STAKE amount
     */
    function stakeAsOracle() external payable {
        if (isOracle[msg.sender]) revert AlreadyOracle();
        if (msg.value < ORACLE_STAKE) revert InsufficientOracleStake();
        
        oracleStakes[msg.sender] = msg.value;
        isOracle[msg.sender] = true;
        oracleList.push(msg.sender);
        
        emit OracleStaked(msg.sender, msg.value);
        
        // Return excess ETH
        if (msg.value > ORACLE_STAKE) {
            (bool success, ) = msg.sender.call{value: msg.value - ORACLE_STAKE}("");
            require(success, "Refund failed");
        }
    }
    
    /**
     * @notice Top up oracle stake (for slashed oracles to reactivate)
     * @dev Adds to existing stake and reactivates if threshold met
     */
    function topUpStake() external payable {
        // Must have existing stake (was previously an oracle)
        require(oracleStakes[msg.sender] > 0, "No existing stake");
        // Must not already be active
        require(!isOracle[msg.sender], "Already active oracle");
        
        // Add to existing stake
        oracleStakes[msg.sender] += msg.value;
        
        // If stake now meets threshold, reactivate as oracle
        if (oracleStakes[msg.sender] >= ORACLE_STAKE) {
            isOracle[msg.sender] = true;
            emit OracleStaked(msg.sender, oracleStakes[msg.sender]);
        }
    }
    
    /**
     * @notice Unstake and stop being an oracle
     * @dev Can only unstake if no pending game resolutions
     */
    function unstakeOracle() external {
        if (!isOracle[msg.sender]) revert NotOracle();
        if (oraclePendingCount[msg.sender] > 0) revert OracleHasPendingResolutions();
        
        uint256 stake = oracleStakes[msg.sender];
        oracleStakes[msg.sender] = 0;
        isOracle[msg.sender] = false;
        
        // Remove from oracle list
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracleList[i] == msg.sender) {
                oracleList[i] = oracleList[oracleList.length - 1];
                oracleList.pop();
                break;
            }
        }
        
        (bool success, ) = msg.sender.call{value: stake}("");
        if (!success) revert WithdrawalFailed();
        
        emit OracleUnstaked(msg.sender, stake);
    }
    
    /**
     * @notice Get all registered oracles
     */
    function getOracles() external view returns (address[] memory) {
        return oracleList;
    }
    
    /**
     * @notice Get oracle count
     */
    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }
    
    // ========== HOUSE POOL FUNCTIONS ==========
    
    /**
     * @notice Deposit ETH to the house pool for player payouts
     */
    function depositToPool() external payable onlyOwner {
        poolBalance += msg.value;
        emit PoolDeposit(msg.sender, msg.value);
    }
    
    /**
     * @notice Withdraw from the house pool
     * @param amount Amount to withdraw
     */
    function withdrawFromPool(uint256 amount) external onlyOwner {
        if (amount > poolBalance) revert InsufficientPoolBalance();
        poolBalance -= amount;
        
        (bool success, ) = owner.call{value: amount}("");
        if (!success) revert WithdrawalFailed();
        
        emit PoolWithdrawal(owner, amount);
    }
    
    // ========== GAME CREATION FUNCTIONS ==========
    
    /**
     * @notice Create a new game by paying the game cost
     * @return gameId The unique ID of the created game
     */
    function createGame() external payable returns (uint256 gameId) {
        if (msg.value < GAME_COST) revert InsufficientPayment();
        
        gameId = nextGameId++;
        
        games[gameId] = Game({
            player: msg.sender,
            createdAtBlock: block.number,
            seed: bytes32(0),
            status: GameStatus.Created
        });
        
        playerGames[msg.sender].push(gameId);
        
        emit GameCreated(gameId, msg.sender, block.number);
        
        // Return excess ETH if any
        if (msg.value > GAME_COST) {
            (bool success, ) = msg.sender.call{value: msg.value - GAME_COST}("");
            require(success, "Refund failed");
        }
    }
    
    /**
     * @notice Reveal the seed for a game
     * @dev Must be called at least 1 block after game creation
     * @param gameId The ID of the game to reveal
     * @return seed The revealed game seed
     */
    function revealSeed(uint256 gameId) external returns (bytes32 seed) {
        Game storage game = games[gameId];
        
        if (game.player == address(0)) revert GameDoesNotExist();
        if (game.player != msg.sender) revert NotGameOwner();
        if (game.status != GameStatus.Created) revert InvalidGameStatus();
        
        // Must wait at least 1 block
        if (block.number <= game.createdAtBlock) revert TooEarlyToReveal();
        
        // Get the blockhash of the creation block
        bytes32 blockHash = blockhash(game.createdAtBlock);
        if (blockHash == bytes32(0)) revert BlockHashNotAvailable();
        
        // Generate deterministic seed
        seed = keccak256(abi.encodePacked(blockHash, msg.sender, gameId));
        
        game.seed = seed;
        game.status = GameStatus.SeedRevealed;
        
        emit SeedRevealed(gameId, msg.sender, seed);
    }
    
    // ========== ORACLE RESULT SUBMISSION ==========
    
    /**
     * @notice Submit a game result (oracle only)
     * @param gameId The game ID
     * @param resultHash Hash of the game result (keccak256(mapHash, positionsHash, payout))
     * @param payout The calculated payout for the player
     */
    function submitResult(uint256 gameId, bytes32 resultHash, uint256 payout) external onlyOracle {
        Game storage game = games[gameId];
        
        if (game.player == address(0)) revert GameDoesNotExist();
        if (game.status != GameStatus.SeedRevealed) revert InvalidGameStatus();
        
        // Check oracle has enough stake to cover potential slash
        if (oracleStakes[msg.sender] < SLASH_AMOUNT) revert InsufficientOracleBalance();
        
        gameResults[gameId] = GameResult({
            resultHash: resultHash,
            payout: payout,
            oracle: msg.sender,
            submittedAt: block.timestamp,
            challenger: address(0),
            challengedAt: 0,
            challengeResultHash: bytes32(0),
            challengePayout: 0
        });
        
        game.status = GameStatus.ResultSubmitted;
        oraclePendingCount[msg.sender]++;
        
        emit ResultSubmitted(gameId, msg.sender, resultHash, payout);
    }
    
    // ========== CHALLENGE FUNCTIONS ==========
    
    /**
     * @notice Challenge a game result
     * @param gameId The game ID to challenge
     */
    function challengeResult(uint256 gameId) external payable {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status != GameStatus.ResultSubmitted) revert InvalidGameStatus();
        if (result.challenger != address(0)) revert AlreadyChallenged();
        if (block.timestamp > result.submittedAt + CHALLENGE_PERIOD) revert ChallengePeriodEnded();
        if (msg.value < CHALLENGE_STAKE) revert InsufficientPayment();
        
        result.challenger = msg.sender;
        result.challengedAt = block.timestamp;
        game.status = GameStatus.Challenged;
        
        emit ResultChallenged(gameId, msg.sender);
        
        // Return excess ETH
        if (msg.value > CHALLENGE_STAKE) {
            (bool success, ) = msg.sender.call{value: msg.value - CHALLENGE_STAKE}("");
            require(success, "Refund failed");
        }
    }
    
    /**
     * @notice Execute a challenge by providing the on-chain computed result
     * @dev Anyone can call this after running the game on-chain
     * @param gameId The game ID
     * @param computedResultHash The result hash from on-chain execution
     * @param computedPayout The payout from on-chain execution
     */
    function executeChallenge(uint256 gameId, bytes32 computedResultHash, uint256 computedPayout) external {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status != GameStatus.Challenged) revert InvalidGameStatus();
        if (block.timestamp > result.challengedAt + CHALLENGE_EXECUTION_WINDOW) revert ChallengeWindowExpired();
        
        result.challengeResultHash = computedResultHash;
        result.challengePayout = computedPayout;
        
        bool oracleCorrect = (result.resultHash == computedResultHash && result.payout == computedPayout);
        
        if (oracleCorrect) {
            // Oracle was correct - challenger loses stake, game finalizes with oracle's result
            game.status = GameStatus.Finalized;
            oraclePendingCount[result.oracle]--;
            // Challenge stake goes to pool
            poolBalance += CHALLENGE_STAKE;
            
            emit ChallengeExecuted(gameId, computedResultHash, computedPayout, true);
            emit GameFinalized(gameId, result.payout);
        } else {
            // Oracle was wrong - slash oracle, reward challenger
            uint256 slashAmount = SLASH_AMOUNT;
            if (oracleStakes[result.oracle] < slashAmount) {
                slashAmount = oracleStakes[result.oracle];
            }
            oracleStakes[result.oracle] -= slashAmount;
            
            // If oracle stake drops too low, remove oracle status
            if (oracleStakes[result.oracle] < ORACLE_STAKE) {
                isOracle[result.oracle] = false;
            }
            
            // Update result with correct values
            result.payout = computedPayout;
            result.resultHash = computedResultHash;
            
            game.status = GameStatus.Finalized;
            oraclePendingCount[result.oracle]--;
            
            // Pay challenger: their stake back + slash amount
            uint256 challengerReward = CHALLENGE_STAKE + slashAmount;
            (bool success, ) = result.challenger.call{value: challengerReward}("");
            require(success, "Challenger payment failed");
            
            emit OracleSlashed(result.oracle, slashAmount, gameId);
            emit ChallengeExecuted(gameId, computedResultHash, computedPayout, false);
            emit GameFinalized(gameId, computedPayout);
        }
    }
    
    /**
     * @notice Finalize a game after challenge period (if no challenge)
     * @param gameId The game ID
     */
    function finalizeGame(uint256 gameId) external {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status != GameStatus.ResultSubmitted) revert InvalidGameStatus();
        if (block.timestamp <= result.submittedAt + CHALLENGE_PERIOD) revert ChallengePeriodNotEnded();
        
        game.status = GameStatus.Finalized;
        oraclePendingCount[result.oracle]--;
        
        emit GameFinalized(gameId, result.payout);
    }
    
    /**
     * @notice Finalize a challenged game if challenge window expired without execution
     * @param gameId The game ID
     */
    function finalizeChallengedGame(uint256 gameId) external {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status != GameStatus.Challenged) revert InvalidGameStatus();
        if (block.timestamp <= result.challengedAt + CHALLENGE_EXECUTION_WINDOW) revert ChallengeWindowExpired();
        
        // Challenge window expired without execution - oracle wins by default
        game.status = GameStatus.Finalized;
        oraclePendingCount[result.oracle]--;
        
        // Challenge stake goes to pool
        poolBalance += CHALLENGE_STAKE;
        
        emit GameFinalized(gameId, result.payout);
    }
    
    // ========== PAYOUT FUNCTIONS ==========
    
    /**
     * @notice Claim payout for a finalized game
     * @param gameId The game ID
     */
    function claimPayout(uint256 gameId) external {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.player != msg.sender) revert NotGameOwner();
        if (game.status != GameStatus.Finalized) revert GameNotFinalized();
        
        uint256 payout = result.payout;
        if (payout > poolBalance) revert InsufficientPoolBalance();
        
        game.status = GameStatus.Claimed;
        poolBalance -= payout;
        
        (bool success, ) = msg.sender.call{value: payout}("");
        if (!success) revert WithdrawalFailed();
        
        emit PayoutClaimed(gameId, msg.sender, payout);
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Get full game details
     * @param gameId The ID of the game
     */
    function getGame(uint256 gameId) external view returns (
        address player,
        uint256 createdAtBlock,
        bytes32 seed,
        GameStatus status
    ) {
        Game storage game = games[gameId];
        return (game.player, game.createdAtBlock, game.seed, game.status);
    }
    
    /**
     * @notice Get game result details
     * @param gameId The ID of the game
     */
    function getGameResult(uint256 gameId) external view returns (
        bytes32 resultHash,
        uint256 payout,
        address oracle,
        uint256 submittedAt,
        address challenger,
        uint256 challengedAt
    ) {
        GameResult storage result = gameResults[gameId];
        return (
            result.resultHash,
            result.payout,
            result.oracle,
            result.submittedAt,
            result.challenger,
            result.challengedAt
        );
    }
    
    /**
     * @notice Get all game IDs for a player
     * @param player The player address
     */
    function getPlayerGames(address player) external view returns (uint256[] memory) {
        return playerGames[player];
    }
    
    /**
     * @notice Get the most recent game for a player
     * @param player The player address
     */
    function getLatestGame(address player) external view returns (uint256) {
        uint256[] storage gameIds = playerGames[player];
        require(gameIds.length > 0, "No games found");
        return gameIds[gameIds.length - 1];
    }
    
    /**
     * @notice Check if a game can have its seed revealed
     * @param gameId The ID of the game
     */
    function canRevealSeed(uint256 gameId) external view returns (bool canReveal, string memory reason) {
        Game storage game = games[gameId];
        
        if (game.player == address(0)) {
            return (false, "Game does not exist");
        }
        if (game.status != GameStatus.Created) {
            return (false, "Seed already revealed");
        }
        if (block.number <= game.createdAtBlock) {
            return (false, "Must wait for next block");
        }
        if (block.number > game.createdAtBlock + 256) {
            return (false, "Blockhash expired (>256 blocks)");
        }
        
        return (true, "Ready to reveal");
    }
    
    /**
     * @notice Get games awaiting oracle resolution
     * @return gameIds Array of game IDs with SeedRevealed status
     */
    function getGamesAwaitingResolution() external view returns (uint256[] memory) {
        // Count games awaiting resolution
        uint256 count = 0;
        for (uint256 i = 0; i < nextGameId; i++) {
            if (games[i].status == GameStatus.SeedRevealed) {
                count++;
            }
        }
        
        // Build array
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextGameId; i++) {
            if (games[i].status == GameStatus.SeedRevealed) {
                result[index++] = i;
            }
        }
        
        return result;
    }
    
    /**
     * @notice Check if a game can be challenged
     * @param gameId The game ID
     */
    function canChallenge(uint256 gameId) external view returns (bool, string memory) {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status != GameStatus.ResultSubmitted) {
            return (false, "Game not in challengeable state");
        }
        if (result.challenger != address(0)) {
            return (false, "Already challenged");
        }
        if (block.timestamp > result.submittedAt + CHALLENGE_PERIOD) {
            return (false, "Challenge period ended");
        }
        
        return (true, "Can challenge");
    }
    
    /**
     * @notice Check if a game can be finalized
     * @param gameId The game ID
     */
    function canFinalize(uint256 gameId) external view returns (bool, string memory) {
        Game storage game = games[gameId];
        GameResult storage result = gameResults[gameId];
        
        if (game.status == GameStatus.ResultSubmitted) {
            if (block.timestamp > result.submittedAt + CHALLENGE_PERIOD) {
                return (true, "Challenge period ended, can finalize");
            }
            return (false, "Still in challenge period");
        }
        
        if (game.status == GameStatus.Challenged) {
            if (block.timestamp > result.challengedAt + CHALLENGE_EXECUTION_WINDOW) {
                return (true, "Challenge window expired, can finalize");
            }
            return (false, "Still in challenge execution window");
        }
        
        return (false, "Game not in finalizable state");
    }
    
    /**
     * @notice Calculate payout from game stats
     * @param tilesDiscovered Number of tiles discovered
     * @param mushroomsFound Number of mushrooms found
     */
    function calculatePayout(uint256 tilesDiscovered, uint256 mushroomsFound) external pure returns (uint256) {
        return (tilesDiscovered * PAYOUT_PER_TILE) + (mushroomsFound * PAYOUT_PER_MUSHROOM);
    }
    
    /**
     * @notice Compute result hash from components
     * @param mapHash Hash of the final map state
     * @param positionsHash Hash of final vehicle positions
     * @param payout The calculated payout
     */
    function computeResultHash(bytes32 mapHash, bytes32 positionsHash, uint256 payout) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(mapHash, positionsHash, payout));
    }
    
    // ========== ADMIN FUNCTIONS ==========
    
    /**
     * @notice Withdraw collected game fees to owner
     * @dev Does not touch pool balance or oracle stakes
     */
    function withdrawFees() external onlyOwner {
        // Calculate withdrawable amount (total balance - pool - oracle stakes)
        uint256 totalOracleStakes = 0;
        for (uint256 i = 0; i < oracleList.length; i++) {
            totalOracleStakes += oracleStakes[oracleList[i]];
        }
        
        uint256 withdrawable = address(this).balance - poolBalance - totalOracleStakes;
        require(withdrawable > 0, "Nothing to withdraw");
        
        (bool success, ) = owner.call{value: withdrawable}("");
        if (!success) revert WithdrawalFailed();
        
        emit Withdrawal(owner, withdrawable);
    }
    
    /**
     * @notice Get contract balance breakdown
     */
    function getBalances() external view returns (
        uint256 totalBalance,
        uint256 pool,
        uint256 oracleStakesTotal,
        uint256 fees
    ) {
        totalBalance = address(this).balance;
        pool = poolBalance;
        
        for (uint256 i = 0; i < oracleList.length; i++) {
            oracleStakesTotal += oracleStakes[oracleList[i]];
        }
        
        fees = totalBalance - pool - oracleStakesTotal;
    }
    
    /**
     * @notice Receive ETH (for pool deposits)
     */
    receive() external payable {
        if (msg.sender == owner) {
            poolBalance += msg.value;
            emit PoolDeposit(msg.sender, msg.value);
        }
    }
}
