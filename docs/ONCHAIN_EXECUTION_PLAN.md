# Future Plan: On-Chain Execution with Fraud Proofs

## Overview

The simulation can be verified on-chain using an **optimistic execution** pattern with **fraud proofs**. This allows cheap off-chain computation while maintaining trustless verification.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NORMAL FLOW (99.9%)                      │
│                                                             │
│  1. Game starts with deterministic seed                     │
│  2. Admin runs simulation off-chain (JS)                    │
│  3. Admin submits final state hash + stakes ETH             │
│  4. Challenge period (e.g., 1 hour)                         │
│  5. No challenge → result finalized                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   CHALLENGE FLOW (rare)                     │
│                                                             │
│  1. Challenger stakes ETH                                   │
│  2. Challenger runs simulation on-chain in chunks           │
│     (e.g., 5 rounds per transaction)                        │
│  3. If result differs from admin → challenger wins          │
│     - Admin slashed, challenger rewarded                    │
│  4. If result matches → challenger slashed                  │
└─────────────────────────────────────────────────────────────┘
```

## Solidity Implementation Requirements

### Integer Math Conversion

| JavaScript                     | Solidity                            |
| ------------------------------ | ----------------------------------- |
| Float positions (e.g., 1234.5) | Integer × 1000 (e.g., 1234500)      |
| `Math.sqrt(distSq)`            | Compare `distSq` vs `range * range` |
| Force magnitudes               | Fixed step sizes                    |

### Deterministic RNG (Already Compatible!)

The JS `deterministic-dice` library already uses **keccak256 hashing** - same as Solidity's native `keccak256`. This makes RNG parity straightforward:

```javascript
// JS (deterministic-dice)
const dice = new DeterministicDice(seed);
const roll = dice.roll(16); // Uses keccak256 internally
```

```solidity
// Solidity (identical logic)
function roll(bytes32 seed, uint256 nonce, uint256 max) pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(seed, nonce))) % max;
}
```

Both use the same hash function, so they'll produce identical sequences given the same seed.

### Simplified Physics for Gas Efficiency

```solidity
// Instead of force accumulation with magnitudes:
if (distSq < repelDistSq) {
    // Move one step away from connection
    direction = getDirectionAway(myPos, connPos);
} else if (distSq > attractDistSq) {
    // Move one step toward connection
    direction = getDirectionToward(myPos, connPos);
}
// Sweet spot: don't move
```

### Chunked Execution

```solidity
function executeRounds(uint256 gameId, uint8 roundCount) external {
    require(roundCount <= 10, "Max 10 rounds per tx");

    GameState storage state = games[gameId];

    for (uint8 r = 0; r < roundCount; r++) {
        for (uint16 i = 0; i < state.agentCount; i++) {
            updateAgent(state, i, state.currentRound);
        }
        state.currentRound++;
    }

    state.stateHash = keccak256(abi.encode(state.positions));
}
```

## Gas Estimates (L2)

| Operation            | Gas   | Cost @ $0.01/M gas |
| -------------------- | ----- | ------------------ |
| Submit result        | ~100K | $0.001             |
| 1 round (100 agents) | ~1M   | $0.01              |
| 5 rounds             | ~5M   | $0.05              |
| Full 1000 rounds     | ~200M | **$2-5**           |

## Advanced: Bisection Challenge (Optional)

For even cheaper disputes, use binary search:

1. Admin commits state hash at checkpoints (round 0, 100, 200...)
2. Challenger identifies disputed checkpoint
3. Binary search narrows to single bad round
4. Execute only 1 round on-chain to prove fraud
5. Cost: **~$0.10-0.50** instead of $2-5

## Contract Structure

```
contracts/
├── DeterministicoGame.sol      # Main game registry & challenge logic
├── SimulationEngine.sol        # Pure simulation computation
├── DeterministicDice.sol       # Deterministic RNG matching JS
└── interfaces/
    └── ISimulation.sol
```

## Critical: JS ↔ Solidity Parity

The JavaScript and Solidity implementations MUST produce **identical results** for the same inputs. This requires:

1. **Identical RNG**: Same keccak256-based dice algorithm
2. **Identical math**: Integer arithmetic, same rounding
3. **Identical order**: Same agent processing order
4. **Extensive testing**: Fuzz tests with random seeds

### View Functions for Parallel Execution

The Solidity simulation should expose **view functions** that can run the simulation without spending gas. This allows running JS and Solidity in parallel to verify parity:

```solidity
/// @notice Execute rounds as a view function (no gas cost when called off-chain)
/// @dev Use this to verify JS and Solidity produce identical results
function simulateRounds(
    bytes32 seed,
    Position[] calldata initialPositions,
    uint16 fromRound,
    uint16 toRound
) external view returns (bytes32 stateHash, Position[] memory finalPositions) {
    // Run simulation in memory (no storage writes)
    Position[] memory positions = initialPositions;

    for (uint16 round = fromRound; round < toRound; round++) {
        for (uint16 i = 0; i < positions.length; i++) {
            positions[i] = updateAgentPure(positions, i, seed, round);
        }
    }

    return (keccak256(abi.encode(positions)), positions);
}

/// @notice Run full simulation as view (for parity testing)
function simulateFull(
    bytes32 seed,
    Position[] calldata initialPositions,
    uint16 totalRounds
) external view returns (bytes32 finalStateHash) {
    // Can run entire 1000 rounds in one eth_call (no gas limit for views)
    return simulateRounds(seed, initialPositions, 0, totalRounds);
}
```

### Parallel Execution During Development

```javascript
// Run both JS and Solidity, compare results
async function verifyParity(seed, rounds) {
  // Run JS simulation
  const jsResult = runSimulationJS(seed, rounds);

  // Run Solidity simulation via eth_call (FREE - no gas!)
  const solidityResult = await contract.simulateFull(
    seed,
    initialPositions,
    rounds
  );

  // Compare
  if (jsResult.stateHash !== solidityResult.finalStateHash) {
    console.error("PARITY MISMATCH!", { seed, jsResult, solidityResult });
    // Binary search to find exact divergence round
    await findDivergenceRound(seed, rounds);
  }

  return jsResult.stateHash === solidityResult.finalStateHash;
}

// Run parity check on every game during testing
async function runGameWithVerification(seed) {
  const jsResult = runSimulationJS(seed, 1000);

  // Verify every 100 rounds
  for (let checkpoint = 100; checkpoint <= 1000; checkpoint += 100) {
    const solidityHash = await contract.simulateRounds(
      seed,
      initial,
      0,
      checkpoint
    );
    assert(jsResult.checkpoints[checkpoint] === solidityHash);
  }

  return jsResult;
}
```

### Why View Functions Work

- **No gas limit**: `eth_call` has no block gas limit, can run full simulation
- **Free**: View functions cost nothing when called off-chain
- **Same code path**: Uses identical logic as the challenge execution
- **CI/CD integration**: Can run parity tests in automated pipelines

## Economic Parameters (Example)

| Parameter                          | Value                   |
| ---------------------------------- | ----------------------- |
| Admin stake                        | 0.1 ETH                 |
| Challenger stake                   | 0.05 ETH                |
| Challenge period                   | 1 hour                  |
| Challenger reward (if wins)        | Admin's stake (0.1 ETH) |
| Admin reward (if challenger fails) | Challenger's stake      |

## Implementation Phases

### Phase 1: Solidity Simulation Engine

- Port agent update logic to Solidity
- Integer math, no sqrt
- Deterministic dice matching JS

### Phase 2: Parity Testing

- Fuzz test JS vs Solidity with 1000+ random seeds
- Fix any discrepancies

### Phase 3: Challenge Contract

- Submit/challenge/resolve flow
- Chunked execution
- Stake management

### Phase 4: Production

- Deploy to L2 (Arbitrum/Base/Optimism)
- Admin tooling
- Monitoring for challenges

## Why This Works

- **Normal case is cheap**: Just one tx to submit result
- **Security is economic**: Fraud is always provable and punishable
- **Challenges are affordable**: $2-5 on L2 to fully verify
- **Deterrence**: Rational admin won't cheat (will lose stake)
- **Trustless**: Anyone can verify, no trust in admin required
