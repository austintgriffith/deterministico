/**
 * Web Worker for high-performance agent simulation.
 * Runs deterministic updates off the main thread for smooth rendering.
 *
 * Uses transferable ArrayBuffers for zero-copy data transfer.
 */
import { DeterministicDice } from "deterministic-dice";

// Direction vectors for fast indexed lookup
// Index: 0=north, 1=east, 2=south, 3=west
const DIRECTION_DX = new Float32Array([2, 2, -2, -2]);
const DIRECTION_DY = new Float32Array([-1, 1, 1, -1]);

/**
 * Convert a force vector (fx, fy) to the best matching direction index (0-3)
 * Uses isometric coordinate system
 */
function getDirectionFromForce(fx: number, fy: number): number {
  // Determine quadrant based on sign of force components
  if (fx >= 0 && fy < 0) return 0; // north (top-right)
  if (fx >= 0 && fy >= 0) return 1; // east (bottom-right)
  if (fx < 0 && fy >= 0) return 2; // south (bottom-left)
  return 3; // west (top-left)
}

// Movement speed per vehicle type (matches VEHICLE_TYPES order)
// heavy=3px, medium=4px, light=5px
const MOVE_SPEED_BY_TYPE = new Float32Array([3, 3, 3, 5, 5, 5, 4]);

// Comms unit operating range (matches VEHICLE_TYPES order)
// 0 means not a comms unit
const COMMS_RANGE = new Float32Array([800, 0, 0, 800, 0, 0, 0]);

// Comms gravity behavior constants
const COMMS_REPEL_RATIO = 0.4; // Below range * 0.4, units repel
const COMMS_ATTRACT_RATIO = 0.8; // Above range * 0.8, units attract
const COMMS_REPEL_STRENGTH = 1.5; // Force multiplier for repulsion
const COMMS_ATTRACT_STRENGTH = 2.0; // Force multiplier for attraction
const COMMS_FORCE_THRESHOLD = 0.1; // Minimum force magnitude to trigger movement
const NUM_TEAMS = 12;

// Agent data buffers
let x: Float32Array;
let y: Float32Array;
let direction: Uint8Array;
let team: Uint8Array;
let vehicleType: Uint8Array;
let spawnX: Float32Array;
let spawnY: Float32Array;
let count = 0;
let maxAgents = 0;

// Team home base positions (for comms gravity)
let teamSpawnX: Float32Array;
let teamSpawnY: Float32Array;

// Message types
type InitMessage = {
  type: "init";
  maxAgents: number;
};

type ResetMessage = {
  type: "reset";
};

type AddAgentMessage = {
  type: "addAgent";
  x: number;
  y: number;
  direction: number;
  team: number;
  vehicleType: number;
};

type TickMessage = {
  type: "tick";
  rollSeed: string;
};

type GetStateMessage = {
  type: "getState";
};

type SetTeamSpawnMessage = {
  type: "setTeamSpawn";
  teamIndex: number;
  x: number;
  y: number;
};

type WorkerMessage = InitMessage | ResetMessage | AddAgentMessage | TickMessage | GetStateMessage | SetTeamSpawnMessage;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type } = e.data;

  switch (type) {
    case "init": {
      const { maxAgents: max } = e.data as InitMessage;
      maxAgents = max;
      x = new Float32Array(max);
      y = new Float32Array(max);
      direction = new Uint8Array(max);
      team = new Uint8Array(max);
      vehicleType = new Uint8Array(max);
      spawnX = new Float32Array(max);
      spawnY = new Float32Array(max);
      teamSpawnX = new Float32Array(NUM_TEAMS);
      teamSpawnY = new Float32Array(NUM_TEAMS);
      count = 0;

      self.postMessage({ type: "ready" });
      break;
    }

    case "reset": {
      count = 0;
      self.postMessage({ type: "resetComplete" });
      break;
    }

    case "addAgent": {
      const { x: ax, y: ay, direction: dir, team: t, vehicleType: vt } = e.data as AddAgentMessage;
      if (count < maxAgents) {
        x[count] = ax;
        y[count] = ay;
        direction[count] = dir;
        team[count] = t;
        vehicleType[count] = vt;
        // Store spawn position (initial position is the spawn point)
        spawnX[count] = ax;
        spawnY[count] = ay;
        count++;
      }
      self.postMessage({ type: "agentAdded", count });
      break;
    }

    case "setTeamSpawn": {
      const { teamIndex, x: sx, y: sy } = e.data as SetTeamSpawnMessage;
      if (teamIndex >= 0 && teamIndex < NUM_TEAMS) {
        teamSpawnX[teamIndex] = sx;
        teamSpawnY[teamIndex] = sy;
      }
      break;
    }

    case "tick": {
      const { rollSeed } = e.data as TickMessage;
      const dice = new DeterministicDice(rollSeed as `0x${string}`);

      // Update all agents in place
      for (let i = 0; i < count; i++) {
        // Always consume a dice roll for determinism
        const action = dice.roll(16);
        const vt = vehicleType[i];
        const commsRange = COMMS_RANGE[vt];

        // Check if this is a comms unit
        if (commsRange > 0) {
          // === COMMS UNIT GRAVITY BEHAVIOR ===
          const myX = x[i];
          const myY = y[i];
          const myTeam = team[i];

          // Calculate distance thresholds based on this unit's range
          const repelDist = commsRange * COMMS_REPEL_RATIO;
          const attractDist = commsRange * COMMS_ATTRACT_RATIO;

          // Accumulate forces from all connections
          let forceX = 0;
          let forceY = 0;

          // Helper to apply force from a connection point (only if within range)
          const applyForce = (connX: number, connY: number, maxRange: number) => {
            const dx = connX - myX;
            const dy = connY - myY;
            const distSq = dx * dx + dy * dy;

            // If basically on top of it, push away in a random direction
            if (distSq < 1) {
              // Use dice-based direction for deterministic random push
              const randomDir = action % 4; // 0-3 direction
              forceX += DIRECTION_DX[randomDir] * COMMS_REPEL_STRENGTH;
              forceY += DIRECTION_DY[randomDir] * COMMS_REPEL_STRENGTH;
              return;
            }

            const dist = Math.sqrt(distSq);

            // Only aware of things within range (local vision)
            if (dist > maxRange) return;

            // Normalize direction
            const nx = dx / dist;
            const ny = dy / dist;

            if (dist < repelDist) {
              // Repel - push away (force points opposite to connection)
              const strength = ((repelDist - dist) / repelDist) * COMMS_REPEL_STRENGTH;
              forceX -= nx * strength;
              forceY -= ny * strength;
            } else if (dist > attractDist) {
              // Attract - pull toward connection (approaching edge of range)
              const strength = ((dist - attractDist) / commsRange) * COMMS_ATTRACT_STRENGTH;
              forceX += nx * strength;
              forceY += ny * strength;
            }
            // Between repelDist and attractDist = sweet spot, no force
          };

          // Apply force from home base (team spawn point) - always visible
          applyForce(teamSpawnX[myTeam], teamSpawnY[myTeam], commsRange);

          // Apply force from same-team comms units within range
          for (let j = 0; j < count; j++) {
            if (j === i) continue;
            if (team[j] !== myTeam) continue;
            if (COMMS_RANGE[vehicleType[j]] === 0) continue; // not a comms unit

            // Only check units within our communication range (local vision)
            const dx = x[j] - myX;
            const dy = y[j] - myY;
            const distSq = dx * dx + dy * dy;
            if (distSq > commsRange * commsRange) continue; // Outside range, can't see them

            applyForce(x[j], y[j], commsRange);
          }

          // Convert accumulated force to movement
          const forceMag = Math.sqrt(forceX * forceX + forceY * forceY);
          if (forceMag > COMMS_FORCE_THRESHOLD) {
            // Set direction based on net force
            direction[i] = getDirectionFromForce(forceX, forceY);

            // Move in that direction
            const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
            x[i] += DIRECTION_DX[direction[i]] * moveSpeed;
            y[i] += DIRECTION_DY[direction[i]] * moveSpeed;
          }
          // else: forces balanced, stay still (in the sweet spot)
        } else {
          // === NORMAL AGENT BEHAVIOR ===
          if (action <= 9) {
            // Move forward
            const dir = direction[i];
            const moveSpeed = MOVE_SPEED_BY_TYPE[vt];
            x[i] += DIRECTION_DX[dir] * moveSpeed;
            y[i] += DIRECTION_DY[dir] * moveSpeed;
          } else if (action <= 12) {
            // Turn left: (dir + 3) % 4
            direction[i] = (direction[i] + 3) % 4;
          } else {
            // Turn right: (dir + 1) % 4
            direction[i] = (direction[i] + 1) % 4;
          }
        }
      }

      // Send back copies of the data (can't transfer if we need to keep using them)
      // For true zero-copy, we'd use SharedArrayBuffer, but that requires COOP/COEP headers
      const xCopy = new Float32Array(count);
      const yCopy = new Float32Array(count);
      const directionCopy = new Uint8Array(count);

      xCopy.set(x.subarray(0, count));
      yCopy.set(y.subarray(0, count));
      directionCopy.set(direction.subarray(0, count));

      self.postMessage(
        {
          type: "tickComplete",
          x: xCopy.buffer,
          y: yCopy.buffer,
          direction: directionCopy.buffer,
          count,
        },
        { transfer: [xCopy.buffer, yCopy.buffer, directionCopy.buffer] },
      );
      break;
    }

    case "getState": {
      // Return current state
      const xCopy = new Float32Array(count);
      const yCopy = new Float32Array(count);
      const directionCopy = new Uint8Array(count);

      xCopy.set(x.subarray(0, count));
      yCopy.set(y.subarray(0, count));
      directionCopy.set(direction.subarray(0, count));

      self.postMessage(
        {
          type: "state",
          x: xCopy.buffer,
          y: yCopy.buffer,
          direction: directionCopy.buffer,
          count,
        },
        { transfer: [xCopy.buffer, yCopy.buffer, directionCopy.buffer] },
      );
      break;
    }
  }
};
