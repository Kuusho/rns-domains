import { type HardhatUserConfig } from 'hardhat/config'

import HardhatChaiMatchersViemPlugin from '@ensdomains/hardhat-chai-matchers-viem'
import HardhatNetworkHelpersPlugin from '@nomicfoundation/hardhat-network-helpers'
import HardhatViem from '@nomicfoundation/hardhat-viem'

const config = {
  networks: {
    hardhat: { type: 'edr-simulated', allowUnlimitedContractSize: false },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.26',
        settings: {
          optimizer: { enabled: true, runs: 1_000_000 },
          metadata: { bytecodeHash: 'ipfs', useLiteralContent: true },
          evmVersion: 'paris',
        },
      },
    ],
    // Force-emit artifacts for node_modules files that have no in-repo
    // importer of their own name. `shouldSupportInterfaces` (the ported
    // conformance helper) resolves `IERC165` by artifact name, so its
    // artifact must exist even though no RNS contract imports it directly.
    npmFilesToBuild: [
      '@openzeppelin/contracts/utils/introspection/IERC165.sol',
    ],
  },
  paths: { sources: { solidity: ['./contracts'] } },
  plugins: [HardhatNetworkHelpersPlugin, HardhatChaiMatchersViemPlugin, HardhatViem],
} satisfies HardhatUserConfig

export default config
