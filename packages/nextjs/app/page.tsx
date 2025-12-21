"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DeterministicDice } from "deterministic-dice";
import type { NextPage } from "next";
import { keccak256, toHex } from "viem";
import {
  Agent,
  DIRECTIONS,
  GRID_SIZE,
  MAX_ROUNDS,
  ROUND_DELAY,
  TILE_HEIGHT,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  generateGrid,
  processAgentAction,
} from "~~/lib/game";

// Image cache for canvas rendering
type ImageCache = {
  tiles: HTMLImageElement[];
  drills: Record<string, HTMLImageElement>;
  loaded: boolean;
};

const HomeContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roll = searchParams.get("roll");

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Image cache
  const imageCacheRef = useRef<ImageCache>({ tiles: [], drills: {}, loaded: false });
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Agent state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [round, setRound] = useState(0);

  // Camera state (viewport offset)
  const cameraRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, cameraX: 0, cameraY: 0 });

  // Track if we need to redraw
  const needsRedrawRef = useRef(true);
  const animationFrameRef = useRef<number>(0);

  // Calculate map dimensions
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + TILE_HEIGHT;
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;
  const startY = 0;

  // Generate grid
  const grid = useMemo(() => {
    if (!roll) return [];
    return generateGrid(roll as `0x${string}`, GRID_SIZE);
  }, [roll]);

  // Preload images on mount
  useEffect(() => {
    const cache = imageCacheRef.current;
    if (cache.loaded) return;

    let loadedCount = 0;
    const totalImages = 6 + 4; // 6 tiles + 4 drill directions

    const onLoad = () => {
      loadedCount++;
      if (loadedCount === totalImages) {
        cache.loaded = true;
        setImagesLoaded(true);
        needsRedrawRef.current = true;
      }
    };

    // Load tile images (1-6)
    for (let i = 1; i <= 6; i++) {
      const img = new window.Image();
      img.onload = onLoad;
      img.src = `/surface/surface_normal_${i}.png`;
      cache.tiles[i] = img;
    }

    // Load drill images
    const directions = ["north", "east", "south", "west"];
    directions.forEach(dir => {
      const img = new window.Image();
      img.onload = onLoad;
      img.src = `/vehicles/drill_${dir}.png`;
      cache.drills[dir] = img;
    });
  }, []);

  // Initialize agents when roll changes
  useEffect(() => {
    if (!roll) {
      setAgents([]);
      setRound(0);
      return;
    }
    const initDice = new DeterministicDice(keccak256(toHex(roll + "agent-init")));
    const randomDirection = DIRECTIONS[initDice.roll(4) % 4];

    const agentStartX = mapWidth / 2;
    const agentStartY = mapHeight / 2;

    setAgents([{ x: agentStartX, y: agentStartY, direction: randomDirection }]);
    setRound(0);
    needsRedrawRef.current = true;
  }, [roll, mapWidth, mapHeight]);

  // Center camera when roll changes - must wait for images to be loaded so canvas is in DOM
  useEffect(() => {
    if (!roll || !imagesLoaded || !containerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Size the canvas first
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Then center camera on the map
    cameraRef.current = {
      x: mapWidth / 2 - canvas.width / 2,
      y: mapHeight / 2 - canvas.height / 2,
    };
    needsRedrawRef.current = true;
  }, [roll, imagesLoaded, mapWidth, mapHeight]);

  // Game loop
  useEffect(() => {
    if (!roll || agents.length === 0 || round >= MAX_ROUNDS) return;

    const timer = setTimeout(() => {
      const gameDice = new DeterministicDice(keccak256(toHex(roll + "round" + round)));

      setAgents(prevAgents => {
        const updatedAgents = prevAgents.map(agent => {
          const action = gameDice.roll(16);
          return processAgentAction(agent, action);
        });

        const nextRound = round + 1;
        if (nextRound % 5 === 0 && nextRound < MAX_ROUNDS) {
          const spawnDice = new DeterministicDice(keccak256(toHex(roll + "spawn" + round)));
          const randomDirection = DIRECTIONS[spawnDice.roll(4) % 4];
          updatedAgents.push({
            x: mapWidth / 2,
            y: mapHeight / 2,
            direction: randomDirection,
          });
        }

        return updatedAgents;
      });
      setRound(r => r + 1);
      needsRedrawRef.current = true;
    }, ROUND_DELAY);

    return () => clearTimeout(timer);
  }, [roll, round, agents.length, mapWidth, mapHeight]);

  // Canvas draw function with viewport culling
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const cache = imageCacheRef.current;

    if (!canvas || !ctx || !cache.loaded || grid.length === 0) return;

    const camera = cameraRef.current;
    const viewportWidth = canvas.width;
    const viewportHeight = canvas.height;

    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    // Enable pixelated rendering
    ctx.imageSmoothingEnabled = false;

    // Calculate visible tile range with buffer
    // For isometric, we need to be more generous with the buffer
    const buffer = 200;

    // Get tile aspect height from first loaded tile (all tiles should be same size)
    const sampleTile = cache.tiles[1];
    const tileAspectHeight = sampleTile
      ? sampleTile.naturalHeight * (TILE_WIDTH / sampleTile.naturalWidth)
      : TILE_HEIGHT;

    // Iterate through grid and only draw visible tiles
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex];
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const tileType = row[colIndex];

        // Calculate tile position in world space
        const worldX = centerX + (colIndex - rowIndex) * TILE_X_SPACING;
        const worldY = startY + (colIndex + rowIndex) * TILE_Y_SPACING;

        // Calculate screen position
        const screenX = worldX - camera.x;
        const screenY = worldY - camera.y;

        // Viewport culling - skip tiles outside visible area
        if (
          screenX + TILE_WIDTH < -buffer ||
          screenX > viewportWidth + buffer ||
          screenY + tileAspectHeight < -buffer ||
          screenY > viewportHeight + buffer
        ) {
          continue;
        }

        // Draw tile at natural aspect ratio (width fixed, height calculated)
        const tileImg = cache.tiles[tileType];
        if (tileImg) {
          ctx.drawImage(tileImg, screenX, screenY, TILE_WIDTH, tileAspectHeight);
        }
      }
    }

    // Draw agents sorted by Y position for proper layering
    const sortedAgents = [...agents].sort((a, b) => a.y - b.y);
    sortedAgents.forEach(agent => {
      const screenX = agent.x - 32 - camera.x;
      const screenY = agent.y - 60 - camera.y;

      // Only draw if visible
      if (screenX + 64 > 0 && screenX < viewportWidth && screenY + 64 > 0 && screenY < viewportHeight) {
        const drillImg = cache.drills[agent.direction];
        if (drillImg) {
          ctx.drawImage(drillImg, screenX, screenY, 64, 64);
        }
      }
    });
  }, [grid, agents, centerX, startY]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      if (needsRedrawRef.current) {
        draw();
        needsRedrawRef.current = false;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  // Resize canvas to match container - must wait for images so canvas is in DOM
  useEffect(() => {
    if (!imagesLoaded) return;

    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      needsRedrawRef.current = true;
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [imagesLoaded]);

  // Drag handlers - update camera position directly
  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
    };
  }, []);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;
      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;
      cameraRef.current.x = dragStartRef.current.cameraX - dx;
      cameraRef.current.y = dragStartRef.current.cameraY - dy;
      needsRedrawRef.current = true;
    },
    [isDragging],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      handleDragStart(e.clientX, e.clientY);
    },
    [handleDragStart],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    },
    [handleDragMove],
  );

  const handleMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const touch = e.touches[0];
      handleDragStart(touch.clientX, touch.clientY);
    },
    [handleDragStart],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const touch = e.touches[0];
      handleDragMove(touch.clientX, touch.clientY);
    },
    [handleDragMove, isDragging],
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  const handleRoll = () => {
    const randomNumber = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const hash = keccak256(toHex(randomNumber));
    router.push(`?roll=${hash}`);
  };

  const handleExit = () => {
    router.push("/");
  };

  return (
    <div
      ref={containerRef}
      className={`h-screen w-screen bg-black overflow-hidden ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: "none" }}
    >
      {roll && (
        <div className="fixed top-6 left-6 font-mono text-white text-sm opacity-70 z-50">
          <div>{roll}</div>
          <div className="mt-2">
            Round: {round} / {MAX_ROUNDS}
          </div>
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

      {roll && imagesLoaded && <canvas ref={canvasRef} className="block w-full h-full" />}

      {roll && !imagesLoaded && (
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
