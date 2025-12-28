// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/GameMap.sol";
import "../contracts/MapGenerator.sol";
import "../contracts/GameFactory.sol";
import "../contracts/ChallengeExecutor.sol";

/**
 * @notice Deploy script for game contracts
 * @dev Deploys:
 *      - MapGenerator: Pure map generation contract
 *      - GameMap: Main game state storage
 *      - GameFactory: Pay-to-play game creation with seed reveal
 *      - ChallengeExecutor: On-chain challenge verification
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
        // Deploy MapGenerator contract for pure map generation
        MapGenerator mapGenerator = new MapGenerator();
        
        // Deploy GameMap for game state storage (requires MapGenerator)
        new GameMap(mapGenerator);
        
        // Deploy GameFactory for pay-to-play game creation
        GameFactory gameFactory = new GameFactory(deployer);
        
        // Fund the pool with 1 ETH for player payouts
        gameFactory.depositToPool{value: 1 ether}();
        
        // Deploy ChallengeExecutor for on-chain challenge verification
        new ChallengeExecutor(address(gameFactory), address(mapGenerator));
    }
}
