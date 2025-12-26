"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SPRITE_SHEETS,
  SPRITE_SHEET_COLS,
  SPRITE_SHEET_ROWS,
  TERRAIN_SHEETS,
  TOTAL_TILES_PER_SHEET,
  TerrainType,
  getWeightedTerrainType,
  hash,
  smoothTerrainGrid,
} from "~~/lib/game";

// Display size for the tile preview
const PREVIEW_WIDTH = 200;
const PREVIEW_HEIGHT = 200;

// Surface grid size for preview (smaller than game's 111 for performance)
const SURFACE_GRID_SIZE = 21;

// Fine-tune step size
const FINE_STEP = 1;

export default function TileSpritesPage() {
  // Current tile position for preview
  const [currentCol, setCurrentCol] = useState(0);
  const [currentRow, setCurrentRow] = useState(0);

  // Sprite sheet natural dimensions (loaded from image)
  const [sheetWidth, setSheetWidth] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Sprite sheet extraction parameters (calibrated values for ground_tiles_00.png)
  const [startX, setStartX] = useState(22);
  const [startY, setStartY] = useState(34);
  const [stepX, setStepX] = useState(196);
  const [stepY, setStepY] = useState(166);

  // Surface layout parameters (how tiles fit together in isometric grid)
  // Calibrated values for ground_tiles_00.png tiles
  const [surfaceSpacingX, setSurfaceSpacingX] = useState(89); // horizontal offset between tiles
  const [surfaceSpacingY, setSurfaceSpacingY] = useState(47); // vertical offset between rows

  // Camera/pan state for dragging the surface
  const [cameraX, setCameraX] = useState(0);
  const [cameraY, setCameraY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, camX: 0, camY: 0 });

  // Selected sprite sheet: "all" or specific sheet name
  const [selectedSheet, setSelectedSheet] = useState<"all" | string>("all");

  // Random seed for map generation (press R to regenerate)
  const [seed, setSeed] = useState(42);

  // Calculate current offset for preview based on tile position and parameters
  const offsetX = startX + currentCol * stepX;
  const offsetY = startY + currentRow * stepY;
  const currentTileIndex = currentRow * SPRITE_SHEET_COLS + currentCol;

  // Generate deterministic terrain map with three phases:
  // 1. Weighted type assignment
  // 2. Smoothing passes
  // 3. Tile variant selection
  const surfaceTiles = useMemo(() => {
    // Convert numeric seed to bigint for keccak256 compatibility
    const seedBigInt = BigInt(seed);

    // Phase 1: Generate initial type grid with weighted random selection
    let typeGrid: TerrainType[][] = [];
    for (let row = 0; row < SURFACE_GRID_SIZE; row++) {
      const rowTypes: TerrainType[] = [];
      for (let col = 0; col < SURFACE_GRID_SIZE; col++) {
        rowTypes.push(getWeightedTerrainType(row, col, seedBigInt));
      }
      typeGrid.push(rowTypes);
    }

    // Phase 2: Apply smoothing passes (2 passes for natural clustering)
    typeGrid = smoothTerrainGrid(typeGrid, 1, seedBigInt);
    typeGrid = smoothTerrainGrid(typeGrid, 2, seedBigInt);

    // Phase 3: Select tile variants based on terrain type
    // Note: sheetIndex of -1 indicates liquid terrain (rendered as colored diamond)
    const tiles: { sheetIndex: number; tileIndex: number }[][] = [];

    // If a specific sheet is selected in UI, use it for ALL tiles
    const overrideSheetIndex = selectedSheet !== "all" ? SPRITE_SHEETS.findIndex(s => s === selectedSheet) : -1;

    for (let row = 0; row < SURFACE_GRID_SIZE; row++) {
      const rowTiles: { sheetIndex: number; tileIndex: number }[] = [];
      for (let col = 0; col < SURFACE_GRID_SIZE; col++) {
        // Use deterministic hash to select tile variant
        const tileHash = hash(row + 3000, col + 3000, seedBigInt);
        const tileIndex = Number(tileHash % BigInt(TOTAL_TILES_PER_SHEET));

        // If specific sheet selected in UI, override ALL tiles (including liquid)
        if (overrideSheetIndex >= 0) {
          rowTiles.push({ sheetIndex: overrideSheetIndex, tileIndex });
          continue;
        }

        const terrainType = typeGrid[row][col];

        // Get available sheets for this terrain type
        const availableSheets = TERRAIN_SHEETS[terrainType];

        // Handle liquid terrain (no sprite sheets - rendered as colored diamond)
        if (availableSheets.length === 0) {
          rowTiles.push({ sheetIndex: -1, tileIndex: 0 });
          continue;
        }

        // Use deterministic hash to select sheet
        const sheetHash = hash(row + 2000, col + 2000, seedBigInt);

        // Select random sheet from available sheets for this terrain type
        const selectedSheetName = availableSheets[Number(sheetHash % BigInt(availableSheets.length))];

        // Find the index in the full SPRITE_SHEETS array
        const sheetIndex = SPRITE_SHEETS.findIndex(s => s === selectedSheetName);

        rowTiles.push({ sheetIndex, tileIndex });
      }
      tiles.push(rowTiles);
    }
    return tiles;
  }, [selectedSheet, seed]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      // WASD: adjust surface layout, R: new seed
      switch (e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          setSurfaceSpacingX(prev => prev - 1);
          return;
        case "d":
          e.preventDefault();
          setSurfaceSpacingX(prev => prev + 1);
          return;
        case "w":
          e.preventDefault();
          setSurfaceSpacingY(prev => prev - 1);
          return;
        case "s":
          e.preventDefault();
          setSurfaceSpacingY(prev => prev + 1);
          return;
        case "r":
          e.preventDefault();
          setSeed(Math.floor(Math.random() * 1000000));
          return;
      }

      if (e.shiftKey) {
        // Shift + arrows: fine-tune sprite sheet extraction
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (currentCol === 0) {
              setStartX(prev => prev - FINE_STEP);
            } else {
              setStepX(prev => prev - FINE_STEP);
            }
            break;
          case "ArrowRight":
            e.preventDefault();
            if (currentCol === 0) {
              setStartX(prev => prev + FINE_STEP);
            } else {
              setStepX(prev => prev + FINE_STEP);
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            if (currentRow === 0) {
              setStartY(prev => prev - FINE_STEP);
            } else {
              setStepY(prev => prev - FINE_STEP);
            }
            break;
          case "ArrowDown":
            e.preventDefault();
            if (currentRow === 0) {
              setStartY(prev => prev + FINE_STEP);
            } else {
              setStepY(prev => prev + FINE_STEP);
            }
            break;
        }
      } else {
        // Arrows without shift: move to next/prev tile in preview
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            setCurrentCol(prev => Math.max(0, prev - 1));
            break;
          case "ArrowRight":
            e.preventDefault();
            setCurrentCol(prev => Math.min(SPRITE_SHEET_COLS - 1, prev + 1));
            break;
          case "ArrowUp":
            e.preventDefault();
            setCurrentRow(prev => Math.max(0, prev - 1));
            break;
          case "ArrowDown":
            e.preventDefault();
            setCurrentRow(prev => Math.min(SPRITE_SHEET_ROWS - 1, prev + 1));
            break;
        }
      }
    },
    [currentCol, currentRow],
  );

  // Set up keyboard listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Load all sprite sheets
  const [loadedSheets, setLoadedSheets] = useState<Set<string>>(new Set());
  const [failedSheets, setFailedSheets] = useState<Set<string>>(new Set());

  useEffect(() => {
    SPRITE_SHEETS.forEach(sheetName => {
      const img = new Image();
      img.onload = () => {
        // Use first sheet dimensions as reference
        if (sheetWidth === 0) {
          setSheetWidth(img.naturalWidth);
          setSheetHeight(img.naturalHeight);
        }
        setLoadedSheets(prev => new Set([...prev, sheetName]));
      };
      img.onerror = () => {
        console.error(`Failed to load sprite sheet: ${sheetName}`);
        setFailedSheets(prev => new Set([...prev, sheetName]));
      };
      img.src = `/surface/${sheetName}.png`;
    });
  }, [sheetWidth]);

  // Check if all sheets are loaded (or at least the selected one)
  useEffect(() => {
    if (selectedSheet === "all") {
      setImageLoaded(loadedSheets.size === SPRITE_SHEETS.length);
    } else {
      setImageLoaded(loadedSheets.has(selectedSheet));
    }
  }, [loadedSheets, selectedSheet]);

  // Jump to a specific tile by index
  const jumpToTile = (index: number) => {
    const col = index % SPRITE_SHEET_COLS;
    const row = Math.floor(index / SPRITE_SHEET_COLS);
    setCurrentCol(col);
    setCurrentRow(row);
  };

  // Copy full configuration to clipboard
  const copyConfig = () => {
    const data = `// Tile sprite sheet configuration
const TILE_START_X = ${startX};
const TILE_START_Y = ${startY};
const TILE_STEP_X = ${stepX};
const TILE_STEP_Y = ${stepY};

// Surface layout configuration
const SURFACE_SPACING_X = ${surfaceSpacingX};
const SURFACE_SPACING_Y = ${surfaceSpacingY};`;
    navigator.clipboard.writeText(data);
  };

  // Calculate centering offset for isometric grid
  // The grid spans from negative to positive X, so we center at 0
  const centerX = 0;

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't start drag if clicking on UI
    if ((e.target as HTMLElement).closest(".ui-panel")) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY, camX: cameraX, camY: cameraY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setCameraX(dragStart.camX + dx);
    setCameraY(dragStart.camY + dy);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative min-h-screen">
      {/* Surface Background - isometric grid */}
      <div
        className={`fixed inset-0 bg-black ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ zIndex: 0, overflow: "visible" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            position: "absolute",
            left: `calc(50% + ${cameraX}px)`,
            top: `calc(30% + ${cameraY}px)`,
            transform: "translateX(-50%)",
          }}
        >
          {imageLoaded &&
            surfaceTiles.map((row, rowIndex) =>
              row.map((tileData, colIndex) => {
                const { sheetIndex, tileIndex } = tileData;

                // Isometric positioning (diamond grid)
                const screenX = centerX + (colIndex - rowIndex) * surfaceSpacingX;
                const screenY = (colIndex + rowIndex) * surfaceSpacingY;

                // Handle liquid terrain (sheetIndex === -1) - render as colored diamond
                if (sheetIndex === -1) {
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      style={{
                        position: "absolute",
                        left: screenX,
                        top: screenY,
                        width: PREVIEW_WIDTH,
                        height: PREVIEW_HEIGHT,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          width: PREVIEW_WIDTH * 0.9,
                          height: PREVIEW_HEIGHT * 0.45,
                          background: "linear-gradient(135deg, #1e90ff 0%, #0066cc 50%, #004499 100%)",
                          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                          boxShadow: "inset 0 -20px 40px rgba(0,0,0,0.3), inset 0 20px 40px rgba(255,255,255,0.1)",
                        }}
                      />
                    </div>
                  );
                }

                const sheetName = SPRITE_SHEETS[sheetIndex];
                const tileCol = tileIndex % SPRITE_SHEET_COLS;
                const tileRow = Math.floor(tileIndex / SPRITE_SHEET_COLS);
                const spriteOffsetX = startX + tileCol * stepX;
                const spriteOffsetY = startY + tileRow * stepY;

                return (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    style={{
                      position: "absolute",
                      left: screenX,
                      top: screenY,
                      width: PREVIEW_WIDTH,
                      height: PREVIEW_HEIGHT,
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={`/surface/${sheetName}.png`}
                      alt=""
                      style={{
                        position: "absolute",
                        left: -spriteOffsetX,
                        top: -spriteOffsetY,
                        width: sheetWidth,
                        height: sheetHeight,
                        maxWidth: "none",
                        imageRendering: "pixelated",
                      }}
                      draggable={false}
                    />
                  </div>
                );
              }),
            )}
        </div>
      </div>

      {/* UI Overlay - Fixed position so it stays visible while scrolling */}
      <div className="fixed top-4 left-4 z-10 ui-panel">
        <div className="bg-gray-900/95 backdrop-blur rounded-lg p-6 max-w-xl shadow-2xl">
          <h1 className="text-3xl font-bold mb-6 text-white">Tile Sprite Calibration</h1>

          <div className="flex gap-8">
            {/* Left panel - Tile preview */}
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold text-white">Tile Preview</h2>

              {/* Tile preview with overflow hidden */}
              <div
                className="border-2 border-yellow-500 bg-black"
                style={{
                  width: PREVIEW_WIDTH,
                  height: PREVIEW_HEIGHT,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {imageLoaded && (
                  <img
                    src={`/surface/${selectedSheet === "all" ? SPRITE_SHEETS[0] : selectedSheet}.png`}
                    alt="Sprite sheet"
                    style={{
                      position: "absolute",
                      left: -offsetX,
                      top: -offsetY,
                      width: sheetWidth,
                      height: sheetHeight,
                      maxWidth: "none",
                      imageRendering: "pixelated",
                    }}
                    draggable={false}
                  />
                )}
              </div>

              {/* Offset readout */}
              <div className="font-mono text-sm bg-gray-800 p-3 rounded text-white">
                <div>
                  Sprite: <span className="text-yellow-400">X: {offsetX}</span>,{" "}
                  <span className="text-green-400">Y: {offsetY}</span>
                </div>
                <div className="mt-1">
                  Tile:{" "}
                  <span className="text-cyan-400">
                    [{currentCol}, {currentRow}]
                  </span>{" "}
                  (#{currentTileIndex})
                </div>
              </div>

              <button
                onClick={copyConfig}
                className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded transition-colors text-sm text-white"
              >
                Copy All Config
              </button>
            </div>

            {/* Right panel - Controls and info */}
            <div className="flex flex-col gap-4 text-white">
              {/* Sprite Sheet Selector */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Sprite Sheet</h2>
                <div className="bg-gray-800 p-3 rounded">
                  <select
                    value={selectedSheet}
                    onChange={e => setSelectedSheet(e.target.value)}
                    className="bg-gray-700 text-white px-2 py-1 rounded w-full text-sm"
                  >
                    <option value="all">All Sheets (Random)</option>
                    {SPRITE_SHEETS.map(sheet => (
                      <option key={sheet} value={sheet}>
                        {sheet} {loadedSheets.has(sheet) ? "✓" : failedSheets.has(sheet) ? "✗" : "..."}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs mt-2 text-gray-400">
                    Loaded: {loadedSheets.size}/{SPRITE_SHEETS.length}
                    {failedSheets.size > 0 && (
                      <span className="text-red-400 ml-2">Failed: {Array.from(failedSheets).join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Sprite Sheet Parameters */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Sprite Sheet Extraction</h2>
                <div className="bg-gray-800 p-3 rounded space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <label className="w-16">Start X:</label>
                    <input
                      type="number"
                      value={startX}
                      onChange={e => setStartX(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                    <label className="w-16 ml-2">Step X:</label>
                    <input
                      type="number"
                      value={stepX}
                      onChange={e => setStepX(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-16">Start Y:</label>
                    <input
                      type="number"
                      value={startY}
                      onChange={e => setStartY(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                    <label className="w-16 ml-2">Step Y:</label>
                    <input
                      type="number"
                      value={stepY}
                      onChange={e => setStepY(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                  </div>
                </div>
              </div>

              {/* Surface Layout Parameters */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Surface Layout</h2>
                <div className="bg-gray-800 p-3 rounded space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <label className="w-20">Spacing X:</label>
                    <input
                      type="number"
                      value={surfaceSpacingX}
                      onChange={e => setSurfaceSpacingX(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                    <span className="text-gray-400">px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-20">Spacing Y:</label>
                    <input
                      type="number"
                      value={surfaceSpacingY}
                      onChange={e => setSurfaceSpacingY(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-16"
                    />
                    <span className="text-gray-400">px</span>
                  </div>
                  <div className="flex items-center gap-2 border-t border-gray-600 pt-2">
                    <label className="w-20">Seed:</label>
                    <input
                      type="number"
                      value={seed}
                      onChange={e => setSeed(Number(e.target.value))}
                      className="bg-gray-700 text-white px-2 py-1 rounded w-24"
                    />
                    <button
                      onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                      className="bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-xs"
                    >
                      🎲
                    </button>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Controls</h2>
                <div className="bg-gray-800 p-3 rounded text-sm space-y-1">
                  <div>
                    <span className="text-yellow-400">Arrow keys</span>: Navigate tiles
                  </div>
                  <div>
                    <span className="text-yellow-400">Shift + Arrows</span>: {currentCol === 0 ? "Start" : "Step"} X/Y
                  </div>
                  <div className="border-t border-gray-600 pt-1 mt-1">
                    <span className="text-cyan-400">W/S</span>: Surface Spacing Y
                  </div>
                  <div>
                    <span className="text-cyan-400">A/D</span>: Surface Spacing X
                  </div>
                  <div>
                    <span className="text-purple-400">R</span>: New random seed
                  </div>
                </div>
              </div>

              {/* Quick jump to tiles */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Jump to Tile</h2>
                <div className="grid grid-cols-5 gap-1">
                  {Array.from({ length: TOTAL_TILES_PER_SHEET }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => jumpToTile(i)}
                      className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                        currentTileIndex === i ? "bg-yellow-600 text-black" : "bg-gray-700 hover:bg-gray-600"
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
