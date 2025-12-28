# 🪐 Deterministico

> A fully deterministic, on-chain verifiable exploration game with optimistic oracle resolution.

## Overview

Deterministico is an exploration game where players send autonomous vehicle agents across procedurally generated terrain. Every aspect of the game—from map generation to agent movement—is fully deterministic and can be verified on-chain, enabling a trustless optimistic oracle system.

## How It Works

### Game Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GAME LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CREATE GAME          2. REVEAL SEED         3. GAME RUNS               │
│  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐           │
│  │ Player pays  │───────▶│ Wait 1 block │──────▶│ Deterministic│           │
│  │ 0.001 ETH    │        │ Get blockhash│       │ simulation   │           │
│  └──────────────┘        └──────────────┘       └──────────────┘           │
│                                                        │                    │
│  ┌─────────────────────────────────────────────────────┘                    │
│  │                                                                          │
│  ▼                                                                          │
│  4. ORACLE SUBMITS       5. CHALLENGE PERIOD    6. FINALIZE                │
│  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐           │
│  │ Result hash  │───────▶│   5 minutes  │──────▶│ Player claims│           │
│  │ + payout     │        │ to challenge │       │ their payout │           │
│  └──────────────┘        └──────────────┘       └──────────────┘           │
│                                 │                                           │
│                                 │ (if challenged)                           │
│                                 ▼                                           │
│                          ┌──────────────┐       ┌──────────────┐           │
│                          │ 30 min window│──────▶│ On-chain     │           │
│                          │ to execute   │       │ verification │           │
│                          └──────────────┘       └──────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Creating a Game

Players pay **0.001 ETH** to create a game. This registers their intent and records the current block number.

### 2. Revealing the Seed

After waiting at least 1 block, the player reveals their game seed. The seed is generated deterministically:

```
seed = keccak256(blockhash(createdAtBlock) + playerAddress + gameId)
```

This commit-reveal scheme prevents players from predicting or manipulating their seed.

### 3. Game Simulation

Once the seed is revealed, the entire game can be simulated deterministically:

- **Map Generation**: The seed generates a unique isometric terrain map with ground, mountains, liquid, mushrooms, and ruby mountains
- **Spawn Points**: Team spawn locations are deterministically placed on valid ground tiles
- **Agent Movement**: Vehicles explore the map using deterministic dice rolls for movement decisions
- **Fog of War**: Tiles are revealed as agents explore, tracking discovered terrain

The same seed will always produce the exact same game outcome—in TypeScript or Solidity.

### 4. Oracle Resolution

Registered oracles watch for games awaiting resolution. They:

1. Simulate the complete game off-chain
2. Calculate the result hash and payout
3. Submit the result on-chain

**Result Hash** = `keccak256(mapHash + positionsHash + payout)`

This commits to the entire final game state.

### 5. Challenge Period (5 minutes)

After an oracle submits a result, there's a **5-minute challenge window**. During this time:

- Anyone can challenge by staking **0.01 ETH**
- If no challenge occurs, the game proceeds to finalization

### 6. Challenge Execution (30 minutes)

If challenged, a **30-minute execution window** begins. During this time:

- The challenger (or anyone) can run the game on-chain
- The on-chain execution produces a verified result hash and payout
- Results are compared to the oracle's submission

**If the oracle was wrong:**

- Oracle is slashed **0.03 ETH** from their stake
- Challenger receives their 0.01 ETH back + 0.03 ETH reward (3x return)
- Game finalizes with the correct result

**If the oracle was correct:**

- Challenger loses their 0.01 ETH stake (goes to house pool)
- Game finalizes with the oracle's result

### 7. Claiming Payout

After finalization, the player can claim their payout from the house pool.

## Payout Calculation

Players earn ETH based on their exploration:

| Discovery                | Reward      |
| ------------------------ | ----------- |
| Each tile discovered     | 0.00001 ETH |
| Each mushroom tile found | 0.0001 ETH  |

A typical game discovering 500 tiles with 20 mushrooms would earn:

- 500 × 0.00001 = 0.005 ETH (tiles)
- 20 × 0.0001 = 0.002 ETH (mushrooms)
- **Total: 0.007 ETH**

## Oracle System

### Becoming an Oracle

To become an oracle:

1. Navigate to `/oracle`
2. Connect your wallet
3. Stake **1 ETH**

Oracles must maintain at least 1 ETH staked to remain active.

### Oracle Responsibilities

Oracles:

- Watch for games with revealed seeds awaiting resolution
- Simulate games accurately off-chain
- Submit correct results on-chain
- Maintain sufficient stake to cover potential slashing

### Oracle Rewards

Oracles are not directly paid per resolution, but they provide a valuable service to the network. Incorrect results risk slashing, creating strong incentives for honest behavior.

### Unstaking

Oracles can unstake and withdraw their ETH only if they have **no pending game resolutions**. This prevents oracles from submitting results and immediately withdrawing before the challenge period ends.

## House Pool

The house pool funds player payouts. The contract owner:

- Deposits ETH via `depositToPool()`
- Can withdraw excess funds via `withdrawFromPool()`
- Collects game creation fees (0.001 ETH per game)

The pool must have sufficient balance for players to claim payouts.

## Smart Contracts

### GameFactory.sol

The main contract handling:

- Game creation and seed reveal
- Oracle registration and staking
- Result submission and challenge system
- Payout claims and pool management

### GameMap.sol

Stores terrain maps on-chain using gas-optimized nibble-packing (4 bits per tile).

### MapGenerator.sol

Pure function library for deterministic terrain generation from a seed.

### GameSimulator.sol

On-chain game simulation for challenge verification.

### DeterministicDice.sol

Deterministic random number generation matching the TypeScript implementation exactly.

### AgentStorage.sol

Efficient agent state storage using Structure-of-Arrays pattern.

## Technical Details

### Determinism

All randomness derives from the game seed through deterministic dice rolls:

- Uses keccak256 hashing for entropy
- 32 rolls per hash (8 bits each)
- Identical behavior in TypeScript and Solidity

### Fixed-Point Math

All positions use **x100 fixed-point** integers for Solidity compatibility:

- No floating-point errors
- Exact parity between off-chain and on-chain calculations
- Integer division truncates toward zero (matches Solidity)

### Gas Optimization

- Nibble-packed terrain storage (64 tiles per 256-bit slot)
- Structure-of-Arrays for agent storage
- Batched operations where possible

## Development

This is a [Scaffold-ETH 2](https://scaffoldeth.io) project.

```bash
# Install dependencies
yarn install

# Start local chain
yarn chain

# Deploy contracts
yarn deploy

# Start frontend
yarn start
```

Visit:

- `http://localhost:3000` - Main game
- `http://localhost:3000/oracle` - Oracle dashboard
- `http://localhost:3000/debug` - Contract debugging

## Constants

| Parameter                  | Value       |
| -------------------------- | ----------- |
| Game Cost                  | 0.001 ETH   |
| Oracle Stake               | 1 ETH       |
| Challenge Stake            | 0.01 ETH    |
| Slash Amount               | 0.03 ETH    |
| Challenge Period           | 5 minutes   |
| Challenge Execution Window | 30 minutes  |
| Payout per Tile            | 0.00001 ETH |
| Payout per Mushroom        | 0.0001 ETH  |

## License

MIT
