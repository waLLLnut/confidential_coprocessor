export type JobStatus = 'Submitted' | 'Posted' | 'Finalized';
export type FunctionId = 100 | 200 | 300 | 400;

export interface JobRow {
  pubkey: string;
  functionId: FunctionId;
  status: JobStatus;
  expectedCodeDigest: string; // 0x...
  resultCommitment?: string; // 0x...
  externalPtrHash?: string; // 0x...
  contextData: string; // 0x...
  submitter: string;
}

export interface OracleSnapshot {
  pda: string;
  oracleProgram: string;
  feed: string;
  priceE9: string; // decimal display: /1e9
  confE9: string;
  observedSlot: number;
  ptrHash: string; // 0x..
  fresh: boolean;
  timestamp?: number; // Added for freshness tracking
}

export interface ProgramEvent {
  type: 'JobSubmitted' | 'JobPosted' | 'JobFinalized' | 'OracleSnapshotRecorded' | 'MetricsPublished' | 'LiqTicket';
  data: any;
  slot: number;
  signature: string;
}

export interface CpiSubmitJobCommonArgs {
  commitment: number[];
  daPtrHash: number[] | null;
  revealAfterSlot: string;
  contextData: number[];
}

export const FUNCTION_NAMES: Record<FunctionId, string> = {
  100: 'DEPOSIT',
  200: 'BORROW',
  300: 'WITHDRAW',
  400: 'LIQ_ELIGIBILITY',
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  'Submitted': 'bg-gray-600',
  'Posted': 'bg-purple-600',
  'Finalized': 'bg-green-600',
};