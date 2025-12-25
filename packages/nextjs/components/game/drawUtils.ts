/**
 * Drawing utility functions for the game renderer.
 */
import {
  DIRECTION_SPRITE_POS,
  DIRECTION_TO_ROTATION,
  FIRST_MOUNTAIN_SHEET_INDEX,
  FLAG_DEPTH_OFFSET,
  GROUND_DEPTH_OFFSET,
  MINIMAP_BG_COLOR,
  MINIMAP_BORDER_COLOR,
  MINIMAP_BORDER_WIDTH,
  MINIMAP_CORNER_RADIUS,
  MINIMAP_MARGIN,
  MINIMAP_SCALE,
  MINIMAP_SIZE,
  MINIMAP_SPRITE_SIZE,
  TOP_VIEW_SPRITE_COL,
  TOP_VIEW_SPRITE_ROW,
  VEHICLE_DEPTH_OFFSET,
  VEHICLE_Y_OFFSET,
} from "./constants";
import {
  AgentPool,
  SPRITE_SHEETS,
  SPRITE_SHEET_COLS,
  TEAM_COLORS,
  TEAM_HEX_COLORS,
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  TILE_START_X,
  TILE_START_Y,
  TILE_STEP_X,
  TILE_STEP_Y,
  TILE_X_SPACING,
  TILE_Y_SPACING,
  TerrainType,
  VEHICLE_FRAME_OFFSETS,
  VEHICLE_TYPES,
} from "~~/lib/game";
import type {
  Drawable,
  DrawableAgent,
  DrawableFlag,
  DrawableTile,
  ImageCache,
  SpawnPoint,
  TileData,
} from "~~/lib/game";

// Direction to frame index mapping
// Direction indices: 0=north, 1=east, 2=south, 3=west
// Frame indices: 0=south, 1=east, 2=north, 3=west
const DIRECTION_TO_FRAME: number[] = [
  2, // north -> frame 2
  1, // east -> frame 1
  0, // south -> frame 0
  3, // west -> frame 3
];

// Liquid rendering constants (adjustable)
export const LIQUID_COLOR = "#99f1f2";
export const LIQUID_OPACITY = 0.6;
export const LIQUID_Y_OFFSET = 10; // pixels lower than ground level

// Liquid layer colors (bottom to top)
export const LIQUID_LAYER_COLORS = [
  "#91ccda", // deepest (base layer, drawn under all tiles)
  "#8ee9e7",
  "#92e8e9",
  "#99f1f2", // top
];

// Animation settings
export const LIQUID_WAVE_AMPLITUDE = 1.5; // pixels of vertical movement
export const LIQUID_WAVE_SPEED = 0.001; // oscillation speed
export const LIQUID_LAYER_SPACING = 4; // pixels between layers

// Edge masking constants
export const EDGE_TILE_COLOR = "#000000"; // Black edge tiles to mask overflow
export const EDGE_BORDER_DEPTH = 2; // How many tiles deep the border extends

/**
 * Get the sprite key for a given vehicle type and team color
 */
export function getSpriteKey(vehicleTypeIndex: number, teamIndex: number): string {
  const vehicleType = VEHICLE_TYPES[vehicleTypeIndex];
  const teamColor = TEAM_COLORS[teamIndex];
  return `${vehicleType}_${teamColor}`;
}

/**
 * Draw a flag at the given position with the team's color
 */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, hexColor: string): void {
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
 * Draw all visible tiles with viewport culling
 */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  grid: TileData[][],
  cache: ImageCache,
  centerX: number,
  startY: number,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  buffer: number,
): void {
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const tileData = row[colIndex];

      // Calculate tile position in world space
      const worldX = centerX + (colIndex - rowIndex) * TILE_X_SPACING;
      const worldY = startY + (colIndex + rowIndex) * TILE_Y_SPACING;

      // Calculate screen position
      const screenX = worldX - cameraX;
      const screenY = worldY - cameraY;

      // Viewport culling - skip tiles outside visible area
      if (
        screenX + TILE_RENDER_WIDTH < -buffer ||
        screenX > visibleWidth + buffer ||
        screenY + TILE_RENDER_HEIGHT < -buffer ||
        screenY > visibleHeight + buffer
      ) {
        continue;
      }

      // Get sprite sheet and calculate source rectangle
      const sheetName = SPRITE_SHEETS[tileData.sheetIndex];
      const sheetInfo = cache.spriteSheets.get(sheetName);
      if (sheetInfo) {
        // Calculate tile position within sprite sheet
        const tileCol = tileData.tileIndex % SPRITE_SHEET_COLS;
        const tileRow = Math.floor(tileData.tileIndex / SPRITE_SHEET_COLS);
        const srcX = TILE_START_X + tileCol * TILE_STEP_X;
        const srcY = TILE_START_Y + tileRow * TILE_STEP_Y;

        // Draw tile from sprite sheet
        ctx.drawImage(
          sheetInfo.image,
          srcX,
          srcY,
          TILE_RENDER_WIDTH,
          TILE_RENDER_HEIGHT,
          screenX,
          screenY,
          TILE_RENDER_WIDTH,
          TILE_RENDER_HEIGHT,
        );
      }
    }
  }
}

/**
 * Create depth-sorted drawable list for tiles, agents, and flags.
 * Uses isometric depth (row + col) for proper occlusion ordering.
 *
 * @param grid - The tile data grid
 * @param agentPool - The agent pool
 * @param teamSpawnPoints - Flag spawn positions
 * @param centerX - X center for coordinate conversion
 * @param cameraX - Camera X position for culling
 * @param cameraY - Camera Y position for culling
 * @param visibleWidth - Visible viewport width
 * @param visibleHeight - Visible viewport height
 * @param buffer - Buffer around viewport for culling
 */
export function createDrawables(
  grid: TileData[][],
  agentPool: AgentPool,
  teamSpawnPoints: SpawnPoint[],
  centerX: number,
  startY: number,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  buffer: number,
): Drawable[] {
  const drawables: Drawable[] = [];

  // Add visible tiles to the drawable list
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      // Calculate tile position in world space
      const worldX = centerX + (colIndex - rowIndex) * TILE_X_SPACING;
      const worldY = startY + (colIndex + rowIndex) * TILE_Y_SPACING;

      // Calculate screen position
      const screenX = worldX - cameraX;
      const screenY = worldY - cameraY;

      // Viewport culling - skip tiles outside visible area
      if (
        screenX + TILE_RENDER_WIDTH < -buffer ||
        screenX > visibleWidth + buffer ||
        screenY + TILE_RENDER_HEIGHT < -buffer ||
        screenY > visibleHeight + buffer
      ) {
        continue;
      }

      // Ground tiles get a negative offset so vehicles render on top of them
      // Mountains keep their natural depth so they can occlude vehicles
      const tileData = grid[rowIndex][colIndex];
      const isGround = tileData.sheetIndex < FIRST_MOUNTAIN_SHEET_INDEX;
      const tileDepth = rowIndex + colIndex + (isGround ? GROUND_DEPTH_OFFSET : 0);

      const tile: DrawableTile = {
        type: "tile",
        depth: tileDepth,
        row: rowIndex,
        col: colIndex,
      };
      drawables.push(tile);
    }
  }

  // Add all agents to the drawable list
  // Apply depth offset so vehicles render on top of tiles at boundaries
  // Use exact depth (no rounding) so vehicles sort correctly relative to each other
  for (let i = 0; i < agentPool.count; i++) {
    const depth = worldToTileDepthExact(agentPool.x[i], agentPool.y[i], centerX) + VEHICLE_DEPTH_OFFSET;
    const agent: DrawableAgent = {
      type: "agent",
      depth,
      index: i,
    };
    drawables.push(agent);
  }

  // Add all flags to the drawable list
  for (let teamIndex = 0; teamIndex < teamSpawnPoints.length; teamIndex++) {
    const spawn = teamSpawnPoints[teamIndex];
    // Use spawn position with offset for depth calculation
    const depth = worldToTileDepth(spawn.x, spawn.y + FLAG_DEPTH_OFFSET, centerX);
    const flag: DrawableFlag = {
      type: "flag",
      depth,
      index: teamIndex,
    };
    drawables.push(flag);
  }

  // Sort by depth (lower depth = further back = drawn first)
  drawables.sort((a, b) => a.depth - b.depth);

  return drawables;
}

/**
 * Pre-calculated tile center Y offset for debug drawing.
 * Must match the value in simulation.ts for coordinate consistency.
 */
const TILE_CENTER_Y_OFFSET = (TILE_START_Y * TILE_RENDER_HEIGHT) / TILE_STEP_Y + TILE_Y_SPACING; // ~88

/**
 * Draw debug overlay showing terrain types as colored diamonds.
 * Green = ground (traversable), Red = mountain/rubyMountain (blocked).
 */
export function drawTerrainDebug(
  ctx: CanvasRenderingContext2D,
  terrainGrid: TerrainType[][],
  centerX: number,
  startY: number,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  buffer: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.4;

  for (let rowIndex = 0; rowIndex < terrainGrid.length; rowIndex++) {
    const row = terrainGrid[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const terrain = row[colIndex];

      // Calculate tile position in world space (top-left corner)
      const worldX = centerX + (colIndex - rowIndex) * TILE_X_SPACING;
      const worldY = startY + (colIndex + rowIndex) * TILE_Y_SPACING;

      // Calculate screen position
      const screenX = worldX - cameraX;
      const screenY = worldY - cameraY;

      // Viewport culling
      if (
        screenX + TILE_RENDER_WIDTH < -buffer ||
        screenX > visibleWidth + buffer ||
        screenY + TILE_RENDER_HEIGHT < -buffer ||
        screenY > visibleHeight + buffer
      ) {
        continue;
      }

      // Calculate diamond center position (where entities are placed)
      const diamondCenterX = screenX + TILE_RENDER_WIDTH / 2;
      const diamondCenterY = screenY + TILE_CENTER_Y_OFFSET;

      // Draw isometric diamond
      const halfWidth = TILE_X_SPACING; // Half width of diamond
      const halfHeight = TILE_Y_SPACING; // Half height of diamond

      ctx.beginPath();
      ctx.moveTo(diamondCenterX, diamondCenterY - halfHeight); // Top
      ctx.lineTo(diamondCenterX + halfWidth, diamondCenterY); // Right
      ctx.lineTo(diamondCenterX, diamondCenterY + halfHeight); // Bottom
      ctx.lineTo(diamondCenterX - halfWidth, diamondCenterY); // Left
      ctx.closePath();

      // Color based on terrain type
      if (terrain === "ground") {
        ctx.fillStyle = "#00ff00"; // Green for ground
      } else if (terrain === "liquid") {
        ctx.fillStyle = "#00ffff"; // Cyan for liquid
      } else if (terrain === "mushroom") {
        ctx.fillStyle = "#7b68ee"; // Medium slate blue for mushroom
      } else if (terrain === "rubyMountain") {
        ctx.fillStyle = "#ff00ff"; // Magenta for ruby mountain
      } else {
        ctx.fillStyle = "#ff0000"; // Red for mountain
      }
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw the base liquid layer (opaque, no animation).
 * This is drawn under EVERY tile so transparency in tile sprites shows liquid color.
 */
export function drawLiquidBase(ctx: CanvasRenderingContext2D, screenX: number, screenY: number): void {
  const diamondCenterX = screenX + TILE_RENDER_WIDTH / 2;
  const baseCenterY = screenY + TILE_CENTER_Y_OFFSET + LIQUID_Y_OFFSET + 2; // Bottom layer offset

  const halfWidth = TILE_X_SPACING;
  const halfHeight = TILE_Y_SPACING;

  ctx.fillStyle = LIQUID_LAYER_COLORS[0]; // Bottom layer color (opaque)

  ctx.beginPath();
  ctx.moveTo(diamondCenterX, baseCenterY - halfHeight);
  ctx.lineTo(diamondCenterX + halfWidth, baseCenterY);
  ctx.lineTo(diamondCenterX, baseCenterY + halfHeight);
  ctx.lineTo(diamondCenterX - halfWidth, baseCenterY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw animated liquid layers (transparent, on top of liquid tiles only).
 * The base layer is drawn separately under all tiles.
 */
export function drawLiquidTile(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, time: number): void {
  const diamondCenterX = screenX + TILE_RENDER_WIDTH / 2;
  const baseCenterY = screenY + TILE_CENTER_Y_OFFSET + LIQUID_Y_OFFSET;

  const halfWidth = TILE_X_SPACING;
  const halfHeight = TILE_Y_SPACING;

  ctx.save();

  // Draw only the animated transparent layers (skip bottom layer - it's drawn for all tiles)
  const layerOffsets = [2, 0, -2, -4]; // bottom, lower-mid, upper-mid, top (close together near surface)
  for (let i = 1; i < LIQUID_LAYER_COLORS.length; i++) {
    // Calculate animated Y offset using sine wave
    const waveOffset = Math.sin(time * LIQUID_WAVE_SPEED + i * 0.5) * LIQUID_WAVE_AMPLITUDE;
    const depthOffset = layerOffsets[i] ?? 0;
    const layerCenterY = baseCenterY + depthOffset + waveOffset;

    // Transparent layers
    const layerOpacity = 0.3 + (i / (LIQUID_LAYER_COLORS.length - 1)) * 0.2;

    ctx.globalAlpha = layerOpacity;
    ctx.fillStyle = LIQUID_LAYER_COLORS[i];

    ctx.beginPath();
    ctx.moveTo(diamondCenterX, layerCenterY - halfHeight);
    ctx.lineTo(diamondCenterX + halfWidth, layerCenterY);
    ctx.lineTo(diamondCenterX, layerCenterY + halfHeight);
    ctx.lineTo(diamondCenterX - halfWidth, layerCenterY);
    ctx.closePath();
    ctx.fill();
  }

  // Subtle edge highlight on top layer
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#5ad8d9";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Pre-calculated tile center Y offset for edge tiles.
 * Uses the same offset as debug drawing for consistency.
 */
const EDGE_TILE_CENTER_Y_OFFSET = (TILE_START_Y * TILE_RENDER_HEIGHT) / TILE_STEP_Y + TILE_Y_SPACING;

/**
 * Draw black edge tiles around the map border to mask liquid overflow.
 * These tiles are drawn at the same height as the water surface.
 */
export function drawEdgeTiles(
  ctx: CanvasRenderingContext2D,
  gridSize: number,
  centerX: number,
  startY: number,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  buffer: number,
): void {
  const halfWidth = TILE_X_SPACING;
  const halfHeight = TILE_Y_SPACING;

  // Helper to draw a single black diamond tile
  const drawBlackTile = (row: number, col: number) => {
    const worldX = centerX + (col - row) * TILE_X_SPACING;
    const worldY = startY + (col + row) * TILE_Y_SPACING;

    const screenX = worldX - cameraX;
    const screenY = worldY - cameraY;

    // Viewport culling
    if (
      screenX + TILE_RENDER_WIDTH < -buffer ||
      screenX > visibleWidth + buffer ||
      screenY + TILE_RENDER_HEIGHT < -buffer ||
      screenY > visibleHeight + buffer
    ) {
      return;
    }

    // Calculate diamond center at water surface height
    const diamondCenterX = screenX + TILE_RENDER_WIDTH / 2;
    const diamondCenterY = screenY + EDGE_TILE_CENTER_Y_OFFSET + LIQUID_Y_OFFSET;

    ctx.fillStyle = EDGE_TILE_COLOR;
    ctx.beginPath();
    ctx.moveTo(diamondCenterX, diamondCenterY - halfHeight);
    ctx.lineTo(diamondCenterX + halfWidth, diamondCenterY);
    ctx.lineTo(diamondCenterX, diamondCenterY + halfHeight);
    ctx.lineTo(diamondCenterX - halfWidth, diamondCenterY);
    ctx.closePath();
    ctx.fill();
  };

  // Draw edge tiles around all four sides (multiple rows deep for coverage)
  for (let depth = 1; depth <= EDGE_BORDER_DEPTH; depth++) {
    // North edge (row = -depth, all columns)
    for (let col = -depth; col < gridSize + depth; col++) {
      drawBlackTile(-depth, col);
    }

    // South edge (row = gridSize + depth - 1, all columns)
    for (let col = -depth; col < gridSize + depth; col++) {
      drawBlackTile(gridSize + depth - 1, col);
    }

    // West edge (col = -depth, all rows except corners already drawn)
    for (let row = -depth + 1; row < gridSize + depth - 1; row++) {
      drawBlackTile(row, -depth);
    }

    // East edge (col = gridSize + depth - 1, all rows except corners already drawn)
    for (let row = -depth + 1; row < gridSize + depth - 1; row++) {
      drawBlackTile(row, gridSize + depth - 1);
    }
  }
}

/** Must match VEHICLE_COLLISION_PADDING in simulation.ts */
const VEHICLE_COLLISION_PADDING = 20;

/**
 * Convert world coordinates to tile coordinates.
 * Must match the worldToTile function in simulation.ts exactly.
 */
function worldToTile(worldX: number, worldY: number, centerX: number): { row: number; col: number } {
  const adjustedX = worldX - TILE_RENDER_WIDTH / 2;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const colMinusRow = (adjustedX - centerX) / TILE_X_SPACING;
  const colPlusRow = adjustedY / TILE_Y_SPACING;

  const col = (colMinusRow + colPlusRow) / 2;
  const row = (colPlusRow - colMinusRow) / 2;

  return { row: Math.round(row), col: Math.round(col) };
}

/**
 * Calculate isometric depth from world coordinates.
 * Depth = row + col, used for painter's algorithm sorting.
 * Higher depth = closer to camera = drawn later.
 */
export function worldToTileDepth(worldX: number, worldY: number, centerX: number): number {
  const { row, col } = worldToTile(worldX, worldY, centerX);
  return row + col;
}

/**
 * Calculate exact isometric depth from world coordinates without rounding.
 * Used for vehicle depth sorting to ensure proper layering between vehicles
 * that are close together or within the same tile.
 */
export function worldToTileDepthExact(worldX: number, worldY: number, centerX: number): number {
  const adjustedX = worldX - TILE_RENDER_WIDTH / 2;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const colMinusRow = (adjustedX - centerX) / TILE_X_SPACING;
  const colPlusRow = adjustedY / TILE_Y_SPACING;

  const col = (colMinusRow + colPlusRow) / 2;
  const row = (colPlusRow - colMinusRow) / 2;

  return row + col; // No rounding - exact position for smooth depth sorting
}

/**
 * Draw debug markers showing agent positions as small circles.
 * Shows the actual (x, y) coordinates used for terrain collision.
 * Also shows the calculated tile coordinates and terrain type.
 */
export function drawAgentDebugMarkers(
  ctx: CanvasRenderingContext2D,
  agentPool: AgentPool,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  centerX: number,
  terrainGrid?: TerrainType[][],
): void {
  ctx.save();

  for (let i = 0; i < agentPool.count; i++) {
    const screenX = agentPool.x[i] - cameraX;
    const screenY = agentPool.y[i] - cameraY;

    // Only draw if visible
    if (screenX < -20 || screenX > visibleWidth + 20 || screenY < -20 || screenY > visibleHeight + 20) {
      continue;
    }

    // Draw the collision padding area as an isometric diamond
    const pad = VEHICLE_COLLISION_PADDING;
    ctx.strokeStyle = "#ffff00"; // Yellow
    ctx.lineWidth = 2;

    ctx.beginPath();
    // North point (dx positive, dy negative)
    ctx.moveTo(screenX + pad, screenY - pad / 2);
    // East point (dx positive, dy positive)
    ctx.lineTo(screenX + pad, screenY + pad / 2);
    // South point (dx negative, dy positive)
    ctx.lineTo(screenX - pad, screenY + pad / 2);
    // West point (dx negative, dy negative)
    ctx.lineTo(screenX - pad, screenY - pad / 2);
    ctx.closePath();
    ctx.stroke();

    // Draw a small crosshair at agent's exact center position
    ctx.beginPath();
    ctx.moveTo(screenX - 4, screenY);
    ctx.lineTo(screenX + 4, screenY);
    ctx.moveTo(screenX, screenY - 4);
    ctx.lineTo(screenX, screenY + 4);
    ctx.stroke();

    // Show calculated tile coordinates and terrain type
    if (terrainGrid) {
      const { row, col } = worldToTile(agentPool.x[i], agentPool.y[i], centerX);
      const terrain =
        row >= 0 && row < terrainGrid.length && col >= 0 && col < terrainGrid[0].length ? terrainGrid[row][col] : "OOB";

      ctx.fillStyle = terrain === "ground" ? "#00ff00" : "#ff0000";
      ctx.font = "bold 10px monospace";
      ctx.fillText(`(${row},${col})`, screenX + 12, screenY - 4);
      ctx.fillText(terrain.substring(0, 3), screenX + 12, screenY + 8);
    }
  }

  ctx.restore();
}

/**
 * Draw all tiles, agents, and flags in depth-sorted order.
 * This is the main rendering function that properly handles isometric occlusion.
 * Liquid tiles (sheetIndex === -1) are rendered as colored diamonds instead of sprites.
 */
export function drawAllSorted(
  ctx: CanvasRenderingContext2D,
  drawables: Drawable[],
  grid: TileData[][],
  terrainGrid: TerrainType[][] | undefined,
  agentPool: AgentPool,
  teamSpawnPoints: SpawnPoint[],
  cache: ImageCache,
  centerX: number,
  startY: number,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
  time: number, // Animation time in ms for liquid effects
): void {
  for (const drawable of drawables) {
    if (drawable.type === "tile") {
      // Draw tile
      const tileData = grid[drawable.row][drawable.col];

      // Calculate tile position in world space
      const worldX = centerX + (drawable.col - drawable.row) * TILE_X_SPACING;
      const worldY = startY + (drawable.col + drawable.row) * TILE_Y_SPACING;

      // Calculate screen position
      const screenX = worldX - cameraX;
      const screenY = worldY - cameraY;

      // Draw liquid base under EVERY tile (so transparency shows liquid color)
      drawLiquidBase(ctx, screenX, screenY);

      // Check if this is a liquid tile (sheetIndex === -1 means no sprite)
      if (tileData.sheetIndex === -1) {
        // Draw animated transparent liquid layers on top
        drawLiquidTile(ctx, screenX, screenY, time);
      } else {
        // Get sprite sheet and draw on top of liquid base
        const sheetName = SPRITE_SHEETS[tileData.sheetIndex];
        const sheetInfo = cache.spriteSheets.get(sheetName);
        if (sheetInfo) {
          // Calculate tile position within sprite sheet
          const tileCol = tileData.tileIndex % SPRITE_SHEET_COLS;
          const tileRow = Math.floor(tileData.tileIndex / SPRITE_SHEET_COLS);
          const srcX = TILE_START_X + tileCol * TILE_STEP_X;
          const srcY = TILE_START_Y + tileRow * TILE_STEP_Y;

          // Draw tile from sprite sheet
          ctx.drawImage(
            sheetInfo.image,
            srcX,
            srcY,
            TILE_RENDER_WIDTH,
            TILE_RENDER_HEIGHT,
            screenX,
            screenY,
            TILE_RENDER_WIDTH,
            TILE_RENDER_HEIGHT,
          );
        }
      }
    } else if (drawable.type === "flag") {
      // Draw flag
      const spawn = teamSpawnPoints[drawable.index];
      const flagScreenX = spawn.x - cameraX;
      const flagScreenY = spawn.y - cameraY;

      // Only draw if visible
      if (flagScreenX > -50 && flagScreenX < visibleWidth + 50 && flagScreenY > -60 && flagScreenY < visibleHeight) {
        const teamColor = TEAM_COLORS[drawable.index];
        const hexColor = TEAM_HEX_COLORS[teamColor];
        drawFlag(ctx, flagScreenX, flagScreenY, hexColor);
      }
    } else if (drawable.type === "agent") {
      // Draw agent
      const i = drawable.index;
      const screenX = agentPool.x[i] - 32 - cameraX;
      const screenY = agentPool.y[i] + VEHICLE_Y_OFFSET - cameraY;

      // Only draw if visible
      if (screenX + 64 > 0 && screenX < visibleWidth && screenY + 64 > 0 && screenY < visibleHeight) {
        const spriteKey = getSpriteKey(agentPool.vehicleType[i], agentPool.team[i]);
        const spriteInfo = cache.vehicleSprites.get(spriteKey);

        if (spriteInfo) {
          const dir = agentPool.direction[i];
          const [col, row] = DIRECTION_SPRITE_POS[dir];
          const sx = col * spriteInfo.frameWidth;
          const sy = row * spriteInfo.frameHeight;

          // Apply per-frame offset from calibration (scaled to render size)
          const frameIndex = DIRECTION_TO_FRAME[dir];
          const frameOffset = VEHICLE_FRAME_OFFSETS[frameIndex];
          const renderScale = 64 / spriteInfo.frameWidth;

          ctx.drawImage(
            spriteInfo.image,
            sx,
            sy,
            spriteInfo.frameWidth,
            spriteInfo.frameHeight,
            screenX + frameOffset.x * renderScale,
            screenY + frameOffset.y * renderScale,
            64,
            64,
          );
        }
      }
    }
  }
}

/**
 * Draw a minimap/radar in the bottom-right corner showing a local top-down view.
 * Vehicles are rendered using their Top view sprite (Frame 4) rotated to show
 * their actual facing direction. North is always at the top of the minimap.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  agentPool: AgentPool,
  cache: ImageCache,
  canvasWidth: number,
  canvasHeight: number,
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): void {
  ctx.save();

  // Calculate minimap position (bottom-right corner)
  const minimapX = canvasWidth - MINIMAP_SIZE - MINIMAP_MARGIN;
  const minimapY = canvasHeight - MINIMAP_SIZE - MINIMAP_MARGIN;

  // Draw minimap background with rounded corners
  ctx.beginPath();
  ctx.roundRect(minimapX, minimapY, MINIMAP_SIZE, MINIMAP_SIZE, MINIMAP_CORNER_RADIUS);
  ctx.fillStyle = MINIMAP_BG_COLOR;
  ctx.fill();
  ctx.strokeStyle = MINIMAP_BORDER_COLOR;
  ctx.lineWidth = MINIMAP_BORDER_WIDTH;
  ctx.stroke();

  // Set up clipping region for minimap content
  ctx.beginPath();
  ctx.roundRect(minimapX, minimapY, MINIMAP_SIZE, MINIMAP_SIZE, MINIMAP_CORNER_RADIUS);
  ctx.clip();

  // Calculate the center of the current view in world coordinates
  const worldCenterX = cameraX + viewportWidth / zoom / 2;
  const worldCenterY = cameraY + viewportHeight / zoom / 2;

  // Minimap center in screen coordinates
  const minimapCenterX = minimapX + MINIMAP_SIZE / 2;
  const minimapCenterY = minimapY + MINIMAP_SIZE / 2;

  // Calculate how much world space the minimap covers
  const minimapWorldRadius = MINIMAP_SIZE / 2 / MINIMAP_SCALE;

  // Draw each agent on the minimap
  for (let i = 0; i < agentPool.count; i++) {
    const agentWorldX = agentPool.x[i];
    const agentWorldY = agentPool.y[i];

    // Calculate offset from world center
    const offsetX = agentWorldX - worldCenterX;
    const offsetY = agentWorldY - worldCenterY;

    // Skip agents outside the minimap radius
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    if (distance > minimapWorldRadius * 1.2) continue;

    // Convert world offset to minimap coordinates
    const minimapAgentX = minimapCenterX + offsetX * MINIMAP_SCALE;
    const minimapAgentY = minimapCenterY + offsetY * MINIMAP_SCALE;

    // Get the vehicle sprite
    const spriteKey = getSpriteKey(agentPool.vehicleType[i], agentPool.team[i]);
    const spriteInfo = cache.vehicleSprites.get(spriteKey);

    if (spriteInfo) {
      // Get the Top view sprite (Frame 4 at col=2, row=0)
      const sx = TOP_VIEW_SPRITE_COL * spriteInfo.frameWidth;
      const sy = TOP_VIEW_SPRITE_ROW * spriteInfo.frameHeight;

      // Get rotation based on direction
      const direction = agentPool.direction[i];
      const rotation = DIRECTION_TO_ROTATION[direction];

      // Draw rotated sprite
      ctx.save();
      ctx.translate(minimapAgentX, minimapAgentY);
      ctx.rotate(rotation);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        spriteInfo.image,
        sx,
        sy,
        spriteInfo.frameWidth,
        spriteInfo.frameHeight,
        -MINIMAP_SPRITE_SIZE / 2,
        -MINIMAP_SPRITE_SIZE / 2,
        MINIMAP_SPRITE_SIZE,
        MINIMAP_SPRITE_SIZE,
      );
      ctx.restore();
    }
  }

  // Draw a small "N" indicator at the top for North
  ctx.fillStyle = "#888";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", minimapCenterX, minimapY + 12);

  // Draw viewport rectangle indicator (shows current camera view area)
  const viewportWorldWidth = viewportWidth / zoom;
  const viewportWorldHeight = viewportHeight / zoom;
  const viewportMinimapWidth = viewportWorldWidth * MINIMAP_SCALE;
  const viewportMinimapHeight = viewportWorldHeight * MINIMAP_SCALE;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    minimapCenterX - viewportMinimapWidth / 2,
    minimapCenterY - viewportMinimapHeight / 2,
    viewportMinimapWidth,
    viewportMinimapHeight,
  );

  ctx.restore();
}
