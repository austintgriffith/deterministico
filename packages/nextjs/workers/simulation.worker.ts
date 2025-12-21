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
const MOVE_AMOUNT = 5;

// Agent data buffers
let x: Float32Array;
let y: Float32Array;
let direction: Uint8Array;
let count = 0;
let maxAgents = 0;

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
};

type TickMessage = {
  type: "tick";
  rollSeed: string;
};

type GetStateMessage = {
  type: "getState";
};

type WorkerMessage = InitMessage | ResetMessage | AddAgentMessage | TickMessage | GetStateMessage;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type } = e.data;

  switch (type) {
    case "init": {
      const { maxAgents: max } = e.data as InitMessage;
      maxAgents = max;
      x = new Float32Array(max);
      y = new Float32Array(max);
      direction = new Uint8Array(max);
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
      const { x: ax, y: ay, direction: dir } = e.data as AddAgentMessage;
      if (count < maxAgents) {
        x[count] = ax;
        y[count] = ay;
        direction[count] = dir;
        count++;
      }
      self.postMessage({ type: "agentAdded", count });
      break;
    }

    case "tick": {
      const { rollSeed } = e.data as TickMessage;
      const dice = new DeterministicDice(rollSeed as `0x${string}`);

      // Update all agents in place
      for (let i = 0; i < count; i++) {
        const action = dice.roll(16);

        if (action <= 9) {
          // Move forward
          const dir = direction[i];
          x[i] += DIRECTION_DX[dir] * MOVE_AMOUNT;
          y[i] += DIRECTION_DY[dir] * MOVE_AMOUNT;
        } else if (action <= 12) {
          // Turn left: (dir + 3) % 4
          direction[i] = (direction[i] + 3) % 4;
        } else {
          // Turn right: (dir + 1) % 4
          direction[i] = (direction[i] + 1) % 4;
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
