// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/GameMap.sol";
import "../contracts/MapGeneratorWrapper.sol";

/**
 * @notice Deploy script for game contracts
 * @dev Deploys:
 *      - GameMap: Main game state storage
 *      - MapGeneratorWrapper: Pure map generation for verification/parity checks
 *
 * Example:
 * yarn deploy --file DeployGame.s.sol  # local anvil chain
 * yarn deploy --file DeployGame.s.sol --network optimism # live network (requires keystore)
 */
contract DeployGame is ScaffoldETHDeploy {
    /**
     * @dev Deployer setup based on `ETH_KEYSTORE_ACCOUNT` in `.env`:
     *      - "scaffold-eth-default": Uses Anvil's account #9 (0xa0Ee7A142d267C1f36714E4a8F75612F20a79720), no password prompt
     *      - "scaffold-eth-custom": requires password used while creating keystore
     *
     * Note: Must use ScaffoldEthDeployerRunner modifier to:
     *      - Setup correct `deployer` account and fund it
     *      - Export contract addresses & ABIs to `nextjs` packages
     */
    function run() external ScaffoldEthDeployerRunner {
        // Deploy GameMap for game state storage
        new GameMap();
        
        // Deploy MapGeneratorWrapper for pure map generation (parity verification)
        new MapGeneratorWrapper();
    }
}

