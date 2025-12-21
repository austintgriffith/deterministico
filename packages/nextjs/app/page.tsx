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
  ROUND_DELAY,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  generateGrid,
} from "~~/lib/game";

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

  // Force re-render counter for UI updates
  const [, forceUpdate] = useState(0);

  // Calculate map dimensions for agent spawn position
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + 80; // TILE_HEIGHT

  // Generate grid
  const grid = useMemo(() => {
    if (!roll) return [];
    return generateGrid(roll as `0x${string}`, GRID_SIZE);
  }, [roll]);

  // Initialize agent pool when roll changes
  useEffect(() => {
    const pool = agentPoolRef.current;
    pool.reset();

    if (!roll) {
      setRound(0);
      setRendererReady(false);
      return;
    }

    const initDice = new DeterministicDice(keccak256(toHex(roll + "agent-init")));
    const randomDirection = initDice.roll(4) % 4; // 0=north, 1=east, 2=south, 3=west

    const agentStartX = mapWidth / 2;
    const agentStartY = mapHeight / 2;

    pool.add(agentStartX, agentStartY, randomDirection);
    setRound(0);
  }, [roll, mapWidth, mapHeight]);

  // Game loop - uses AgentPool.updateAll() for zero-allocation updates
  useEffect(() => {
    if (!roll || !rendererReady || round >= MAX_ROUNDS) return;

    const pool = agentPoolRef.current;
    if (pool.count === 0) return;

    const timer = setTimeout(() => {
      const gameDice = new DeterministicDice(keccak256(toHex(roll + "round" + round)));

      // Update all agents in place (zero allocations)
      pool.updateAll(gameDice);

      // Spawn new agent every 5 rounds
      const nextRound = round + 1;
      if (nextRound % 5 === 0 && nextRound < MAX_ROUNDS && pool.count < MAX_AGENTS) {
        const spawnDice = new DeterministicDice(keccak256(toHex(roll + "spawn" + round)));
        const randomDirection = spawnDice.roll(4) % 4;
        pool.add(mapWidth / 2, mapHeight / 2, randomDirection);
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
        <GameRenderer grid={grid} agentPool={agentPoolRef.current} onReady={handleRendererReady} />
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
