"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { keccak256, toHex } from "viem";
import { GameRenderer } from "~~/components/GameRenderer";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import {
  AgentPool,
  GRID_SIZE,
  MAX_AGENTS,
  MAX_ROUNDS,
  MIN_SPAWN_DISTANCE,
  NUM_TEAMS,
  ROUND_DELAY,
  SPAWN_CUTOFF_ROUND,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  generateGrid,
  generateSpawnPoints,
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
  const { data: mapGeneratorContract } = useDeployedContractInfo({ contractName: "MapGeneratorWrapper" });

  // Call Solidity contract to generate map for parity verification
  const {
    data: solidityMap,
    isLoading: isLoadingSolidityMap,
    error: solidityMapError,
    isError: isSolidityMapError,
    status: solidityMapStatus,
    fetchStatus,
  } = useScaffoldReadContract({
    contractName: "MapGeneratorWrapper",
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

    // Generate spawn points for all teams within the valid tile area
    // Spawn points must be on flat ground tiles with at least 4 ground neighbors
    const spawnDice = new DeterministicDice(keccak256(toHex(roll + "spawn-points")));
    const spawnPoints = generateSpawnPoints(
      spawnDice,
      centerX,
      GRID_SIZE,
      NUM_TEAMS,
      MIN_SPAWN_DISTANCE,
      gridData.terrain,
    );
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
    const initDice = new DeterministicDice(keccak256(toHex(roll + "agent-init")));
    for (let team = 0; team < NUM_TEAMS; team++) {
      const spawn = spawnPoints[team];
      const randomDirection = initDice.roll(4) % 4; // 0=north, 1=east, 2=south, 3=west
      const randomVehicle = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
      pool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);

      // Reveal tiles around initial spawn position
      const { row, col } = worldToTile(spawn.x, spawn.y, centerX);
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
      const gameDice = new DeterministicDice(keccak256(toHex(roll + "round" + round)));

      // Update all agents in place (zero allocations)
      pool.updateAll(gameDice);

      // Reveal tiles around all agents after movement
      for (let i = 0; i < pool.count; i++) {
        const { row, col } = worldToTile(pool.x[i], pool.y[i], centerX);
        revealTilesAround(exploredTilesRef.current, row, col, GRID_SIZE);
      }

      // Spawn one new agent per team every 5 rounds (stop spawning after SPAWN_CUTOFF_ROUND)
      // For now, only spawn comms units (0 = heavy_comms, 6 = light_comms)
      const COMMS_TYPES = [0, 6];
      const nextRound = round + 1;
      if (nextRound % 5 === 0 && nextRound <= SPAWN_CUTOFF_ROUND) {
        const spawnDice = new DeterministicDice(keccak256(toHex(roll + "spawn" + round)));
        const spawnPoints = teamSpawnPointsRef.current;

        for (let team = 0; team < NUM_TEAMS; team++) {
          if (pool.count >= MAX_AGENTS) break;
          const spawn = spawnPoints[team];
          const randomDirection = spawnDice.roll(4) % 4;
          const randomVehicle = COMMS_TYPES[spawnDice.roll(COMMS_TYPES.length)];
          pool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);

          // Reveal tiles around newly spawned agent
          const { row, col } = worldToTile(spawn.x, spawn.y, centerX);
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
    <div className="h-screen w-screen bg-black overflow-hidden">
      {roll && (
        <div className="fixed top-6 left-6 font-mono text-white text-sm opacity-70 z-50">
          <div className="truncate max-w-[200px]">{roll}</div>
          <div className="mt-2">
            Round: {round} / {MAX_ROUNDS}
          </div>
          <div className="mt-1">Agents: {agentPoolRef.current.count}</div>
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
        <div className="flex items-center justify-center h-full w-full">
          <button
            onClick={handleRoll}
            className="px-8 py-4 text-2xl bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl border border-neutral-700 hover:border-neutral-500 transition-all duration-200 cursor-pointer"
          >
            🎲 Random Roll
          </button>
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
