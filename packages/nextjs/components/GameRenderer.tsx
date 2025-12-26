"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDrawables,
  drawAgentDebugMarkers,
  drawAllSorted,
  drawEdgeTiles,
  drawMinimap,
  drawTerrainDebug,
  useCamera,
  useImageLoader,
} from "./game";
import {
  AgentPool,
  GRID_SIZE,
  TILE_HEIGHT,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  TerrainType,
} from "~~/lib/game";
import type { SpawnPoint, TileData } from "~~/lib/game";

interface GameRendererProps {
  grid: TileData[][];
  terrainGrid?: TerrainType[][]; // For debug overlay
  agentPool: AgentPool;
  teamSpawnPoints: SpawnPoint[];
  focusTeamIndex?: number; // Team index to center camera on at start
  exploredTiles?: Set<string>; // Set of "row,col" strings for fog of war
  onReady?: () => void;
}

/**
 * High-performance game renderer using HTML5 Canvas.
 *
 * Optimizations:
 * - Viewport culling (only draws visible tiles)
 * - O(n) bucket sort for agent depth ordering
 * - Dirty flag rendering (only redraws when needed)
 * - Image caching
 *
 * Controls:
 * - Arrow keys or WASD: Pan camera
 * - Mouse drag: Pan camera
 * - Mouse wheel / Pinch: Zoom in/out
 * - Press 'G': Toggle debug mode (terrain overlay + agent markers)
 */
export function GameRenderer({
  grid,
  terrainGrid,
  agentPool,
  teamSpawnPoints,
  focusTeamIndex,
  exploredTiles,
  onReady,
}: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);

  // Image loading
  const { imageCacheRef, imagesLoaded } = useImageLoader();

  // Camera controls
  const {
    cameraRef,
    zoomRef,
    isDragging,
    setCamera,
    setZoom,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    createTouchMoveHandler,
    handleTouchEnd,
    createWheelHandler,
  } = useCamera();

  // Calculate map dimensions
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + TILE_HEIGHT;
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;
  const startY = 0;

  // Center camera and setup canvas when images are loaded
  useEffect(() => {
    if (!imagesLoaded || !containerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Size the canvas
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Reset zoom
    setZoom(1);

    // Center camera on focused team's spawn point, or map center if not specified
    if (focusTeamIndex !== undefined && teamSpawnPoints[focusTeamIndex]) {
      const spawn = teamSpawnPoints[focusTeamIndex];
      setCamera(spawn.x - canvas.width / 2, spawn.y - canvas.height / 2);
    } else {
      // Fallback: center on the map
      setCamera(mapWidth / 2 - canvas.width / 2, mapHeight / 2 - canvas.height / 2);
    }

    onReady?.();
  }, [imagesLoaded, mapWidth, mapHeight, focusTeamIndex, teamSpawnPoints, onReady, setCamera, setZoom]);

  // Canvas draw function with viewport culling
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const cache = imageCacheRef.current;

    if (!canvas || !ctx || !cache.loaded || grid.length === 0) return;

    const camera = cameraRef.current;
    const zoom = zoomRef.current;
    const viewportWidth = canvas.width;
    const viewportHeight = canvas.height;

    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    // Save context state before transformations
    ctx.save();

    // Apply zoom transformation
    ctx.scale(zoom, zoom);

    // Enable pixelated rendering
    ctx.imageSmoothingEnabled = false;

    // Calculate visible area with buffer
    const buffer = 200 / zoom;
    const visibleWidth = viewportWidth / zoom;
    const visibleHeight = viewportHeight / zoom;

    // Create depth-sorted drawables (tiles, agents, flags) and draw everything
    const drawables = createDrawables(
      grid,
      agentPool,
      teamSpawnPoints,
      centerX,
      startY,
      camera.x,
      camera.y,
      visibleWidth,
      visibleHeight,
      buffer,
    );
    drawAllSorted(
      ctx,
      drawables,
      grid,
      terrainGrid,
      agentPool,
      teamSpawnPoints,
      cache,
      centerX,
      startY,
      camera.x,
      camera.y,
      visibleWidth,
      visibleHeight,
      performance.now(), // Animation time for liquid effects
      exploredTiles,
    );

    // Draw black edge tiles to mask liquid overflow on east/south edges
    drawEdgeTiles(ctx, GRID_SIZE, centerX, startY, camera.x, camera.y, visibleWidth, visibleHeight, buffer);

    // Draw debug terrain overlay if enabled
    if (debugMode && terrainGrid) {
      drawTerrainDebug(ctx, terrainGrid, centerX, startY, camera.x, camera.y, visibleWidth, visibleHeight, buffer);
    }

    // Draw debug agent markers if enabled
    if (debugMode) {
      drawAgentDebugMarkers(ctx, agentPool, camera.x, camera.y, visibleWidth, visibleHeight, centerX, terrainGrid);
    }

    // Restore context state
    ctx.restore();

    // Draw minimap overlay (in screen space, after restore)
    drawMinimap(
      ctx,
      agentPool,
      cache,
      viewportWidth,
      viewportHeight,
      camera.x,
      camera.y,
      viewportWidth,
      viewportHeight,
      zoom,
      terrainGrid,
      teamSpawnPoints,
      centerX,
      startY,
      exploredTiles,
    );
  }, [
    grid,
    terrainGrid,
    debugMode,
    centerX,
    startY,
    agentPool,
    teamSpawnPoints,
    imageCacheRef,
    cameraRef,
    zoomRef,
    exploredTiles,
  ]);

  // Animation loop
  useEffect(() => {
    if (!imagesLoaded) return;

    const animate = () => {
      draw();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw, imagesLoaded]);

  // Resize canvas handler
  useEffect(() => {
    if (!imagesLoaded) return;

    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [imagesLoaded]);

  // Debug mode toggle (press 'G' for Grid debug)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "g" || e.key === "G") {
        setDebugMode(prev => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Create event handlers that need canvas ref
  const handleTouchMove = createTouchMoveHandler(canvasRef);
  const handleWheel = createWheelHandler(canvasRef);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      style={{ touchAction: "none" }}
    >
      {imagesLoaded && <canvas ref={canvasRef} className="block w-full h-full" />}
      {!imagesLoaded && (
        <div className="flex items-center justify-center h-full w-full">
          <div className="text-white">Loading...</div>
        </div>
      )}
    </div>
  );
}
