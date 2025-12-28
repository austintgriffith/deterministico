"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { Header } from "~~/components/Header";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

// Game status enum matching the contract
const GameStatus = {
  0: "Created",
  1: "SeedRevealed",
  2: "ResultSubmitted",
  3: "Challenged",
  4: "Finalized",
  5: "Claimed",
} as const;

const StatusColors: Record<number, string> = {
  0: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  1: "bg-blue-900/50 text-blue-300 border-blue-700",
  2: "bg-purple-900/50 text-purple-300 border-purple-700",
  3: "bg-red-900/50 text-red-300 border-red-700",
  4: "bg-green-900/50 text-green-300 border-green-700",
  5: "bg-neutral-800/50 text-neutral-400 border-neutral-600",
};

// Challenge period from contract (1 minute)
const CHALLENGE_PERIOD = 1 * 60;

// Challenge stake from contract (0.01 ETH)
const CHALLENGE_STAKE = parseEther("0.01");

// Challenge execution window (30 minutes)
const CHALLENGE_EXECUTION_WINDOW = 30 * 60;

// Max rounds for simulation
const MAX_ROUNDS = 100;

// Batch size options for simulation (user can select)
const BATCH_SIZE_OPTIONS = [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const DEFAULT_BATCH_SIZE = 50;

// Countdown timer component
const CountdownTimer = ({ targetTime, onComplete }: { targetTime: number; onComplete?: () => void }) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = targetTime - now;
      return Math.max(0, remaining);
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining === 0) {
        onComplete?.();
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime, onComplete]);

  if (timeLeft === 0) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <span className="font-mono text-amber-400">
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
};

// Challenge Execution Panel component
const ChallengeExecutionPanel = ({ gameId, challenger }: { gameId: bigint; challenger: string }) => {
  const { address: connectedAddress } = useAccount();
  const [isStarting, setIsStarting] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);

  // Read challenge state from ChallengeExecutor
  // Returns: initialized, finalized, challenger, seed, currentRound, agentCount, tilesDiscovered, mushroomsFound
  const { data: challengeState, refetch: refetchChallenge } = useScaffoldReadContract({
    contractName: "ChallengeExecutor",
    functionName: "getChallenge",
    args: [gameId],
  });

  // Check if challenge can be started (for debugging)
  const { data: canStartData } = useScaffoldReadContract({
    contractName: "ChallengeExecutor",
    functionName: "canStartChallenge",
    args: [gameId],
    query: {
      enabled: challengeState?.[0] !== true, // Only when not initialized
    },
  });

  // Read estimated payout
  const { data: estimatedPayout } = useScaffoldReadContract({
    contractName: "ChallengeExecutor",
    functionName: "getEstimatedPayout",
    args: [gameId],
    query: {
      enabled: challengeState?.[0] === true, // Only when initialized
    },
  });

  // Read oracle result for comparison
  const { data: gameResult } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGameResult",
    args: [gameId],
  });

  const { writeContractAsync: writeChallengeExecutor, isPending } = useScaffoldWriteContract({
    contractName: "ChallengeExecutor",
  });

  const isChallenger = connectedAddress?.toLowerCase() === challenger?.toLowerCase();
  const isInitialized = challengeState?.[0] === true;
  const isFinalized = challengeState?.[1] === true;
  const currentRound = challengeState ? Number(challengeState[4]) : 0;
  const agentCount = challengeState ? Number(challengeState[5]) : 0;
  const tilesDiscovered = challengeState ? Number(challengeState[6]) : 0;
  const mushroomsFound = challengeState ? Number(challengeState[7]) : 0;
  const isSimulationComplete = currentRound >= MAX_ROUNDS;
  const oraclePayout = gameResult ? gameResult[1] : 0n;
  const canStart = canStartData?.[0] ?? false;
  const canStartReason = canStartData?.[1] ?? "";

  const handleStartChallenge = async () => {
    setIsStarting(true);
    setErrorMsg(null);
    try {
      await writeChallengeExecutor({
        functionName: "startChallenge",
        args: [gameId],
      });
      refetchChallenge();
    } catch (e: unknown) {
      console.error("Error starting challenge:", e);
      const errStr = e instanceof Error ? e.message : String(e);
      setErrorMsg(errStr.slice(0, 200));
    } finally {
      setIsStarting(false);
    }
  };

  const handleSimulateBatch = async () => {
    setIsSimulating(true);
    setErrorMsg(null);
    try {
      await writeChallengeExecutor({
        functionName: "simulateBatch",
        args: [gameId, batchSize],
      });
      refetchChallenge();
    } catch (e: unknown) {
      console.error("Error simulating batch:", e);
      const errStr = e instanceof Error ? e.message : String(e);
      // If out of gas, suggest reducing batch size
      if (errStr.includes("OutOfGas") || errStr.includes("out of gas")) {
        setErrorMsg(`Out of gas! Try reducing batch size to ${batchSize > 5 ? batchSize - 5 : 5} rounds.`);
      } else {
        setErrorMsg(errStr.slice(0, 200));
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const handleFinalize = async () => {
    setIsFinalizing(true);
    setErrorMsg(null);
    try {
      await writeChallengeExecutor({
        functionName: "finalize",
        args: [gameId],
      });
      refetchChallenge();
    } catch (e: unknown) {
      console.error("Error finalizing challenge:", e);
      const errStr = e instanceof Error ? e.message : String(e);
      // Check for ChallengeWindowExpired error
      if (errStr.includes("0x561f7f8a") || errStr.includes("ChallengeWindowExpired")) {
        setErrorMsg(
          "⚠️ Challenge execution window expired! The 30-minute window to complete the challenge has passed. " +
            "Go back to the game list and click 'Finalize (Oracle Wins)' to close the game with the oracle's result.",
        );
      } else {
        setErrorMsg(errStr.slice(0, 200));
      }
    } finally {
      setIsFinalizing(false);
    }
  };

  // Check if challenge window has expired
  const challengedAt = gameResult ? Number(gameResult[5]) : 0;
  const executionDeadline = challengedAt + CHALLENGE_EXECUTION_WINDOW;
  const now = Math.floor(Date.now() / 1000);
  const windowExpired = challengedAt > 0 && now > executionDeadline;

  if (!isChallenger) {
    return (
      <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
        <p className="text-neutral-500 text-sm">Waiting for challenger to execute on-chain verification...</p>
      </div>
    );
  }

  // If window expired, show warning
  if (windowExpired) {
    return (
      <div className="p-4 bg-amber-950/30 rounded-lg border border-amber-900/50">
        <h4 className="text-amber-300 font-medium mb-3">⚠️ Challenge Window Expired</h4>
        <p className="text-amber-200 text-sm mb-3">
          The 30-minute challenge execution window has expired. Since the challenge wasn&apos;t completed in time, the
          oracle&apos;s result will be used.
        </p>
        <p className="text-neutral-400 text-sm">
          Go back to the game list and click <strong>&quot;Finalize (Oracle Wins)&quot;</strong> to close the game and
          allow the player to claim their payout.
        </p>
        {isSimulationComplete && estimatedPayout && (
          <div className="mt-3 p-2 bg-neutral-900/50 rounded text-sm">
            <p className="text-neutral-500">
              Your on-chain simulation found: {tilesDiscovered} tiles, {mushroomsFound} mushrooms
            </p>
            <p className="text-neutral-500">
              Correct payout would have been: <span className="text-green-400">{formatEther(estimatedPayout)} ETH</span>
            </p>
            <p className="text-neutral-500">
              Oracle claimed: <span className="text-red-400">{formatEther(oraclePayout)} ETH</span>
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 bg-red-950/30 rounded-lg border border-red-900/50">
      <h4 className="text-red-300 font-medium mb-3">Challenge Execution</h4>

      {errorMsg && <p className="text-red-400 text-xs bg-red-900/30 p-2 rounded mb-3">{errorMsg}</p>}

      {!isInitialized ? (
        /* Step 1: Initialize challenge */
        <div className="space-y-3">
          <p className="text-neutral-400 text-sm">
            <span className="text-red-400 font-medium">Step 1:</span> Initialize the challenge and spawn first agent.
          </p>
          {!canStart && canStartReason && <p className="text-yellow-500 text-xs">Status: {canStartReason}</p>}
          <button
            onClick={handleStartChallenge}
            disabled={isStarting || isPending}
            className="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 rounded border border-red-700 hover:border-red-500 transition-all disabled:opacity-50"
          >
            {isStarting ? "Initializing..." : "1. Initialize Challenge"}
          </button>
        </div>
      ) : isFinalized ? (
        <div className="space-y-2">
          <p className="text-green-400 text-sm">✓ Challenge verification complete!</p>
        </div>
      ) : (
        /* Step 2 & 3: Simulate and Finalize */
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">
                <span className="text-red-400 font-medium">Step 2:</span> Simulation Progress
              </span>
              <span className="text-neutral-300 font-mono">
                {currentRound} / {MAX_ROUNDS} rounds
              </span>
            </div>
            <div className="w-full bg-neutral-800 rounded-full h-2">
              <div
                className="bg-red-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(currentRound / MAX_ROUNDS) * 100}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-neutral-900/50 p-2 rounded">
              <span className="text-neutral-500">Agents:</span>{" "}
              <span className="text-neutral-300 font-mono">{agentCount}</span>
            </div>
            <div className="bg-neutral-900/50 p-2 rounded">
              <span className="text-neutral-500">Tiles:</span>{" "}
              <span className="text-neutral-300 font-mono">{tilesDiscovered}</span>
            </div>
            <div className="bg-neutral-900/50 p-2 rounded">
              <span className="text-neutral-500">Mushrooms:</span>{" "}
              <span className="text-neutral-300 font-mono">{mushroomsFound}</span>
            </div>
            <div className="bg-neutral-900/50 p-2 rounded">
              <span className="text-neutral-500">Est. Payout:</span>{" "}
              <span className="text-neutral-300 font-mono">
                {estimatedPayout ? formatEther(estimatedPayout) : "0"} ETH
              </span>
            </div>
          </div>

          {/* Oracle comparison */}
          <div className="p-3 bg-neutral-900/50 rounded border border-neutral-800">
            <p className="text-sm text-neutral-400 mb-1">Oracle&apos;s Claimed Payout:</p>
            <p className="text-lg font-mono text-purple-400">{formatEther(oraclePayout)} ETH</p>
          </div>

          {/* Batch size selector */}
          {!isSimulationComplete && (
            <div className="flex items-center gap-3">
              <span className="text-neutral-400 text-sm">Rounds per batch:</span>
              <div className="flex gap-1">
                {BATCH_SIZE_OPTIONS.map(size => (
                  <button
                    key={size}
                    onClick={() => setBatchSize(size)}
                    className={`px-3 py-1 text-sm rounded border transition-all ${
                      batchSize === size
                        ? "bg-red-900 text-red-200 border-red-600"
                        : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-neutral-600"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {!isSimulationComplete ? (
              <button
                onClick={handleSimulateBatch}
                disabled={isSimulating || isPending}
                className="flex-1 px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 rounded border border-red-700 hover:border-red-500 transition-all disabled:opacity-50"
              >
                {isSimulating ? "Simulating..." : `2. Run ${batchSize} Rounds`}
              </button>
            ) : (
              <button
                onClick={handleFinalize}
                disabled={isFinalizing || isPending}
                className="flex-1 px-4 py-2 bg-green-900 hover:bg-green-800 text-green-200 rounded border border-green-700 hover:border-green-500 transition-all disabled:opacity-50"
              >
                {isFinalizing ? "Finalizing..." : "3. Complete Challenge"}
              </button>
            )}
          </div>

          {!isSimulationComplete && (
            <p className="text-xs text-neutral-500 text-center">
              Reduce batch size if you hit gas limits. Smaller = safer but more transactions.
            </p>
          )}

          {isSimulationComplete && (
            <p className="text-xs text-neutral-500 text-center">
              Simulation complete! Click &quot;3. Complete Challenge&quot; to verify result on-chain.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// Individual game row component
const GameRow = ({ gameId }: { gameId: bigint }) => {
  const router = useRouter();
  const [canFinalizeNow, setCanFinalizeNow] = useState(false);
  const [isChallenging, setIsChallenging] = useState(false);

  const { data: gameData, refetch: refetchGame } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGame",
    args: [gameId],
  });

  const { data: canReveal } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "canRevealSeed",
    args: [gameId],
    query: {
      enabled: gameData?.[3] === 0, // Only check if status is Created
    },
  });

  const { data: gameResult, refetch: refetchGameResult } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getGameResult",
    args: [gameId],
    query: {
      enabled: gameData && Number(gameData[3]) >= 2, // Only fetch if ResultSubmitted or later
    },
  });

  const { data: canFinalizeData, refetch: refetchCanFinalize } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "canFinalize",
    args: [gameId],
    query: {
      enabled: gameData && Number(gameData[3]) === 2, // Only check if ResultSubmitted
    },
  });

  const { data: canChallengeData } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "canChallenge",
    args: [gameId],
    query: {
      enabled: gameData && Number(gameData[3]) === 2, // Only check if ResultSubmitted
    },
  });

  const { writeContractAsync: writeGameFactory, isPending } = useScaffoldWriteContract({
    contractName: "GameFactory",
  });

  if (!gameData) {
    return (
      <tr className="border-b border-neutral-800">
        <td colSpan={5} className="px-4 py-3 text-neutral-500">
          Loading game #{gameId.toString()}...
        </td>
      </tr>
    );
  }

  const [, , seed, status] = gameData;
  const statusNum = Number(status);
  const statusText = GameStatus[statusNum as keyof typeof GameStatus] || "Unknown";
  const statusColor = StatusColors[statusNum] || "bg-neutral-800 text-neutral-400";

  const hasSeed = seed && seed !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Calculate finalization time for ResultSubmitted games
  const submittedAt = gameResult ? Number(gameResult[3]) : 0;
  const finalizationTime = submittedAt + CHALLENGE_PERIOD;
  const payout = gameResult ? gameResult[1] : 0n;

  const handleViewGame = () => {
    if (statusNum === 0) {
      router.push("/");
    } else if (hasSeed) {
      router.push(`/?roll=${seed}`);
    }
  };

  const handleFinalize = async () => {
    try {
      await writeGameFactory({
        functionName: "finalizeGame",
        args: [gameId],
      });
      refetchGame();
      refetchCanFinalize();
    } catch (e) {
      console.error("Error finalizing game:", e);
    }
  };

  const handleClaim = async () => {
    try {
      await writeGameFactory({
        functionName: "claimPayout",
        args: [gameId],
      });
      refetchGame();
    } catch (e) {
      console.error("Error claiming payout:", e);
    }
  };

  const handleChallenge = async () => {
    setIsChallenging(true);
    try {
      await writeGameFactory({
        functionName: "challengeResult",
        args: [gameId],
        value: CHALLENGE_STAKE,
      });
      refetchGame();
      refetchGameResult();
    } catch (e) {
      console.error("Error challenging result:", e);
    } finally {
      setIsChallenging(false);
    }
  };

  const getActionButton = () => {
    // Status 0: Created - waiting for seed reveal
    if (statusNum === 0) {
      return (
        <button
          onClick={handleViewGame}
          className="px-3 py-1 text-sm bg-yellow-900 hover:bg-yellow-800 text-yellow-200 rounded border border-yellow-700 hover:border-yellow-500 transition-all"
        >
          {canReveal?.[0] ? "Start Game" : "Waiting..."}
        </button>
      );
    }

    // Status 2: ResultSubmitted - show challenge button and countdown/finalize
    if (statusNum === 2) {
      const canFinalize = canFinalizeData?.[0] || canFinalizeNow;
      const canChallenge = canChallengeData?.[0] && !canFinalize;

      if (canFinalize) {
        return (
          <button
            onClick={handleFinalize}
            disabled={isPending}
            className="px-3 py-1 text-sm bg-green-900 hover:bg-green-800 text-green-200 rounded border border-green-700 hover:border-green-500 transition-all disabled:opacity-50"
          >
            {isPending ? "Finalizing..." : "Finalize"}
          </button>
        );
      }

      return (
        <div className="flex items-center gap-2">
          {canChallenge && (
            <button
              onClick={handleChallenge}
              disabled={isChallenging || isPending}
              className="px-3 py-1 text-sm bg-red-900 hover:bg-red-800 text-red-200 rounded border border-red-700 hover:border-red-500 transition-all disabled:opacity-50"
              title="Stake 0.01 ETH to challenge this result"
            >
              {isChallenging ? "..." : "Challenge"}
            </button>
          )}
          <span className="text-xs text-neutral-500">
            <CountdownTimer
              targetTime={finalizationTime}
              onComplete={() => {
                setCanFinalizeNow(true);
                refetchCanFinalize();
              }}
            />
          </span>
        </div>
      );
    }

    // Status 3: Challenged - show challenge execution info
    if (statusNum === 3) {
      const challengedAt = gameResult ? Number(gameResult[5]) : 0;
      const executionDeadline = challengedAt + CHALLENGE_EXECUTION_WINDOW;
      const challenger = gameResult ? gameResult[4] : null;
      const now = Math.floor(Date.now() / 1000);
      const windowExpired = challengedAt > 0 && now > executionDeadline;

      // If window expired, show finalize button (oracle wins by default)
      if (windowExpired) {
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-amber-400">Window expired</span>
            <button
              onClick={async () => {
                try {
                  await writeGameFactory({
                    functionName: "finalizeChallengedGame",
                    args: [gameId],
                  });
                  refetchGame();
                  refetchGameResult();
                } catch (e) {
                  console.error("Error finalizing expired challenge:", e);
                }
              }}
              disabled={isPending}
              className="px-3 py-1 text-sm bg-amber-900 hover:bg-amber-800 text-amber-200 rounded border border-amber-700 hover:border-amber-500 transition-all disabled:opacity-50"
            >
              {isPending ? "Finalizing..." : "Finalize (Oracle Wins)"}
            </button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-red-400">Under challenge</span>
          {challenger && (
            <span className="text-xs text-neutral-500 font-mono">
              by {challenger.slice(0, 6)}...{challenger.slice(-4)}
            </span>
          )}
          {challengedAt > 0 && (
            <div className="flex items-center gap-1 text-xs text-neutral-500">
              <span>Exec window:</span>
              <CountdownTimer targetTime={executionDeadline} />
            </div>
          )}
        </div>
      );
    }

    // Status 4: Finalized - show claim button
    if (statusNum === 4) {
      return (
        <button
          onClick={handleClaim}
          disabled={isPending}
          className="px-3 py-1 text-sm bg-emerald-900 hover:bg-emerald-800 text-emerald-200 rounded border border-emerald-700 hover:border-emerald-500 transition-all disabled:opacity-50"
        >
          {isPending ? "Claiming..." : `Claim ${formatEther(payout)} ETH`}
        </button>
      );
    }

    // Status 5: Claimed - show completed
    if (statusNum === 5) {
      return <span className="text-xs text-neutral-500">Claimed ✓</span>;
    }

    // Status 1 or others with seed - view game
    if (hasSeed) {
      return (
        <button
          onClick={handleViewGame}
          className="px-3 py-1 text-sm bg-blue-900 hover:bg-blue-800 text-blue-200 rounded border border-blue-700 hover:border-blue-500 transition-all"
        >
          View Game
        </button>
      );
    }

    return <span className="text-neutral-600">—</span>;
  };

  // Get challenger address for Challenged games
  const challenger = gameResult ? gameResult[4] : null;
  const isChallenged = statusNum === 3;

  return (
    <>
      <tr className="border-b border-neutral-800 hover:bg-neutral-900/50 transition-colors">
        <td className="px-4 py-3 font-mono text-neutral-300">#{gameId.toString()}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 text-xs rounded border ${statusColor}`}>{statusText}</span>
        </td>
        <td className="px-4 py-3 font-mono text-neutral-500 text-sm">
          {hasSeed ? `${seed.slice(0, 10)}...${seed.slice(-8)}` : "—"}
        </td>
        <td className="px-4 py-3 font-mono text-neutral-400 text-sm">
          {statusNum >= 2 && payout > 0n ? `${formatEther(payout)} ETH` : "—"}
        </td>
        <td className="px-4 py-3 text-right">{getActionButton()}</td>
      </tr>
      {isChallenged && challenger && (
        <tr className="border-b border-neutral-800">
          <td colSpan={5} className="px-4 py-3">
            <ChallengeExecutionPanel gameId={gameId} challenger={challenger} />
          </td>
        </tr>
      )}
    </>
  );
};

const GamesPage: NextPage = () => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();

  // Get all game IDs for the connected player
  const { data: gameIds, isLoading } = useScaffoldReadContract({
    contractName: "GameFactory",
    functionName: "getPlayerGames",
    args: [connectedAddress],
    query: {
      enabled: !!connectedAddress,
    },
  });

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <Header />

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">My Games</h1>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-amber-900 hover:bg-amber-800 text-amber-200 rounded-lg border border-amber-700 hover:border-amber-500 transition-all"
          >
            + New Game
          </button>
        </div>

        {!connectedAddress ? (
          <div className="text-center py-12">
            <p className="text-neutral-400 text-lg">Connect your wallet to see your games</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-12">
            <p className="text-neutral-400 text-lg">Loading games...</p>
          </div>
        ) : !gameIds || gameIds.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-neutral-400 text-lg mb-4">No games yet</p>
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 bg-amber-900 hover:bg-amber-800 text-amber-200 rounded-lg border border-amber-700 hover:border-amber-500 transition-all"
            >
              Create Your First Game
            </button>
          </div>
        ) : (
          <div className="bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-neutral-400">Game</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-neutral-400">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-neutral-400">Seed</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-neutral-400">Payout</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-neutral-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {/* Show games in reverse order (newest first) */}
                {[...gameIds].reverse().map(gameId => (
                  <GameRow key={gameId.toString()} gameId={gameId} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {gameIds && gameIds.length > 0 && (
          <div className="mt-6 p-4 bg-neutral-950 rounded-xl border border-neutral-800">
            <h3 className="text-sm font-medium text-neutral-400 mb-3">Status Legend</h3>
            <div className="flex flex-wrap gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded border bg-yellow-900/50 text-yellow-300 border-yellow-700">
                  Created
                </span>
                <span className="text-neutral-500">Waiting for seed reveal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded border bg-blue-900/50 text-blue-300 border-blue-700">
                  SeedRevealed
                </span>
                <span className="text-neutral-500">Game playable</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded border bg-purple-900/50 text-purple-300 border-purple-700">
                  ResultSubmitted
                </span>
                <span className="text-neutral-500">Oracle result, can challenge (0.01 ETH)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded border bg-red-900/50 text-red-300 border-red-700">Challenged</span>
                <span className="text-neutral-500">On-chain verification in progress</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded border bg-green-900/50 text-green-300 border-green-700">
                  Finalized
                </span>
                <span className="text-neutral-500">Ready for payout</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GamesPage;
