"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { keccak256, toHex } from "viem";
import { GameRenderer } from "~~/components/GameRenderer";
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
} from "~~/lib/game";

// Spawn point type for team bases
type SpawnPoint = { x: number; y: number };

/**
 * Convert tile coordinates (row, col) to world coordinates
 */
function tileToWorld(row: number, col: number, centerX: number): { x: number; y: number } {
  return {
    x: centerX + (col - row) * TILE_X_SPACING,
    y: (col + row) * TILE_Y_SPACING,
  };
}

/**
 * Check if a point is far enough from all existing spawn points
 */
function isFarEnough(x: number, y: number, spawns: SpawnPoint[], minDistance: number): boolean {
  for (const spawn of spawns) {
    const dx = x - spawn.x;
    const dy = y - spawn.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < minDistance) {
      return false;
    }
  }
  return true;
}

/**
 * Generate spawn points for all teams within the valid tile area
 * Uses tile coordinates to ensure spawns are always on the map
 */
function generateSpawnPoints(
  dice: DeterministicDice,
  centerX: number,
  gridSize: number,
  numTeams: number,
  minDistance: number,
): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  const tileMargin = 10; // Stay this many tiles away from edges

  for (let team = 0; team < numTeams; team++) {
    let attempts = 0;
    let worldX: number, worldY: number;

    do {
      // Generate random tile coordinates within bounds
      const row = tileMargin + dice.roll(gridSize - 2 * tileMargin);
      const col = tileMargin + dice.roll(gridSize - 2 * tileMargin);

      // Convert to world coordinates
      const world = tileToWorld(row, col, centerX);
      worldX = world.x;
      worldY = world.y;
      attempts++;
    } while (!isFarEnough(worldX, worldY, spawns, minDistance) && attempts < 100);

    spawns.push({ x: worldX, y: worldY });
  }

  return spawns;
}

/**
 * Performance Configuration
 *
 * USE_WORKER: Enable Web Worker for off-main-thread simulation.
 * Set to true for maximum performance with 1000+ agents.
 * The worker keeps simulation computation off the main thread,
 * allowing the renderer to maintain smooth 60fps.
 *
 * To enable: set USE_WORKER = true and import useSimulationWorker hook.
 * See workers/simulation.worker.ts and hooks/useSimulationWorker.ts
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USE_WORKER = false;

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

  // Force re-render counter for UI updates
  const [, forceUpdate] = useState(0);

  // Calculate map dimensions for agent spawn position
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + 80; // TILE_HEIGHT
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;

  // Generate grid
  const grid = useMemo(() => {
    if (!roll) return [];
    return generateGrid(roll as `0x${string}`, GRID_SIZE);
  }, [roll]);

  // Initialize agent pool and team spawn points when roll changes
  useEffect(() => {
    const pool = agentPoolRef.current;
    pool.reset();

    if (!roll) {
      setRound(0);
      setRendererReady(false);
      teamSpawnPointsRef.current = [];
      return;
    }

    // Set map bounds for boundary checking
    pool.setMapBounds(centerX, GRID_SIZE);

    // Generate spawn points for all teams within the valid tile area
    const spawnDice = new DeterministicDice(keccak256(toHex(roll + "spawn-points")));
    const spawnPoints = generateSpawnPoints(spawnDice, centerX, GRID_SIZE, NUM_TEAMS, MIN_SPAWN_DISTANCE);
    teamSpawnPointsRef.current = spawnPoints;

    // Set team spawn points for comms gravity behavior
    for (let team = 0; team < NUM_TEAMS; team++) {
      pool.setTeamSpawn(team, spawnPoints[team].x, spawnPoints[team].y);
    }

    // Pick a random team to focus camera on
    const focusDice = new DeterministicDice(keccak256(toHex(roll + "focus-team")));
    focusTeamIndexRef.current = focusDice.roll(NUM_TEAMS);

    // Initialize one agent per team at their spawn point
    // For now, only spawn comms units (0 = heavy_comms, 3 = light_comms)
    const COMMS_TYPES = [0, 3];
    const initDice = new DeterministicDice(keccak256(toHex(roll + "agent-init")));
    for (let team = 0; team < NUM_TEAMS; team++) {
      const spawn = spawnPoints[team];
      const randomDirection = initDice.roll(4) % 4; // 0=north, 1=east, 2=south, 3=west
      const randomVehicle = COMMS_TYPES[initDice.roll(COMMS_TYPES.length)];
      pool.add(spawn.x, spawn.y, randomDirection, team, randomVehicle);
    }

    setRound(0);
  }, [roll, centerX]);

  // Game loop - uses AgentPool.updateAll() for zero-allocation updates
  useEffect(() => {
    if (!roll || !rendererReady || round >= MAX_ROUNDS) return;

    const pool = agentPoolRef.current;
    if (pool.count === 0) return;

    const timer = setTimeout(() => {
      const gameDice = new DeterministicDice(keccak256(toHex(roll + "round" + round)));

      // Update all agents in place (zero allocations)
      pool.updateAll(gameDice);

      // Spawn one new agent per team every 5 rounds (stop spawning after SPAWN_CUTOFF_ROUND)
      // For now, only spawn comms units (0 = heavy_comms, 3 = light_comms)
      const COMMS_TYPES = [0, 3];
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
        }
      }

      setRound(nextRound);
      forceUpdate(n => n + 1); // Trigger re-render for UI count update
    }, ROUND_DELAY);

    return () => clearTimeout(timer);
  }, [roll, round, rendererReady, mapWidth, mapHeight]);

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

      {roll && grid.length > 0 && (
        <GameRenderer
          grid={grid}
          agentPool={agentPoolRef.current}
          teamSpawnPoints={teamSpawnPointsRef.current}
          focusTeamIndex={focusTeamIndexRef.current}
          onReady={handleRendererReady}
        />
      )}

      {roll && grid.length === 0 && (
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
