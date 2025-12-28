"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { encodePacked, formatEther, keccak256, parseEther, toHex } from "viem";
import { useAccount } from "wagmi";
import { Header } from "~~/components/Header";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  FIXED_POINT_SCALE,
  GRID_SIZE,
  MAX_ROUNDS,
  NUM_TEAMS,
  SPAWN_CUTOFF_ROUND,
  generateGrid,
  tileCenterToWorld,
  worldToTile,
} from "~~/lib/game";
import { AgentPool } from "~~/lib/game/AgentPool";

const MAX_AGENTS = 256;
const ORACLE_STAKE_REQUIRED = parseEther("1"); // 1 ETH required to be an oracle

// Game status enum matching contract
const GameStatus = {
  0: "Created",
  1: "SeedRevealed",
  2: "ResultSubmitted",
  3: "Challenged",
  4: "Finalized",
  5: "Claimed",
} as const;

type GameStatusType = keyof typeof GameStatus;

/**
 * Simulate a full game and return the result hash and payout
 */
function simulateGame(seed: `0x${string}`): {
  resultHash: `0x${string}`;
  payout: bigint;
  tilesDiscovered: number;
  mushroomsFound: number;
  mapHash: `0x${string}`;
  positionsHash: `0x${string}`;
} {
  // Generate grid
  const gridData = generateGrid(seed, GRID_SIZE);
  const terrain = gridData.terrain;

  // Calculate map dimensions
  const TILE_WIDTH = 200;
  const TILE_X_SPACING = 89;
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;

  // Create agent pool
  const agentPool = new AgentPool(MAX_AGENTS);
  agentPool.setMapBounds(centerX, GRID_SIZE);
  agentPool.setTerrainGrid(terrain);

  // Generate spawn point - simple: start at center, find ground tile
  // Use encodePacked for Solidity parity: keccak256(abi.encodePacked(seed, "spawn-points"))
  const spawnDice = new DeterministicDice(keccak256(encodePacked(["bytes32", "string"], [seed, "spawn-points"])));

  // Start at center tile
  const centerTile = Math.floor(GRID_SIZE / 2);
  let spawnRow = centerTile;
  let spawnCol = centerTile;

  // If center isn't ground, search randomly for a ground tile
  if (terrain[spawnRow][spawnCol] !== "ground") {
    for (let attempts = 0; attempts < 100; attempts++) {
      // Random offset from center (-5 to +5)
      const dr = spawnDice.roll(11) - 5;
      const dc = spawnDice.roll(11) - 5;
      const testRow = centerTile + dr;
      const testCol = centerTile + dc;

      if (testRow >= 0 && testRow < GRID_SIZE && testCol >= 0 && testCol < GRID_SIZE) {
        if (terrain[testRow][testCol] === "ground") {
          spawnRow = testRow;
          spawnCol = testCol;
          break;
        }
      }
    }
  }

  // Convert to world coordinates
  const spawnWorld = tileCenterToWorld(spawnRow, spawnCol, centerX);
  const spawnPoints = [{ x: spawnWorld.x, y: spawnWorld.y }];

  // Set team spawn
  agentPool.setTeamSpawn(0, spawnPoints[0].x, spawnPoints[0].y);

  // Initialize agents
  const COMMS_TYPES = [0, 6];
  // Use encodePacked for Solidity parity: keccak256(abi.encodePacked(seed, "agent-init"))
  const initDice = new DeterministicDice(keccak256(encodePacked(["bytes32", "string"], [seed, "agent-init"])));
  for (let team = 0; team < NUM_TEAMS; team++) {
    const spawn = spawnPoints[team];
    const randomDirection = initDice.roll(4) % 4;
    const randomVehicle = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
    agentPool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);
  }

  // Track explored tiles
  const exploredTiles = new Set<string>();
  const centerXFP = centerX * FIXED_POINT_SCALE;

  // Reveal initial tiles
  for (let i = 0; i < agentPool.count; i++) {
    const { row, col } = worldToTile(
      spawnPoints[i % NUM_TEAMS].x * FIXED_POINT_SCALE,
      spawnPoints[i % NUM_TEAMS].y * FIXED_POINT_SCALE,
      centerXFP,
    );
    revealTilesAround(exploredTiles, row, col, GRID_SIZE);
  }

  // Run simulation
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Use encodePacked for Solidity parity: keccak256(abi.encodePacked(seed, "round", uint32(round)))
    const gameDice = new DeterministicDice(
      keccak256(encodePacked(["bytes32", "string", "uint32"], [seed, "round", round])),
    );
    agentPool.updateAll(gameDice);

    // Reveal tiles around agents
    for (let i = 0; i < agentPool.count; i++) {
      const { row, col } = worldToTile(agentPool.x[i], agentPool.y[i], centerXFP);
      revealTilesAround(exploredTiles, row, col, GRID_SIZE);
    }

    // Spawn new agents
    const nextRound = round + 1;
    if (nextRound % 5 === 0 && nextRound <= SPAWN_CUTOFF_ROUND) {
      // Use encodePacked for Solidity parity: keccak256(abi.encodePacked(seed, "spawn", uint32(round)))
      const spawnRoundDice = new DeterministicDice(
        keccak256(encodePacked(["bytes32", "string", "uint32"], [seed, "spawn", round])),
      );
      for (let team = 0; team < NUM_TEAMS; team++) {
        if (agentPool.count >= MAX_AGENTS) break;
        const spawn = spawnPoints[team];
        const randomDirection = spawnRoundDice.roll(4) % 4;
        const randomVehicle = COMMS_TYPES[spawnRoundDice.roll(COMMS_TYPES.length)];
        agentPool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);
      }
    }
  }

  // Calculate stats
  const tilesDiscovered = exploredTiles.size;
  let mushroomsFound = 0;

  for (const tileKey of exploredTiles) {
    const [rowStr, colStr] = tileKey.split(",");
    const row = parseInt(rowStr);
    const col = parseInt(colStr);
    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
      if (terrain[row][col] === "mushroom") {
        mushroomsFound++;
      }
    }
  }

  // Calculate payout: 0.00001 ETH per tile + 0.0001 ETH per mushroom
  const PAYOUT_PER_TILE = BigInt("10000000000000"); // 0.00001 ether in wei
  const PAYOUT_PER_MUSHROOM = BigInt("100000000000000"); // 0.0001 ether in wei
  const payout = BigInt(tilesDiscovered) * PAYOUT_PER_TILE + BigInt(mushroomsFound) * PAYOUT_PER_MUSHROOM;

  // Create map hash from terrain
  const terrainFlat = terrain.flat().join("");
  const mapHash = keccak256(toHex(terrainFlat)) as `0x${string}`;

  // Create positions hash from final agent positions
  const positionsData: number[] = [];
  for (let i = 0; i < agentPool.count; i++) {
    positionsData.push(agentPool.x[i], agentPool.y[i], agentPool.direction[i]);
  }
  const positionsHash = keccak256(toHex(positionsData.join(","))) as `0x${string}`;

  // Compute result hash
  const resultHash = keccak256(
    toHex(mapHash + positionsHash.slice(2) + payout.toString(16).padStart(64, "0")),
  ) as `0x${string}`;

  return {
    resultHash,
    payout,
    tilesDiscovered,
    mushroomsFound,
    mapHash,
    positionsHash,
  };
}

function revealTilesAround(exploredTiles: Set<string>, row: number, col: number, gridSize: number): void {
  const offsets = [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
  ];
  for (const [dr, dc] of offsets) {
    const newRow = row + dr;
    const newCol = col + dc;
    if (newRow >= 0 && newRow < gridSize && newCol >= 0 && newCol < gridSize) {
      exploredTiles.add(`${newRow},${newCol}`);
    }
  }
}

const OraclePage: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const [simulationResults, setSimulationResults] = useState<
    Record<
      string,
      {
        resultHash: `0x${string}`;
        payout: bigint;
        tilesDiscovered: number;
        mushroomsFound: number;
        mapHash: `0x${string}`;
        positionsHash: `0x${string}`;
      }
    >
  >({});
  const [isSimulating, setIsSimulating] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState<Record<string, boolean>>({});

  // Contract hooks
  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "GameFactory",
  });

  // Read oracle status
  const { data: isOracleData, refetch: refetchIsOracle } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "isOracle",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  // Read oracle stake
  const { data: oracleStake, refetch: refetchOracleStake } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "oracleStakes",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  // Read pending count
  const { data: pendingCount } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "oraclePendingCount",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  // Read games awaiting resolution
  const { data: awaitingGames, refetch: refetchAwaitingGames } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGamesAwaitingResolution",
  });

  // Read pool balance
  const { data: poolBalance } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "poolBalance",
  });

  // Read all oracles
  const { data: oracleList } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getOracles",
  });

  // Read total game count
  const { data: nextGameId } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "nextGameId",
  });

  // Read slashing events
  const { data: slashEvents } = useScaffoldEventHistory({
    contractName: "GameFactory",
    eventName: "OracleSlashed",
    fromBlock: 0n,
    watch: true,
  });

  // Read challenge executed events
  const { data: challengeEvents } = useScaffoldEventHistory({
    contractName: "GameFactory",
    eventName: "ChallengeExecuted",
    fromBlock: 0n,
    watch: true,
  });

  // Calculate stake deficit
  const stakeDeficit =
    oracleStake !== undefined && oracleStake < ORACLE_STAKE_REQUIRED ? ORACLE_STAKE_REQUIRED - oracleStake : 0n;
  const hasStake = oracleStake !== undefined && oracleStake > 0n;
  const needsTopUp = hasStake && !isOracleData && stakeDeficit > 0n;

  const handleStake = async () => {
    try {
      await writeContractAsync({
        functionName: "stakeAsOracle",
        value: parseEther("1"),
      });
      refetchIsOracle();
      refetchOracleStake();
    } catch (error) {
      console.error("Failed to stake:", error);
    }
  };

  const handleUnstake = async () => {
    try {
      await writeContractAsync({
        functionName: "unstakeOracle",
      });
      refetchIsOracle();
      refetchOracleStake();
    } catch (error) {
      console.error("Failed to unstake:", error);
    }
  };

  const handleTopUp = async () => {
    try {
      // Top up stake to get back to 1 ETH threshold
      await writeContractAsync({
        functionName: "topUpStake",
        value: stakeDeficit,
      });
      refetchIsOracle();
      refetchOracleStake();
    } catch (error) {
      console.error("Failed to top up stake:", error);
    }
  };

  const handleSimulate = async (gameId: bigint, seed: `0x${string}`) => {
    const key = gameId.toString();
    setIsSimulating(prev => ({ ...prev, [key]: true }));

    try {
      // Run simulation in next tick to allow UI update
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = simulateGame(seed);
      setSimulationResults(prev => ({
        ...prev,
        [key]: result,
      }));
    } catch (error) {
      console.error("Simulation failed:", error);
    } finally {
      setIsSimulating(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSubmitResult = async (gameId: bigint) => {
    const key = gameId.toString();
    const result = simulationResults[key];
    if (!result) return;

    setIsSubmitting(prev => ({ ...prev, [key]: true }));

    try {
      await writeContractAsync({
        functionName: "submitResult",
        args: [gameId, result.resultHash, result.payout],
      });
      // Clear simulation result and refresh
      setSimulationResults(prev => {
        const newResults = { ...prev };
        delete newResults[key];
        return newResults;
      });
      refetchAwaitingGames();
    } catch (error) {
      console.error("Failed to submit result:", error);
    } finally {
      setIsSubmitting(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSubmitWrongResult = async (gameId: bigint) => {
    const key = gameId.toString();
    const result = simulationResults[key];
    if (!result) return;

    setIsSubmitting(prev => ({ ...prev, [key]: true }));

    try {
      // Submit HALF the payout - this makes the result wrong and challengeable
      const wrongPayout = result.payout / 2n;

      // Recompute hash with wrong payout (will differ from correct hash)
      const wrongResultHash = keccak256(
        toHex(result.mapHash + result.positionsHash.slice(2) + wrongPayout.toString(16).padStart(64, "0")),
      ) as `0x${string}`;

      await writeContractAsync({
        functionName: "submitResult",
        args: [gameId, wrongResultHash, wrongPayout],
      });

      // Clear simulation result and refresh
      setSimulationResults(prev => {
        const newResults = { ...prev };
        delete newResults[key];
        return newResults;
      });
      refetchAwaitingGames();
    } catch (error) {
      console.error("Failed to submit wrong result:", error);
    } finally {
      setIsSubmitting(prev => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <Header />
      <div className="container mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500 mb-2">
            Oracle Dashboard
          </h1>
          <p className="text-slate-400">Resolve games and earn rewards</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Games" value={nextGameId?.toString() ?? "0"} icon="🎮" />
          <StatCard label="Awaiting Resolution" value={awaitingGames?.length.toString() ?? "0"} icon="⏳" />
          <StatCard label="Pool Balance" value={poolBalance ? `${formatEther(poolBalance)} ETH` : "0 ETH"} icon="💰" />
          <StatCard label="Active Oracles" value={oracleList?.length.toString() ?? "0"} icon="🔮" />
        </div>

        {/* Oracle Status Card */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-slate-700">
          <h2 className="text-2xl font-semibold text-white mb-4">Your Oracle Status</h2>

          {!connectedAddress ? (
            <p className="text-slate-400">Connect your wallet to become an oracle</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  className={`w-3 h-3 rounded-full ${isOracleData ? "bg-green-500" : needsTopUp ? "bg-yellow-500" : "bg-red-500"}`}
                />
                <span className="text-white">
                  {isOracleData ? "Active Oracle" : needsTopUp ? "Oracle (Slashed - Needs Top Up)" : "Not an Oracle"}
                </span>
              </div>

              {/* Always show stake info if user has any stake */}
              {hasStake && (
                <>
                  <div className="flex items-center justify-between bg-slate-700/50 rounded-lg p-4">
                    <span className="text-slate-300">Staked Amount</span>
                    <div className="text-right">
                      <span className={`font-mono ${isOracleData ? "text-amber-400" : "text-red-400"}`}>
                        {formatEther(oracleStake!)} ETH
                      </span>
                      {!isOracleData && <span className="text-slate-500 text-sm ml-2">/ 1.0 ETH required</span>}
                    </div>
                  </div>

                  {needsTopUp && (
                    <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-red-400 mb-2">
                        <span className="text-lg">⚠️</span>
                        <span className="font-semibold">Stake Below Threshold</span>
                      </div>
                      <p className="text-red-300 text-sm">
                        Your stake was slashed. You need {formatEther(stakeDeficit)} ETH more to become an active oracle
                        again.
                      </p>
                    </div>
                  )}
                </>
              )}

              {isOracleData && (
                <div className="flex items-center justify-between bg-slate-700/50 rounded-lg p-4">
                  <span className="text-slate-300">Pending Resolutions</span>
                  <span className="text-white font-mono">{pendingCount?.toString() ?? "0"}</span>
                </div>
              )}

              <div className="flex gap-4 mt-6">
                {!isOracleData && !needsTopUp && (
                  <button
                    onClick={handleStake}
                    className="flex-1 py-3 px-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-xl transition-all duration-200"
                  >
                    Stake 1 ETH to Become Oracle
                  </button>
                )}

                {needsTopUp && (
                  <button
                    onClick={handleTopUp}
                    className="flex-1 py-3 px-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-xl transition-all duration-200"
                  >
                    Top Up {formatEther(stakeDeficit)} ETH to Reactivate
                  </button>
                )}

                {isOracleData && (
                  <button
                    onClick={handleUnstake}
                    disabled={pendingCount !== undefined && pendingCount > 0n}
                    className={`flex-1 py-3 px-6 font-semibold rounded-xl transition-all duration-200 ${
                      pendingCount !== undefined && pendingCount > 0n
                        ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                        : "bg-red-600 hover:bg-red-700 text-white"
                    }`}
                  >
                    {pendingCount !== undefined && pendingCount > 0n
                      ? `Cannot Unstake (${pendingCount} pending)`
                      : "Unstake & Withdraw"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Games Awaiting Resolution */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
          <h2 className="text-2xl font-semibold text-white mb-4">Games Awaiting Resolution</h2>

          {!awaitingGames || awaitingGames.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">✨</div>
              <p className="text-slate-400">No games awaiting resolution</p>
            </div>
          ) : (
            <div className="space-y-4">
              {awaitingGames.map(gameId => (
                <GameCard
                  key={gameId.toString()}
                  gameId={gameId}
                  isOracle={isOracleData ?? false}
                  simulationResult={simulationResults[gameId.toString()]}
                  isSimulating={isSimulating[gameId.toString()] ?? false}
                  isSubmitting={isSubmitting[gameId.toString()] ?? false}
                  onSimulate={handleSimulate}
                  onSubmit={handleSubmitResult}
                  onSubmitWrong={handleSubmitWrongResult}
                />
              ))}
            </div>
          )}
        </div>

        {/* Challenge History */}
        {(slashEvents && slashEvents.length > 0) || (challengeEvents && challengeEvents.length > 0) ? (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 mt-8 border border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-4">Challenge History</h2>
            <div className="space-y-3">
              {challengeEvents?.map((event, i) => {
                const gameId = event.args.gameId?.toString() ?? "?";
                const oracleCorrect = event.args.oracleCorrect;
                const computedPayout = event.args.computedPayout;

                return (
                  <div
                    key={`challenge-${i}`}
                    className={`rounded-lg p-4 border ${
                      oracleCorrect ? "bg-green-900/20 border-green-500/30" : "bg-red-900/20 border-red-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-amber-400">Game #{gameId}</span>
                      <span
                        className={`text-sm px-2 py-1 rounded ${
                          oracleCorrect ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {oracleCorrect ? "Oracle Correct" : "Oracle Slashed"}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      Computed Payout:{" "}
                      <span className="text-white font-mono">
                        {computedPayout ? formatEther(computedPayout) : "?"} ETH
                      </span>
                    </div>
                  </div>
                );
              })}

              {slashEvents?.map((event, i) => {
                const oracle = event.args.oracle;
                const amount = event.args.amount;
                const gameId = event.args.gameId?.toString() ?? "?";
                const isYou = oracle?.toLowerCase() === connectedAddress?.toLowerCase();

                return (
                  <div key={`slash-${i}`} className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⚡</span>
                        <span className="text-red-400 font-semibold">Oracle Slashed</span>
                        {isYou && <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded">You</span>}
                      </div>
                      <span className="font-mono text-amber-400">Game #{gameId}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">
                        Oracle: <Address address={oracle} />
                      </div>
                      <div className="text-slate-400">
                        Slashed:{" "}
                        <span className="text-red-400 font-mono">{amount ? formatEther(amount) : "?"} ETH</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Oracle List */}
        {oracleList && oracleList.length > 0 && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 mt-8 border border-slate-700">
            <h2 className="text-2xl font-semibold text-white mb-4">Registered Oracles</h2>
            <div className="grid gap-2">
              {oracleList.map((oracle, i) => (
                <OracleListItem key={i} oracle={oracle} isYou={oracle === connectedAddress} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-slate-400 text-sm">{label}</p>
          <p className="text-white text-xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}

function GameCard({
  gameId,
  isOracle,
  simulationResult,
  isSimulating,
  isSubmitting,
  onSimulate,
  onSubmit,
  onSubmitWrong,
}: {
  gameId: bigint;
  isOracle: boolean;
  simulationResult?: {
    resultHash: `0x${string}`;
    payout: bigint;
    tilesDiscovered: number;
    mushroomsFound: number;
    mapHash: `0x${string}`;
    positionsHash: `0x${string}`;
  };
  isSimulating: boolean;
  isSubmitting: boolean;
  onSimulate: (gameId: bigint, seed: `0x${string}`) => void;
  onSubmit: (gameId: bigint) => void;
  onSubmitWrong: (gameId: bigint) => void;
}) {
  // Fetch game details
  const { data: gameData } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGame",
    args: [gameId],
  });

  if (!gameData) return null;

  const [player, , seed, status] = gameData;

  return (
    <div className="bg-slate-700/50 rounded-xl p-4 border border-slate-600">
      <div className="flex items-center justify-between mb-3">
        <span className="text-amber-400 font-mono text-lg">Game #{gameId.toString()}</span>
        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
          {GameStatus[status as GameStatusType]}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Player</span>
          <Address address={player} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Seed</span>
          <span className="text-slate-300 font-mono text-xs truncate max-w-[200px]">{seed}</span>
        </div>
      </div>

      {simulationResult && (
        <div className="mt-4 bg-slate-800/50 rounded-lg p-3 space-y-2">
          <div className="text-sm font-semibold text-green-400 mb-2">Simulation Complete</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-slate-400">Tiles Discovered:</span>
              <span className="text-white ml-2">{simulationResult.tilesDiscovered}</span>
            </div>
            <div>
              <span className="text-slate-400">Mushrooms:</span>
              <span className="text-white ml-2">{simulationResult.mushroomsFound}</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-600">
            <span className="text-slate-400">Payout</span>
            <span className="text-amber-400 font-mono">{formatEther(simulationResult.payout)} ETH</span>
          </div>
        </div>
      )}

      {isOracle && (
        <div className="flex gap-3 mt-4">
          {!simulationResult ? (
            <button
              onClick={() => onSimulate(gameId, seed as `0x${string}`)}
              disabled={isSimulating}
              className="flex-1 py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-medium rounded-lg transition-all duration-200"
            >
              {isSimulating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⚙️</span> Simulating...
                </span>
              ) : (
                "Simulate Game"
              )}
            </button>
          ) : (
            <>
              <button
                onClick={() => onSubmit(gameId)}
                disabled={isSubmitting}
                className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white font-medium rounded-lg transition-all duration-200"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⏳</span> Submitting...
                  </span>
                ) : (
                  "Submit Result"
                )}
              </button>
              <button
                onClick={() => onSubmitWrong(gameId)}
                disabled={isSubmitting}
                className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white font-medium rounded-lg transition-all duration-200 border border-red-500"
                title="Submit incorrect result (half payout) for testing challenge system"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⏳</span> Submitting...
                  </span>
                ) : (
                  "Misbehave (Half Pay)"
                )}
              </button>
            </>
          )}
        </div>
      )}

      {!isOracle && (
        <div className="mt-4 text-center text-slate-400 text-sm">Become an oracle to resolve this game</div>
      )}
    </div>
  );
}

function OracleListItem({ oracle, isYou }: { oracle: string; isYou: boolean }) {
  // Fetch oracle's stake
  const { data: stake } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "oracleStakes",
    args: [oracle as `0x${string}`],
  });

  // Fetch if they're an active oracle
  const { data: isActive } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "isOracle",
    args: [oracle as `0x${string}`],
  });

  const stakeAmount = stake ? formatEther(stake) : "0";
  const isBelowThreshold = stake !== undefined && stake < ORACLE_STAKE_REQUIRED;

  return (
    <div
      className={`flex items-center justify-between rounded-lg p-3 ${
        isBelowThreshold ? "bg-red-900/20 border border-red-500/30" : "bg-slate-700/50"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-red-500"}`} />
        <Address address={oracle} />
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-mono text-sm ${isBelowThreshold ? "text-red-400" : "text-slate-400"}`}>
          {stakeAmount} ETH
        </span>
        {isBelowThreshold && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Slashed</span>}
        {isYou && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded">You</span>}
      </div>
    </div>
  );
}

export default OraclePage;
