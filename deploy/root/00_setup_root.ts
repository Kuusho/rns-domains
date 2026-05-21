import { artifacts, deployScript } from '@rocketh'
import { zeroHash } from 'viem'

// Re-created from reference/ens-contracts/deploy/root/00_setup_root.ts,
// re-implemented as a LINEAR script (RESEARCH O-2 / Pitfall 3): the reference's
// `switch (rootOwner)` with its deliberate fall-through is dropped.
//
// Every transaction is signed by `deployer`, in this exact order:
//   1. registry.setOwner(0x0, RNSRoot)        — hand root node 0x0 to RNSRoot
//   2. RNSRoot.setController(deployer, true)   — wire controller (deployer still owns RNSRoot)
//   3. RNSRoot.setController(RNSRootSecurityController, true)
//   4. RNSRoot.transferOwnership(owner)        — LAST: hand a fully-wired root to `owner`
//
// This wires all controllers WHILE `deployer` still owns RNSRoot, then hands a
// fully-configured root to `owner` as the final step. No transaction is ever
// sent *from* `owner`, so it works identically whether `owner` is an EOA (local
// + smoke deploy) or a future multisig.
export default deployScript(
  async ({ get, read, execute: write, namedAccounts: { deployer, owner } }) => {
    const registry =
      get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')
    const root = get<(typeof artifacts.RNSRoot)['abi']>('RNSRoot')
    const rootSecurityController = get<
      (typeof artifacts.RNSRootSecurityController)['abi']
    >('RNSRootSecurityController')

    // 1. Hand root node 0x0 to the RNSRoot contract. The deployer can sign this
    //    because the RNSRegistry constructor seated the deployer as 0x0 owner.
    const rootNodeOwner = await read(registry, {
      functionName: 'owner',
      args: [zeroHash],
    })
    if (rootNodeOwner !== root.address) {
      console.log('  - Setting owner of root node 0x0 to the RNSRoot contract')
      await write(registry, {
        functionName: 'setOwner',
        args: [zeroHash, root.address],
        account: deployer,
      })
    }

    // 2. Register the deployer as a controller (deployer still owns RNSRoot).
    const deployerIsController = await read(root, {
      functionName: 'controllers',
      args: [deployer],
    })
    if (!deployerIsController) {
      console.log('  - Registering the deployer as a controller on RNSRoot')
      await write(root, {
        functionName: 'setController',
        args: [deployer, true],
        account: deployer,
      })
    }

    // 3. Register RNSRootSecurityController as a controller.
    const securityControllerIsController = await read(root, {
      functionName: 'controllers',
      args: [rootSecurityController.address],
    })
    if (!securityControllerIsController) {
      console.log(
        '  - Registering RNSRootSecurityController as a controller on RNSRoot',
      )
      await write(root, {
        functionName: 'setController',
        args: [rootSecurityController.address, true],
        account: deployer,
      })
    }

    // 4. LAST: hand the fully-wired root to `owner`.
    const currentRootOwner = await read(root, {
      functionName: 'owner',
      args: [],
    })
    if (currentRootOwner !== owner) {
      console.log(`  - Transferring ownership of RNSRoot to ${owner}`)
      await write(root, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RNSRoot:setup v1.0.0',
    tags: ['category:root', 'RNSRoot', 'RNSRoot:setup'],
    dependencies: ['RNSRoot:contract', 'RNSRootSecurityController'],
  },
)
