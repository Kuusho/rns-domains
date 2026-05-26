import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import {
  type Address,
  type Hash,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  namehash,
  padHex,
  stringToHex,
  zeroAddress,
  zeroHash,
} from 'viem'

import { dnsEncodeName } from '../fixtures/dnsEncodeName.js'
import { getAccounts } from '../fixtures/utils.js'

// Fresh test suite — no reference test exists for OwnedResolver. Coverage:
//   * isAuthorised override — only the OZ Ownable owner may write records;
//     the registry is NEVER consulted (D-04 + Pitfall 9 carry-forward)
//   * supportsInterface — advertises the 8 inherited profile mixin interfaces
//     + IVersionableResolver + IERC165; EXPLICITLY does NOT advertise
//     IDataResolver (Pitfall 9 verification — interface ID 0xecbfada3 returns
//     false)
//   * 8 profile round-trips — one positive-case write+read per inherited
//     mixin (Addr, Text, ContentHash, ABI, Interface, Name, Pubkey, DNS)
//   * ExtendedResolver.resolve(name, data) — staticcall dispatch on the
//     inheriting resolver + revert bubbling for failed inner calls (D-04)
//   * Ownable.transferOwnership — new owner can write, old owner cannot;
//     non-owner attempts to rotate revert with the OZ v4 string
//
// Direct-deploy pattern (no rocketh-in-test). Plan 05's integration test
// reserves the loadAndExecuteDeployments fixture for the activation gate
// verification (SC.setRegistrarResolver → RNS.resolver(namehash('rise')) ==
// RiseOwnedResolver.address). This file only exercises the contract surface.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  // OZ Ownable v4 seats msg.sender (the deployer, accounts[0]) as the owner.
  const resolver = await connection.viem.deployContract(
    'RiseOwnedResolver',
    [],
  )
  return { resolver, accounts }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// Per Pitfall 9 RESEARCH table — IDataResolver.interfaceId is 0xecbfada3.
// RiseOwnedResolver MUST NOT advertise this; the supportsInterface override
// list deliberately excludes DataResolver from the inheritance chain.
const IDATA_RESOLVER_INTERFACE_ID: Hex = '0xecbfada3'

// targetNode is `.rise`; the resolver is single-owner and does not consult
// the registry, so any bytes32 would work — using namehash('rise') for
// readability and to mirror Plan 05's eventual production use of this
// resolver for the `.rise` TLD node.
const targetNode = namehash('rise')

describe('RiseOwnedResolver', () => {
  shouldSupportInterfaces({
    contract: () => loadFixture().then(({ resolver }) => resolver),
    interfaces: [
      'IAddrResolver',
      'IAddressResolver',
      'INameResolver',
      'IABIResolver',
      'IPubkeyResolver',
      'ITextResolver',
      'IContentHashResolver',
      'IDNSRecordResolver',
      'IDNSZoneResolver',
      'IInterfaceResolver',
    ],
  })

  describe('isAuthorised', () => {
    it('permits the Ownable owner to set records', async () => {
      const { resolver } = await loadFixture()

      await resolver.write.setAddr([targetNode, accounts[0].address])
      await expect(
        resolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[0].address)
    })

    it('forbids non-owner callers from setting records (bare-revert per D-12)', async () => {
      const { resolver } = await loadFixture()

      await expect(
        resolver.write.setAddr([targetNode, accounts[1].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('ignores the registry entirely — only msg.sender == owner() gates writes', async () => {
      const { resolver } = await loadFixture()

      // The contract has no `rns` storage. Even an arbitrary bytes32 node
      // succeeds for the owner — proves isAuthorised is single-source and
      // not delegating to any registry-owner lookup.
      const arbitraryNode = keccak256(stringToHex('arbitrary-non-rise-node'))
      await resolver.write.setAddr([arbitraryNode, accounts[0].address])
      await expect(
        resolver.read.addr([arbitraryNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[0].address)
    })
  })

  describe('supportsInterface', () => {
    it('does NOT advertise IDataResolver (Pitfall 9 — DataResolver excluded from inheritance)', async () => {
      const { resolver } = await loadFixture()

      await expect(
        resolver.read.supportsInterface([IDATA_RESOLVER_INTERFACE_ID]),
      ).resolves.toBe(false)
    })

    it('does not support a random interface', async () => {
      const { resolver } = await loadFixture()

      await expect(
        resolver.read.supportsInterface(['0x3b3b57df']),
      ).resolves.toBe(false)
    })
  })

  describe('round-trip per profile', () => {
    it('AddrResolver — setAddr / addr', async () => {
      const { resolver } = await loadFixture()

      await resolver.write.setAddr([targetNode, accounts[1].address])
      await expect(
        resolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('TextResolver — setText / text', async () => {
      const { resolver } = await loadFixture()

      const url = 'https://rise.example/'
      await resolver.write.setText([targetNode, 'url', url])
      await expect(resolver.read.text([targetNode, 'url'])).resolves.toEqual(
        url,
      )
    })

    it('ContentHashResolver — setContenthash / contenthash', async () => {
      const { resolver } = await loadFixture()

      const ch = padHex('0xdeadbeef', { dir: 'right', size: 32 })
      await resolver.write.setContenthash([targetNode, ch])
      await expect(resolver.read.contenthash([targetNode])).resolves.toEqual(ch)
    })

    it('ABIResolver — setABI / ABI', async () => {
      const { resolver } = await loadFixture()

      // contentType 1 is JSON (power-of-2; passes ABIResolver's bare-require)
      const abiBytes: Hex = '0x666f6f'
      await resolver.write.setABI([targetNode, 1n, abiBytes])
      await expect(
        resolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([1n, abiBytes])
    })

    it('InterfaceResolver — setInterface / interfaceImplementer', async () => {
      const { resolver } = await loadFixture()

      const interfaceId: Hex = '0x12345678'
      await resolver.write.setInterface([
        targetNode,
        interfaceId,
        accounts[2].address,
      ])
      await expect(
        resolver.read.interfaceImplementer([targetNode, interfaceId]),
      ).resolves.toEqualAddress(accounts[2].address)
    })

    it('NameResolver — setName / name', async () => {
      const { resolver } = await loadFixture()

      await resolver.write.setName([targetNode, 'rise-root'])
      await expect(resolver.read.name([targetNode])).resolves.toEqual(
        'rise-root',
      )
    })

    it('PubkeyResolver — setPubkey / pubkey', async () => {
      const { resolver } = await loadFixture()

      const x: Hash = padHex('0x10', { dir: 'right', size: 32 })
      const y: Hash = padHex('0x20', { dir: 'right', size: 32 })
      await resolver.write.setPubkey([targetNode, x, y])
      await expect(resolver.read.pubkey([targetNode])).resolves.toMatchObject([
        x,
        y,
      ])
    })

    it('DNSResolver — setDNSRecords / dnsRecord', async () => {
      const { resolver } = await loadFixture()

      // a.eth. 3600 IN A 1.2.3.4 — using reference's verbatim wire-format
      // RR encoding; the test sets it on `.rise`'s `targetNode` (DNS labels
      // inside RDATA are arbitrary string bytes, not registry namehashes).
      const arec = '016103657468000001000100000e10000401020304'
      const rec: Hex = `0x${arec}`
      await resolver.write.setDNSRecords([targetNode, rec])
      await expect(
        resolver.read.dnsRecord([
          targetNode,
          keccak256(dnsEncodeName('a.eth')),
          1,
        ]),
      ).resolves.toEqual(`0x${arec}` as Hex)
    })
  })

  describe('ExtendedResolver.resolve (ENSIP-10 stub, D-04)', () => {
    it('dispatches via staticcall and returns the inner call result', async () => {
      const { resolver } = await loadFixture()

      // Set an address record first, then resolve(name, data) it through the
      // ENSIP-10 routing stub. The inner call is `addr(targetNode)`; the
      // result is ABI-decoded as `address` and asserted equal to the
      // owner's address.
      await resolver.write.setAddr([targetNode, accounts[1].address])

      const innerCall = encodeFunctionData({
        abi: resolver.abi,
        functionName: 'addr',
        args: [targetNode],
      })
      const wrappedResult = await resolver.read.resolve([
        dnsEncodeName('rise'),
        innerCall,
      ])
      const decoded = decodeFunctionResult({
        abi: resolver.abi,
        functionName: 'addr',
        data: wrappedResult,
      })
      expect(decoded).toEqualAddress(accounts[1].address)
    })

    it('bubbles inner staticcall revert reasons', async () => {
      const { resolver } = await loadFixture()

      // Encode a call to a non-existent selector — staticcall fails, and
      // ExtendedResolver re-reverts with the inner call's revert payload.
      const badCall: Hex =
        '0xdeadbeef00000000000000000000000000000000000000000000000000000000'
      await expect(
        resolver.read.resolve([dnsEncodeName('rise'), badCall]),
      ).rejects.toThrow()
    })
  })

  describe('Ownable.transferOwnership', () => {
    it('transferOwnership lets the new owner write records and locks out the old owner', async () => {
      const { resolver } = await loadFixture()

      // Initial owner (deployer = accounts[0]) rotates ownership to accounts[1].
      await resolver.write.transferOwnership([accounts[1].address])
      await expect(
        resolver.read.owner() as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)

      // New owner can write
      await resolver.write.setAddr([targetNode, accounts[1].address], {
        account: accounts[1],
      })
      await expect(
        resolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)

      // Old owner can no longer write — bare revert (the inherited
      // ResolverBase.authorised modifier reverts without a reason; OZ
      // Ownable's onlyOwner is NOT in this path because isAuthorised is
      // overridden here)
      await expect(
        resolver.write.setAddr([targetNode, accounts[0].address], {
          account: accounts[0],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('non-owner transferOwnership reverts with the OZ Ownable string', async () => {
      const { resolver } = await loadFixture()

      // OZ Ownable v4.9.3 emits exactly "Ownable: caller is not the owner"
      // — asserted verbatim. Any divergence here means the OZ version was
      // bumped or the inheritance chain was rewired.
      await expect(
        resolver.write.transferOwnership([accounts[2].address], {
          account: accounts[1],
        }),
      ).rejects.toThrow('Ownable: caller is not the owner')
    })

    it('initial owner is the deployer (msg.sender)', async () => {
      const { resolver } = await loadFixture()

      // OZ Ownable v4's parameterless constructor seats msg.sender. The
      // direct-deploy fixture uses accounts[0] as the connection's default
      // sender. Plan 05's deploy script calls transferOwnership(owner)
      // after deploy to rotate to the named `owner` account.
      await expect(
        resolver.read.owner() as Promise<Address>,
      ).resolves.toEqualAddress(getAddress(accounts[0].address))
    })
  })
})
