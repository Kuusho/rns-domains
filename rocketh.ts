// ------------------------------------------------------------------------------------------------
// RNS rocketh deploy-harness config
// ------------------------------------------------------------------------------------------------
// Re-created from reference/ens-contracts/rocketh.ts, simplified to RNS scope (D-02):
//   - the hardcoded ENS mainnet owner (0xFe89cc7a...) is removed (D-15 / spec §6.4);
//   - the ENS migration network tag is dropped from every network (D-02);
//   - the sepolia / mainnet networks are dropped (RNS targets RiseChain);
//   - the ENS-only HookFunctions type is dropped — its hooks (registry-name
//     seeding, wrapped/unwrapped registration) have no RNS analog.
// ------------------------------------------------------------------------------------------------
import type { UserConfig } from 'rocketh'

export const config = {
  accounts: {
    // The two-account model (D-14): `deployer` deploys + wires, then hands
    // ownership to a DISTINCT `owner`. On every LOCAL network `owner` resolves
    // to Hardhat account index 1 (an EOA) — distinct from `deployer` (index 0)
    // — so the local deploy genuinely exercises the deployer != owner handoff.
    deployer: {
      default: 0,
    },
    owner: {
      default: 1,
      // RiseChain testnet (chainId 11155931): EOA owner resolved at Plan 04
      // execution time (O-3). Per the O-1 resolution, the smoke deploy uses an
      // EOA owner (Safe is unsupported on chain 11155931); the production
      // multisig is wired at the MVP phase. The address below is also the
      // deployer EOA for this smoke deploy — D-14's distinct-account gate is
      // exercised by the LOCAL Plan 03 deploy (which uses distinct Hardhat
      // accounts); on testnet, deployer == owner is acceptable per Plan 04 §
      // objective (the smoke deploy is a deploy-path exercise, not the D-14
      // authoritative gate).
      11155931: '0xFe8ED71EB54A95b7F35737aA9F34114E361e6Ad1',
    },
  },
  networks: {
    hardhat: {
      rpcUrl: 'http://127.0.0.1:8545',
      tags: ['test', 'use_root'],
    },
    localhost: {
      rpcUrl: 'http://127.0.0.1:8545',
      tags: ['test', 'use_root', 'allow_unsafe'],
    },
    riseTestnet: {
      rpcUrl: 'https://testnet.riselabs.xyz', // chainId 11155931
      tags: ['use_root'],
    },
  },
} as const satisfies UserConfig

// ------------------------------------------------------------------------------------------------
// Imports and Re-exports
// ------------------------------------------------------------------------------------------------
// We regroup everything the deploy scripts need so they can just import this
// file via the `@rocketh` alias (tsconfig `paths`).
import * as deployFunctions from '@rocketh/deploy'
import * as readExecuteFunctions from '@rocketh/read-execute'
import * as viemFunctions from '@rocketh/viem'

// ------------------------------------------------------------------------------------------------
// Re-export the generated typed artifacts so they are available from the alias.
// `hardhat compile` (generateTypedArtifacts) emits `./generated/artifacts.js`
// (a gitignored build output) with a default export — so it is imported here
// and re-exported as `artifacts`.
import artifacts from './generated/artifacts.js'
export { artifacts }

// ------------------------------------------------------------------------------------------------
// Convert the execution function type so it knows about the named accounts —
// this gives type-safe `namedAccounts` in the deploy scripts.
import {
  setup,
  type CurriedFunctions,
  type Environment as Environment_,
} from 'rocketh'

const functions = {
  ...deployFunctions,
  ...readExecuteFunctions,
  ...viemFunctions,
}

export type Environment = Environment_<typeof config.accounts> &
  CurriedFunctions<typeof functions>

export const { deployScript, loadAndExecuteDeployments, loadEnvironment } =
  process.env.ROCKETH_CONFIG_FILE
    ? ((await import(process.env.ROCKETH_CONFIG_FILE)) as ReturnType<
        typeof setup<typeof functions, typeof config.accounts>
      >)
    : setup<typeof functions, typeof config.accounts>(functions)
