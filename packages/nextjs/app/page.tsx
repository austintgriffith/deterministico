"use client";

import { Suspense, useMemo } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { keccak256, toHex } from "viem";

// Configurable spacing parameters - adjust these to align tiles
const TILE_X_SPACING = 64; // horizontal offset between tiles
const TILE_Y_SPACING = 32; // vertical offset between tiles
const GRID_SIZE = 10; // 10x10 grid
const TILE_WIDTH = 140; // approximate tile width for centering
const TILE_HEIGHT = 80; // approximate tile height

const HomeContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roll = searchParams.get("roll");

  // Generate a 2D grid of tile types (1, 2, or 3)
  const grid = useMemo(() => {
    if (!roll) return [];
    const dice = new DeterministicDice(roll as `0x${string}`);
    // roll(3) returns 0, 1, or 2 - add 1 to get 1, 2, or 3 for the tile filenames
    return Array.from({ length: GRID_SIZE }, () =>
      Array.from({ length: GRID_SIZE }, () => {
        const value = dice.roll(5) + 1;
        return value;
      }),
    );
  }, [roll]);

  const handleRoll = () => {
    const randomNumber = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const hash = keccak256(toHex(randomNumber));
    router.push(`?roll=${hash}`);
  };

  const handleExit = () => {
    router.push("/");
  };

  // Calculate map dimensions for centering
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + TILE_HEIGHT;
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;
  const startY = 0;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8 overflow-hidden">
      {roll && <div className="absolute top-6 left-6 font-mono text-white text-sm opacity-70 z-50">{roll}</div>}

      {roll && (
        <div className="absolute top-6 right-6 flex gap-3 z-50">
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
        <div className="relative" style={{ width: mapWidth, height: mapHeight }}>
          {grid.map((row, rowIndex) =>
            row.map((tileType, colIndex) => (
              <Image
                key={`${rowIndex}-${colIndex}`}
                src={`/surface/surface_normal_${tileType}.png`}
                alt=""
                width={TILE_WIDTH}
                height={TILE_HEIGHT}
                style={{
                  position: "absolute",
                  left: centerX + (colIndex - rowIndex) * TILE_X_SPACING,
                  top: startY + (colIndex + rowIndex) * TILE_Y_SPACING,
                  zIndex: rowIndex + colIndex,
                  imageRendering: "pixelated",
                }}
                draggable={false}
              />
            )),
          )}
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
