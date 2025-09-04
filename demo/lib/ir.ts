// IR operation codes
export const OP_ADD = 0x01;
export const OP_SUB = 0x02;
export const OP_MUL = 0x03;
export const OP_MUL_CST = 0x04;
export const OP_GTE = 0x05;

// IR bytecode builders for different operations (must match Rust exactly)
export function buildDepositIr(): Uint8Array {
  return Uint8Array.from([
    OP_ADD,
    0x00, 0x01, // input[0] (balance)
    0x00, 0x02, // input[1] (amount)
    0x00, 0x00, // output[0] (result)
  ]);
}

export function buildWithdrawIr(): Uint8Array {
  return Uint8Array.from([
    OP_SUB,
    0x00, 0x01, // input[0] (balance)
    0x00, 0x02, // input[1] (amount)
    0x00, 0x00, // output[0] (result)
  ]);
}

export function buildBorrowIr(ltv_bp: number): Uint8Array {
  const b = new Uint8Array(1 + 2 + 4 + 2 + 2);
  b.set([OP_GTE, 0x00, 0x01]); // opcode + input[0]
  new DataView(b.buffer).setUint32(3, ltv_bp, true); // little-endian
  b.set([0x00, 0x02, 0x00, 0x00], 7); // input[1], output[0]
  return b;
}

export function buildLiqEligibilityIr(minCrBp: number): Uint8Array {
  // Same format as borrow
  return buildBorrowIr(minCrBp);
}

// Get IR for a specific function ID
export function getIrForFunction(functionId: number, params?: { ltv_bp?: number; min_cr_bp?: number }): Uint8Array {
  switch (functionId) {
    case 100: // DEPOSIT
      return buildDepositIr();
    case 200: // BORROW
      return buildBorrowIr(params?.ltv_bp || 5000);
    case 300: // WITHDRAW
      return buildWithdrawIr();
    case 400: // LIQ_ELIGIBILITY
      return buildLiqEligibilityIr(params?.min_cr_bp || 15000);
    default:
      return buildDepositIr(); // fallback
  }
}