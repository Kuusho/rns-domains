import hre from 'hardhat'
import {
  decodeErrorResult,
  labelhash,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { toLabelId } from '../fixtures/utils.js'
import { configureSubdomain } from '../fixtures/configureSubdomain.js'

// Hand-wired unit suite for the Phase-7 SubdomainRegistrar (Plan 07-02, Wave 2).
//
// Mirrors the fixture shape of TestRiseRegistrar.test.ts: deploy RNSRegistry +
// RiseRegistrar (wired to own `.rise`), PublicResolver (the injected default
// resolver written onto sold subnodes), and SubdomainRegistrar (fee default 0,
// D-08). A parent 2LD `alice.rise` is registered to `parentOwner` via the
// registrar's controller-mint path, so `rns.owner(namehash('alice.rise'))` and
// `registrar.nameExpires(labelhash('alice'))` are real.
//
// The 7-param `configure` signature is LOCKED by Plan 07-01 and includes
// `parentLabelHash` (== the 2LD labelhash == RiseRegistrar token id), supplied by
// the configureSubdomain fixture helper. Epoch invalidation (SUB-05) +
// cross-contract re-registration live in the Wave-3 integration suite; this unit
// suite covers configure/register/split/free/fee/gate/revoke/reentrancy.
//
// `-t` filter tokens embedded in describe titles: configure | register | split |
// free | fee | gate | revoke | reentr.

const connection = await hre.network.connect()
const publicClient = await connection.viem.getPublicClient()
const [
  deployerClient, // accounts[0] — deploys, owns the registrar (OZ Ownable seat)
  parentClient, // accounts[1] — owns alice.rise, lists it
  buyerClient, // accounts[2] — buys subdomains
  strangerClient, // accounts[3] — unauthorized actor
  controllerClient, // accounts[4] — RiseRegistrar controller (mints the parent 2LD)
  payoutClient, // accounts[5] — parent payout sink (never sends tx → clean balance deltas)
  feeRecipientClient, // accounts[6] — protocol fee sink (never sends tx → clean balance deltas)
  holderClient, // accounts[7] — gate-token holder
] = await connection.viem.getWalletClients()

const deployer = deployerClient.account
const parentOwner = parentClient.account
const buyer = buyerClient.account
const stranger = strangerClient.account
const controllerAccount = controllerClient.account
const payout = payoutClient.account
const feeRecipient = feeRecipientClient.account
const holder = holderClient.account

const PARENT_LABEL = 'alice'
const PARENT_NAME = `${PARENT_LABEL}.rise`
const parentNode = namehash(PARENT_NAME) as Hex
const parentLabelHash = labelhash(PARENT_LABEL) as Hex
const PARENT_DURATION = 365n * 86400n // 1 year (well past grace concerns)
const PRICE = 10n ** 16n // 0.01 RISE

const subNode = (label: string) => namehash(`${label}.${PARENT_NAME}`) as Hex

async function fixture() {
  const rns = await connection.viem.deployContract('RNSRegistry', [])
  const registrar = await connection.viem.deployContract('RiseRegistrar', [
    rns.address,
    namehash('rise'),
  ])

  // Wire the registrar to own the `.rise` TLD + seat a controller (mirrors
  // TestRiseRegistrar fixture).
  await registrar.write.addController([controllerAccount.address])
  await rns.write.setSubnodeOwner([
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    labelhash('rise'),
    registrar.address,
  ])

  // Register the parent 2LD `alice.rise` to parentOwner via the controller-mint
  // path — this writes rns.owner(namehash('alice.rise')) == parentOwner.
  await registrar.write.register(
    [toLabelId(PARENT_LABEL), parentOwner.address, PARENT_DURATION],
    { account: controllerAccount },
  )

  const publicResolver = await connection.viem.deployContract('PublicResolver', [
    rns.address,
    zeroAddress,
    zeroAddress,
  ])

  // SubdomainRegistrar — default fee 0 (D-08); feeRecipient is a dedicated sink.
  const subdomainRegistrar = await connection.viem.deployContract(
    'SubdomainRegistrar',
    [rns.address, registrar.address, publicResolver.address, feeRecipient.address, 0n],
  )

  return { rns, registrar, publicResolver, subdomainRegistrar }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('SubdomainRegistrar', () => {
  describe('configure', () => {
    it('lets the parent owner list after setApprovalForAll', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()

      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      const cfg = await subdomainRegistrar.read.config([parentNode])
      // Config: [controller, parentLabelHash, payout, price, enabled, gateToken, minGateBalance, configEpoch]
      expect(cfg[0]).toEqualAddress(parentOwner.address) // controller snapshot
      expect(cfg[2]).toEqualAddress(payout.address)
      expect(cfg[3]).toBe(PRICE)
      expect(cfg[4]).toBe(true) // enabled
    })

    it('reverts NotParentOwner for a non-parent-owner', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      // stranger grants approval for THEMSELVES (so NotApproved is not what fires)
      await rns.write.setApprovalForAll([subdomainRegistrar.address, true], {
        account: stranger,
      })

      await expect(
        subdomainRegistrar.write.configure(
          [parentNode, parentLabelHash, payout.address, PRICE, true, zeroAddress, 0n],
          { account: stranger },
        ),
      ).toBeRevertedWithCustomError('NotParentOwner')
    })

    it('reverts NotApproved when configure runs without prior setApprovalForAll', async () => {
      const { subdomainRegistrar } = await loadFixture()
      // parentOwner is the parent owner but has NOT approved the registrar (Pitfall 4)
      await expect(
        subdomainRegistrar.write.configure(
          [parentNode, parentLabelHash, payout.address, PRICE, true, zeroAddress, 0n],
          { account: parentOwner },
        ),
      ).toBeRevertedWithCustomError('NotApproved')
    })

    it('reverts ValueTooLarge when price exceeds uint96', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await rns.write.setApprovalForAll([subdomainRegistrar.address, true], {
        account: parentOwner,
      })
      const tooLarge = 2n ** 96n // type(uint96).max + 1

      await expect(
        subdomainRegistrar.write.configure(
          [parentNode, parentLabelHash, payout.address, tooLarge, true, zeroAddress, 0n],
          { account: parentOwner },
        ),
      ).toBeRevertedWithCustomError('ValueTooLarge')
    })

    it('reverts InvalidGateConfig when gateToken is set but minGateBalance is 0', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await rns.write.setApprovalForAll([subdomainRegistrar.address, true], {
        account: parentOwner,
      })
      // gateToken set, minGateBalance 0 — not both-or-neither
      await expect(
        subdomainRegistrar.write.configure(
          [parentNode, parentLabelHash, payout.address, PRICE, true, buyer.address, 0n],
          { account: parentOwner },
        ),
      ).toBeRevertedWithCustomError('InvalidGateConfig')
    })

    it('reverts ParentLabelMismatch when parentLabelHash does not hash to parentNode (CR-01)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await rns.write.setApprovalForAll([subdomainRegistrar.address, true], {
        account: parentOwner,
      })
      // A far-future name's labelhash supplied against alice.rise's node: the
      // forward namehash keccak256(riseNode, mismatchedLabel) != parentNode, so
      // the bind check (CR-01) fires BEFORE any nameExpires read can be decoupled.
      const mismatchedLabelHash = labelhash('mallory') as Hex

      await expect(
        subdomainRegistrar.write.configure(
          [parentNode, mismatchedLabelHash, payout.address, PRICE, true, zeroAddress, 0n],
          { account: parentOwner },
        ),
      ).toBeRevertedWithCustomError('ParentLabelMismatch')
    })

    it('accepts a correctly-formed (parentNode, parentLabelHash) pair (CR-01 happy path)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()

      // The matching pair derived from 'alice' must still configure cleanly.
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      const cfg = await subdomainRegistrar.read.config([parentNode])
      expect(cfg[1]).toBe(parentLabelHash) // stored, validated labelhash
      expect(cfg[4]).toBe(true) // enabled
    })
  })

  describe('register', () => {
    it('mints the subnode to the buyer with the default resolver', async () => {
      const { rns, publicResolver, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      await subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      await expect(
        rns.read.owner([subNode('sub')]),
      ).resolves.toEqualAddress(buyer.address)
      await expect(
        rns.read.resolver([subNode('sub')]),
      ).resolves.toEqualAddress(publicResolver.address) // A3 default resolver
    })

    it('reverts NotEnabled on a disabled parent', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        enabled: false,
        parentOwner,
      })

      await expect(
        subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
          value: PRICE,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('NotEnabled')
    })

    it('reverts InsufficientFee when value is below price', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      await expect(
        subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
          value: PRICE - 1n,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('InsufficientFee')
    })
  })

  describe('register2', () => {
    it('2-arg overload mints to msg.sender, gates against the real caller, and refunds the caller (WR-01)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      // Gate the listing on an ERC-721 the HOLDER owns (the registrar holds none),
      // so a working gate proves it is checked against the caller, not the contract.
      const mock721 = await connection.viem.deployContract('MockERC721', [
        'Gate721',
        'G721',
        [holder.address],
      ])
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        gateToken: mock721.address,
        minGateBalance: 1n,
        parentOwner,
      })

      // A non-holder calling the 2-arg form fails the gate (checked against the
      // caller, NOT the registrar's own zero balance — proves no self-call rebind).
      await expect(
        subdomainRegistrar.write.register([parentNode, 'mine'], {
          value: PRICE,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('GateFailed')

      // The gate-token holder buys via the 2-arg overload with excess value.
      const overpay = 10n ** 15n // 0.001 RISE excess
      const holderBefore = await publicClient.getBalance({ address: holder.address })
      const hash = await subdomainRegistrar.write.register([parentNode, 'mine'], {
        value: PRICE + overpay,
        account: holder,
      })
      const receipt = await publicClient.getTransactionReceipt({ hash })
      const gas = receipt.gasUsed * receipt.effectiveGasPrice
      const holderAfter = await publicClient.getBalance({ address: holder.address })

      // Minted to the caller (msg.sender), NOT the registrar.
      await expect(
        rns.read.owner([subNode('mine')]),
      ).resolves.toEqualAddress(holder.address)
      // Caller spent exactly PRICE + gas — the overpay was refunded to the CALLER
      // (not pushed back into the contract via a rebound msg.sender).
      expect(holderBefore - holderAfter).toBe(PRICE + gas)
      // SUB-03: the contract pools nothing after a 2-arg sale.
      await expect(
        publicClient.getBalance({ address: subdomainRegistrar.address }),
      ).resolves.toBe(0n)
    })
  })

  describe('split', () => {
    it('pushes payout/fee and refunds excess with ZERO pooled in the contract (SUB-03)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()

      // owner-only: set fee to 5% (500 bps)
      await subdomainRegistrar.write.setFeeBps([500n], { account: deployer })

      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      const overpay = 10n ** 15n // 0.001 RISE excess
      const fee = (PRICE * 500n) / 10_000n
      const parentShare = PRICE - fee

      const payoutBefore = await publicClient.getBalance({ address: payout.address })
      const feeBefore = await publicClient.getBalance({ address: feeRecipient.address })
      const buyerBefore = await publicClient.getBalance({ address: buyer.address })

      const hash = await subdomainRegistrar.write.register(
        [parentNode, 'sub', buyer.address],
        { value: PRICE + overpay, account: buyer },
      )
      const receipt = await publicClient.getTransactionReceipt({ hash })
      const gas = receipt.gasUsed * receipt.effectiveGasPrice

      const payoutAfter = await publicClient.getBalance({ address: payout.address })
      const feeAfter = await publicClient.getBalance({ address: feeRecipient.address })
      const buyerAfter = await publicClient.getBalance({ address: buyer.address })

      // Parent payout receives price - fee; feeRecipient receives fee.
      expect(payoutAfter - payoutBefore).toBe(parentShare)
      expect(feeAfter - feeBefore).toBe(fee)
      // Buyer spent exactly PRICE + gas (overpay refunded).
      expect(buyerBefore - buyerAfter).toBe(PRICE + gas)
      // SUB-03: the contract pools NOTHING.
      await expect(
        publicClient.getBalance({ address: subdomainRegistrar.address }),
      ).resolves.toBe(0n)
    })
  })

  describe('free', () => {
    it('registers a zero-price subdomain with zero fee (D-05)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      // a non-zero fee bps is set, but a 0-price sale yields fee 0
      await subdomainRegistrar.write.setFeeBps([500n], { account: deployer })
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: 0n,
        parentOwner,
      })

      const feeBefore = await publicClient.getBalance({ address: feeRecipient.address })
      await subdomainRegistrar.write.register([parentNode, 'gratis', buyer.address], {
        value: 0n,
        account: buyer,
      })
      const feeAfter = await publicClient.getBalance({ address: feeRecipient.address })

      await expect(
        rns.read.owner([subNode('gratis')]),
      ).resolves.toEqualAddress(buyer.address)
      expect(feeAfter - feeBefore).toBe(0n) // fee == 0 on a free sale
      // contract still pools nothing
      await expect(
        publicClient.getBalance({ address: subdomainRegistrar.address }),
      ).resolves.toBe(0n)
    })

    it('still applies the gate on a free (price 0) gated listing', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      const mock721 = await connection.viem.deployContract('MockERC721', [
        'Gate',
        'GATE',
        [holder.address],
      ])
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: 0n,
        gateToken: mock721.address,
        minGateBalance: 1n,
        parentOwner,
      })

      // non-holder freebie still fails the gate
      await expect(
        subdomainRegistrar.write.register([parentNode, 'gratis', buyer.address], {
          value: 0n,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('GateFailed')

      // holder freebie succeeds
      await subdomainRegistrar.write.register([parentNode, 'gratis', holder.address], {
        value: 0n,
        account: holder,
      })
      await expect(
        rns.read.owner([subNode('gratis')]),
      ).resolves.toEqualAddress(holder.address)
    })
  })

  describe('fee', () => {
    it('defaults feeBps to 0 (D-08)', async () => {
      const { subdomainRegistrar } = await loadFixture()
      await expect(subdomainRegistrar.read.feeBps()).resolves.toBe(0n)
    })

    it('reverts FeeTooHigh above the cap (D-07)', async () => {
      const { subdomainRegistrar } = await loadFixture()
      await expect(
        subdomainRegistrar.write.setFeeBps([1001n], { account: deployer }),
      ).toBeRevertedWithCustomError('FeeTooHigh')
    })

    it('allows setting fee at the boundary (1000 bps)', async () => {
      const { subdomainRegistrar } = await loadFixture()
      await subdomainRegistrar.write.setFeeBps([1000n], { account: deployer })
      await expect(subdomainRegistrar.read.feeBps()).resolves.toBe(1000n)
    })

    it('reverts for a non-owner caller (Ownable)', async () => {
      const { subdomainRegistrar } = await loadFixture()
      await expect(
        subdomainRegistrar.write.setFeeBps([100n], { account: stranger }),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

  describe('gate', () => {
    it('lets an ERC-20 holder register and reverts GateFailed for a non-holder (D-09)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      // MockERC20 mints to deployer + each passed holder.
      const mock20 = await connection.viem.deployContract('MockERC20', [
        'Gate20',
        'G20',
        [holder.address],
      ])
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        gateToken: mock20.address,
        minGateBalance: 1n,
        parentOwner,
      })

      // holder passes the gate
      await subdomainRegistrar.write.register([parentNode, 'h20', holder.address], {
        value: PRICE,
        account: holder,
      })
      await expect(
        rns.read.owner([subNode('h20')]),
      ).resolves.toEqualAddress(holder.address)

      // a non-holder (buyer) reverts GateFailed
      await expect(
        subdomainRegistrar.write.register([parentNode, 'nope', buyer.address], {
          value: PRICE,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('GateFailed')
    })

    it('lets an ERC-721 holder register and reverts GateFailed for a non-holder (D-10)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      // MockERC721 mints sequential ids to each passed holder.
      const mock721 = await connection.viem.deployContract('MockERC721', [
        'Gate721',
        'G721',
        [holder.address],
      ])
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        gateToken: mock721.address,
        minGateBalance: 1n,
        parentOwner,
      })

      // ERC-721 holder (balance >= 1) passes the SAME balanceOf path as ERC-20
      await subdomainRegistrar.write.register([parentNode, 'h721', holder.address], {
        value: PRICE,
        account: holder,
      })
      await expect(
        rns.read.owner([subNode('h721')]),
      ).resolves.toEqualAddress(holder.address)

      // non-holder reverts GateFailed
      await expect(
        subdomainRegistrar.write.register([parentNode, 'nope', buyer.address], {
          value: PRICE,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('GateFailed')
    })

    it('treats a non-implementing gate token as balance 0 (GateFailed for everyone)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      const nonToken = await connection.viem.deployContract('MockNonToken', [])
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        gateToken: nonToken.address,
        minGateBalance: 1n,
        parentOwner,
      })

      // _balanceOf returns 0 for a token that does not answer the selector →
      // every buyer fails the gate (RESEARCH Pattern 3 / T-7-08). Even the holder
      // account fails because the non-token never reports a balance.
      await expect(
        subdomainRegistrar.write.register([parentNode, 'sub', holder.address], {
          value: PRICE,
          account: holder,
        }),
      ).toBeRevertedWithCustomError('GateFailed')
    })
  })

  describe('revoke', () => {
    it('blocks overwriting an active subdomain (NotAvailable, SUB-06)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      await subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      // a second buyer cannot overwrite the active subnode
      await expect(
        subdomainRegistrar.write.register([parentNode, 'sub', stranger.address], {
          value: PRICE,
          account: stranger,
        }),
      ).toBeRevertedWithCustomError('NotAvailable')
    })

    it('reverts NotSold when the parent owner revokes a never-sold label (WR-02)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      // No sale has occurred under 'ghost' — revoke must NOT double as a general
      // subnode writer / emit a misleading SubdomainRevoked.
      await expect(
        subdomainRegistrar.write.revokeSubdomain(
          [parentNode, labelhash('ghost'), parentOwner.address],
          { account: parentOwner },
        ),
      ).toBeRevertedWithCustomError('NotSold')
    })

    it('reverts NotParentOwner when a stranger revokes', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })
      await subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      await expect(
        subdomainRegistrar.write.revokeSubdomain(
          [parentNode, labelhash('sub'), stranger.address],
          { account: stranger },
        ),
      ).toBeRevertedWithCustomError('NotParentOwner')
    })

    it('lets the parent owner revoke, making the subnode re-sellable (SUB-06)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })
      await subdomainRegistrar.write.register([parentNode, 'sub', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      // before revoke: active, not available
      await expect(
        subdomainRegistrar.read.isActive([parentNode, labelhash('sub')]),
      ).resolves.toBe(true)
      await expect(
        subdomainRegistrar.read.isSubnodeAvailable([parentNode, labelhash('sub')]),
      ).resolves.toBe(false)

      // parent owner revokes, handing the subnode back to themselves
      await subdomainRegistrar.write.revokeSubdomain(
        [parentNode, labelhash('sub'), parentOwner.address],
        { account: parentOwner },
      )

      await expect(
        rns.read.owner([subNode('sub')]),
      ).resolves.toEqualAddress(parentOwner.address)
      await expect(
        subdomainRegistrar.read.isSubnodeAvailable([parentNode, labelhash('sub')]),
      ).resolves.toBe(true) // re-sellable

      // a fresh sale of the same label now succeeds
      await subdomainRegistrar.write.register([parentNode, 'sub', stranger.address], {
        value: PRICE,
        account: stranger,
      })
      await expect(
        rns.read.owner([subNode('sub')]),
      ).resolves.toEqualAddress(stranger.address)
    })
  })

  describe('reentr', () => {
    // Solidity `Error(string)` ABI — used to decode the inner revert reason the
    // attacker captures, so we can assert the guard string SPECIFICALLY fired.
    const ERROR_STRING_ABI = [
      { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
    ] as const

    it('a malicious payout re-entering register fails the whole sale (D-06 / T-7-01)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      const attacker = await connection.viem.deployContract('ReentrantPayout', [])

      // arm the attacker to re-enter register('evil') for the same subnode on
      // its first received value; default bubble mode bubbles the inner revert
      await attacker.write.setTarget([subdomainRegistrar.address, parentNode, 'evil'])

      // list the parent with the attacker as the payout sink (fee default 0, so
      // the full price is pushed to the payout → hits attacker.receive())
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: attacker.address,
        price: PRICE,
        parentOwner,
      })

      // The parent-share push lands on attacker.receive(), which re-enters the
      // nonReentrant register. The inner re-entry is rejected by the guard; in
      // bubble mode the failed push makes safeTransferETH revert the whole sale
      // (ETHTransferFailed at the outer boundary) — the attack cannot complete.
      await expect(
        subdomainRegistrar.write.register([parentNode, 'evil', buyer.address], {
          value: PRICE,
          account: buyer,
        }),
      ).toBeRevertedWithCustomError('ETHTransferFailed')

      // The subnode was NOT minted — the re-entrant sale fully reverted.
      await expect(
        rns.read.owner([subNode('evil')]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('the captured re-entry reason equals "ReentrancyGuard: reentrant call" (payout)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      const attacker = await connection.viem.deployContract('ReentrantPayout', [])
      await attacker.write.setTarget([subdomainRegistrar.address, parentNode, 'evil'])
      await attacker.write.setBubble([false]) // capture mode

      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: attacker.address,
        price: PRICE,
        parentOwner,
      })

      // Outer sale settles (attacker accepts funds after capturing the revert).
      await subdomainRegistrar.write.register([parentNode, 'evil', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      // The attacker captured the inner revert reason — decode it and assert it
      // is exactly the OZ v4 ReentrancyGuard string (proves the guard fired).
      const reason = (await attacker.read.lastRevertReason()) as Hex
      const decoded = decodeErrorResult({ abi: ERROR_STRING_ABI, data: reason })
      expect(decoded.errorName).toBe('Error')
      expect(decoded.args[0]).toBe('ReentrancyGuard: reentrant call')
    })

    it('the captured re-entry reason equals "ReentrancyGuard: reentrant call" (feeRecipient)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      const attacker = await connection.viem.deployContract('ReentrantPayout', [])
      await attacker.write.setTarget([subdomainRegistrar.address, parentNode, 'evil'])
      await attacker.write.setBubble([false]) // capture mode

      // route the protocol fee to the attacker (owner-only) with a non-zero fee
      await subdomainRegistrar.write.setFeeRecipient([attacker.address], {
        account: deployer,
      })
      await subdomainRegistrar.write.setFeeBps([500n], { account: deployer })

      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      await subdomainRegistrar.write.register([parentNode, 'evil', buyer.address], {
        value: PRICE,
        account: buyer,
      })

      const reason = (await attacker.read.lastRevertReason()) as Hex
      const decoded = decodeErrorResult({ abi: ERROR_STRING_ABI, data: reason })
      expect(decoded.errorName).toBe('Error')
      expect(decoded.args[0]).toBe('ReentrancyGuard: reentrant call')
    })
  })

  describe('stats', () => {
    it('increments totalSubdomains once per sale (ENUM-02)', async () => {
      const { rns, subdomainRegistrar } = await loadFixture()
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: payout.address,
        price: PRICE,
        parentOwner,
      })

      // starts at 0 before any sale
      await expect(subdomainRegistrar.read.totalSubdomains()).resolves.toBe(0n)

      // one successful sale → 1
      await subdomainRegistrar.write.register([parentNode, 'one', buyer.address], {
        value: PRICE,
        account: buyer,
      })
      await expect(subdomainRegistrar.read.totalSubdomains()).resolves.toBe(1n)

      // a second successful sale (different label) → 2
      await subdomainRegistrar.write.register([parentNode, 'two', buyer.address], {
        value: PRICE,
        account: buyer,
      })
      await expect(subdomainRegistrar.read.totalSubdomains()).resolves.toBe(2n)
    })
  })
})
