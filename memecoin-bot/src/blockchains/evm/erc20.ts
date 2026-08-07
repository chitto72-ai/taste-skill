import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

/** The only ERC-20 surface the bot needs; swaps go through the venue router. */
export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function owner() view returns (address)',
]);

export function encodeBalanceOf(owner: string): string {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [owner as `0x${string}`],
  });
}

export function encodeDecimals(): string {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'decimals' });
}

export function encodeTotalSupply(): string {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'totalSupply' });
}

export function encodeOwner(): string {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'owner' });
}

export function encodeApprove(spender: string, amount: bigint): string {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender as `0x${string}`, amount],
  });
}

export function decodeUint(data: string): bigint {
  if (!data || data === '0x') return 0n;
  return BigInt(data.length > 66 ? `0x${data.slice(2, 66)}` : data);
}

export function decodeDecimals(data: string): number {
  return Number(
    decodeFunctionResult({ abi: ERC20_ABI, functionName: 'decimals', data: data as `0x${string}` }),
  );
}

export function decodeAddress(data: string): string {
  if (!data || data.length < 66) return '0x0000000000000000000000000000000000000000';
  return `0x${data.slice(-40)}`;
}
