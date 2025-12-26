// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/DeterministicDice.sol";

/**
 * @title DeterministicDiceParity
 * @notice Tests that Solidity DeterministicDice produces identical results to the JS version.
 * @dev Uses Foundry's FFI to call a Node.js script that generates expected values.
 *      Run with: forge test --match-contract DeterministicDiceParity --ffi -vvv
 */
contract DeterministicDiceParityTest is Test {
    // Test sequence: must match the JS script exactly
    uint256[] internal TEST_SEQUENCE;

    function setUp() public {
        // This sequence must match diceParityData.js exactly
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(6);
        TEST_SEQUENCE.push(2);
        TEST_SEQUENCE.push(2);
        TEST_SEQUENCE.push(2);
        TEST_SEQUENCE.push(2);
        TEST_SEQUENCE.push(2);
        TEST_SEQUENCE.push(1000);
        TEST_SEQUENCE.push(1000);
        TEST_SEQUENCE.push(1000);
        TEST_SEQUENCE.push(256);
        TEST_SEQUENCE.push(256);
        TEST_SEQUENCE.push(256);
        TEST_SEQUENCE.push(256);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(100);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        TEST_SEQUENCE.push(16);
        // 2^16 (65536) - larger numbers (16 bits), 10 times
        // Note: JS library has overflow issues with larger ranges
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
        TEST_SEQUENCE.push(65536);
    }

    /// @notice Get expected results from the JS implementation via FFI
    function getJsResults(bytes32 seed) internal returns (uint256[] memory) {
        string[] memory inputs = new string[](3);
        inputs[0] = "node";
        inputs[1] = "scripts-js/diceParityData.js";
        inputs[2] = vm.toString(seed);

        bytes memory result = vm.ffi(inputs);
        string memory jsonStr = string(result);

        // Parse the results array from JSON
        // The output format is: {"seed":"0x...","sequence":[...],"results":[...]}
        return parseResultsFromJson(jsonStr);
    }

    /// @notice Parse the results array from the JSON output
    /// @dev Simple parser for our known JSON format
    function parseResultsFromJson(string memory json) internal pure returns (uint256[] memory) {
        // Find "results":[ and extract the array
        bytes memory jsonBytes = bytes(json);
        
        // Find the start of results array
        uint256 resultsStart = 0;
        bytes memory resultsKey = bytes('"results":[');
        
        for (uint256 i = 0; i < jsonBytes.length - resultsKey.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < resultsKey.length; j++) {
                if (jsonBytes[i + j] != resultsKey[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                resultsStart = i + resultsKey.length;
                break;
            }
        }
        
        require(resultsStart > 0, "Could not find results in JSON");
        
        // Find the end of results array
        uint256 resultsEnd = resultsStart;
        for (uint256 i = resultsStart; i < jsonBytes.length; i++) {
            if (jsonBytes[i] == "]") {
                resultsEnd = i;
                break;
            }
        }
        
        // Count numbers (count commas + 1)
        uint256 count = 1;
        for (uint256 i = resultsStart; i < resultsEnd; i++) {
            if (jsonBytes[i] == ",") count++;
        }
        
        // Parse numbers
        uint256[] memory results = new uint256[](count);
        uint256 numStart = resultsStart;
        uint256 numIndex = 0;
        
        for (uint256 i = resultsStart; i <= resultsEnd; i++) {
            if (jsonBytes[i] == "," || jsonBytes[i] == "]") {
                // Parse the number from numStart to i
                uint256 num = 0;
                for (uint256 j = numStart; j < i; j++) {
                    uint8 digit = uint8(jsonBytes[j]) - 48; // ASCII '0' = 48
                    num = num * 10 + digit;
                }
                results[numIndex] = num;
                numIndex++;
                numStart = i + 1;
            }
        }
        
        return results;
    }

    /// @notice Generate Solidity results for comparison
    function getSolidityResults(bytes32 seed) internal view returns (uint256[] memory) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint256[] memory results = new uint256[](TEST_SEQUENCE.length);
        
        for (uint256 i = 0; i < TEST_SEQUENCE.length; i++) {
            (results[i], dice) = DeterministicDice.roll(dice, TEST_SEQUENCE[i]);
        }
        
        return results;
    }

    /// @notice Main parity test with a fixed seed
    function test_ParityWithFixedSeed() public {
        bytes32 seed = keccak256("parity test seed");
        
        uint256[] memory jsResults = getJsResults(seed);
        uint256[] memory solResults = getSolidityResults(seed);
        
        assertEq(jsResults.length, solResults.length, "Result array lengths differ");
        
        for (uint256 i = 0; i < jsResults.length; i++) {
            assertEq(
                solResults[i], 
                jsResults[i], 
                string.concat(
                    "Mismatch at index ", 
                    vm.toString(i),
                    " (n=",
                    vm.toString(TEST_SEQUENCE[i]),
                    "): Sol=",
                    vm.toString(solResults[i]),
                    " JS=",
                    vm.toString(jsResults[i])
                )
            );
        }
    }

    /// @notice Test with another seed to increase confidence
    function test_ParityWithSecondSeed() public {
        bytes32 seed = keccak256("another test seed for verification");
        
        uint256[] memory jsResults = getJsResults(seed);
        uint256[] memory solResults = getSolidityResults(seed);
        
        assertEq(jsResults.length, solResults.length, "Result array lengths differ");
        
        for (uint256 i = 0; i < jsResults.length; i++) {
            assertEq(
                solResults[i], 
                jsResults[i], 
                string.concat("Mismatch at index ", vm.toString(i))
            );
        }
    }

    /// @notice Test with a third seed (the one we used for manual testing)
    function test_ParityWithManualTestSeed() public {
        bytes32 seed = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        
        uint256[] memory jsResults = getJsResults(seed);
        uint256[] memory solResults = getSolidityResults(seed);
        
        assertEq(jsResults.length, solResults.length, "Result array lengths differ");
        
        for (uint256 i = 0; i < jsResults.length; i++) {
            assertEq(
                solResults[i], 
                jsResults[i], 
                string.concat("Mismatch at index ", vm.toString(i))
            );
        }
    }

    /// @notice Test with a zero seed (edge case)
    function test_ParityWithZeroSeed() public {
        bytes32 seed = bytes32(0);
        
        uint256[] memory jsResults = getJsResults(seed);
        uint256[] memory solResults = getSolidityResults(seed);
        
        assertEq(jsResults.length, solResults.length, "Result array lengths differ");
        
        for (uint256 i = 0; i < jsResults.length; i++) {
            assertEq(
                solResults[i], 
                jsResults[i], 
                string.concat("Mismatch at index ", vm.toString(i))
            );
        }
    }

    /// @notice Test with max bytes32 seed (edge case)  
    function test_ParityWithMaxSeed() public {
        bytes32 seed = bytes32(type(uint256).max);
        
        uint256[] memory jsResults = getJsResults(seed);
        uint256[] memory solResults = getSolidityResults(seed);
        
        assertEq(jsResults.length, solResults.length, "Result array lengths differ");
        
        for (uint256 i = 0; i < jsResults.length; i++) {
            assertEq(
                solResults[i], 
                jsResults[i], 
                string.concat("Mismatch at index ", vm.toString(i))
            );
        }
    }
}

