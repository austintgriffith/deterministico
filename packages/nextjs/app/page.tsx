"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { keccak256, toHex } from "viem";

const Home: NextPage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roll = searchParams.get("roll");

  const randomNumbers = useMemo(() => {
    if (!roll) return [];
    const dice = new DeterministicDice(roll as `0x${string}`);
    return Array.from({ length: 500 }, () => dice.roll(1000));
  }, [roll]);

  const handleRoll = () => {
    const randomNumber = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const hash = keccak256(toHex(randomNumber));
    router.push(`?roll=${hash}`);
  };

  const handleExit = () => {
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      {roll && <div className="absolute top-6 left-6 font-mono text-white text-sm opacity-70">{roll}</div>}

      {roll && (
        <div className="absolute top-6 right-6 flex gap-3">
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

      {roll && randomNumbers.length > 0 && (
        <div className="max-w-4xl">
          <p className="font-mono text-white text-lg leading-relaxed break-all">{randomNumbers.join(", ")}</p>
        </div>
      )}

      {!roll && (
        <button
          onClick={handleRoll}
          className="px-8 py-4 text-2xl bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl border border-neutral-700 hover:border-neutral-500 transition-all duration-200 cursor-pointer"
        >
          🎲 Random Roll
        </button>
      )}
    </div>
  );
};

export default Home;
