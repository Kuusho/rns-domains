import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import {
  type Address,
  type Hex,
  encodePacked,
  getAddress,
  keccak256,
  toFunctionSelector,
} from 'viem'

// Unit-test suite for DefaultReverseRegistrar (Plan 06-02). Coverage per the
// plan's must_haves and 06-VALIDATION rows 06-02-01..06-02-03:
//   * REG-07 read path — nameForAddr(address) read-side of the reverse map.
//   * REG-07 round-trip — setName writes msg.sender's name; nameForAddr reads it back.
//   * REG-07 signature path — setNameForAddrWithSignature accepts a valid EOA
//     signature (Focus 6 Option A: ECDSA.toEthSignedMessageHash on-chain).
//   * REG-13 part 3 — setNameForAddr(address,string) is onlyController-gated.
//   * Custom-error coverage — SignatureExpired / SignatureExpiryTooHigh /
//     InvalidSignature reverts via SignatureUtils library (errors compiled
//     into DefaultReverseRegistrar's ABI by solc 0.8.26).
//   * ERC-165 introspection — IDefaultReverseRegistrar +
//     IStandaloneReverseRegistrar interface ids (runtime XOR).
//   * Pitfall 5 (RESEARCH.md) — ERC-6492 wrapped-signature branch documented
//     as testnet-unsupported; one it.skip() carries the rationale.

const connection = await hre.network.connect()

// Helper — reproduces the on-chain ERC191-v0 message-hash construction.
//   keccak256(abi.encodePacked(addr, selector, addr_param, expiry, name))
// The contract then applies ECDSA.toEthSignedMessageHash on top (the v4
// equivalent of v5 MessageHashUtils.toEthSignedMessageHash — Focus 6 Option A);
// viem's signMessage({ message: { raw } }) applies the same ERC191 prefix
// client-side, so the two hashes match.
const createMessageHash = ({
  contractAddress,
  functionSelector,
  address,
  signatureExpiry,
  name,
}: {
  contractAddress: Address
  functionSelector: Hex
  address: Address
  signatureExpiry: bigint
  name: string
}): Hex =>
  keccak256(
    encodePacked(
      ['address', 'bytes4', 'address', 'uint256', 'string'],
      [contractAddress, functionSelector, address, signatureExpiry, name],
    ),
  )

// Runtime-XOR derivation of interface ids — hallucination-proof per Phase 5
// D-09. Compared on-chain via supportsInterface([id]).
const I_DEFAULT_REVERSE_REGISTRAR_SELECTORS = [
  toFunctionSelector('function setName(string) external'),
  toFunctionSelector(
    'function setNameForAddrWithSignature(address,uint256,string,bytes) external',
  ),
  toFunctionSelector('function setNameForAddr(address,string) external'),
] as const

const I_STANDALONE_REVERSE_REGISTRAR_SELECTORS = [
  toFunctionSelector(
    'function nameForAddr(address) external view returns (string)',
  ),
] as const

const xorSelectors = (sels: readonly Hex[]): Hex =>
  sels.reduce<Hex>(
    (acc, s) =>
      `0x${(BigInt(acc) ^ BigInt(s))
        .toString(16)
        .padStart(8, '0')}` as Hex,
    '0x00000000',
  )

const I_DEFAULT_REVERSE_REGISTRAR_INTERFACE_ID = xorSelectors(
  I_DEFAULT_REVERSE_REGISTRAR_SELECTORS,
)
const I_STANDALONE_REVERSE_REGISTRAR_INTERFACE_ID = xorSelectors(
  I_STANDALONE_REVERSE_REGISTRAR_SELECTORS,
)

// setNameForAddrWithSignature selector — used for the ERC191 message hash.
const SET_NAME_FOR_ADDR_WITH_SIG_SELECTOR = toFunctionSelector(
  'function setNameForAddrWithSignature(address,uint256,string,bytes) external',
)

async function fixture() {
  const walletClients = await connection.viem.getWalletClients()
  const [deployerClient, aliceClient, bobClient, carolClient, daveClient] =
    walletClients
  const accounts = walletClients.map((c) => c.account)

  const defaultReverseRegistrar = await connection.viem.deployContract(
    'DefaultReverseRegistrar',
    [],
  )

  return {
    defaultReverseRegistrar,
    walletClients,
    deployerClient,
    aliceClient,
    bobClient,
    carolClient,
    daveClient,
    accounts,
  }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('DefaultReverseRegistrar', () => {
  // Block 1 — ERC-165 advertisement. The shouldSupportInterfaces helper covers
  // IERC165 by name (resolved via npmFilesToBuild in hardhat.config.ts).
  shouldSupportInterfaces({
    contract: () =>
      loadFixture().then(
        ({ defaultReverseRegistrar }) => defaultReverseRegistrar,
      ),
    interfaces: ['IERC165'],
  })

  it('supports IDefaultReverseRegistrar and IStandaloneReverseRegistrar via supportsInterface', async () => {
    const { defaultReverseRegistrar } = await loadFixture()
    await expect(
      defaultReverseRegistrar.read.supportsInterface([
        I_DEFAULT_REVERSE_REGISTRAR_INTERFACE_ID,
      ]),
    ).resolves.toBe(true)
    await expect(
      defaultReverseRegistrar.read.supportsInterface([
        I_STANDALONE_REVERSE_REGISTRAR_INTERFACE_ID,
      ]),
    ).resolves.toBe(true)
    // Negative gate — 0xffffffff is the ERC-165 "everything" marker which
    // the contract MUST NOT advertise as supported.
    await expect(
      defaultReverseRegistrar.read.supportsInterface(['0xffffffff']),
    ).resolves.toBe(false)
  })

  it('nameForAddr returns the empty string for an unset address', async () => {
    const { defaultReverseRegistrar, accounts } = await loadFixture()
    // REG-07 read path — 06-02-01.
    await expect(
      defaultReverseRegistrar.read.nameForAddr([accounts[1].address]),
    ).resolves.toEqual('')
  })

  it('nameForAddr returns the stored name after setName', async () => {
    const { defaultReverseRegistrar, accounts, aliceClient } = await loadFixture()

    // REG-07 round-trip — 06-02-01.
    await expect(
      defaultReverseRegistrar.write.setName(['alice.rise'], {
        account: aliceClient.account,
      }),
    )
      .toEmitEvent('NameForAddrChanged')
      .withArgs({
        addr: getAddress(accounts[1].address),
        name: 'alice.rise',
      })

    await expect(
      defaultReverseRegistrar.read.nameForAddr([accounts[1].address]),
    ).resolves.toEqual('alice.rise')
  })

  it('setNameForAddr only callable by a controller — non-controller reverts with the frozen string', async () => {
    const { defaultReverseRegistrar, accounts, aliceClient } = await loadFixture()

    // RNSControllable lineage (frozen string from Phase 2 D-07). REG-13 part 3
    // gate. accounts[1] (alice) is NOT a registered controller — must revert.
    await expect(
      defaultReverseRegistrar.write.setNameForAddr(
        [accounts[2].address, 'bob.rise'],
        { account: aliceClient.account },
      ),
    ).toBeRevertedWithString('Controllable: Caller is not a controller')
  })

  it('setNameForAddr succeeds from a registered controller', async () => {
    const { defaultReverseRegistrar, accounts, carolClient } = await loadFixture()

    // REG-13 part 3 surface — 06-02-02.
    // Owner is the default (deployer, accounts[0]); owner registers carol
    // (accounts[3]) as a controller, then carol writes a reverse record FOR
    // accounts[2] (the addr field, not the caller).
    await defaultReverseRegistrar.write.setController([
      accounts[3].address,
      true,
    ])

    await defaultReverseRegistrar.write.setNameForAddr(
      [accounts[2].address, 'bob.rise'],
      { account: carolClient.account },
    )

    await expect(
      defaultReverseRegistrar.read.nameForAddr([accounts[2].address]),
    ).resolves.toEqual('bob.rise')

    // carol's own slot must NOT have been touched — the controller wrote on
    // behalf of accounts[2], not themselves.
    await expect(
      defaultReverseRegistrar.read.nameForAddr([accounts[3].address]),
    ).resolves.toEqual('')
  })

  it('setNameForAddrWithSignature accepts a valid EOA signature and writes the name', async () => {
    const { defaultReverseRegistrar, accounts, aliceClient, bobClient } =
      await loadFixture()

    // EOA signature path of REG-07 — 06-02-02. alice (accounts[1]) signs the
    // ERC191 message; bob (accounts[2]) submits the tx as a relayer. The
    // on-chain contract reconstructs the same hash via ECDSA.toEthSignedMessageHash
    // (Focus 6 Option A — replaces v5's MessageHashUtils with v4's ECDSA;
    // byte-identical output).
    const publicClient = await connection.viem.getPublicClient()
    const blockTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp)
    const signatureExpiry = blockTimestamp + 30n * 60n // 30 minutes — well below the 1 hour ceiling

    const messageHash = createMessageHash({
      contractAddress: defaultReverseRegistrar.address,
      functionSelector: SET_NAME_FOR_ADDR_WITH_SIG_SELECTOR,
      address: accounts[1].address,
      signatureExpiry,
      name: 'alice.rise',
    })

    // viem's signMessage with `{ message: { raw } }` applies the ERC191 v0
    // prefix automatically, matching the on-chain toEthSignedMessageHash call.
    const signature = await aliceClient.signMessage({
      message: { raw: messageHash },
    })

    // bob submits the relayed write — accounts[1] (alice) gets the name.
    await defaultReverseRegistrar.write.setNameForAddrWithSignature(
      [accounts[1].address, signatureExpiry, 'alice.rise', signature],
      { account: bobClient.account },
    )

    await expect(
      defaultReverseRegistrar.read.nameForAddr([accounts[1].address]),
    ).resolves.toEqual('alice.rise')
  })

  it('setNameForAddrWithSignature reverts with SignatureExpired when signatureExpiry < block.timestamp', async () => {
    const { defaultReverseRegistrar, accounts, aliceClient, bobClient } =
      await loadFixture()

    // Sign with a 1-second expiry, then advance time past it so the EOA path
    // succeeds but the expiry check fires.
    const publicClient = await connection.viem.getPublicClient()
    const blockTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp)
    const signatureExpiry = blockTimestamp + 5n // 5 seconds out

    const messageHash = createMessageHash({
      contractAddress: defaultReverseRegistrar.address,
      functionSelector: SET_NAME_FOR_ADDR_WITH_SIG_SELECTOR,
      address: accounts[1].address,
      signatureExpiry,
      name: 'alice.rise',
    })

    const signature = await aliceClient.signMessage({
      message: { raw: messageHash },
    })

    // Advance the chain past the expiry so the on-chain check
    // `signatureExpiry < block.timestamp` returns true.
    await connection.networkHelpers.time.increase(3600n)

    await expect(
      defaultReverseRegistrar.write.setNameForAddrWithSignature(
        [accounts[1].address, signatureExpiry, 'alice.rise', signature],
        { account: bobClient.account },
      ),
    ).toBeRevertedWithCustomError('SignatureExpired')
  })

  it('setNameForAddrWithSignature reverts with SignatureExpiryTooHigh when signatureExpiry > block.timestamp + 1 hour', async () => {
    const { defaultReverseRegistrar, accounts, aliceClient, bobClient } =
      await loadFixture()

    const publicClient = await connection.viem.getPublicClient()
    const blockTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp)
    // 2 hours out — beyond the 1 hour ceiling.
    const signatureExpiry = blockTimestamp + 2n * 3600n

    const messageHash = createMessageHash({
      contractAddress: defaultReverseRegistrar.address,
      functionSelector: SET_NAME_FOR_ADDR_WITH_SIG_SELECTOR,
      address: accounts[1].address,
      signatureExpiry,
      name: 'alice.rise',
    })

    const signature = await aliceClient.signMessage({
      message: { raw: messageHash },
    })

    await expect(
      defaultReverseRegistrar.write.setNameForAddrWithSignature(
        [accounts[1].address, signatureExpiry, 'alice.rise', signature],
        { account: bobClient.account },
      ),
    ).toBeRevertedWithCustomError('SignatureExpiryTooHigh')
  })

  it('setNameForAddrWithSignature reverts InvalidSignature for a wrong signer (EOA signature)', async () => {
    const { defaultReverseRegistrar, accounts, daveClient, bobClient } =
      await loadFixture()

    // EOA signature mismatch — dave (accounts[4]) signs, but the addr field
    // claims to be alice (accounts[1]). The on-chain
    // SignatureChecker.isValidSignatureNow(alice, message, dave-sig) returns
    // false (the recovered signer doesn't match the addr), triggering
    // InvalidSignature. 06-02-03 — EOA path coverage.
    const publicClient = await connection.viem.getPublicClient()
    const blockTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp)
    const signatureExpiry = blockTimestamp + 30n * 60n

    const messageHash = createMessageHash({
      contractAddress: defaultReverseRegistrar.address,
      functionSelector: SET_NAME_FOR_ADDR_WITH_SIG_SELECTOR,
      address: accounts[1].address, // claims to be alice
      signatureExpiry,
      name: 'alice.rise',
    })

    // dave (accounts[4]) — NOT alice — signs the message.
    const signature = await daveClient.signMessage({
      message: { raw: messageHash },
    })

    await expect(
      defaultReverseRegistrar.write.setNameForAddrWithSignature(
        [accounts[1].address, signatureExpiry, 'alice.rise', signature],
        { account: bobClient.account },
      ),
    ).toBeRevertedWithCustomError('InvalidSignature')
  })

  it.skip('setNameForAddrWithSignature ERC-6492 wrapped sig path is testnet-unsupported (Pitfall 5)', () => {
    // Documented skip per RESEARCH.md Pitfall 5 + CONTEXT.md D-07:
    //
    //   The ERC-6492 universal-validator at
    //   0x164af34fAF9879394370C7f09064127C043A35E9 is a MAINNET deployment.
    //   On RiseChain testnet — and on the in-process Hardhat node used for
    //   this test — the validator is NOT deployed, so the wrapped-signature
    //   branch (signature with the ERC6492_DETECTION_SUFFIX trailing 32 bytes)
    //   would revert when SignatureUtils calls validator.isValidSig(...).
    //
    //   EOA signature path coverage (test above — "setNameForAddrWithSignature
    //   accepts a valid EOA signature") is sufficient for Phase 6 MVP closure.
    //   ERC-6492 / counterfactual-wallet signatures are a deferred concern;
    //   the validator can be deployed (or replaced with a chain-local one) in
    //   a future plan if smart-account UX becomes a requirement.
    //
    // 06-02-03 documented-skip.
  })
})
