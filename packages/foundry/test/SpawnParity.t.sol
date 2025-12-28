// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "forge-std/Test.sol";
import "../contracts/DeterministicDice.sol";

contract SpawnParityTest is Test {
    using DeterministicDice for DeterministicDice.Dice;
    
    int32 constant TILE_X_SPACING = 89;
    int32 constant TILE_Y_SPACING = 47;
    int32 constant TILE_RENDER_WIDTH = 200;
    int32 constant FIXED_POINT_SCALE = 100;
    uint16 constant GRID_SIZE = 32;
    uint16 constant TILE_MARGIN = 10;
    
    function _tileCenterToWorld(int32 row, int32 col, int32 centerX) internal pure returns (int32 x, int32 y) {
        // Calculated: ((34 * 200 / 166) + 47) * 100 = 8796 - MUST match TypeScript
        int32 tileCenterYOffset = 8796;
        // centerX is in pixels (not scaled), so we need to scale everything together
        x = (centerX + (col - row) * TILE_X_SPACING + TILE_RENDER_WIDTH / 2) * FIXED_POINT_SCALE;
        y = (col + row) * TILE_Y_SPACING * FIXED_POINT_SCALE + tileCenterYOffset;
    }
    
    function test_SpawnPointParity() public {
        bytes32 seed = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        
        // Expected from JavaScript
        bytes32 expectedSpawnSeed = 0xbd219f7c95ec7899adfcde5de82d304573514f908b351303a0c01365c9f51b3d;
        uint256 expectedRowRoll = 11;
        uint256 expectedColRoll = 2;
        int32 expectedSpawnX = 214700;  // spawn.x * 100
        // y = (col + row) * 47 * 100 + 8796 = (12+21) * 4700 + 8796 = 163896
        int32 expectedSpawnY = 163896;  // spawn.y * 100 (with corrected TILE_CENTER_Y_OFFSET)
        
        // Calculate spawn dice seed
        bytes32 spawnDiceSeed = keccak256(abi.encodePacked(seed, "spawn-points"));
        assertEq(spawnDiceSeed, expectedSpawnSeed, "Spawn dice seed mismatch");
        
        // Create dice and roll
        DeterministicDice.Dice memory dice = DeterministicDice.create(spawnDiceSeed);
        uint256 rollRange = uint256(GRID_SIZE) - 2 * uint256(TILE_MARGIN);
        assertEq(rollRange, 12, "Roll range mismatch");
        
        uint256 rowRoll;
        uint256 colRoll;
        (rowRoll, dice) = dice.roll(rollRange);
        (colRoll, dice) = dice.roll(rollRange);
        
        assertEq(rowRoll, expectedRowRoll, "Row roll mismatch");
        assertEq(colRoll, expectedColRoll, "Col roll mismatch");
        
        uint16 row = uint16(TILE_MARGIN + rowRoll);
        uint16 col = uint16(TILE_MARGIN + colRoll);
        
        assertEq(row, 21, "Row mismatch");
        assertEq(col, 12, "Col mismatch");
        
        // Calculate centerX
        uint256 mapWidth = uint256(GRID_SIZE) * 2 * uint256(uint32(TILE_X_SPACING)) + uint256(uint32(TILE_RENDER_WIDTH));
        int32 centerX = int32(int256(mapWidth / 2 - uint256(uint32(TILE_RENDER_WIDTH)) / 2));
        assertEq(centerX, 2848, "CenterX mismatch");
        
        // Calculate spawn point
        (int32 spawnX, int32 spawnY) = _tileCenterToWorld(int32(uint32(row)), int32(uint32(col)), centerX);
        
        emit log_named_int("spawnX", spawnX);
        emit log_named_int("spawnY", spawnY);
        emit log_named_int("expectedSpawnX", expectedSpawnX);
        emit log_named_int("expectedSpawnY", expectedSpawnY);
        
        assertEq(spawnX, expectedSpawnX, "SpawnX mismatch");
        assertEq(spawnY, expectedSpawnY, "SpawnY mismatch");
    }
    
    function test_AgentInitDiceParity() public {
        bytes32 seed = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        
        // Expected from JavaScript
        bytes32 expectedInitSeed = 0x880dd83aaa4d888dab0b90c8bdfd34e86355ea9cdef3f0114d4a5d04b6852bd5;
        uint256 expectedDirRoll = 0;
        uint256 expectedTypeRoll = 0;
        
        // Calculate init dice seed
        bytes32 initDiceSeed = keccak256(abi.encodePacked(seed, "agent-init"));
        assertEq(initDiceSeed, expectedInitSeed, "Init dice seed mismatch");
        
        // Create dice and roll
        DeterministicDice.Dice memory dice = DeterministicDice.create(initDiceSeed);
        
        uint256 dirRoll;
        uint256 typeRoll;
        (dirRoll, dice) = dice.roll(4);
        (typeRoll, dice) = dice.roll(2);
        
        assertEq(dirRoll, expectedDirRoll, "Direction roll mismatch");
        assertEq(typeRoll, expectedTypeRoll, "Type roll mismatch");
    }
}
