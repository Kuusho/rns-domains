import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import {
  type Address,
  type Hash,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
  labelhash,
  namehash,
  padHex,
  stringToHex,
  zeroAddress,
  zeroHash,
} from 'viem'

import { createInterfaceId } from '../fixtures/createInterfaceId.js'
import { dnsEncodeName } from '../fixtures/dnsEncodeName.js'
import { getAccounts } from '../fixtures/utils.js'
import {
  COIN_TYPE_DEFAULT,
  COIN_TYPE_ETH,
  shortCoin,
} from '../fixtures/ensip19.js'

// Ported verbatim-in-intent from
// reference/ens-contracts/test/resolvers/TestPublicResolver.test.ts per D-10.
// Adaptations applied:
//   * `.eth` → `.rise` (targetNode = namehash('rise'); labelhash('rise')).
//   * `ENSRegistry` → `RNSRegistry`.
//   * The reference's wrapper-dummy contract deployment + the wrapper-address
//     constructor arg are DROPPED (Pitfall 3, D-01).
//   * `ReverseRegistrar` deployment DROPPED (D-07; RNS has no reverse registrar
//     in Phase 4). The `accounts[8]` slot used by the reference as
//     `trustedReverseRegistrar` is wired directly via the constructor here
//     (Pitfall 3 Option A — adapt the fixture, not the production deploy flow).
//   * The reference's "permits name wrapper owner to make changes if owner is
//     set to name wrapper address" test (lines 1518-1541) is DROPPED (D-01:
//     no NameWrapper).
//   * NEW: 6 setter tests for `setTrustedController` /
//     `setTrustedReverseRegistrar` (D-01: 2 owner-only setters; 04-VALIDATION
//     rows 04-03-05, 04-03-06).
//   * NEW: 2 `multicallWithNodeCheck` tests (Open Q5 + 04-VALIDATION row
//     04-01-03 + Pitfall 4 mitigation coverage).
//
// All other tests port verbatim; `.eth` literals are replaced with `.rise`
// throughout. DNS records in the `dns.records` describe block keep their
// reference labels (`a.eth`, `b.eth`, `eth`) because those are wire-format
// DNS labels, NOT registry namehashes — they are arbitrary string bytes
// the test happens to use. Replacing them with `.rise` strings would
// invalidate the reference's hex blob and require re-deriving every
// DNSResolver assertion. Keeping them preserves the reference's DNS
// edge-case coverage with zero semantic drift.

const targetNode = namehash('rise')

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])

  // Pitfall 3 Option A — wire trustedRiseController = accounts[9] and
  // trustedReverseRegistrar = accounts[8] at construction so the reference's
  // "trusted contract can bypass authorisation" test passes with minimal
  // port edits. The new setter tests below exercise the production deploy
  // path (deploy with address(0), call setter later).
  const trustedRiseController = accounts[9]
  const trustedReverseRegistrar = accounts[8]

  const publicResolver = await connection.viem.deployContract(
    'PublicResolver',
    [
      rnsRegistry.address,
      trustedRiseController.address,
      trustedReverseRegistrar.address,
    ],
  )

  // Seat accounts[0] as the owner of the .rise node directly through the
  // registry. This mirrors the reference's targetNode setup (lines 70-74)
  // minus the reverse-registrar wiring (D-07).
  await rnsRegistry.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    accounts[0].address,
  ])

  return {
    rnsRegistry,
    publicResolver,
    trustedRiseController,
    trustedReverseRegistrar,
    accounts,
  }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

async function fixtureWithDnsRecords() {
  const existing = await loadFixture()
  // a.eth. 3600 IN A 1.2.3.4
  const arec = '016103657468000001000100000e10000401020304' as const
  // b.eth. 3600 IN A 2.3.4.5
  const b1rec = '016203657468000001000100000e10000402030405' as const
  // b.eth. 3600 IN A 3.4.5.6
  const b2rec = '016203657468000001000100000e10000403040506' as const
  // eth. 86400 IN SOA ns1.ethdns.xyz. hostmaster.test.eth. 2018061501 15620 1800 1814400 14400
  const soarec =
    '03657468000006000100015180003a036e733106657468646e730378797a000a686f73746d6173746572057465737431036574680078492cbd00003d0400000708001baf8000003840' as const
  const rec = `0x${arec}${b1rec}${b2rec}${soarec}` as const
  const tx = existing.publicResolver.write.setDNSRecords([targetNode, rec])
  return { ...existing, rec, arec, b1rec, b2rec, soarec, tx }
}
const loadFixtureWithDnsRecords = async () =>
  connection.networkHelpers.loadFixture(fixtureWithDnsRecords)

describe('PublicResolver', () => {
  shouldSupportInterfaces({
    contract: () => loadFixture().then(({ publicResolver }) => publicResolver),
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

  describe('fallback function', () => {
    it('forbids calls to the fallback function with 0 value', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.arbitrary({
          to: publicResolver.address,
          value: 0n,
          gas: 3000000n,
          account: accounts[0],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids calls to the fallback function with 1 value', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.arbitrary({
          to: publicResolver.address,
          value: 1n,
          gas: 3000000n,
          account: accounts[0],
        }),
      ).toBeRevertedWithoutReason()
    })
  })

  describe('supportsInterface function', () => {
    it('does not support a random interface', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.supportsInterface(['0x3b3b57df']),
      ).resolves.toEqual(false)
    })
  })

  describe('recordVersion', () => {
    it('permits clearing records', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.write.clearRecords([targetNode]))
        .toEmitEvent('VersionChanged')
        .withArgs({ node: targetNode, newVersion: 1n })
    })
  })

  describe('addr', () => {
    it('permits setting address by owner', async () => {
      const { publicResolver } = await loadFixture()

      const tx = publicResolver.write.setAddr([targetNode, accounts[1].address])

      await expect(tx).toEmitEvent('AddressChanged').withArgs({
        node: targetNode,
        coinType: 60n,
        newAddress: accounts[1].address,
      })

      await expect(tx)
        .toEmitEvent('AddrChanged')
        .withArgs({ node: targetNode, a: getAddress(accounts[1].address) })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('can overwrite previously set address', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)

      await publicResolver.write.setAddr([targetNode, accounts[0].address])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[0].address)
    })

    it('can overwrite to same address', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)

      await publicResolver.write.setAddr([targetNode, accounts[1].address])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('forbids setting new address by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setAddr([targetNode, accounts[1].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids writing same address by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])

      await expect(
        publicResolver.write.setAddr([targetNode, accounts[1].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids overwriting existing address by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])

      await expect(
        publicResolver.write.setAddr([targetNode, accounts[0].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('returns zero when fetching nonexistent addresses', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('permits setting and retrieving addresses for other coin types', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([
        targetNode,
        123n,
        accounts[1].address,
      ])

      await expect(
        publicResolver.read.addr([targetNode, 123n]) as Promise<Hex>,
      ).resolves.toEqual(accounts[1].address.toLowerCase() as Address)
    })

    it('returns ETH address for coin type 60', async () => {
      const { publicResolver } = await loadFixture()

      const tx = publicResolver.write.setAddr([targetNode, accounts[1].address])

      await expect(tx).toEmitEvent('AddressChanged').withArgs({
        node: targetNode,
        coinType: 60n,
        newAddress: accounts[1].address,
      })
      await expect(tx)
        .toEmitEvent('AddrChanged')
        .withArgs({ node: targetNode, a: getAddress(accounts[1].address) })
      await expect(
        publicResolver.read.addr([targetNode, COIN_TYPE_ETH]) as Promise<Hex>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('setting coin type 60 updates ETH address', async () => {
      const { publicResolver } = await loadFixture()

      const tx = publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_ETH,
        accounts[2].address,
      ])

      await expect(tx).toEmitEvent('AddressChanged').withArgs({
        node: targetNode,
        coinType: 60n,
        newAddress: accounts[2].address,
      })
      await expect(tx)
        .toEmitEvent('AddrChanged')
        .withArgs({ node: targetNode, a: getAddress(accounts[2].address) })
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[2].address)
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('clears address w/setAddr(60)', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_ETH,
        accounts[1].address,
      ])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
        'confirm set',
      ).resolves.toEqualAddress(accounts[1].address)
      // clear
      await publicResolver.write.setAddr([targetNode, COIN_TYPE_ETH, '0x'])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
        'addr',
      ).resolves.toEqualAddress(zeroAddress)
      await expect(
        publicResolver.read.addr([
          targetNode,
          COIN_TYPE_ETH,
        ]) as Promise<Address>,
        'addr(60)',
      ).resolves.toStrictEqual('0x')
    })

    it('zeros address w/setAddr()', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set
      await publicResolver.write.setAddr([targetNode, accounts[1].address])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
        'confirm set',
      ).resolves.toEqualAddress(accounts[1].address)
      // clear
      await publicResolver.write.setAddr([targetNode, zeroAddress])
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
        'addr',
      ).resolves.toEqualAddress(zeroAddress)
      await expect(
        publicResolver.read.addr([
          targetNode,
          COIN_TYPE_ETH,
        ]) as Promise<Address>,
        'addr(60)',
      ).resolves.toStrictEqual(zeroAddress)
    })

    it('does fallback for EVM coin types to default', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set default
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_DEFAULT,
        accounts[1].address,
      ])
      // expect evm are default
      for (const coinType of [COIN_TYPE_ETH, COIN_TYPE_DEFAULT | 1n]) {
        await expect(
          publicResolver.read.addr([targetNode, coinType]) as Promise<Address>,
          shortCoin(coinType),
        ).resolves.toEqualAddress(accounts[1].address)
      }
    })

    it('does not fallback for non-EVM coin types', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set default
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_DEFAULT,
        accounts[1].address,
      ])
      // expect non-evm ignore default
      for (const coinType of [0n, 1n]) {
        await expect(
          publicResolver.read.addr([targetNode, coinType]) as Promise<Address>,
          shortCoin(coinType),
        ).resolves.toStrictEqual('0x')
      }
    })

    it('forbids setting an invalid EVM address', async () => {
      const invalidAddr = '0x1234'
      const { publicResolver } = await loadFixture()
      for (const coinType of [COIN_TYPE_ETH, COIN_TYPE_DEFAULT]) {
        await expect(
          publicResolver.write.setAddr([targetNode, coinType, invalidAddr]),
        ).toBeRevertedWithCustomError('InvalidEVMAddress')
      }
    })

    it('allows address(0) to prevent fallback', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set explicit 0
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_ETH,
        zeroAddress,
      ])
      // set default
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_DEFAULT,
        accounts[1].address,
      ])
      // expect 0
      await expect(
        publicResolver.read.addr([
          targetNode,
          COIN_TYPE_ETH,
        ]) as Promise<Address>,
      ).resolves.toStrictEqual(zeroAddress)
    })

    it('supports hasAddr() even if addr() returns default', async () => {
      const { publicResolver, accounts } = await loadFixture()
      // set default
      await publicResolver.write.setAddr([
        targetNode,
        COIN_TYPE_DEFAULT,
        accounts[1].address,
      ])
      // has default
      await expect(
        publicResolver.read.hasAddr([targetNode, COIN_TYPE_DEFAULT]),
      ).resolves.toStrictEqual(true)
      // does not have any other
      for (const coinType of [0n, COIN_TYPE_ETH, COIN_TYPE_DEFAULT | 1n]) {
        await expect(
          publicResolver.read.hasAddr([targetNode, coinType]),
          shortCoin(coinType),
        ).resolves.toStrictEqual(false)
      }
    })
  })

  describe('name', () => {
    it('permits setting name by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.write.setName([targetNode, 'name1']))
        .toEmitEvent('NameChanged')
        .withArgs({ node: targetNode, name: 'name1' })
      await expect(publicResolver.read.name([targetNode])).resolves.toEqual(
        'name1',
      )
    })

    it('can overwrite previously set names', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setName([targetNode, 'name1'])
      await expect(publicResolver.read.name([targetNode])).resolves.toEqual(
        'name1',
      )

      await publicResolver.write.setName([targetNode, 'name2'])
      await expect(publicResolver.read.name([targetNode])).resolves.toEqual(
        'name2',
      )
    })

    it('forbids setting name by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setName([targetNode, 'name2'], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('returns empty when fetching nonexistent name', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.read.name([targetNode])).resolves.toEqual('')
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setName([targetNode, 'name1'])

      await expect(publicResolver.read.name([targetNode])).resolves.toEqual(
        'name1',
      )

      await publicResolver.write.clearRecords([targetNode])

      await expect(publicResolver.read.name([targetNode])).resolves.toEqual('')
    })
  })

  describe('pubkey', async () => {
    const pubkeyEmpty: [Hash, Hash] = [zeroHash, zeroHash]
    const pubkey1: [Hash, Hash] = [
      padHex('0x10', { dir: 'right', size: 32 }),
      padHex('0x20', { dir: 'right', size: 32 }),
    ]
    const pubkey2: [Hash, Hash] = [
      padHex('0x30', { dir: 'right', size: 32 }),
      padHex('0x40', { dir: 'right', size: 32 }),
    ]

    it('returns empty when fetching nonexistent values', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkeyEmpty)
    })

    it('permits setting public key by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.write.setPubkey([targetNode, ...pubkey1]))
        .toEmitEvent('PubkeyChanged')
        .withArgs({ node: targetNode, x: pubkey1[0], y: pubkey1[1] })

      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey1)
    })

    it('can overwrite previously set value', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])
      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey1)

      await publicResolver.write.setPubkey([targetNode, ...pubkey2])
      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey2)
    })

    it('can overwrite to same value', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])
      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey1)

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])
      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey1)
    })

    it('forbids setting value by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setPubkey([targetNode, ...pubkey1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids writing same value by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])

      await expect(
        publicResolver.write.setPubkey([targetNode, ...pubkey1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids overwriting existing value by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])

      await expect(
        publicResolver.write.setPubkey([targetNode, ...pubkey2], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setPubkey([targetNode, ...pubkey1])

      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkey1)

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.pubkey([targetNode]),
      ).resolves.toMatchObject(pubkeyEmpty)
    })
  })

  describe('ABI', () => {
    it('returns a contentType of 0 when nothing is available', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([0n, '0x'])
    })

    it('returns an ABI after it has been set', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setABI([targetNode, 1n, '0x666f6f'])

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([1n, '0x666f6f'])
    })

    it('returns the first valid ABI', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setABI([targetNode, 0x2n, '0x666f6f'])
      await publicResolver.write.setABI([targetNode, 0x4n, '0x626172'])

      await expect(
        publicResolver.read.ABI([targetNode, 0x7n]),
      ).resolves.toMatchObject([2n, '0x666f6f'])

      await expect(
        publicResolver.read.ABI([targetNode, 0x5n]),
      ).resolves.toMatchObject([4n, '0x626172'])
    })

    it('allows deleting ABIs', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setABI([targetNode, 1n, '0x666f6f'])

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([1n, '0x666f6f'])

      await publicResolver.write.setABI([targetNode, 1n, '0x'])

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([0n, '0x'])
    })

    it('rejects invalid content types', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setABI([targetNode, 0x3n, '0x12']),
      ).toBeRevertedWithoutReason()
    })

    it('forbids setting value by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setABI([targetNode, 1n, '0x666f6f'], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('resets on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setABI([targetNode, 1n, '0x666f6f'])

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([1n, '0x666f6f'])

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.ABI([targetNode, 0xffffffffn]),
      ).resolves.toMatchObject([0n, '0x'])
    })

    it('can try all content types', async () => {
      const { publicResolver } = await loadFixture()
      await expect(
        publicResolver.read.ABI([targetNode, (1n << 256n) - 1n]),
      ).resolves.toMatchObject([0n, '0x'])
    })
  })

  describe('text', () => {
    const url1 = 'https://ethereum.org'
    const url2 = 'https://github.com/ethereum'

    it('permits setting text by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.write.setText([targetNode, 'url', url1]))
        .toEmitEvent('TextChanged')
        .withArgs({
          node: targetNode,
          indexedKey: keccak256(stringToHex('url')),
          key: 'url',
          value: url1,
        })

      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url1)
    })

    it('can overwrite previously set text', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setText([targetNode, 'url', url1])
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url1)

      await publicResolver.write.setText([targetNode, 'url', url2])
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url2)
    })

    it('can overwrite to same text', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setText([targetNode, 'url', url1])
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url1)

      await publicResolver.write.setText([targetNode, 'url', url1])
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url1)
    })

    it('forbids setting text by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setText([targetNode, 'url', url1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids writing same text by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setText([targetNode, 'url', url1])

      await expect(
        publicResolver.write.setText([targetNode, 'url', url1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids overwriting existing text by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setText([targetNode, 'url', url1])

      await expect(
        publicResolver.write.setText([targetNode, 'url', url2], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setText([targetNode, 'url', url1])

      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(url1)

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual('')
    })
  })

  describe('data', () => {
    const dataKey = 'my-data-key'
    const data1 = '0x746f6d207761732068657265'

    it('permits setting data by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(publicResolver.write.setData([targetNode, dataKey, data1]))
        .toEmitEvent('DataChanged')
        .withArgs({
          node: targetNode,
          indexedKey: keccak256(stringToHex(dataKey)),
          key: dataKey,
          indexedData: keccak256(hexToBytes(data1)),
        })

      await expect(
        publicResolver.read.data([targetNode, dataKey]),
      ).resolves.toEqual(data1)
    })

    it('forbids setting data if not owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setData([targetNode, dataKey, data1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })
  })

  describe('contenthash', () => {
    const contenthash1 = padHex('0x01', { dir: 'left', size: 32 })
    const contenthash2 = padHex('0x02', { dir: 'left', size: 32 })

    it('permits setting contenthash by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setContenthash([targetNode, contenthash1]),
      )
        .toEmitEvent('ContenthashChanged')
        .withArgs({ node: targetNode, hash: contenthash1 })

      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash1)
    })

    it('can overwrite previously set contenthash', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setContenthash([targetNode, contenthash1])
      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash1)

      await publicResolver.write.setContenthash([targetNode, contenthash2])
      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash2)
    })

    it('can overwrite to same contenthash', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setContenthash([targetNode, contenthash1])
      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash1)

      await publicResolver.write.setContenthash([targetNode, contenthash1])
      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash1)
    })

    it('forbids setting contenthash by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setContenthash([targetNode, contenthash1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('forbids writing same contenthash by non-owners', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setContenthash([targetNode, contenthash1])

      await expect(
        publicResolver.write.setContenthash([targetNode, contenthash1], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('returns empty when fetching nonexistent contenthash', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual('0x')
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setContenthash([targetNode, contenthash1])

      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual(contenthash1)

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.contenthash([targetNode]),
      ).resolves.toEqual('0x')
    })
  })

  describe('dns', () => {
    describe('records', () => {
      it('permits setting name by owner', async () => {
        const { publicResolver, tx, arec, b1rec, b2rec, soarec } =
          await loadFixtureWithDnsRecords()

        await expect(tx).toEmitEvent('DNSRecordChanged')

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('a.eth')),
            1,
          ]),
        ).resolves.toEqual(`0x${arec}`)

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('b.eth')),
            1,
          ]),
        ).resolves.toEqual(`0x${b1rec}${b2rec}`)

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('eth')),
            6,
          ]),
        ).resolves.toEqual(`0x${soarec}`)
      })

      it('should update existing records', async () => {
        const { publicResolver } = await loadFixtureWithDnsRecords()

        // a.eth. 3600 IN A 4.5.6.7
        const arec = '016103657468000001000100000e10000404050607' as const
        // eth. 86400 IN SOA ns1.ethdns.xyz. hostmaster.test.eth. 2018061502 15620 1800 1814400 14400
        const soarec =
          '03657468000006000100015180003a036e733106657468646e730378797a000a686f73746d6173746572057465737431036574680078492cbe00003d0400000708001baf8000003840' as const
        const rec = `0x${arec}${soarec}` as const

        await publicResolver.write.setDNSRecords([targetNode, rec])

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('a.eth')),
            1,
          ]),
        ).resolves.toEqual(`0x${arec}`)
        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('eth')),
            6,
          ]),
        ).resolves.toEqual(`0x${soarec}`)
      })

      it('should keep track of entries', async () => {
        const { publicResolver } = await loadFixtureWithDnsRecords()

        // c.eth. 3600 IN A 1.2.3.4
        const crec = '016303657468000001000100000e10000401020304' as const
        const rec = `0x${crec}` as const

        await publicResolver.write.setDNSRecords([targetNode, rec])

        // Initial check
        await expect(
          publicResolver.read.hasDNSRecords([
            targetNode,
            keccak256(dnsEncodeName('c.eth')),
          ]),
        ).resolves.toEqual(true)
        await expect(
          publicResolver.read.hasDNSRecords([
            targetNode,
            keccak256(dnsEncodeName('d.eth')),
          ]),
        ).resolves.toEqual(false)

        // Update with no new data makes no difference
        await publicResolver.write.setDNSRecords([targetNode, rec])
        await expect(
          publicResolver.read.hasDNSRecords([
            targetNode,
            keccak256(dnsEncodeName('c.eth')),
          ]),
        ).resolves.toEqual(true)

        // c.eth. 3600 IN A
        const crec2 = '016303657468000001000100000e100000' as const
        const rec2 = `0x${crec2}` as const

        await publicResolver.write.setDNSRecords([targetNode, rec2])

        // Removal returns to 0
        await expect(
          publicResolver.read.hasDNSRecords([
            targetNode,
            keccak256(dnsEncodeName('c.eth')),
          ]),
        ).resolves.toEqual(false)
      })

      it('should handle single-record updates', async () => {
        const { publicResolver } = await loadFixtureWithDnsRecords()

        // e.eth. 3600 IN A 1.2.3.4
        const erec = '016503657468000001000100000e10000401020304' as const
        const rec = `0x${erec}` as const

        await publicResolver.write.setDNSRecords([targetNode, rec])

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('e.eth')),
            1,
          ]),
        ).resolves.toEqual(`0x${erec}`)
      })

      it('forbids setting DNS records by non-owners', async () => {
        const { publicResolver } = await loadFixtureWithDnsRecords()

        // f.eth. 3600 IN A 1.2.3.4
        const frec = '016603657468000001000100000e10000401020304' as const
        const rec = `0x${frec}` as const

        await expect(
          publicResolver.write.setDNSRecords([targetNode, rec], {
            account: accounts[1],
          }),
        ).toBeRevertedWithoutReason()
      })

      it('resets record on version change', async () => {
        const { publicResolver } = await loadFixtureWithDnsRecords()

        await publicResolver.write.clearRecords([targetNode])

        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('a.eth')),
            1,
          ]),
        ).resolves.toEqual('0x')
        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('b.eth')),
            1,
          ]),
        ).resolves.toEqual('0x')
        await expect(
          publicResolver.read.dnsRecord([
            targetNode,
            keccak256(dnsEncodeName('eth')),
            6,
          ]),
        ).resolves.toEqual('0x')
      })
    })

    describe('zonehash', () => {
      const zonehash1 = padHex('0x01', { dir: 'left', size: 32 })
      const zonehash2 = padHex('0x02', { dir: 'left', size: 32 })

      it('permits setting zonehash by owner', async () => {
        const { publicResolver } = await loadFixture()

        await expect(
          publicResolver.write.setZonehash([targetNode, zonehash1]),
        ).toEmitEvent('DNSZonehashChanged')

        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash1)
      })

      it('can overwrite previously set zonehash', async () => {
        const { publicResolver } = await loadFixture()

        await publicResolver.write.setZonehash([targetNode, zonehash1])
        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash1)

        await publicResolver.write.setZonehash([targetNode, zonehash2])
        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash2)
      })

      it('can overwrite to same zonehash', async () => {
        const { publicResolver } = await loadFixture()

        await publicResolver.write.setZonehash([targetNode, zonehash1])
        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash1)

        await publicResolver.write.setZonehash([targetNode, zonehash1])
        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash1)
      })

      it('forbids setting zonehash by non-owners', async () => {
        const { publicResolver } = await loadFixture()

        await expect(
          publicResolver.write.setZonehash([targetNode, zonehash1], {
            account: accounts[1],
          }),
        ).toBeRevertedWithoutReason()
      })

      it('forbids writing same zonehash by non-owners', async () => {
        const { publicResolver } = await loadFixture()

        await publicResolver.write.setZonehash([targetNode, zonehash1])

        await expect(
          publicResolver.write.setZonehash([targetNode, zonehash1], {
            account: accounts[1],
          }),
        ).toBeRevertedWithoutReason()
      })

      it('returns empty when fetching nonexistent zonehash', async () => {
        const { publicResolver } = await loadFixture()

        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual('0x')
      })

      it('emits the correct event', async () => {
        const { publicResolver } = await loadFixture()

        await expect(publicResolver.write.setZonehash([targetNode, zonehash1]))
          .toEmitEvent('DNSZonehashChanged')
          .withArgs({
            node: targetNode,
            lastzonehash: '0x',
            zonehash: zonehash1,
          })

        await expect(publicResolver.write.setZonehash([targetNode, zonehash2]))
          .toEmitEvent('DNSZonehashChanged')
          .withArgs({
            node: targetNode,
            lastzonehash: zonehash1,
            zonehash: zonehash2,
          })

        await expect(publicResolver.write.setZonehash([targetNode, '0x']))
          .toEmitEvent('DNSZonehashChanged')
          .withArgs({
            node: targetNode,
            lastzonehash: zonehash2,
            zonehash: '0x',
          })
      })

      it('resets record on version change', async () => {
        const { publicResolver } = await loadFixture()

        await publicResolver.write.setZonehash([targetNode, zonehash1])

        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual(zonehash1)

        await publicResolver.write.clearRecords([targetNode])

        await expect(
          publicResolver.read.zonehash([targetNode]),
        ).resolves.toEqual('0x')
      })
    })
  })

  describe('implementsInterface', () => {
    const interface1 = '0x12345678'

    it('permits setting interface by owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setInterface([
          targetNode,
          interface1,
          accounts[0].address,
        ]),
      )
        .toEmitEvent('InterfaceChanged')
        .withArgs({
          node: targetNode,
          interfaceID: interface1,
          implementer: getAddress(accounts[0].address),
        })

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(accounts[0].address)
    })

    it('can update previously set interface', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setInterface([
        targetNode,
        interface1,
        accounts[0].address,
      ])
      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(accounts[0].address)

      await publicResolver.write.setInterface([
        targetNode,
        interface1,
        accounts[1].address,
      ])
      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('forbids setting interface by non-owner', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setInterface(
          [targetNode, interface1, accounts[0].address],
          {
            account: accounts[1],
          },
        ),
      ).toBeRevertedWithoutReason()
    })

    it('returns zero when fetching nonexistent interface', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('falls back to calling implementsInterface on addr', async () => {
      const { publicResolver } = await loadFixture()

      // Set addr to the resolver itself, since it has interface implementations.
      await publicResolver.write.setAddr([targetNode, publicResolver.address])

      const addrArtifact = await hre.artifacts.readArtifact('IAddrResolver')
      const addrInterfaceId = createInterfaceId(addrArtifact.abi)

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, addrInterfaceId]),
      ).resolves.toEqualAddress(publicResolver.address)
    })

    it('returns 0 on fallback when target contract does not implement interface', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, publicResolver.address])

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('returns 0 on fallback when target contract does not support implementsInterface', async () => {
      const { rnsRegistry, publicResolver } = await loadFixture()

      // Set addr to the RNS registry, which doesn't implement supportsInterface.
      await publicResolver.write.setAddr([targetNode, rnsRegistry.address])

      const supportsInterfaceArtifact =
        await hre.artifacts.readArtifact('IERC165')
      const supportsInterfaceId = createInterfaceId(
        supportsInterfaceArtifact.abi,
      )

      await expect(
        publicResolver.read.interfaceImplementer([
          targetNode,
          supportsInterfaceId,
        ]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('returns 0 on fallback when target is not a contract', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[0].address])

      const supportsInterfaceArtifact =
        await hre.artifacts.readArtifact('IERC165')
      const supportsInterfaceId = createInterfaceId(
        supportsInterfaceArtifact.abi,
      )

      await expect(
        publicResolver.read.interfaceImplementer([
          targetNode,
          supportsInterfaceId,
        ]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('resets record on version change', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setInterface([
        targetNode,
        interface1,
        publicResolver.address,
      ])

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(publicResolver.address)

      await publicResolver.write.clearRecords([targetNode])

      await expect(
        publicResolver.read.interfaceImplementer([targetNode, interface1]),
      ).resolves.toEqualAddress(zeroAddress)
    })
  })

  describe('authorisations', () => {
    it('permits authorisations to be set', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setApprovalForAll([accounts[1].address, true]),
      )
        .toEmitEvent('ApprovalForAll')
        .withArgs({
          owner: getAddress(accounts[0].address),
          operator: getAddress(accounts[1].address),
          approved: true,
        })

      await expect(
        publicResolver.read.isApprovedForAll([
          accounts[0].address,
          accounts[1].address,
        ]),
      ).resolves.toEqual(true)
    })

    it('permits authorised users to make changes', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setApprovalForAll([accounts[1].address, true])

      await publicResolver.write.setAddr([targetNode, accounts[1].address], {
        account: accounts[1],
      })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('permits authorisations to be cleared', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setApprovalForAll([accounts[1].address, true])

      await publicResolver.write.setApprovalForAll([accounts[1].address, false])

      await expect(
        publicResolver.write.setAddr([targetNode, accounts[1].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('permits non-owners to set authorisations', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setApprovalForAll(
        [accounts[2].address, true],
        {
          account: accounts[1],
        },
      )

      // The authorisation should have no effect, because accounts[1] is not the owner.
      await expect(
        publicResolver.write.setAddr([targetNode, accounts[0].address], {
          account: accounts[2],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('checks the authorisation for the current owner', async () => {
      const { rnsRegistry, publicResolver } = await loadFixture()

      await publicResolver.write.setApprovalForAll(
        [accounts[2].address, true],
        { account: accounts[1] },
      )
      await rnsRegistry.write.setOwner([targetNode, accounts[1].address])

      await publicResolver.write.setAddr([targetNode, accounts[0].address], {
        account: accounts[2],
      })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[0].address)
    })

    it('trusted contract can bypass authorisation', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[9].address], {
        account: accounts[9],
      })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[9].address)
    })

    it('emits an ApprovalForAll log', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setApprovalForAll([accounts[1].address, true]),
      )
        .toEmitEvent('ApprovalForAll')
        .withArgs({
          owner: getAddress(accounts[0].address),
          operator: getAddress(accounts[1].address),
          approved: true,
        })
    })

    it('reverts if attempting to approve self as an operator', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setApprovalForAll([accounts[1].address, true], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('ERC1155: setting approval status for self')
    })

    // Reference's "permits name wrapper owner to make changes if owner is set
    // to name wrapper address" test is DROPPED per D-01 — RNS has no
    // NameWrapper slot (Phase 8 deferred / may never ship).
  })

  describe('token approvals', async () => {
    it('permits delegate to be approved', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.approve([
        targetNode,
        accounts[1].address,
        true,
      ])

      await expect(
        publicResolver.read.isApprovedFor([
          accounts[0].address,
          targetNode,
          accounts[1].address,
        ]),
      ).resolves.toEqual(true)
    })

    it('permits delegated users to make changes', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.approve([
        targetNode,
        accounts[1].address,
        true,
      ])

      await expect(
        publicResolver.read.isApprovedFor([
          accounts[0].address,
          targetNode,
          accounts[1].address,
        ]),
      ).resolves.toEqual(true)

      await publicResolver.write.setAddr([targetNode, accounts[1].address], {
        account: accounts[1],
      })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('permits delegations to be cleared', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.approve([
        targetNode,
        accounts[1].address,
        true,
      ])

      await publicResolver.write.approve([
        targetNode,
        accounts[1].address,
        false,
      ])

      await expect(
        publicResolver.write.setAddr([targetNode, accounts[0].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('permits non-owners to set delegations', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.approve(
        [targetNode, accounts[2].address, true],
        {
          account: accounts[1],
        },
      )

      // The delegation should have no effect, because accounts[1] is not the owner.
      await expect(
        publicResolver.write.setAddr([targetNode, accounts[0].address], {
          account: accounts[2],
        }),
      ).toBeRevertedWithoutReason()
    })

    it('checks the delegation for the current owner', async () => {
      const { rnsRegistry, publicResolver } = await loadFixture()

      await publicResolver.write.approve(
        [targetNode, accounts[2].address, true],
        { account: accounts[1] },
      )
      await rnsRegistry.write.setOwner([targetNode, accounts[1].address])

      await publicResolver.write.setAddr([targetNode, accounts[0].address], {
        account: accounts[2],
      })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[0].address)
    })

    it('emits an Approved log', async () => {
      const { publicResolver } = await loadFixture()

      const owner = accounts[0].address
      const delegate = accounts[1].address

      await expect(publicResolver.write.approve([targetNode, delegate, true]))
        .toEmitEvent('Approved')
        .withArgs({
          owner: getAddress(owner),
          node: targetNode,
          delegate: getAddress(delegate),
          approved: true,
        })
    })

    it('reverts if attempting to delegate to self', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.approve([targetNode, accounts[1].address, true], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('Setting delegate status for self')
    })
  })

  // NEW: D-01 owner-only setters — 6 tests covering non-owner revert,
  // event emission, and post-rotation bypass behavior. Closes
  // 04-VALIDATION.md rows 04-03-05 and 04-03-06.
  describe('owner-only setters', () => {
    it('setTrustedController reverts with Ownable for non-owner caller', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setTrustedController([accounts[5].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })

    it('setTrustedController emits TrustedControllerChanged and updates the slot', async () => {
      const { publicResolver } = await loadFixture()

      // The deployer (accounts[0]) is the OZ owner because the constructor
      // seats msg.sender. Plan 05 will call transferOwnership(owner) later.
      const previous = accounts[9].address // fixture-wired value
      const next = accounts[5].address

      await expect(
        publicResolver.write.setTrustedController([next], {
          account: accounts[0],
        }),
      )
        .toEmitEvent('TrustedControllerChanged')
        .withArgs({
          previous: getAddress(previous),
          next: getAddress(next),
        })

      await expect(
        publicResolver.read.trustedRiseController(),
      ).resolves.toEqualAddress(next)
    })

    it('setTrustedController updates the slot — bypass takes effect for the new trusted address', async () => {
      const { publicResolver } = await loadFixture()
      const newController = accounts[5]

      // Initially accounts[5] is not trusted (only accounts[9] is per fixture).
      await expect(
        publicResolver.write.setAddr([targetNode, newController.address], {
          account: newController,
        }),
      ).toBeRevertedWithoutReason()

      // Owner rotates the trusted controller.
      await publicResolver.write.setTrustedController([newController.address], {
        account: accounts[0],
      })

      // accounts[5] can now bypass authorisation.
      await publicResolver.write.setAddr([targetNode, newController.address], {
        account: newController,
      })
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(newController.address)
    })

    it('setTrustedReverseRegistrar reverts with Ownable for non-owner caller', async () => {
      const { publicResolver } = await loadFixture()

      await expect(
        publicResolver.write.setTrustedReverseRegistrar([accounts[5].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })

    it('setTrustedReverseRegistrar emits TrustedReverseRegistrarChanged and updates the slot', async () => {
      const { publicResolver } = await loadFixture()

      const previous = accounts[8].address // fixture-wired value
      const next = accounts[5].address

      await expect(
        publicResolver.write.setTrustedReverseRegistrar([next], {
          account: accounts[0],
        }),
      )
        .toEmitEvent('TrustedReverseRegistrarChanged')
        .withArgs({
          previous: getAddress(previous),
          next: getAddress(next),
        })

      await expect(
        publicResolver.read.trustedReverseRegistrar(),
      ).resolves.toEqualAddress(next)
    })

    it('setTrustedReverseRegistrar updates the slot — bypass takes effect for the new trusted address', async () => {
      const { publicResolver } = await loadFixture()
      const newRegistrar = accounts[5]

      // Initially accounts[5] is not the trusted reverse registrar.
      await expect(
        publicResolver.write.setAddr([targetNode, newRegistrar.address], {
          account: newRegistrar,
        }),
      ).toBeRevertedWithoutReason()

      // Owner rotates the trusted reverse registrar.
      await publicResolver.write.setTrustedReverseRegistrar(
        [newRegistrar.address],
        { account: accounts[0] },
      )

      // accounts[5] can now bypass authorisation.
      await publicResolver.write.setAddr([targetNode, newRegistrar.address], {
        account: newRegistrar,
      })
      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(newRegistrar.address)
    })
  })

  describe('multicall', async () => {
    const urlValue = 'https://ethereum.org/'

    it('allows setting multiple fields', async () => {
      const { publicResolver } = await loadFixture()

      const setAddrCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setAddr',
        args: [targetNode, accounts[1].address],
      })
      const setTextCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setText',
        args: [targetNode, 'url', urlValue],
      })

      const tx = publicResolver.write.multicall([[setAddrCall, setTextCall]])

      await expect(tx)
        .toEmitEvent('AddrChanged')
        .withArgs({ node: targetNode, a: getAddress(accounts[1].address) })
      await expect(tx).toEmitEvent('AddressChanged').withArgs({
        node: targetNode,
        coinType: 60n,
        newAddress: accounts[1].address,
      })
      await expect(tx)
        .toEmitEvent('TextChanged')
        .withArgs({
          node: targetNode,
          indexedKey: keccak256(stringToHex('url')),
          key: 'url',
          value: urlValue,
        })

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(urlValue)
    })

    it('allows reading multiple fields', async () => {
      const { publicResolver } = await loadFixture()

      await publicResolver.write.setAddr([targetNode, accounts[1].address])
      await publicResolver.write.setText([targetNode, 'url', urlValue])

      const addrCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'addr',
        args: [targetNode],
      })
      const textCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'text',
        args: [targetNode, 'url'],
      })

      const {
        result: [addrResult, textResult],
      } = await publicResolver.simulate.multicall([[addrCall, textCall]])

      const decodedAddr = decodeFunctionResult<
        (typeof publicResolver)['abi'],
        'addr',
        [Hex]
      >({
        abi: publicResolver.abi,
        functionName: 'addr',
        args: [targetNode],
        data: addrResult,
      })
      const decodedText = decodeFunctionResult({
        abi: publicResolver.abi,
        functionName: 'text',
        data: textResult,
      })

      expect(decodedAddr).toEqualAddress(accounts[1].address)
      expect(decodedText).toEqual(urlValue)
    })

    // NEW: multicallWithNodeCheck coverage (Open Question 5 + Pitfall 4
    // mitigation + 04-VALIDATION row 04-01-03). Confirms the calldata-slice
    // node-check is wired and rejects cross-name escalation.
    it('multicallWithNodeCheck succeeds when all inner calls match the nodehash', async () => {
      const { publicResolver } = await loadFixture()

      const setAddrCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setAddr',
        args: [targetNode, accounts[1].address],
      })
      const setTextCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setText',
        args: [targetNode, 'url', urlValue],
      })

      await publicResolver.write.multicallWithNodeCheck([
        targetNode,
        [setAddrCall, setTextCall],
      ])

      await expect(
        publicResolver.read.addr([targetNode]) as Promise<Address>,
      ).resolves.toEqualAddress(accounts[1].address)
      await expect(
        publicResolver.read.text([targetNode, 'url']),
      ).resolves.toEqual(urlValue)
    })

    it('multicallWithNodeCheck reverts when an inner call has a mismatched namehash', async () => {
      const { publicResolver } = await loadFixture()

      const otherNode = namehash('other.rise')
      const setAddrCall = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setAddr',
        args: [targetNode, accounts[1].address],
      })
      const setTextCallOtherNode = encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setText',
        args: [otherNode, 'url', urlValue],
      })

      await expect(
        publicResolver.write.multicallWithNodeCheck([
          targetNode,
          [setAddrCall, setTextCallOtherNode],
        ]),
      ).toBeRevertedWithString(
        'multicall: All records must have a matching namehash',
      )
    })
  })
})
