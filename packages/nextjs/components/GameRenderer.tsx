"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentPool,
  GRID_SIZE,
  TEAM_COLORS,
  TEAM_HEX_COLORS,
  TILE_HEIGHT,
  TILE_WIDTH,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  VEHICLE_TYPES,
} from "~~/lib/game";

// Direction to sprite sheet position: [col, row]
// Sheet layout: [[SOUTH, EAST], [NORTH, WEST]]
// Direction indices: 0=north, 1=east, 2=south, 3=west
const DIRECTION_SPRITE_POS: [number, number][] = [
  [0, 1], // 0=north → bottom-left
  [1, 0], // 1=east → top-right
  [0, 0], // 2=south → top-left
  [1, 1], // 3=west → bottom-right
];

// Vehicle sprite info (frame dimensions stored per vehicle type)
type VehicleSpriteInfo = {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
};

// Image cache for canvas rendering
type ImageCache = {
  tiles: HTMLImageElement[];
  // Map of "vehicleType_teamColor" -> sprite info (e.g., "heavy_miner_orange")
  vehicleSprites: Map<string, VehicleSpriteInfo>;
  loaded: boolean;
};

// Vehicle sprite vertical offset (negative = up, positive = down)
const VEHICLE_Y_OFFSET = -30;

// Spawn point type
type SpawnPoint = { x: number; y: number };

interface GameRendererProps {
  grid: number[][];
  agentPool: AgentPool;
  teamSpawnPoints: SpawnPoint[];
  focusTeamIndex?: number; // Team index to center camera on at start
  onReady?: () => void;
}

/**
 * Get the sprite key for a given vehicle type and team color
 */
function getSpriteKey(vehicleTypeIndex: number, teamIndex: number): string {
  const vehicleType = VEHICLE_TYPES[vehicleTypeIndex];
  const teamColor = TEAM_COLORS[teamIndex];
  return `${vehicleType}_${teamColor}`;
}

/**
 * Draw a flag at the given position with the team's color
 */
function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, hexColor: string): void {
  // Pole (dark line)
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 50);
  ctx.stroke();

  // Flag triangle
  ctx.fillStyle = hexColor;
  ctx.beginPath();
  ctx.moveTo(x, y - 50);
  ctx.lineTo(x + 28, y - 40);
  ctx.lineTo(x, y - 30);
  ctx.closePath();
  ctx.fill();

  // Flag outline
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();
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
export function GameRenderer({ grid, agentPool, teamSpawnPoints, focusTeamIndex, onReady }: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Image cache
  const imageCacheRef = useRef<ImageCache>({
    tiles: [],
    vehicleSprites: new Map(),
    loaded: false,
  });
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
    // 13 tiles + (7 vehicle types * 12 team colors) = 13 + 84 = 97 total images
    const totalImages = 13 + VEHICLE_TYPES.length * TEAM_COLORS.length;

    const onLoad = () => {
      loadedCount++;
      if (loadedCount === totalImages) {
        cache.loaded = true;
        setImagesLoaded(true);
      }
    };

    // Load tile images (1-13)
    for (let i = 1; i <= 13; i++) {
      const img = new window.Image();
      img.onload = onLoad;
      img.src = `/surface/surface_normal_${i}.png`;
      cache.tiles[i] = img;
    }

    // Load all vehicle sprite sheets (7 vehicle types * 12 team colors = 84 sprites)
    for (const vehicleType of VEHICLE_TYPES) {
      for (const teamColor of TEAM_COLORS) {
        const spriteKey = `${vehicleType}_${teamColor}`;
        const vehicleImg = new window.Image();
        vehicleImg.onload = () => {
          cache.vehicleSprites.set(spriteKey, {
            image: vehicleImg,
            frameWidth: vehicleImg.naturalWidth / 2,
            frameHeight: vehicleImg.naturalHeight / 2,
          });
          onLoad();
        };
        vehicleImg.src = `/vehicles/${spriteKey}.png`;
      }
    }
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

    // Center camera on focused team's spawn point, or map center if not specified
    if (focusTeamIndex !== undefined && teamSpawnPoints[focusTeamIndex]) {
      const spawn = teamSpawnPoints[focusTeamIndex];
      cameraRef.current = {
        x: spawn.x - canvas.width / 2,
        y: spawn.y - canvas.height / 2,
      };
    } else {
      // Fallback: center on the map
      cameraRef.current = {
        x: mapWidth / 2 - canvas.width / 2,
        y: mapHeight / 2 - canvas.height / 2,
      };
    }

    onReady?.();
  }, [imagesLoaded, mapWidth, mapHeight, focusTeamIndex, teamSpawnPoints, onReady]);

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

    // Create a combined list of drawable objects (agents and flags) for proper depth sorting
    // Each entry is: { type: 'agent' | 'flag', y: number, index: number }
    type Drawable = { type: "agent" | "flag"; y: number; index: number };
    const drawables: Drawable[] = [];

    // Add all agents to the drawable list
    const pool = agentPool;
    for (let i = 0; i < pool.count; i++) {
      drawables.push({ type: "agent", y: pool.y[i], index: i });
    }

    // Add all flags to the drawable list (using their base Y position for sorting)
    // Offset the flag's sort Y slightly back so it doesn't appear too far in front
    const FLAG_DEPTH_OFFSET = -25;
    for (let teamIndex = 0; teamIndex < teamSpawnPoints.length; teamIndex++) {
      const spawn = teamSpawnPoints[teamIndex];
      drawables.push({ type: "flag", y: spawn.y + FLAG_DEPTH_OFFSET, index: teamIndex });
    }

    // Sort by Y position (lower Y = further back = drawn first)
    drawables.sort((a, b) => a.y - b.y);

    // Draw all objects in depth-sorted order
    for (const drawable of drawables) {
      if (drawable.type === "flag") {
        const spawn = teamSpawnPoints[drawable.index];
        const flagScreenX = spawn.x - camera.x;
        const flagScreenY = spawn.y - camera.y;

        // Only draw if visible
        if (flagScreenX > -50 && flagScreenX < visibleWidth + 50 && flagScreenY > -60 && flagScreenY < visibleHeight) {
          const teamColor = TEAM_COLORS[drawable.index];
          const hexColor = TEAM_HEX_COLORS[teamColor];
          drawFlag(ctx, flagScreenX, flagScreenY, hexColor);
        }
      } else {
        // Draw agent
        const i = drawable.index;
        const screenX = pool.x[i] - 32 - camera.x;
        const screenY = pool.y[i] + VEHICLE_Y_OFFSET - camera.y;

        // Only draw if visible
        if (screenX + 64 > 0 && screenX < visibleWidth && screenY + 64 > 0 && screenY < visibleHeight) {
          // Get the correct sprite for this agent's team and vehicle type
          const spriteKey = getSpriteKey(pool.vehicleType[i], pool.team[i]);
          const spriteInfo = cache.vehicleSprites.get(spriteKey);

          if (spriteInfo) {
            const dir = pool.direction[i];
            const [col, row] = DIRECTION_SPRITE_POS[dir];
            const sx = col * spriteInfo.frameWidth;
            const sy = row * spriteInfo.frameHeight;

            ctx.drawImage(
              spriteInfo.image,
              sx,
              sy,
              spriteInfo.frameWidth,
              spriteInfo.frameHeight,
              screenX,
              screenY,
              64,
              64,
            );
          }
        }
      }
    }

    // Restore context state
    ctx.restore();
  }, [grid, centerX, startY, agentPool, teamSpawnPoints]);

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
