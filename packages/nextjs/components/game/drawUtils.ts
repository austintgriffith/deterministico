/**
 * Drawing utility functions for the game renderer.
 */
import { DIRECTION_SPRITE_POS, FLAG_DEPTH_OFFSET, VEHICLE_Y_OFFSET } from "./constants";
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
  VEHICLE_TYPES,
} from "~~/lib/game";
import type { Drawable, ImageCache, SpawnPoint, TileData } from "~~/lib/game";

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
 * Create sorted drawable list for agents and flags
 */
export function createDrawables(agentPool: AgentPool, teamSpawnPoints: SpawnPoint[]): Drawable[] {
  const drawables: Drawable[] = [];

  // Add all agents to the drawable list
  for (let i = 0; i < agentPool.count; i++) {
    drawables.push({ type: "agent", y: agentPool.y[i], index: i });
  }

  // Add all flags to the drawable list (using their base Y position for sorting)
  for (let teamIndex = 0; teamIndex < teamSpawnPoints.length; teamIndex++) {
    const spawn = teamSpawnPoints[teamIndex];
    drawables.push({ type: "flag", y: spawn.y + FLAG_DEPTH_OFFSET, index: teamIndex });
  }

  // Sort by Y position (lower Y = further back = drawn first)
  drawables.sort((a, b) => a.y - b.y);

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

/** Must match VEHICLE_COLLISION_PADDING in simulation.ts */
const VEHICLE_COLLISION_PADDING = 20;

/**
 * Convert world coordinates to tile coordinates for debug display.
 * Must match the worldToTile function in simulation.ts exactly.
 */
function debugWorldToTile(worldX: number, worldY: number, centerX: number): { row: number; col: number } {
  const adjustedX = worldX - TILE_RENDER_WIDTH / 2;
  const adjustedY = worldY - TILE_CENTER_Y_OFFSET;

  const colMinusRow = (adjustedX - centerX) / TILE_X_SPACING;
  const colPlusRow = adjustedY / TILE_Y_SPACING;

  const col = (colMinusRow + colPlusRow) / 2;
  const row = (colPlusRow - colMinusRow) / 2;

  return { row: Math.round(row), col: Math.round(col) };
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
      const { row, col } = debugWorldToTile(agentPool.x[i], agentPool.y[i], centerX);
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
 * Draw all agents and flags in depth-sorted order
 */
export function drawEntities(
  ctx: CanvasRenderingContext2D,
  drawables: Drawable[],
  agentPool: AgentPool,
  teamSpawnPoints: SpawnPoint[],
  cache: ImageCache,
  cameraX: number,
  cameraY: number,
  visibleWidth: number,
  visibleHeight: number,
): void {
  for (const drawable of drawables) {
    if (drawable.type === "flag") {
      const spawn = teamSpawnPoints[drawable.index];
      const flagScreenX = spawn.x - cameraX;
      const flagScreenY = spawn.y - cameraY;

      // Only draw if visible
      if (flagScreenX > -50 && flagScreenX < visibleWidth + 50 && flagScreenY > -60 && flagScreenY < visibleHeight) {
        const teamColor = TEAM_COLORS[drawable.index];
        const hexColor = TEAM_HEX_COLORS[teamColor];
        drawFlag(ctx, flagScreenX, flagScreenY, hexColor);
      }
    } else {
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
}
