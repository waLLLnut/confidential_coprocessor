// programs/confidential_coprocessor/src/lib.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hashv;

declare_id!("CCxx3Q6jHtuXDndGJ5xHndGmA9v5YZoAQN7rSK6GQX9S");

#[program]
pub mod conf_coprocessor {
    use super::*;

    /// 권한/실행자/챌린지 윈도우 초기화
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        executor: Pubkey,
        challenge_window_slots: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.executor = executor;
        config.challenge_window_slots = challenge_window_slots;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// 인라인 IR 모드 - 소형 IR 바이트를 직접 전달, 온체인에서 해시 계산
    pub fn submit_job_inline(
        ctx: Context<SubmitJob>,
        commitment: [u8; 32],
        da_ptr_hash: Option<[u8; 32]>,
        reveal_after_slot: u64,
        function_id: u16,
        context_data: [u8; 32],
        ir_bytes: Vec<u8>,
    ) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        // 크기 제한으로 DoS 방어 (2KB 제한)
        const MAX_IR_BYTES: usize = 2048;
        require!(ir_bytes.len() <= MAX_IR_BYTES, ErrorCode::IrTooLarge);

        // 온체인에서 IR 해시 계산
        let digest = anchor_lang::solana_program::hash::hash(&ir_bytes).to_bytes();

        // Job 초기화
        job.commitment = commitment;
        job.da_ptr_hash = da_ptr_hash;
        job.expected_code_digest = digest;
        job.result_commitment = None;
        job.external_ptr_hash = None;
        job.status = JobStatus::Submitted;
        job.posted_slot = None;
        job.reveal_after_slot = reveal_after_slot;
        job.function_id = function_id;
        job.context_data = context_data;
        job.submitter = ctx.accounts.submitter.key();
        job.bump = ctx.bumps.job;

        emit!(JobSubmitted {
            job: job.key(),
            submitter: job.submitter,
            commitment,
            da_ptr_hash,
            expected_code_digest: digest,
            function_id,
            context_data,
            slot: clock.slot,
        });
        Ok(())
    }


    /// 실행자가 결정적 결과 커밋을 게시
    pub fn post_result(
        ctx: Context<PostResult>,
        result_commitment: [u8; 32],
        code_digest_again: [u8; 32],
        external_ptr_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::Submitted, ErrorCode::InvalidJobStatus);
        require!(code_digest_again == job.expected_code_digest, ErrorCode::CodeDigestMismatch);

        // LIQ eligibility job이면 snapshot 필수 (FID_LIQ_ELIGIBILITY = 400)
        if job.function_id == 400 {
            require!(external_ptr_hash.is_some(), ErrorCode::MissingSnapshotHash);
            require!(ctx.remaining_accounts.len() >= 1, ErrorCode::MissingSnapshot);
            
            // Verify snapshot account owner and deserialize
            let snap_info = &ctx.remaining_accounts[0];
            require!(snap_info.owner == &crate::ID, ErrorCode::MissingSnapshot);
            let snap_data = snap_info.try_borrow_data()?;
            require!(snap_data.len() >= 8, ErrorCode::MissingSnapshot);
            let snap = OracleSnapshot::deserialize(&mut &snap_data[8..])?;
            let eph = external_ptr_hash.unwrap();
            require!(eph == snap.ptr_hash, ErrorCode::SnapshotHashMismatch);
        }

        job.result_commitment = Some(result_commitment);
        job.external_ptr_hash = external_ptr_hash;
        job.status = JobStatus::Posted;
        job.posted_slot = Some(clock.slot);

        emit!(JobPosted {
            job: job.key(),
            result_commitment,
            code_digest: code_digest_again,
            external_ptr_hash,
            posted_slot: clock.slot,
        });
        Ok(())
    }

    /// 짧은 챌린지 윈도우 경과 후 누구나 파이널라이즈
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let config = &ctx.accounts.config;
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::Posted, ErrorCode::InvalidJobStatus);
        let posted_slot = job.posted_slot.ok_or(ErrorCode::MissingPostedSlot)?;
        require!(clock.slot >= posted_slot + config.challenge_window_slots, ErrorCode::ChallengeWindowNotPassed);

        job.status = JobStatus::Finalized;
        emit!(JobFinalized { job: job.key(), slot: clock.slot });
        Ok(())
    }

    /// 30초 지표 발행 - executor 전용 (상태 저장 없이 이벤트만)
    pub fn publish_metrics(
        _ctx: Context<PublishMetrics>,
        window_start_slot: u64,
        tvl: u64,
        utilization_bp: u16,
        total_users: u32,
        proof_ptr_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        emit!(MetricsPublished { 
            window_start_slot, 
            tvl, 
            utilization_bp, 
            total_users, 
            proof_ptr_hash 
        });
        Ok(())
    }

    /// Record oracle price snapshot at specific slot
    pub fn record_oracle_snapshot(
        ctx: Context<RecordOracleSnapshot>,
        oracle_program: Pubkey,
        feed: Pubkey,
        price_e9: i64,
        conf_e9: u64,
        observed_slot: u64,
    ) -> Result<()> {
        // Validate oracle program key matches
        require_keys_eq!(ctx.accounts.oracle_program_acc.key(), oracle_program, ErrorCode::BadOracleProgram);

        // Initialize the snapshot account
        let snapshot = &mut ctx.accounts.snapshot;
        let ptr_hash = oracle_ptr_hash(&oracle_program, &feed, price_e9, conf_e9, observed_slot);
        
        snapshot.oracle_program = oracle_program;
        snapshot.feed = feed;
        snapshot.price_e9 = price_e9;
        snapshot.conf_e9 = conf_e9;
        snapshot.observed_slot = observed_slot;
        snapshot.ptr_hash = ptr_hash;
        snapshot.bump = ctx.bumps.snapshot;

        emit!(OracleSnapshotRecorded {
            snapshot: ctx.accounts.snapshot.key(),
            oracle_program, 
            feed, 
            price_e9, 
            conf_e9, 
            observed_slot, 
            ptr_hash
        });
        Ok(())
    }

}

/* ========== Helper Functions ========== */
fn oracle_ptr_hash(
    oracle_program: &Pubkey,
    feed: &Pubkey,
    price_e9: i64,
    conf_e9: u64,
    observed_slot: u64,
) -> [u8; 32] {
    hashv(&[
        b"oracle-snap-v1",
        oracle_program.as_ref(),
        feed.as_ref(),
        &price_e9.to_le_bytes(),
        &conf_e9.to_le_bytes(),
        &observed_slot.to_le_bytes(),
    ]).to_bytes()
}

/* ========== Accounts ========== */

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = payer, space = 8 + Config::SIZE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(commitment: [u8;32])]
pub struct SubmitJob<'info> {
    #[account(seeds=[b"config"], bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = submitter,
        space = 8 + Job::SIZE,
        seeds = [b"job", commitment.as_ref(), submitter.key().as_ref()],
        bump
    )]
    pub job: Account<'info, Job>,
    #[account(mut)]
    pub submitter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostResult<'info> {
    #[account(
        mut,
        seeds=[b"job", &job.commitment, job.submitter.as_ref()],
        bump=job.bump
    )]
    pub job: Account<'info, Job>,
    #[account(
        seeds=[b"config"],
        bump=config.bump,
        constraint = config.executor == executor.key() @ ErrorCode::UnauthorizedExecutor
    )]
    pub config: Account<'info, Config>,
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(seeds=[b"config"], bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds=[b"job", &job.commitment, job.submitter.as_ref()],
        bump=job.bump
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct PublishMetrics<'info> {
    #[account(
        seeds=[b"config"],
        bump=config.bump,
        constraint = config.executor == executor.key() @ ErrorCode::UnauthorizedExecutor
    )]
    pub config: Account<'info, Config>,
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(oracle_program: Pubkey, feed: Pubkey, price_e9: i64, conf_e9: u64, observed_slot: u64)]
pub struct RecordOracleSnapshot<'info> {
    #[account(seeds=[b"config"], bump=config.bump,
        constraint = config.executor == recorder.key() @ ErrorCode::UnauthorizedExecutor)]
    pub config: Account<'info, Config>,
    /// CHECK: 오라클 프로그램 주소 (owner 체크만)
    pub oracle_program_acc: UncheckedAccount<'info>,
    /// CHECK: 피드(어그리게이터) 계정
    pub feed_acc: UncheckedAccount<'info>,
    
    #[account(
        init,
        payer = recorder,
        space = 8 + OracleSnapshot::SIZE,
        seeds = [
            b"oraclesnap",
            oracle_program.as_ref(),
            feed.as_ref(),
            &observed_slot.to_le_bytes()
        ],
        bump
    )]
    pub snapshot: Account<'info, OracleSnapshot>,

    #[account(mut)]
    pub recorder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/* ========== State ========== */

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub executor: Pubkey,
    pub challenge_window_slots: u64,
    pub bump: u8,
}
impl Config {
    // authority(32) + executor(32) + challenge_window_slots(8) + bump(1)
    // = 32 + 32 + 8 + 1 = 73 bytes
    pub const SIZE: usize = 73;
}

#[account]
pub struct Job {
    pub commitment: [u8; 32],
    pub da_ptr_hash: Option<[u8; 32]>,
    pub expected_code_digest: [u8; 32],
    pub result_commitment: Option<[u8; 32]>,
    pub external_ptr_hash: Option<[u8; 32]>,
    pub status: JobStatus,
    pub posted_slot: Option<u64>,
    pub reveal_after_slot: u64,
    pub function_id: u16,
    pub context_data: [u8; 32],
    pub submitter: Pubkey,
    pub bump: u8,
}
impl Job {
    // commitment(32) + da_ptr_hash(1+32) + expected_code_digest(32)
    // + result_commitment(1+32) + external_ptr_hash(1+32) + status(1) + posted_slot(1+8)
    // + reveal_after_slot(8) + function_id(2) + context_data(32) + submitter(32) + bump(1)
    // = 32 +33 +32 +33 +33 +1 +9 +8 +2 +32 +32 +1 = 248
    pub const SIZE: usize = 248;
}

#[account]
#[derive(Default)]
pub struct OracleSnapshot {
    pub oracle_program: Pubkey,
    pub feed: Pubkey,
    pub price_e9: i64,        // 1e-9 단위
    pub conf_e9: u64,         // 1e-9 단위의 신뢰구간(선택)
    pub observed_slot: u64,
    pub ptr_hash: [u8; 32],   // 아래 hasher로 계산
    pub bump: u8,
}
impl OracleSnapshot {
    // 32+32+8+8+8+32+1 = 121 bytes
    pub const SIZE: usize = 121;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum JobStatus { Submitted=0, Posted=1, Finalized=2, Revealed=3 }


/* ========== Accounts ========== */





/* ========== Events ========== */

#[event]
pub struct JobSubmitted {
    pub job: Pubkey,
    pub submitter: Pubkey,
    pub commitment: [u8; 32],
    pub da_ptr_hash: Option<[u8; 32]>,
    pub expected_code_digest: [u8; 32],
    pub function_id: u16,
    pub context_data: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct JobPosted {
    pub job: Pubkey,
    pub result_commitment: [u8; 32],
    pub code_digest: [u8; 32],
    pub external_ptr_hash: Option<[u8; 32]>,
    pub posted_slot: u64,
}

#[event] pub struct JobFinalized { pub job: Pubkey, pub slot: u64 }

#[event]
pub struct MetricsPublished {
    pub window_start_slot: u64,
    pub tvl: u64,
    pub utilization_bp: u16,
    pub total_users: u32,
    pub proof_ptr_hash: Option<[u8; 32]>,
}

#[event]
pub struct OracleSnapshotRecorded {
    pub snapshot: Pubkey,
    pub oracle_program: Pubkey,
    pub feed: Pubkey,
    pub price_e9: i64,
    pub conf_e9: u64,
    pub observed_slot: u64,
    pub ptr_hash: [u8; 32],
}

/* ========== Errors ========== */

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid job status")] InvalidJobStatus,
    #[msg("Code digest mismatch")] CodeDigestMismatch,
    #[msg("Unauthorized executor")] UnauthorizedExecutor,
    #[msg("Challenge window not passed")] ChallengeWindowNotPassed,
    #[msg("Posted slot missing")] MissingPostedSlot,
    #[msg("IR bytes too large")] IrTooLarge,
    #[msg("Oracle program mismatch")] BadOracleProgram,
    #[msg("Oracle feed owner mismatch")] BadOracleFeedOwner,
    #[msg("Missing oracle snapshot account")] MissingSnapshot,
    #[msg("Missing oracle snapshot hash")] MissingSnapshotHash,
    #[msg("Snapshot hash mismatch")] SnapshotHashMismatch,
    #[msg("Invalid PDA")] InvalidPDA,
    #[msg("Account already initialized")] AccountAlreadyInitialized,
}
