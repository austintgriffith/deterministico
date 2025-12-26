"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KEYBOARD_PAN_SPEED, MAX_ZOOM, MIN_ZOOM, ZOOM_SENSITIVITY } from "./constants";
import type { CameraState, DragState, PinchState } from "~~/lib/game";

/**
 * Hook for camera pan/zoom/drag functionality.
 */
export function useCamera() {
  const cameraRef = useRef<CameraState>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<DragState>({ x: 0, y: 0, cameraX: 0, cameraY: 0 });

  // Pinch gesture tracking
  const pinchStartRef = useRef<PinchState>({ distance: 0, zoom: 1, centerX: 0, centerY: 0 });
  const [isPinching, setIsPinching] = useState(false);

  // Keyboard pan tracking
  const keysPressed = useRef<Set<string>>(new Set());
  const keyAnimationRef = useRef<number>(0);

  // Set camera position
  const setCamera = useCallback((x: number, y: number) => {
    cameraRef.current = { x, y };
  }, []);

  // Set zoom level
  const setZoom = useCallback((zoom: number) => {
    zoomRef.current = zoom;
  }, []);

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

  const createTouchMoveHandler = useCallback(
    (canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
      return (e: React.TouchEvent) => {
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
      };
    },
    [getTouchDistance, getTouchCenter, handleDragMove, isDragging, isPinching],
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
    setIsPinching(false);
  }, [handleDragEnd]);

  // Mouse wheel zoom
  const createWheelHandler = useCallback((canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
    return (e: React.WheelEvent) => {
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const delta = -e.deltaY * ZOOM_SENSITIVITY;
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
    };
  }, []);

  // Keyboard arrow key panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") {
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
        e.preventDefault();
        keysPressed.current.add(e.key);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
    };

    const updateCameraFromKeys = () => {
      const keys = keysPressed.current;
      if (keys.size === 0) {
        keyAnimationRef.current = requestAnimationFrame(updateCameraFromKeys);
        return;
      }

      const zoom = zoomRef.current;
      const panSpeed = KEYBOARD_PAN_SPEED / zoom;

      // Vertical movement (up/down)
      if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) {
        cameraRef.current.y -= panSpeed;
      }
      if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) {
        cameraRef.current.y += panSpeed;
      }

      // Horizontal movement (left/right)
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
        cameraRef.current.x -= panSpeed;
      }
      if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
        cameraRef.current.x += panSpeed;
      }

      keyAnimationRef.current = requestAnimationFrame(updateCameraFromKeys);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    keyAnimationRef.current = requestAnimationFrame(updateCameraFromKeys);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (keyAnimationRef.current) {
        cancelAnimationFrame(keyAnimationRef.current);
      }
      keysPressed.current.clear();
    };
  }, []);

  return {
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
  };
}
