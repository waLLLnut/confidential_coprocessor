import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Program IDs (replace with your actual deployed addresses)
export const COPROC_PROGRAM_ID = new PublicKey('9FWBcP2fTpjvYpSQmZZm2NkouBifLw5rKtNPyfzkA4zJ');
export const LENDING_PROGRAM_ID = new PublicKey('7416mML15yRamg6KTbemgwBZDsXoVmws328Tp8W7Za9y');

// Job PDA calculation
export function jobPdaFor(
  commitment: Uint8Array | number[],
  submitter: PublicKey,
  coprocId: PublicKey = COPROC_PROGRAM_ID
): PublicKey {
  const commitmentBuffer = Buffer.from(commitment);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('job'), commitmentBuffer, submitter.toBuffer()],
    coprocId
  )[0];
}

// Oracle snapshot PDA
export function oracleSnapPda(
  oracleProgram: PublicKey,
  feed: PublicKey,
  slot: number | BN,
  coprocId: PublicKey = COPROC_PROGRAM_ID
): PublicKey {
  const slotBN = typeof slot === 'number' ? new BN(slot) : slot;
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('oraclesnap'),
      oracleProgram.toBuffer(),
      feed.toBuffer(),
      slotBN.toArrayLike(Buffer, 'le', 8),
    ],
    coprocId
  )[0];
}

// Config PDA
export function configPda(coprocId: PublicKey = COPROC_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    coprocId
  )[0];
}

// Vault Authority PDA
export function vaultAuthPda(
  mint: PublicKey,
  lendingId: PublicKey = LENDING_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-auth'), mint.toBuffer()],
    lendingId
  )[0];
}

// Vault PDA
export function vaultPda(
  mint: PublicKey,
  user: PublicKey,
  lendingId: PublicKey = LENDING_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), mint.toBuffer(), user.toBuffer()],
    lendingId
  )[0];
}

// Job Consumed PDA (for replay protection)
export function jobConsumedPda(
  jobPda: PublicKey,
  lendingId: PublicKey = LENDING_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('job-consumed'), jobPda.toBuffer()],
    lendingId
  )[0];
}