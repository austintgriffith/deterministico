"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPool } from "~~/lib/game";

type WorkerState = "idle" | "ready" | "processing";

interface UseSimulationWorkerOptions {
  enabled?: boolean;
  maxAgents: number;
  onStateUpdate?: (x: Float32Array, y: Float32Array, direction: Uint8Array, count: number) => void;
}

interface UseSimulationWorkerReturn {
  isWorkerReady: boolean;
  workerState: WorkerState;
  reset: () => void;
  addAgent: (x: number, y: number, direction: number) => void;
  tick: (rollSeed: string) => void;
  // Fallback pool for non-worker mode
  fallbackPool: AgentPool | null;
}

/**
 * Hook for managing the simulation worker with main-thread fallback.
 *
 * When enabled, simulation runs in a Web Worker for smooth 60fps rendering.
 * Falls back to AgentPool on main thread if workers aren't available.
 */
export function useSimulationWorker({
  enabled = true,
  maxAgents,
  onStateUpdate,
}: UseSimulationWorkerOptions): UseSimulationWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const fallbackPoolRef = useRef<AgentPool | null>(null);
  const onStateUpdateRef = useRef(onStateUpdate);
  onStateUpdateRef.current = onStateUpdate;

  // Initialize worker on mount
  useEffect(() => {
    if (!enabled) {
      // Use fallback pool
      fallbackPoolRef.current = new AgentPool(maxAgents);
      setIsWorkerReady(true);
      return;
    }

    // Check if Web Workers are supported
    if (typeof Worker === "undefined") {
      console.warn("Web Workers not supported, using main thread fallback");
      fallbackPoolRef.current = new AgentPool(maxAgents);
      setIsWorkerReady(true);
      return;
    }

    try {
      // Create worker using URL constructor for Next.js compatibility
      const worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url));

      worker.onmessage = e => {
        const { type } = e.data;

        switch (type) {
          case "ready":
            setIsWorkerReady(true);
            setWorkerState("ready");
            break;

          case "resetComplete":
            setWorkerState("ready");
            break;

          case "agentAdded":
            setWorkerState("ready");
            break;

          case "tickComplete":
          case "state": {
            const { x, y, direction, count } = e.data;
            const xArr = new Float32Array(x);
            const yArr = new Float32Array(y);
            const dirArr = new Uint8Array(direction);
            onStateUpdateRef.current?.(xArr, yArr, dirArr, count);
            setWorkerState("ready");
            break;
          }
        }
      };

      worker.onerror = error => {
        console.error("Worker error:", error);
        // Fall back to main thread
        worker.terminate();
        workerRef.current = null;
        fallbackPoolRef.current = new AgentPool(maxAgents);
        setIsWorkerReady(true);
      };

      workerRef.current = worker;

      // Initialize the worker
      worker.postMessage({ type: "init", maxAgents });
    } catch (error) {
      console.warn("Failed to create worker, using fallback:", error);
      fallbackPoolRef.current = new AgentPool(maxAgents);
      setIsWorkerReady(true);
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [enabled, maxAgents]);

  const reset = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "reset" });
      setWorkerState("processing");
    } else if (fallbackPoolRef.current) {
      fallbackPoolRef.current.reset();
    }
  }, []);

  const addAgent = useCallback((x: number, y: number, direction: number) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "addAgent", x, y, direction });
      setWorkerState("processing");
    } else if (fallbackPoolRef.current) {
      fallbackPoolRef.current.add(x, y, direction);
    }
  }, []);

  const tick = useCallback((rollSeed: string) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "tick", rollSeed });
      setWorkerState("processing");
    } else if (fallbackPoolRef.current) {
      // Main thread fallback - import dice dynamically to avoid bundling issues
      import("deterministic-dice").then(({ DeterministicDice }) => {
        const dice = new DeterministicDice(rollSeed as `0x${string}`);
        fallbackPoolRef.current!.updateAll(dice);

        // Call the state update callback
        const pool = fallbackPoolRef.current!;
        onStateUpdateRef.current?.(
          pool.x.subarray(0, pool.count),
          pool.y.subarray(0, pool.count),
          pool.direction.subarray(0, pool.count),
          pool.count,
        );
      });
    }
  }, []);

  return {
    isWorkerReady,
    workerState,
    reset,
    addAgent,
    tick,
    fallbackPool: fallbackPoolRef.current,
  };
}
