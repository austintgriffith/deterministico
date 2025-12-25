"use client";

import { useCallback, useEffect, useState } from "react";
import { TEAM_COLORS, VEHICLE_FRAME_OFFSETS, VEHICLE_TYPES } from "~~/lib/game";

// Frame labels corresponding to directions and UI views
// Frames 0-3: Directional (used in game)
// Frames 4-5: UI only (Top/Side views for menus, tooltips, etc.)
const FRAME_LABELS = ["South", "East", "North", "West", "Top", "Side"];

// Frame to sprite grid position: frame index -> [col, row]
// Sprite sheet is now 3 columns x 2 rows
const FRAME_POSITIONS: [number, number][] = [
  [0, 0], // Frame 0 = South
  [1, 0], // Frame 1 = East
  [0, 1], // Frame 2 = North
  [1, 1], // Frame 3 = West
  [2, 0], // Frame 4 = Top (UI only)
  [2, 1], // Frame 5 = Side (UI only)
];

// Number of directional frames (for animation)
const DIRECTIONAL_FRAMES = 4;
// Total number of frames
const TOTAL_FRAMES = 6;

// Preview size for vehicle sprite (container size)
const PREVIEW_SIZE = 128;
const SMALL_PREVIEW_SIZE = 64;

// Fine-tune step size
const FINE_STEP = 1;

export default function VehicleSpritesPage() {
  // Selected vehicle type and team color
  const [selectedVehicle, setSelectedVehicle] = useState<(typeof VEHICLE_TYPES)[number]>(VEHICLE_TYPES[0]);
  const [selectedTeam, setSelectedTeam] = useState<(typeof TEAM_COLORS)[number]>(TEAM_COLORS[0]);

  // Current frame index (0-3)
  const [currentFrame, setCurrentFrame] = useState(0);

  // Per-frame offsets (global for all vehicles) - initialized from constants
  // Ensure we have 6 entries (extend with defaults if constants only has 4)
  const [frameOffsets, setFrameOffsets] = useState(() => {
    const offsets = VEHICLE_FRAME_OFFSETS.map(offset => ({ ...offset }));
    // Add default offsets for Top and Side views if not present
    while (offsets.length < TOTAL_FRAMES) {
      offsets.push({ x: 0, y: 0 });
    }
    return offsets;
  });

  // Vehicle sprite image state
  const [vehicleImage, setVehicleImage] = useState<HTMLImageElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);

  // Animation toggle
  const [isAnimating, setIsAnimating] = useState(false);

  // Load vehicle sprite image when selection changes
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setVehicleImage(img);
      // Sprite sheet is 3 columns x 2 rows
      setFrameWidth(img.naturalWidth / 3);
      setFrameHeight(img.naturalHeight / 2);
    };
    img.src = `/vehicles/${selectedVehicle}_${selectedTeam}.png`;
  }, [selectedVehicle, selectedTeam]);

  // Animation effect - only cycles through directional frames (0-3)
  useEffect(() => {
    if (!isAnimating) return;
    const interval = setInterval(() => {
      setCurrentFrame(prev => (prev + 1) % DIRECTIONAL_FRAMES);
    }, 500);
    return () => clearInterval(interval);
  }, [isAnimating]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.target as HTMLElement).tagName === "SELECT") return;

      if (e.shiftKey) {
        // Shift + arrows: adjust offset for current frame
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            setFrameOffsets(prev => {
              const newOffsets = [...prev];
              newOffsets[currentFrame] = {
                ...newOffsets[currentFrame],
                x: newOffsets[currentFrame].x - FINE_STEP,
              };
              return newOffsets;
            });
            break;
          case "ArrowRight":
            e.preventDefault();
            setFrameOffsets(prev => {
              const newOffsets = [...prev];
              newOffsets[currentFrame] = {
                ...newOffsets[currentFrame],
                x: newOffsets[currentFrame].x + FINE_STEP,
              };
              return newOffsets;
            });
            break;
          case "ArrowUp":
            e.preventDefault();
            setFrameOffsets(prev => {
              const newOffsets = [...prev];
              newOffsets[currentFrame] = {
                ...newOffsets[currentFrame],
                y: newOffsets[currentFrame].y - FINE_STEP,
              };
              return newOffsets;
            });
            break;
          case "ArrowDown":
            e.preventDefault();
            setFrameOffsets(prev => {
              const newOffsets = [...prev];
              newOffsets[currentFrame] = {
                ...newOffsets[currentFrame],
                y: newOffsets[currentFrame].y + FINE_STEP,
              };
              return newOffsets;
            });
            break;
        }
      } else {
        // Arrows without shift: navigate frames (all 6 frames)
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            setCurrentFrame(prev => (prev - 1 + TOTAL_FRAMES) % TOTAL_FRAMES);
            break;
          case "ArrowRight":
            e.preventDefault();
            setCurrentFrame(prev => (prev + 1) % TOTAL_FRAMES);
            break;
        }
      }
    },
    [currentFrame],
  );

  // Set up keyboard listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Copy configuration to clipboard
  const copyConfig = () => {
    const data = `// Per-frame x,y offsets for vehicle sprites (all vehicles use same offsets)
// Frames 0-3: Directional (used in game rendering)
// Frames 4-5: UI only (Top/Side views for menus, tooltips, etc.)
export const VEHICLE_FRAME_OFFSETS = [
  { x: ${frameOffsets[0].x}, y: ${frameOffsets[0].y} }, // Frame 0 (South)
  { x: ${frameOffsets[1].x}, y: ${frameOffsets[1].y} }, // Frame 1 (East)
  { x: ${frameOffsets[2].x}, y: ${frameOffsets[2].y} }, // Frame 2 (North)
  { x: ${frameOffsets[3].x}, y: ${frameOffsets[3].y} }, // Frame 3 (West)
  { x: ${frameOffsets[4].x}, y: ${frameOffsets[4].y} }, // Frame 4 (Top - UI only)
  { x: ${frameOffsets[5].x}, y: ${frameOffsets[5].y} }, // Frame 5 (Side - UI only)
];`;
    navigator.clipboard.writeText(data);
  };

  // Reset offsets to saved constants
  const resetOffsets = () => {
    const offsets = VEHICLE_FRAME_OFFSETS.map(offset => ({ ...offset }));
    // Add default offsets for Top and Side views if not present
    while (offsets.length < TOTAL_FRAMES) {
      offsets.push({ x: 0, y: 0 });
    }
    setFrameOffsets(offsets);
  };

  // Get current frame position
  const [currentCol, currentRow] = FRAME_POSITIONS[currentFrame];

  // Calculate scale factors to fit frames in preview containers
  const largeScale = frameWidth > 0 ? Math.min(PREVIEW_SIZE / frameWidth, PREVIEW_SIZE / frameHeight) : 1;
  const smallScale = frameWidth > 0 ? Math.min(SMALL_PREVIEW_SIZE / frameWidth, SMALL_PREVIEW_SIZE / frameHeight) : 1;

  return (
    <div className="relative min-h-screen bg-gray-950">
      {/* Main Content */}
      <div className="p-6">
        <div className="bg-gray-900/95 backdrop-blur rounded-lg p-6 max-w-4xl mx-auto shadow-2xl">
          <h1 className="text-3xl font-bold mb-6 text-white">Vehicle Sprite Calibration</h1>

          <div className="flex gap-8">
            {/* Left panel - Large Preview */}
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold text-white">Current Frame Preview</h2>

              {/* Large preview with crosshair */}
              <div
                className="border-2 border-yellow-500 bg-black relative"
                style={{
                  width: PREVIEW_SIZE,
                  height: PREVIEW_SIZE,
                  overflow: "hidden",
                }}
              >
                {/* Crosshair guides */}
                <div
                  className="absolute bg-red-500/50"
                  style={{
                    left: PREVIEW_SIZE / 2 - 1,
                    top: 0,
                    width: 2,
                    height: PREVIEW_SIZE,
                  }}
                />
                <div
                  className="absolute bg-red-500/50"
                  style={{
                    left: 0,
                    top: PREVIEW_SIZE / 2 - 1,
                    width: PREVIEW_SIZE,
                    height: 2,
                  }}
                />

                {/* Vehicle sprite */}
                {vehicleImage && (
                  <img
                    src={vehicleImage.src}
                    alt="Vehicle sprite"
                    style={{
                      position: "absolute",
                      left:
                        (-currentCol * frameWidth + frameOffsets[currentFrame].x) * largeScale +
                        (PREVIEW_SIZE - frameWidth * largeScale) / 2,
                      top:
                        (-currentRow * frameHeight + frameOffsets[currentFrame].y) * largeScale +
                        (PREVIEW_SIZE - frameHeight * largeScale) / 2,
                      width: vehicleImage.naturalWidth * largeScale,
                      height: vehicleImage.naturalHeight * largeScale,
                      maxWidth: "none",
                      imageRendering: "pixelated",
                    }}
                    draggable={false}
                  />
                )}
              </div>

              {/* Frame info */}
              <div className="font-mono text-sm bg-gray-800 p-3 rounded text-white">
                <div>
                  Frame: <span className="text-yellow-400">{currentFrame}</span> ({FRAME_LABELS[currentFrame]})
                </div>
                <div className="mt-1">
                  Offset:{" "}
                  <span className="text-cyan-400">
                    X: {frameOffsets[currentFrame].x}, Y: {frameOffsets[currentFrame].y}
                  </span>
                </div>
                <div className="mt-1 text-gray-400 text-xs">
                  Frame size: {frameWidth} x {frameHeight}
                </div>
                <div className="text-gray-400 text-xs">Scale: {largeScale.toFixed(2)}x</div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={copyConfig}
                  className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded transition-colors text-sm text-white flex-1"
                >
                  Copy Config
                </button>
                <button
                  onClick={resetOffsets}
                  className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded transition-colors text-sm text-white"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Right panel - All frames grid and controls */}
            <div className="flex flex-col gap-4 flex-1 text-white">
              {/* Vehicle Selector */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Vehicle Selection</h2>
                <div className="bg-gray-800 p-3 rounded space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="w-16">Type:</label>
                    <select
                      value={selectedVehicle}
                      onChange={e => setSelectedVehicle(e.target.value as (typeof VEHICLE_TYPES)[number])}
                      className="bg-gray-700 text-white px-2 py-1 rounded flex-1 text-sm"
                    >
                      {VEHICLE_TYPES.map(type => (
                        <option key={type} value={type}>
                          {type.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-16">Color:</label>
                    <select
                      value={selectedTeam}
                      onChange={e => setSelectedTeam(e.target.value as (typeof TEAM_COLORS)[number])}
                      className="bg-gray-700 text-white px-2 py-1 rounded flex-1 text-sm"
                    >
                      {TEAM_COLORS.map(color => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* All 6 Frames Grid (3x2) */}
              <div>
                <h2 className="text-lg font-semibold mb-2">All Frames</h2>
                <div className="bg-gray-800 p-3 rounded">
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 4, 2, 3, 5].map(frameIndex => {
                      const [col, row] = FRAME_POSITIONS[frameIndex];
                      const isSelected = frameIndex === currentFrame;
                      const isUIOnly = frameIndex >= DIRECTIONAL_FRAMES;
                      return (
                        <button
                          key={frameIndex}
                          onClick={() => setCurrentFrame(frameIndex)}
                          className={`relative border-2 ${
                            isSelected ? "border-yellow-500" : isUIOnly ? "border-purple-600" : "border-gray-600"
                          } bg-black p-1 rounded transition-colors hover:border-yellow-400`}
                          style={{
                            width: 72,
                            height: 72,
                          }}
                        >
                          <div
                            style={{
                              width: SMALL_PREVIEW_SIZE,
                              height: SMALL_PREVIEW_SIZE,
                              overflow: "hidden",
                              position: "relative",
                            }}
                          >
                            {vehicleImage && (
                              <img
                                src={vehicleImage.src}
                                alt={`Frame ${frameIndex}`}
                                style={{
                                  position: "absolute",
                                  left:
                                    (-col * frameWidth + frameOffsets[frameIndex].x) * smallScale +
                                    (SMALL_PREVIEW_SIZE - frameWidth * smallScale) / 2,
                                  top:
                                    (-row * frameHeight + frameOffsets[frameIndex].y) * smallScale +
                                    (SMALL_PREVIEW_SIZE - frameHeight * smallScale) / 2,
                                  width: vehicleImage.naturalWidth * smallScale,
                                  height: vehicleImage.naturalHeight * smallScale,
                                  maxWidth: "none",
                                  imageRendering: "pixelated",
                                }}
                                draggable={false}
                              />
                            )}
                          </div>
                          <div
                            className={`absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-center py-0.5 ${isUIOnly ? "text-purple-400" : ""}`}
                          >
                            {FRAME_LABELS[frameIndex]}
                            {isUIOnly && " (UI)"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Per-frame offset display */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Frame Offsets</h2>
                <div className="bg-gray-800 p-3 rounded font-mono text-sm">
                  {frameOffsets.map((offset, i) => (
                    <div
                      key={i}
                      className={`flex justify-between ${i === currentFrame ? "text-yellow-400" : "text-gray-400"}`}
                    >
                      <span>
                        Frame {i} ({FRAME_LABELS[i]}):
                      </span>
                      <span>
                        x: {offset.x.toString().padStart(3)}, y: {offset.y.toString().padStart(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Controls info */}
              <div>
                <h2 className="text-lg font-semibold mb-2">Controls</h2>
                <div className="bg-gray-800 p-3 rounded text-sm space-y-1">
                  <div>
                    <span className="text-yellow-400">Left/Right arrows</span>: Navigate frames
                  </div>
                  <div>
                    <span className="text-yellow-400">Shift + Arrows</span>: Adjust current frame offset
                  </div>
                </div>
              </div>

              {/* Animation toggle */}
              <div>
                <button
                  onClick={() => setIsAnimating(!isAnimating)}
                  className={`w-full py-2 rounded transition-colors text-sm ${
                    isAnimating ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"
                  }`}
                >
                  {isAnimating ? "Stop Animation" : "Animate Rotation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
