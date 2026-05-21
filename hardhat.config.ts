import { configVariable, type HardhatUserConfig } from 'hardhat/config'

import HardhatChaiMatchersViemPlugin from '@ensdomains/hardhat-chai-matchers-viem'
import HardhatKeystore from '@nomicfoundation/hardhat-keystore'
import HardhatNetworkHelpersPlugin from '@nomicfoundation/hardhat-network-helpers'
import HardhatViem from '@nomicfoundation/hardhat-viem'
import HardhatDeploy from 'hardhat-deploy'

const config = {
  networks: {
    // In-memory network — the CORE-01..05 behavioral gate (D-04) runs here.
    hardhat: { type: 'edr-simulated', allowUnlimitedContractSize: false },
    // Local JSON-RPC node — `bun run deploy:local` targets this; chainId 31337.
    localhost: {
      type: 'http',
      chainId: 31337,
      url: 'http://127.0.0.1:8545/',
    },
    // RiseChain testnet — Plan 04's smoke deploy targets this. RPC + deployer
    // key are keystore/config-variable backed (never hardcoded — O-3). Default
    // RPC value is https://testnet.riselabs.xyz, chainId 11155931.
    riseTestnet: {
      type: 'http',
      chainId: 11155931,
      url: configVariable('RISE_TESTNET_RPC'),
      accounts: [configVariable('DEPLOYER_KEY')],
    },
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
  // `hardhat compile` emits the typed-artifacts the deploy scripts import via
  // `rocketh.ts`. hardhat-deploy v2.0.x writes each destination to
  // `<folder>/artifacts/index.{js,ts}` — so folder `./generated` produces
  // `./generated/artifacts/index.js` + `.ts`, which `rocketh.ts` imports.
  generateTypedArtifacts: {
    destinations: [
      { mode: 'javascript', folder: './generated' },
      { mode: 'typescript', folder: './generated' },
    ],
  },
  paths: { sources: { solidity: ['./contracts'] } },
  plugins: [
    HardhatNetworkHelpersPlugin,
    HardhatChaiMatchersViemPlugin,
    HardhatViem,
    HardhatDeploy,
    HardhatKeystore,
  ],
} satisfies HardhatUserConfig

export default config
