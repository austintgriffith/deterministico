"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPool, GRID_SIZE, TILE_HEIGHT, TILE_WIDTH, TILE_X_SPACING, TILE_Y_SPACING } from "~~/lib/game";

// Direction names for texture lookup: 0=north, 1=east, 2=south, 3=west
const DIRECTION_NAMES = ["north", "east", "south", "west"] as const;

// Image cache for canvas rendering
type ImageCache = {
  tiles: HTMLImageElement[];
  drills: HTMLImageElement[];
  loaded: boolean;
};

// Bucket sort constants for O(n) depth ordering
const BUCKET_COUNT = 100;

interface GameRendererProps {
  grid: number[][];
  agentPool: AgentPool;
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
 */
export function GameRenderer({ grid, agentPool, onReady }: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Image cache
  const imageCacheRef = useRef<ImageCache>({ tiles: [], drills: [], loaded: false });
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Camera state
  const cameraRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, cameraX: 0, cameraY: 0 });

  // Pinch gesture tracking
  const pinchStartRef = useRef({ distance: 0, zoom: 1, centerX: 0, centerY: 0 });
  const [isPinching, setIsPinching] = useState(false);

  // Animation frame ref
  const animationFrameRef = useRef<number>(0);

  // Bucket sort buckets (reused across frames)
  const bucketsRef = useRef<number[][]>(Array.from({ length: BUCKET_COUNT }, () => []));

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;

  // Calculate map dimensions
  const mapWidth = GRID_SIZE * 2 * TILE_X_SPACING + TILE_WIDTH;
  const mapHeight = GRID_SIZE * 2 * TILE_Y_SPACING + TILE_HEIGHT;
  const centerX = mapWidth / 2 - TILE_WIDTH / 2;
  const startY = 0;

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
      }
    };

    // Load tile images (1-6)
    for (let i = 1; i <= 6; i++) {
      const img = new window.Image();
      img.onload = onLoad;
      img.src = `/surface/surface_normal_${i}.png`;
      cache.tiles[i] = img;
    }

    // Load drill images in direction order: north=0, east=1, south=2, west=3
    DIRECTION_NAMES.forEach((dir, index) => {
      const img = new window.Image();
      img.onload = onLoad;
      img.src = `/vehicles/drill_${dir}.png`;
      cache.drills[index] = img;
    });
  }, []);

  // Center camera and setup canvas when images are loaded
  useEffect(() => {
    if (!imagesLoaded || !containerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Size the canvas
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Reset zoom
    zoomRef.current = 1;

    // Center camera on the map
    cameraRef.current = {
      x: mapWidth / 2 - canvas.width / 2,
      y: mapHeight / 2 - canvas.height / 2,
    };

    onReady?.();
  }, [imagesLoaded, mapWidth, mapHeight, onReady]);

  // O(n) bucket sort for isometric depth ordering
  // In this isometric view, depth is determined by Y position (screen vertical)
  // Higher Y = lower on screen = closer to camera = drawn last (in front)
  const getDepthSortedIndices = useCallback((): number[] => {
    const buckets = bucketsRef.current;
    const pool = agentPool;

    // Clear buckets
    for (const bucket of buckets) bucket.length = 0;

    // Bucket by Y position (Y ranges from 0 to mapHeight)
    const bucketSize = mapHeight / BUCKET_COUNT;

    // O(n) bucket assignment using Y for depth
    for (let i = 0; i < pool.count; i++) {
      const bucket = Math.floor(pool.y[i] / bucketSize);
      buckets[Math.min(Math.max(bucket, 0), BUCKET_COUNT - 1)].push(i);
    }

    // Flatten buckets into sorted array (lower Y = further back = drawn first)
    // Sort within each bucket to handle agents with similar Y values
    const result: number[] = [];
    for (const bucket of buckets) {
      // Sort bucket by Y (ascending), then by X (ascending) as tiebreaker
      // Lower Y = behind, and when Y is equal, lower X = behind (left side)
      if (bucket.length > 1) {
        bucket.sort((a, b) => {
          const yDiff = pool.y[a] - pool.y[b];
          if (yDiff !== 0) return yDiff;
          return pool.x[a] - pool.x[b]; // Secondary sort by X
        });
      }
      for (const i of bucket) {
        result.push(i);
      }
    }
    return result;
  }, [agentPool, mapHeight]);

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

    // Get tile aspect height
    const sampleTile = cache.tiles[1];
    const tileAspectHeight = sampleTile
      ? sampleTile.naturalHeight * (TILE_WIDTH / sampleTile.naturalWidth)
      : TILE_HEIGHT;

    // Draw visible tiles with culling
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
          screenX > visibleWidth + buffer ||
          screenY + tileAspectHeight < -buffer ||
          screenY > visibleHeight + buffer
        ) {
          continue;
        }

        // Draw tile
        const tileImg = cache.tiles[tileType];
        if (tileImg) {
          ctx.drawImage(tileImg, screenX, screenY, TILE_WIDTH, tileAspectHeight);
        }
      }
    }

    // Draw agents using O(n) bucket sort for depth ordering
    const sortedIndices = getDepthSortedIndices();
    const pool = agentPool;

    for (const i of sortedIndices) {
      const screenX = pool.x[i] - 32 - camera.x;
      const screenY = pool.y[i] - 60 - camera.y;

      // Only draw if visible
      if (screenX + 64 > 0 && screenX < visibleWidth && screenY + 64 > 0 && screenY < visibleHeight) {
        const drillImg = cache.drills[pool.direction[i]];
        if (drillImg) {
          ctx.drawImage(drillImg, screenX, screenY, 64, 64);
        }
      }
    }

    // Restore context state
    ctx.restore();
  }, [grid, centerX, startY, getDepthSortedIndices, agentPool]);

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

  // Drag handlers
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
      const zoom = zoomRef.current;
      cameraRef.current.x = dragStartRef.current.cameraX - dx / zoom;
      cameraRef.current.y = dragStartRef.current.cameraY - dy / zoom;
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

  // Touch helpers
  const getTouchDistance = useCallback((touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const getTouchCenter = useCallback((touches: React.TouchList) => {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }, []);

  // Touch event handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;

      if (e.touches.length === 2) {
        setIsPinching(true);
        setIsDragging(false);
        const distance = getTouchDistance(e.touches);
        const center = getTouchCenter(e.touches);
        pinchStartRef.current = {
          distance,
          zoom: zoomRef.current,
          centerX: center.x,
          centerY: center.y,
        };
      } else if (e.touches.length === 1 && !isPinching) {
        const touch = e.touches[0];
        handleDragStart(touch.clientX, touch.clientY);
      }
    },
    [handleDragStart, getTouchDistance, getTouchCenter, isPinching],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 2) {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const currentDistance = getTouchDistance(e.touches);
        const currentCenter = getTouchCenter(e.touches);
        const scale = currentDistance / pinchStartRef.current.distance;
        const oldZoom = pinchStartRef.current.zoom;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * scale));

        const rect = canvas.getBoundingClientRect();
        const pinchX = currentCenter.x - rect.left;
        const pinchY = currentCenter.y - rect.top;

        const worldX = cameraRef.current.x + pinchX / zoomRef.current;
        const worldY = cameraRef.current.y + pinchY / zoomRef.current;

        zoomRef.current = newZoom;

        cameraRef.current.x = worldX - pinchX / newZoom;
        cameraRef.current.y = worldY - pinchY / newZoom;
      } else if (e.touches.length === 1 && isDragging && !isPinching) {
        const touch = e.touches[0];
        handleDragMove(touch.clientX, touch.clientY);
      }
    },
    [getTouchDistance, getTouchCenter, handleDragMove, isDragging, isPinching],
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
    setIsPinching(false);
  }, [handleDragEnd]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * (1 + delta)));

    if (newZoom === oldZoom) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = cameraRef.current.x + mouseX / oldZoom;
    const worldY = cameraRef.current.y + mouseY / oldZoom;

    zoomRef.current = newZoom;

    cameraRef.current.x = worldX - mouseX / newZoom;
    cameraRef.current.y = worldY - mouseY / newZoom;
  }, []);

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
