import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';

// Helper to convert Buffer to fixed-size array
export function buf32(b: Buffer | Uint8Array): number[] {
  if (b.length !== 32) throw new Error('expected 32 bytes');
  return Array.from(b) as number[];
}

export function zeros32(): number[] {
  return new Array(32).fill(0) as number[];
}

// Oracle snapshot hash computation (must match on-chain exactly)
export function oraclePtrHash(
  oracleProgram: PublicKey | Uint8Array,
  feed: PublicKey | Uint8Array,
  priceE9: bigint,
  confE9: bigint,
  observedSlot: bigint
): string {
  // Convert PublicKey to bytes if necessary
  const oracleProgramBytes = oracleProgram instanceof PublicKey 
    ? oracleProgram.toBuffer() 
    : oracleProgram;
  const feedBytes = feed instanceof PublicKey 
    ? feed.toBuffer() 
    : feed;

  // Create LE bytes for numbers
  const priceBuf = new Uint8Array(8);
  new DataView(priceBuf.buffer).setBigInt64(0, priceE9, true);
  const confBuf = new Uint8Array(8);
  new DataView(confBuf.buffer).setBigUInt64(0, confE9, true);
  const slotBuf = new Uint8Array(8);
  new DataView(slotBuf.buffer).setBigUInt64(0, observedSlot, true);

  // Hash with keccak_256
  const h = keccak_256.create();
  h.update(new TextEncoder().encode('oracle-snap-v1'));
  h.update(oracleProgramBytes);
  h.update(feedBytes);
  h.update(priceBuf);
  h.update(confBuf);
  h.update(slotBuf);

  return `0x${Buffer.from(h.digest()).toString('hex')}`;
}

// Context data hash for jobs
export function createDepositContext(
  user: PublicKey,
  mint: PublicKey,
  amount: bigint,
  nonce: bigint,
  programId: PublicKey
): number[] {
  const h = keccak_256.create();
  h.update(new TextEncoder().encode('deposit-v1'));
  h.update(programId.toBuffer());
  h.update(user.toBuffer());
  h.update(mint.toBuffer());
  
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUInt64(0, amount, true);
  h.update(amountBuf);
  
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUInt64(0, nonce, true);
  h.update(nonceBuf);
  
  return buf32(h.digest());
}

export function createWithdrawContext(
  user: PublicKey,
  mint: PublicKey,
  amount: bigint,
  nonce: bigint,
  programId: PublicKey
): number[] {
  const h = keccak_256.create();
  h.update(new TextEncoder().encode('withdraw-v1'));
  h.update(programId.toBuffer());
  h.update(user.toBuffer());
  h.update(mint.toBuffer());
  
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUInt64(0, amount, true);
  h.update(amountBuf);
  
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUInt64(0, nonce, true);
  h.update(nonceBuf);
  
  return buf32(h.digest());
}

export function createBorrowContext(
  user: PublicKey,
  mint: PublicKey,
  amount: bigint,
  nonce: bigint,
  programId: PublicKey
): number[] {
  const h = keccak_256.create();
  h.update(new TextEncoder().encode('borrow-v1'));
  h.update(programId.toBuffer());
  h.update(user.toBuffer());
  h.update(mint.toBuffer());
  
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUInt64(0, amount, true);
  h.update(amountBuf);
  
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUInt64(0, nonce, true);
  h.update(nonceBuf);
  
  return buf32(h.digest());
}

// Generate random commitment
export function genCommitment(): number[] {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes);
}

// Compute SHA256 digest (for IR code)
export function computeCodeDigest(irBytes: Uint8Array): number[] {
  return buf32(sha256(irBytes));
}

// Format hash for display
export function formatHash(hash: string | number[]): string {
  if (typeof hash === 'string') {
    if (hash.startsWith('0x')) return hash;
    return `0x${hash}`;
  }
  return `0x${Buffer.from(hash).toString('hex')}`;
}

// Truncate hash for display
export function truncateHash(hash: string, length = 8): string {
  const formatted = formatHash(hash);
  return `${formatted.slice(0, length)}...${formatted.slice(-6)}`;
}