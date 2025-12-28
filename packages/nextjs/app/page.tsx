"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { encodePacked, formatEther, keccak256, parseEther, toHex } from "viem";
import { useAccount } from "wagmi";
import { GameRenderer } from "~~/components/GameRenderer";
import { Header } from "~~/components/Header";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  AgentPool,
  FIXED_POINT_SCALE,
  GRID_SIZE,
  MAX_AGENTS,
  MAX_ROUNDS,
  NUM_TEAMS,
  ROUND_DELAY,
  SPAWN_CUTOFF_ROUND,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  generateGrid,
  worldToTile,
} from "~~/lib/game";
import type { SpawnPoint, TerrainType } from "~~/lib/game";

// Map Solidity enum values to TypeScript terrain types
const SOLIDITY_TO_TS_TERRAIN: Record<number, TerrainType> = {
  0: "ground",
  1: "mountain",
  2: "liquid",
  3: "mushroom",
  4: "rubyMountain",
};

// Payout constants (must match contract)
const PAYOUT_PER_TILE = BigInt("10000000000000"); // 0.00001 ether
const PAYOUT_PER_MUSHROOM = BigInt("100000000000000"); // 0.0001 ether

/**
 * Compare TypeScript terrain grid with Solidity contract output.
 * Returns true if they match exactly, false otherwise.
 */
function checkMapParity(
  tsGrid: TerrainType[][] | undefined,
  solidityGrid: readonly (readonly number[])[] | undefined,
): boolean {
  if (!tsGrid || !solidityGrid) return false;
  if (tsGrid.length !== solidityGrid.length) return false;

  for (let row = 0; row < tsGrid.length; row++) {
    if (tsGrid[row].length !== solidityGrid[row].length) return false;
    for (let col = 0; col < tsGrid[row].length; col++) {
      const tsTerrain = tsGrid[row][col];
      const solTerrain = SOLIDITY_TO_TS_TERRAIN[solidityGrid[row][col]];
      if (tsTerrain !== solTerrain) {
        console.warn(`Parity mismatch at [${row},${col}]: TS=${tsTerrain}, Sol=${solTerrain}`);
        return false;
      }
    }
  }
  return true;
}

/**
 * Reveal tiles around a given tile coordinate (center + 8 neighbors).
 * Uses "row,col" string keys for the Set.
 */
function revealTilesAround(exploredTiles: Set<string>, row: number, col: number, gridSize: number): void {
  // Offsets for center + 8 directions (N, NE, E, SE, S, SW, W, NW)
  const offsets = [
    [0, 0], // center
    [-1, 0], // north
    [-1, 1], // north-east
    [0, 1], // east
    [1, 1], // south-east
    [1, 0], // south
    [1, -1], // south-west
    [0, -1], // west
    [-1, -1], // north-west
  ];

  for (const [dr, dc] of offsets) {
    const newRow = row + dr;
    const newCol = col + dc;
    // Only add if within grid bounds
    if (newRow >= 0 && newRow < gridSize && newCol >= 0 && newCol < gridSize) {
      exploredTiles.add(`${newRow},${newCol}`);
    }
  }
}

const HomeContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roll = searchParams.get("roll");
  const { address: connectedAddress } = useAccount();

  // Game creation state
  const [pendingGameId, setPendingGameId] = useState<bigint | null>(null);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [isRevealingSeed, setIsRevealingSeed] = useState(false);

  // Agent pool (high-performance TypedArray-based storage)
  const agentPoolRef = useRef<AgentPool>(new AgentPool(MAX_AGENTS));
  const [round, setRound] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);

  // Team spawn points (one per team)
  const teamSpawnPointsRef = useRef<SpawnPoint[]>([]);

  // Random team to focus camera on at start
  const focusTeamIndexRef = useRef<number>(0);

  // Explored tiles for fog of war (Set of "row,col" strings)
  const exploredTilesRef = useRef<Set<string>>(new Set());

  // Force re-render counter for UI updates
  const [, forceUpdate] = useState(0);

  // Calculate map dimensions for agent spawn position
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + 80; // TILE_HEIGHT
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;

  // Generate grid (returns both tiles for rendering and terrain for movement)
  const gridData = useMemo(() => {
    if (!roll) return null;
    return generateGrid(roll as `0x${string}`, GRID_SIZE);
  }, [roll]);

  // Get deployed contract info for debugging
  const { data: mapGeneratorContract } = useDeployedContractInfo({ contractName: "MapGenerator" });

  // Call Solidity contract to generate map for parity verification
  const {
    data: solidityMap,
    isLoading: isLoadingSolidityMap,
    error: solidityMapError,
    isError: isSolidityMapError,
    status: solidityMapStatus,
    fetchStatus,
  } = useScaffoldReadContract({
    contractName: "MapGenerator",
    functionName: "generateMapDefault",
    args: [roll as `0x${string}`],
    query: {
      enabled: !!roll && !!mapGeneratorContract,
    },
  });

  // Debug logging for Solidity contract call
  useEffect(() => {
    console.log("🔍 Solidity Map Debug:", {
      roll,
      hasMapGeneratorContract: !!mapGeneratorContract,
      mapGeneratorContractAddress: mapGeneratorContract?.address,
      status: solidityMapStatus,
      fetchStatus,
      isLoading: isLoadingSolidityMap,
      isError: isSolidityMapError,
      error: solidityMapError?.message || solidityMapError,
      hasData: !!solidityMap,
      dataLength: solidityMap?.length,
      firstRow: solidityMap?.[0]?.slice(0, 5),
    });
  }, [
    roll,
    mapGeneratorContract,
    solidityMapStatus,
    fetchStatus,
    isLoadingSolidityMap,
    isSolidityMapError,
    solidityMapError,
    solidityMap,
  ]);

  // Check parity between TypeScript and Solidity map generation
  const parityStatus = useMemo(() => {
    if (!roll) return null;
    if (!mapGeneratorContract) return "loading"; // Contract not loaded yet
    if (isLoadingSolidityMap || fetchStatus === "fetching") return "loading";
    if (isSolidityMapError) return "error";
    if (!solidityMap) return "loading"; // Still waiting for data
    const isParity = checkMapParity(gridData?.terrain, solidityMap);
    return isParity ? "match" : "mismatch";
  }, [
    roll,
    mapGeneratorContract,
    gridData?.terrain,
    solidityMap,
    isLoadingSolidityMap,
    isSolidityMapError,
    fetchStatus,
  ]);

  // Compute game stats: tiles discovered, mushrooms found, payout
  const gameStats = useMemo(() => {
    if (!gridData?.terrain) return { tilesDiscovered: 0, mushroomsFound: 0, payout: 0n };

    const exploredTiles = exploredTilesRef.current;
    const tilesDiscovered = exploredTiles.size;

    let mushroomsFound = 0;
    exploredTiles.forEach(key => {
      const [rowStr, colStr] = key.split(",");
      const row = parseInt(rowStr);
      const col = parseInt(colStr);
      if (gridData.terrain[row]?.[col] === "mushroom") {
        mushroomsFound++;
      }
    });

    const payout = BigInt(tilesDiscovered) * PAYOUT_PER_TILE + BigInt(mushroomsFound) * PAYOUT_PER_MUSHROOM;

    return { tilesDiscovered, mushroomsFound, payout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridData?.terrain, round]); // Re-compute when round changes (tiles get discovered)

  // ========== GAME FACTORY CONTRACT HOOKS ==========

  // Write contract hook for GameFactory
  const { writeContractAsync: writeGameFactoryAsync } = useScaffoldWriteContract({
    contractName: "GameFactory",
  });

  // Read the latest game for the connected address
  const { data: latestGameId, refetch: refetchLatestGame } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getLatestGame",
    args: [connectedAddress],
    query: {
      enabled: !!connectedAddress && !roll,
    },
  });

  // Read the game details for pending game
  const { data: pendingGameData, refetch: refetchPendingGame } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGame",
    args: [pendingGameId ?? BigInt(0)],
    query: {
      enabled: pendingGameId !== null,
    },
  });

  // Check if we can reveal the seed
  const { data: canRevealData } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "canRevealSeed",
    args: [pendingGameId ?? BigInt(0)],
    query: {
      enabled: pendingGameId !== null,
      refetchInterval: 2000, // Poll every 2 seconds while waiting for next block
    },
  });

  // Load latest game on mount if user has one AND it's still in Created status
  useEffect(() => {
    if (latestGameId !== undefined && connectedAddress && !roll) {
      // Only set as pending if we'll check its status
      setPendingGameId(latestGameId);
    }
  }, [latestGameId, connectedAddress, roll]);

  // Clear pending game if it's already been revealed (status > 0)
  // This lets users create new games instead of being stuck on old ones
  useEffect(() => {
    if (pendingGameData && pendingGameData[3] !== 0) {
      // Game is not in Created status, clear it so user can create a new game
      setPendingGameId(null);
    }
  }, [pendingGameData]);

  // Create a new game
  const handleCreateGame = async () => {
    if (!connectedAddress) return;

    setIsCreatingGame(true);
    try {
      const result = await writeGameFactoryAsync({
        functionName: "createGame",
        value: parseEther("0.001"),
      });

      if (result) {
        // Refetch to get the new game ID
        await refetchLatestGame();
        // The useEffect will set pendingGameId when latestGameId updates
      }
    } catch (error) {
      console.error("Failed to create game:", error);
    } finally {
      setIsCreatingGame(false);
    }
  };

  // Reveal the seed for pending game
  const handleRevealSeed = async () => {
    if (pendingGameId === null) return;

    setIsRevealingSeed(true);
    try {
      const txResult = await writeGameFactoryAsync({
        functionName: "revealSeed",
        args: [pendingGameId],
      });

      console.log("revealSeed transaction result:", txResult);

      // Refetch game data to get the revealed seed
      const result = await refetchPendingGame();
      console.log("Refetched game data:", result.data);

      // Navigate directly using the refetch result
      if (result.data) {
        const seed = result.data[2];
        const status = result.data[3];
        console.log("Game seed:", seed, "status:", status);

        if (seed && seed !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
          router.push(`?roll=${seed}`);
          setPendingGameId(null);
          return;
        }
      }
    } catch (error) {
      console.error("Failed to reveal seed:", error);
      alert("Failed to reveal seed. Please try again.");
    } finally {
      setIsRevealingSeed(false);
    }
  };

  // Initialize agent pool and team spawn points when roll changes
  useEffect(() => {
    const pool = agentPoolRef.current;
    pool.reset();

    // Reset explored tiles for new game
    exploredTilesRef.current = new Set();

    if (!roll || !gridData) {
      setRound(0);
      setRendererReady(false);
      teamSpawnPointsRef.current = [];
      return;
    }

    // Set map bounds for boundary checking
    pool.setMapBounds(centerX, GRID_SIZE);

    // Set terrain grid for movement restrictions (agents can only move on ground tiles)
    pool.setTerrainGrid(gridData.terrain);

    // Generate spawn point - simplified to match Oracle/ChallengeExecutor:
    // Start at center tile, if not ground, search randomly nearby
    // MUST use encodePacked for Solidity parity!
    const spawnDice = new DeterministicDice(
      keccak256(encodePacked(["bytes32", "string"], [roll as `0x${string}`, "spawn-points"])),
    );

    // Simplified spawn point generation to match Oracle
    const centerTile = Math.floor(GRID_SIZE / 2);
    let spawnRow = centerTile;
    let spawnCol = centerTile;

    // If center isn't ground, search randomly for a ground tile
    if (gridData.terrain[spawnRow][spawnCol] !== "ground") {
      for (let attempts = 0; attempts < 100; attempts++) {
        // Random offset from center (-5 to +5) - matches Oracle/Solidity
        const dr = spawnDice.roll(11) - 5;
        const dc = spawnDice.roll(11) - 5;
        const testRow = centerTile + dr;
        const testCol = centerTile + dc;

        if (testRow >= 0 && testRow < GRID_SIZE && testCol >= 0 && testCol < GRID_SIZE) {
          if (gridData.terrain[testRow][testCol] === "ground") {
            spawnRow = testRow;
            spawnCol = testCol;
            break;
          }
        }
      }
    }

    // Convert to world coordinates using tileCenterToWorld equivalent
    // TILE_START_Y=34, TILE_RENDER_HEIGHT=200, TILE_STEP_Y=166, TILE_Y_SPACING=47, TILE_RENDER_WIDTH=200
    const scaledTopOffset = (34 * 200) / 166; // ~41
    const tileCenterYOffset = scaledTopOffset + TILE_Y_SPACING; // ~88
    const spawnX = centerX + (spawnCol - spawnRow) * TILE_X_SPACING + TILE_WIDTH / 2;
    const spawnY = (spawnCol + spawnRow) * TILE_Y_SPACING + tileCenterYOffset;

    const spawnPoints = [{ x: spawnX, y: spawnY }];
    teamSpawnPointsRef.current = spawnPoints;

    // Set team spawn points for comms gravity behavior
    for (let team = 0; team < NUM_TEAMS; team++) {
      pool.setTeamSpawn(team, spawnPoints[team].x, spawnPoints[team].y);
    }

    // Pick a random team to focus camera on
    const focusDice = new DeterministicDice(keccak256(toHex(roll + "focus-team")));
    focusTeamIndexRef.current = focusDice.roll(NUM_TEAMS);

    // Initialize one agent per team at their spawn point
    // For now, only spawn comms units (0 = heavy_comms, 6 = light_comms)
    const COMMS_TYPES = [0, 6];
    // MUST use encodePacked for Solidity parity!
    const initDice = new DeterministicDice(
      keccak256(encodePacked(["bytes32", "string"], [roll as `0x${string}`, "agent-init"])),
    );
    for (let team = 0; team < NUM_TEAMS; team++) {
      const spawn = spawnPoints[team];
      const randomDirection = initDice.roll(4) % 4; // 0=north, 1=east, 2=south, 3=west
      const randomVehicle = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
      pool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);

      // Reveal tiles around initial spawn position
      // worldToTile expects fixed-point values, so convert world coordinates
      const centerXFP = centerX * FIXED_POINT_SCALE;
      const { row, col } = worldToTile(spawn.x * FIXED_POINT_SCALE, spawn.y * FIXED_POINT_SCALE, centerXFP);
      revealTilesAround(exploredTilesRef.current, row, col, GRID_SIZE);
    }

    setRound(0);
  }, [roll, centerX, gridData]);

  // Game loop - uses AgentPool.updateAll() for zero-allocation updates
  useEffect(() => {
    if (!roll || !rendererReady || round >= MAX_ROUNDS) return;

    const pool = agentPoolRef.current;
    if (pool.count === 0) return;

    const timer = setTimeout(() => {
      // MUST use encodePacked for Solidity parity!
      const gameDice = new DeterministicDice(
        keccak256(encodePacked(["bytes32", "string", "uint32"], [roll as `0x${string}`, "round", round])),
      );

      // Update all agents in place (zero allocations)
      pool.updateAll(gameDice);

      // Reveal tiles around all agents after movement
      // pool.x and pool.y are already in fixed-point, centerX needs conversion
      const centerXFP = centerX * FIXED_POINT_SCALE;
      for (let i = 0; i < pool.count; i++) {
        const { row, col } = worldToTile(pool.x[i], pool.y[i], centerXFP);
        revealTilesAround(exploredTilesRef.current, row, col, GRID_SIZE);
      }

      // Spawn one new agent per team every 5 rounds (stop spawning after SPAWN_CUTOFF_ROUND)
      // For now, only spawn comms units (0 = heavy_comms, 6 = light_comms)
      const COMMS_TYPES = [0, 6];
      const nextRound = round + 1;
      if (nextRound % 5 === 0 && nextRound <= SPAWN_CUTOFF_ROUND) {
        // MUST use encodePacked for Solidity parity!
        const spawnDice = new DeterministicDice(
          keccak256(encodePacked(["bytes32", "string", "uint32"], [roll as `0x${string}`, "spawn", round])),
        );
        const spawnPoints = teamSpawnPointsRef.current;

        for (let team = 0; team < NUM_TEAMS; team++) {
          if (pool.count >= MAX_AGENTS) break;
          const spawn = spawnPoints[team];
          const randomDirection = spawnDice.roll(4) % 4;
          const randomVehicle = COMMS_TYPES[spawnDice.roll(COMMS_TYPES.length)];
          pool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);

          // Reveal tiles around newly spawned agent
          // worldToTile expects fixed-point values
          const { row, col } = worldToTile(spawn.x * FIXED_POINT_SCALE, spawn.y * FIXED_POINT_SCALE, centerXFP);
          revealTilesAround(exploredTilesRef.current, row, col, GRID_SIZE);
        }
      }

      setRound(nextRound);
      forceUpdate(n => n + 1); // Trigger re-render for UI count update
    }, ROUND_DELAY);

    return () => clearTimeout(timer);
  }, [roll, round, rendererReady, mapWidth, mapHeight, centerX]);

  const handleRoll = () => {
    const randomNumber = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const hash = keccak256(toHex(randomNumber));
    router.push(`?roll=${hash}`);
  };

  const handleExit = () => {
    router.push("/");
  };

  const handleRendererReady = useCallback(() => {
    setRendererReady(true);
  }, []);

  return (
    <div className="h-screen w-screen bg-black overflow-hidden flex flex-col">
      {!roll && <Header />}
      {roll && (
        <div className="fixed top-6 left-6 font-mono text-white text-sm opacity-70 z-50">
          <div className="truncate max-w-[200px]">{roll}</div>
          <div className="mt-2">
            Round: {round} / {MAX_ROUNDS}
          </div>
          <div className="mt-1">Agents: {agentPoolRef.current.count}</div>
          <div className="mt-1">Tiles: {gameStats.tilesDiscovered}</div>
          <div className="mt-1">🍄 Mushrooms: {gameStats.mushroomsFound}</div>
          <div className="mt-1 text-amber-400">💰 Payout: {formatEther(gameStats.payout)} ETH</div>
          <div className="mt-2 flex items-center gap-2">
            <span>Solidity Parity:</span>
            {parityStatus === "loading" && <span className="text-yellow-400">⏳</span>}
            {parityStatus === "match" && <span className="text-green-400">✓</span>}
            {parityStatus === "mismatch" && <span className="text-red-400">✗</span>}
            {parityStatus === "error" && (
              <span className="text-orange-400" title={solidityMapError?.message || "Unknown error"}>
                ⚠
              </span>
            )}
          </div>
          {isSolidityMapError && (
            <div className="mt-1 text-orange-400 text-xs max-w-[250px] break-words">
              {solidityMapError?.message?.slice(0, 100) || "Contract call failed"}
            </div>
          )}
        </div>
      )}

      {roll && (
        <div className="fixed top-6 right-6 flex gap-3 z-50">
          <button
            onClick={handleRoll}
            className="px-4 py-2 text-lg bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg border border-neutral-700 hover:border-neutral-500 transition-all duration-200 cursor-pointer"
          >
            🎲
          </button>
          <button
            onClick={handleExit}
            className="px-4 py-2 text-lg bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg border border-neutral-700 hover:border-neutral-500 transition-all duration-200 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {roll && gridData && (
        <GameRenderer
          grid={gridData.tiles}
          terrainGrid={gridData.terrain}
          agentPool={agentPoolRef.current}
          teamSpawnPoints={teamSpawnPointsRef.current}
          focusTeamIndex={focusTeamIndexRef.current}
          exploredTiles={exploredTilesRef.current}
          onReady={handleRendererReady}
        />
      )}

      {roll && !gridData && (
        <div className="flex items-center justify-center h-full w-full">
          <div className="text-white">Loading...</div>
        </div>
      )}

      {!roll && (
        <div className="flex flex-col items-center justify-center flex-1 w-full gap-6">
          {!connectedAddress ? (
            <div className="text-center">
              <p className="text-neutral-400 text-lg mb-4">Connect your wallet to play</p>
              <p className="text-neutral-500 text-sm">Game cost: 0.001 ETH</p>
            </div>
          ) : pendingGameId !== null && pendingGameData && !pendingGameData[3] ? (
            // Has a pending game that needs seed reveal
            <div className="flex flex-col items-center gap-4">
              <div className="text-center mb-2">
                <p className="text-neutral-300 text-lg">Game #{pendingGameId.toString()} created!</p>
                <p className="text-neutral-500 text-sm mt-1">
                  {canRevealData?.[0] ? "Ready to start" : canRevealData?.[1] || "Waiting for next block..."}
                </p>
              </div>
              <button
                onClick={handleRevealSeed}
                disabled={isRevealingSeed || !canRevealData?.[0]}
                className={`px-8 py-4 text-2xl rounded-xl border transition-all duration-200 ${
                  canRevealData?.[0]
                    ? "bg-emerald-900 hover:bg-emerald-800 text-white border-emerald-700 hover:border-emerald-500 cursor-pointer"
                    : "bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed"
                }`}
              >
                {isRevealingSeed ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span> Starting...
                  </span>
                ) : (
                  "🎮 Start Game"
                )}
              </button>
              <button
                onClick={handleCreateGame}
                disabled={isCreatingGame}
                className="px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-lg border border-neutral-700 hover:border-neutral-600 transition-all duration-200 cursor-pointer"
              >
                Create New Game Instead
              </button>
            </div>
          ) : (
            // No pending game, show create button
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={handleCreateGame}
                disabled={isCreatingGame}
                className="px-8 py-4 text-2xl bg-amber-900 hover:bg-amber-800 text-white rounded-xl border border-amber-700 hover:border-amber-500 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingGame ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span> Creating...
                  </span>
                ) : (
                  "🎲 Create Game (0.001 ETH)"
                )}
              </button>
              <p className="text-neutral-500 text-sm">Pay to create a game, then reveal your seed</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Home: NextPage = () => {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white">Loading...</div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
};

export default Home;
