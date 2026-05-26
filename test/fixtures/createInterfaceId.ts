import {
  type Abi,
  type AbiFunction,
  bytesToHex,
  hexToBytes,
  toFunctionHash,
} from 'viem'

/**
 * Computes the ERC-165 interface ID for a Solidity ABI by XOR-ing the
 * 4-byte keccak256 selectors of every function entry per EIP-165.
 *
 * Ported verbatim from the ENS reference fixture
 * (`reference/ens-contracts/test/fixtures/createInterfaceId.ts`) so the
 * `InterfaceResolver.interfaceImplementer` fallback tests can pass
 * unchanged. Functionally identical to
 * `@ensdomains/hardhat-chai-matchers-viem/dist/utils/createInterfaceId.js`,
 * but kept local so the ported reference test file can reach it via
 * `../fixtures/createInterfaceId.js` (matching the reference's import shape).
 *
 * @param iface The ABI array of an interface (output of
 *              `hre.artifacts.readArtifact(name).abi`).
 * @returns The 4-byte ERC-165 interface ID as a `0x`-prefixed hex string.
 */
export const createInterfaceId = <iface extends Abi>(
  iface: iface,
): `0x${string}` => {
  const bytesId = iface
    .filter((item): item is AbiFunction => item.type === 'function')
    .map((f) => toFunctionHash(f))
    .map((h) => hexToBytes(h).slice(0, 4))
    .reduce((memo, bytes) => {
      for (let i = 0; i < 4; i++) {
        memo[i] = memo[i] ^ bytes[i]
      }
      return memo
    }, new Uint8Array(4))

  return bytesToHex(bytesId)
}
