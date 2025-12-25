"use client";

import { useEffect, useRef, useState } from "react";
import { SPRITE_SHEETS, TEAM_COLORS, VEHICLE_TYPES } from "~~/lib/game";
import type { ImageCache } from "~~/lib/game";

/**
 * Hook for preloading all game images (sprite sheets and vehicle sprites).
 * Returns the loaded state and a ref to the image cache.
 */
export function useImageLoader() {
  const imageCacheRef = useRef<ImageCache>({
    spriteSheets: new Map(),
    vehicleSprites: new Map(),
    loaded: false,
  });
  const [imagesLoaded, setImagesLoaded] = useState(false);

  useEffect(() => {
    const cache = imageCacheRef.current;
    if (cache.loaded) return;

    let loadedCount = 0;
    // 15 sprite sheets + (12 vehicle types * 12 team colors) = 15 + 144 = 159 total images
    const totalImages = SPRITE_SHEETS.length + VEHICLE_TYPES.length * TEAM_COLORS.length;

    const onLoad = () => {
      loadedCount++;
      if (loadedCount === totalImages) {
        cache.loaded = true;
        setImagesLoaded(true);
      }
    };

    // Load sprite sheet images
    for (const sheetName of SPRITE_SHEETS) {
      const img = new window.Image();
      img.onload = () => {
        cache.spriteSheets.set(sheetName, {
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        onLoad();
      };
      img.src = `/surface/${sheetName}.png`;
    }

    // Load all vehicle sprite sheets (12 vehicle types * 12 team colors = 144 sprites)
    // Sprite sheets are 3 columns x 2 rows
    for (const vehicleType of VEHICLE_TYPES) {
      for (const teamColor of TEAM_COLORS) {
        const spriteKey = `${vehicleType}_${teamColor}`;
        const vehicleImg = new window.Image();
        vehicleImg.onload = () => {
          cache.vehicleSprites.set(spriteKey, {
            image: vehicleImg,
            frameWidth: vehicleImg.naturalWidth / 3,
            frameHeight: vehicleImg.naturalHeight / 2,
          });
          onLoad();
        };
        vehicleImg.src = `/vehicles/${spriteKey}.png`;
      }
    }
  }, []);

  return { imageCacheRef, imagesLoaded };
}
