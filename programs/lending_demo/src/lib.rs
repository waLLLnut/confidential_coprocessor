// programs/lending_demo/src/lib.rs
use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, Mint, Token, TokenAccount, Transfer},
    associated_token::AssociatedToken,
};
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    keccak::hashv,
    program::invoke,
    hash::hash,
};

declare_id!("7416mML15yRamg6KTbemgwBZDsXoVmws328Tp8W7Za9y");

pub mod coproc_iface {
    use super::*;
    anchor_lang::declare_id!("9FWBcP2fTpjvYpSQmZZm2NkouBifLw5rKtNPyfzkA4zJ");

    #[account]
    pub struct Config {
        pub authority: Pubkey,
        pub executor: Pubkey,
        pub challenge_window_slots: u64,
        pub bump: u8,
    }

    #[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
    #[repr(u8)]
    pub enum JobStatus { Submitted=0, Posted=1, Finalized=2, Revealed=3 }

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

    pub fn disc(name: &str) -> [u8; 8] {
        let h = hash(format!("global:{}", name).as_bytes()).to_bytes();
        let mut d = [0u8; 8]; 
        d.copy_from_slice(&h[..8]); 
        d
    }

    #[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
    pub struct SubmitJobInlineArgs {
        pub commitment: [u8; 32],
        pub da_ptr_hash: Option<[u8; 32]>,
        pub reveal_after_slot: u64,
        pub function_id: u16,
        pub context_data: [u8; 32],
        pub ir_bytes: Vec<u8>,
    }
}

// OracleSnapshot mirror for reading from coprocessor
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleSnapshotMirror {
    pub oracle_program: Pubkey,
    pub feed: Pubkey,
    pub price_e9: i64,
    pub conf_e9: u64,
    pub observed_slot: u64,
    pub ptr_hash: [u8; 32],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct JobMirror {
    pub commitment: [u8; 32],
    pub da_ptr_hash: Option<[u8; 32]>,
    pub expected_code_digest: [u8; 32],
    pub result_commitment: Option<[u8; 32]>,
    pub external_ptr_hash: Option<[u8; 32]>,
    pub status: u8, // JobStatus as u8
    pub posted_slot: Option<u64>,
    pub reveal_after_slot: u64,
    pub function_id: u16,
    pub context_data: [u8; 32],
    pub submitter: Pubkey,
    pub bump: u8,
}

// Local oracle hash computation for verification
fn oracle_ptr_hash_local(op:&Pubkey, feed:&Pubkey, p:i64, c:u64, s:u64)->[u8;32]{
    anchor_lang::solana_program::keccak::hashv(&[
        b"oracle-snap-v1", op.as_ref(), feed.as_ref(),
        &p.to_le_bytes(), &c.to_le_bytes(), &s.to_le_bytes()
    ]).to_bytes()
}

// Function IDs for coprocessor job types
pub const FID_DEPOSIT:  u16 = 100;
pub const FID_BORROW:   u16 = 200;
pub const FID_WITHDRAW: u16 = 300;
pub const FID_LIQ_ELIGIBILITY: u16 = 400;

// IR operation codes (matching executor/wrapper format)
pub const OP_ADD: u8 = 0x01;
pub const OP_SUB: u8 = 0x02;
pub const OP_MUL: u8 = 0x03;      // Not implemented yet
pub const OP_MUL_CST: u8 = 0x04;
pub const OP_GTE: u8 = 0x10;      // Fixed: was 0x05, should be 0x10

// IR bytecode builders for different operations
pub fn build_deposit_ir() -> Vec<u8> {
    vec![
        OP_ADD,
        0x00, // dst=0 (result register)
        0x01, // src1=1 (current balance)  
        0x02, // src2=2 (deposit amount)
    ]
}

pub fn build_borrow_ir(ltv_basis_points: u32) -> Vec<u8> {
    let mut ir = Vec::new();
    
    // Step 1: MulCst - debt * ltv_ratio → temp register 3  
    ir.push(OP_MUL_CST);
    ir.push(0x03); // dst=3 (temp register)
    ir.push(0x02); // src=2 (debt amount)
    ir.push(0x00); // unused
    ir.extend_from_slice(&ltv_basis_points.to_le_bytes()); // 4-byte constant
    
    // Step 2: GTE - collateral >= required_collateral
    ir.push(OP_GTE);
    ir.push(0x00); // dst=0 (result register)
    ir.push(0x01); // src1=1 (collateral value)
    ir.push(0x03); // src2=3 (debt * ltv_ratio)
    
    ir
}

pub fn build_withdraw_ir() -> Vec<u8> {
    vec![
        OP_SUB,
        0x00, // dst=0 (result register)
        0x01, // src1=1 (current balance)
        0x02, // src2=2 (withdraw amount) 
    ]
}

pub fn build_liq_eligibility_ir(min_collateral_ratio_bp: u32) -> Vec<u8> {
    let mut ir = Vec::new();
    
    // Step 1: MulCst - debt * min_collateral_ratio → temp register 3
    ir.push(OP_MUL_CST);
    ir.push(0x03); // dst=3 (temp register)
    ir.push(0x02); // src=2 (debt amount)
    ir.push(0x00); // unused
    ir.extend_from_slice(&min_collateral_ratio_bp.to_le_bytes()); // 4-byte constant
    
    // Step 2: GTE - collateral >= minimum_required
    ir.push(OP_GTE);
    ir.push(0x00); // dst=0 (result register - liquidation eligible)
    ir.push(0x01); // src1=1 (collateral value)
    ir.push(0x03); // src2=3 (debt * min_ratio)
    
    ir
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CpiSubmitJobCommonArgs {
    pub commitment: [u8; 32],
    pub da_ptr_hash: Option<[u8; 32]>,
    pub reveal_after_slot: u64,
    pub context_data: [u8; 32],
}

impl CpiSubmitJobCommonArgs {
    pub fn create_deposit_context(user: &Pubkey, mint: &Pubkey, amount: u64, nonce: u64) -> [u8; 32] {
        hashv(&[
            b"deposit-v1",
            crate::ID.as_ref(),
            user.as_ref(),
            mint.as_ref(),
            &amount.to_le_bytes(),
            &nonce.to_le_bytes(),
        ]).to_bytes()
    }

    pub fn create_borrow_context(user: &Pubkey, mint: &Pubkey, amount: u64, nonce: u64) -> [u8; 32] {
        hashv(&[
            b"borrow-v1",
            crate::ID.as_ref(),
            user.as_ref(),
            mint.as_ref(),
            &amount.to_le_bytes(),
            &nonce.to_le_bytes(),
        ]).to_bytes()
    }

    pub fn create_withdraw_context(user: &Pubkey, mint: &Pubkey, amount: u64, nonce: u64) -> [u8; 32] {
        hashv(&[
            b"withdraw-v1",
            crate::ID.as_ref(),
            user.as_ref(),
            mint.as_ref(),
            &amount.to_le_bytes(),
            &nonce.to_le_bytes(),
        ]).to_bytes()
    }

    pub fn create_oracle_anchored_ctx(
        tag: &'static [u8],
        user: &Pubkey,
        mint: &Pubkey,
        amount: u64,
        nonce: u64,
        oracle_program: &Pubkey,
        feed: &Pubkey,
        observed_slot: u64,
        conf_band_bp: u16,
        staleness_limit_slots: u64,
    ) -> [u8; 32] {
        hashv(&[
            tag,
            crate::ID.as_ref(),
            user.as_ref(),
            mint.as_ref(),
            &amount.to_le_bytes(),
            &nonce.to_le_bytes(),
            oracle_program.as_ref(),
            feed.as_ref(),
            &observed_slot.to_le_bytes(),
            &conf_band_bp.to_le_bytes(),
            &staleness_limit_slots.to_le_bytes(),
        ]).to_bytes()
    }
}

#[program]
pub mod lending_demo {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> { Ok(()) }

    pub fn ensure_vault(_ctx: Context<EnsureVault>) -> Result<()> { Ok(()) }

    pub fn deposit_and_submit_job(
        ctx: Context<DepositAndSubmit>,
        amount: u64,
        base: CpiSubmitJobCommonArgs,
    ) -> Result<()> {
        // Transfer tokens from user to vault
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        // Submit deposit job to coprocessor
        let deposit_ir = build_deposit_ir();
        cpi_submit_job_inline(
            &ctx.accounts.coproc_program.to_account_info(),
            &ctx.accounts.coproc_config.to_account_info(),
            &ctx.accounts.coproc_job.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            base.commitment,
            base.da_ptr_hash,
            base.reveal_after_slot,
            FID_DEPOSIT,
            base.context_data,
            deposit_ir,
        )
    }

    pub fn submit_borrow_job(
        ctx: Context<CpiSubmitJob>, 
        base: CpiSubmitJobCommonArgs,
        ltv_basis_points: u32,
    ) -> Result<()> {
        let borrow_ir = build_borrow_ir(ltv_basis_points);
        cpi_submit_job_inline(
            &ctx.accounts.coproc_program.to_account_info(),
            &ctx.accounts.coproc_config.to_account_info(),
            &ctx.accounts.coproc_job.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            base.commitment,
            base.da_ptr_hash,
            base.reveal_after_slot,
            FID_BORROW,
            base.context_data,
            borrow_ir,
        )
    }

    pub fn submit_withdraw_job(ctx: Context<CpiSubmitJob>, base: CpiSubmitJobCommonArgs) -> Result<()> {
        let withdraw_ir = build_withdraw_ir();
        cpi_submit_job_inline(
            &ctx.accounts.coproc_program.to_account_info(),
            &ctx.accounts.coproc_config.to_account_info(),
            &ctx.accounts.coproc_job.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            base.commitment,
            base.da_ptr_hash,
            base.reveal_after_slot,
            FID_WITHDRAW,
            base.context_data,
            withdraw_ir,
        )
    }

    pub fn submit_liq_eligibility_job(
        ctx: Context<CpiSubmitJob>,
        base: CpiSubmitJobCommonArgs,
        min_collateral_ratio_bp: u32,
    ) -> Result<()> {
        let ir = build_liq_eligibility_ir(min_collateral_ratio_bp);
        cpi_submit_job_inline(
            &ctx.accounts.coproc_program.to_account_info(),
            &ctx.accounts.coproc_config.to_account_info(),
            &ctx.accounts.coproc_job.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            base.commitment,
            base.da_ptr_hash,
            base.reveal_after_slot,
            FID_LIQ_ELIGIBILITY,
            base.context_data,
            ir,
        )
    }

    pub fn execute_withdraw(
        ctx: Context<ExecuteWithdraw>,
        amount: u64,
    ) -> Result<()> {
        require!(ctx.accounts.coproc_job.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        require!(ctx.accounts.coproc_config.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        
        let job_data = ctx.accounts.coproc_job.try_borrow_data()?;
        let job = coproc_iface::Job::try_deserialize(&mut &job_data[8..])?;
        
        let user = &ctx.accounts.user;
        let mint = &ctx.accounts.mint;

        // Validate job status and type
        require!(matches!(job.status, coproc_iface::JobStatus::Finalized), LendErr::JobNotFinal);
        require!(job.function_id == FID_WITHDRAW, LendErr::BadFunction);
        require_keys_eq!(job.submitter, user.key(), LendErr::NotJobSubmitter);
        
        // Validate IR digest to prevent malicious executor
        let expected_digest = anchor_lang::solana_program::hash::hash(&build_withdraw_ir()).to_bytes();
        require!(job.expected_code_digest == expected_digest, LendErr::BadIRDigest);

        // Validate context binding
        let expected_ctx = CpiSubmitJobCommonArgs::create_withdraw_context(
            &user.key(),
            &mint.key(),
            amount,
            0 // Fixed nonce for demo
        );
        require!(job.context_data == expected_ctx, LendErr::BadContextData);

        // Check vault balance
        let vault = &ctx.accounts.vault;
        require!(vault.amount >= amount, LendErr::InsufficientVaultBalance);

        // Transfer tokens from vault to user
        let mint_key = mint.key();
        let bump = ctx.bumps.vault_authority;
        let signer_seeds: &[&[u8]] = &[b"vault-auth", mint_key.as_ref(), &[bump]];
        let signer = &[signer_seeds];

        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi, amount)?;
        
        Ok(())
    }

    pub fn execute_liquidation(
        ctx: Context<ExecuteLiquidation>,
        amount: u64,
    ) -> Result<()> {
        require!(ctx.accounts.coproc_job.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        require!(ctx.accounts.coproc_config.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);

        // Load and validate coprocessor job
        let job_data = ctx.accounts.coproc_job.try_borrow_data()?;
        require!(job_data.len() >= 8, LendErr::JobDeserializeFail);
        
        let job = JobMirror::deserialize(&mut &job_data[8..])?;
        
        // Validate job status and type
        require!(job.status == 2, LendErr::JobNotFinalized);
        require!(job.function_id == 400, LendErr::WrongJobFunction);
        require!(job.external_ptr_hash.is_some(), LendErr::MissingExternalPtr);
        
        let external_ptr_hash = job.external_ptr_hash.unwrap();

        // Load and validate oracle snapshot
        let snap_info = &ctx.accounts.oracle_snapshot;
        require!(snap_info.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        let snap_data = snap_info.try_borrow_data()?;
        require!(snap_data.len() >= 8, LendErr::SnapshotDeserializeFail);
        let snap = OracleSnapshotMirror::deserialize(&mut &snap_data[8..])?;

        // Verify job external_ptr_hash matches snapshot ptr_hash
        require!(external_ptr_hash == snap.ptr_hash, LendErr::SnapshotHashMismatch);
        
        // Verify snapshot integrity by recomputing hash locally
        require!(
            snap.ptr_hash == oracle_ptr_hash_local(&snap.oracle_program, &snap.feed, snap.price_e9, snap.conf_e9, snap.observed_slot),
            LendErr::OraclePtrRehashMismatch
        );

        // Check snapshot freshness (300 slot window)
        let clock = Clock::get()?;
        require!(clock.slot.saturating_sub(snap.observed_slot) <= 300, LendErr::OracleStale);

        // Execute token transfer
        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.vault_authority;
        let signer_seeds: &[&[u8]] = &[b"vault-auth", mint_key.as_ref(), &[bump]];
        let signer = &[signer_seeds];

        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi, amount)?;
        Ok(())
    }

    pub fn emit_liq_ticket(ctx: Context<EmitLiqTicket>) -> Result<()> {
        require!(ctx.accounts.coproc_job.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        require!(ctx.accounts.coproc_config.owner == &coproc_iface::ID, LendErr::BadCoprocConfigOwner);
        
        let job_data = ctx.accounts.coproc_job.try_borrow_data()?;
        let job = coproc_iface::Job::try_deserialize(&mut &job_data[8..])?;
        
        require!(matches!(job.status, coproc_iface::JobStatus::Finalized), LendErr::JobNotFinal);
        require!(job.function_id == FID_LIQ_ELIGIBILITY, LendErr::BadFunction);

        let ticket_digest = job.result_commitment.unwrap_or([0u8; 32]);
        let clock = Clock::get()?;

        emit!(LiqTicket {
            job: ctx.accounts.coproc_job.key(),
            ticket_digest,
            asset_pair: *b"SOL/USDC\0\0\0\0\0\0\0\0",
            lot: 1_000_000_000,
            discount_bp: 500,
            deadline_slot: clock.slot + 150,
        });

        Ok(())
    }
}

/* ===== Events ===== */

#[event]
pub struct LiqTicket {
    pub job: Pubkey,
    pub ticket_digest: [u8; 32],  // = result_commitment
    pub asset_pair: [u8; 16],     // 간단한 식별자(예: "SOL/USDC\0...")
    pub lot: u64,
    pub discount_bp: u16,
    pub deadline_slot: u64,
}

/* ===== CPI 함수들 (무국적 모드) ===== */

/// 인라인 IR 모드 CPI - submit_job_inline 호출
fn cpi_submit_job_inline<'info>(
    coproc_program: &AccountInfo<'info>,
    coproc_config: &AccountInfo<'info>,
    coproc_job: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    commitment: [u8; 32],
    da_ptr_hash: Option<[u8; 32]>,
    reveal_after_slot: u64,
    function_id: u16,
    context_data: [u8; 32],
    ir_bytes: Vec<u8>,
) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(
        &[b"job", &commitment, user.key().as_ref()],
        &coproc_iface::ID
    );
    require_keys_eq!(expected, coproc_job.key(), LendErr::BadJobPda);

    let mut data = Vec::with_capacity(8 + 200 + ir_bytes.len());
    data.extend_from_slice(&coproc_iface::disc("submit_job_inline"));
    let args = coproc_iface::SubmitJobInlineArgs {
        commitment,
        da_ptr_hash,
        reveal_after_slot,
        function_id,
        context_data,
        ir_bytes,
    };
    data.extend_from_slice(&args.try_to_vec().map_err(|_| error!(LendErr::SerializeFail))?);

    let metas = vec![
        AccountMeta::new_readonly(coproc_config.key(), false),
        AccountMeta::new(coproc_job.key(), false),
        AccountMeta::new(user.key(), true),
        AccountMeta::new_readonly(system_program.key(), false),
    ];
    let ix = Instruction { program_id: coproc_iface::ID, accounts: metas, data };
    invoke(
        &ix,
        &[
            coproc_program.clone(),
            coproc_config.clone(),
            coproc_job.clone(),
            user.clone(),
            system_program.clone(),
        ],
    )?;
    Ok(())
}


/* ===== Accounts ===== */

#[account]
pub struct JobConsumed {} // 8바이트 discriminator만 - 존재 자체가 소비 마커

#[derive(Accounts)]
pub struct Initialize {}


#[derive(Accounts)]
pub struct EnsureVault<'info> {
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA authority (서명은 seeds로)
    #[account(seeds=[b"vault-auth", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// 유저별 vault = PDA("vault", mint, user)
    #[account(
        init_if_needed,
        payer = user,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [b"vault", mint.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// 입금 + CPI 제출
#[derive(Accounts)]
pub struct DepositAndSubmit<'info> {
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA authority
    #[account(seeds=[b"vault-auth", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds=[b"vault", mint.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// 유저의 소유 ATA (from)
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,

    // --- CPI 공통 ---
    /// CHECK: CoProcessor config account verified by owner constraint
    #[account(
        constraint = coproc_config.owner == &coproc_iface::id() @ LendErr::BadCoprocConfigOwner
    )]
    pub coproc_config: AccountInfo<'info>,
    /// CHECK: 아직 미생성 Job PDA (conf_coprocessor가 init)
    #[account(mut)]
    pub coproc_job: UncheckedAccount<'info>,
    /// CHECK: CPI 대상 프로그램 계정 (실행 가능 + 정확한 주소)
    #[account(executable, address = coproc_iface::id())]
    pub coproc_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>, // submitter + payer
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// 모든 CPI submit_*에서 공통으로 쓰는 계정 (무국적 모드)
#[derive(Accounts)]
pub struct CpiSubmitJob<'info> {
    /// CHECK: CoProcessor config account verified by owner constraint
    #[account(
        constraint = coproc_config.owner == &coproc_iface::id() @ LendErr::BadCoprocConfigOwner
    )]
    pub coproc_config: AccountInfo<'info>,
    /// CHECK: 미생성 Job PDA (conf_coprocessor가 init)
    #[account(mut)]
    pub coproc_job: UncheckedAccount<'info>,
    /// CHECK: CPI 대상 프로그램 계정
    #[account(executable, address = coproc_iface::id())]
    pub coproc_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>, // submitter + payer
    pub system_program: Program<'info, System>,
}

/// Withdraw 실행 (Finalized 검증 + 송금) - 1회성 소비 보장
#[derive(Accounts)]
pub struct ExecuteWithdraw<'info> {
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA authority
    #[account(seeds=[b"vault-auth", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// vault (from)
    #[account(
        mut,
        seeds=[b"vault", mint.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// user ATA (to)
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,

    // 컨피덴셜 Job/Config 읽기
    /// CHECK: Job account verified manually in function
    pub coproc_job: UncheckedAccount<'info>,
    /// CHECK: Config account verified manually in function  
    pub coproc_config: UncheckedAccount<'info>,

    /// Replay protection marker
    #[account(
        init,
        payer = user,
        space = 8,
        seeds = [b"job-consumed", coproc_job.key().as_ref()],
        bump
    )]
    pub job_consumed: Account<'info, JobConsumed>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA authority for vault
    #[account(seeds=[b"vault-auth", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds=[b"vault", mint.key().as_ref(), user.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user)]
    pub user_ata: Account<'info, TokenAccount>,

    /// CHECK: Coprocessor job account verified manually in function
    pub coproc_job: UncheckedAccount<'info>,
    /// CHECK: Coprocessor config account verified manually in function
    pub coproc_config: UncheckedAccount<'info>,

    /// CHECK: Oracle snapshot account verified manually in function
    pub oracle_snapshot: UncheckedAccount<'info>,

    #[account(
        init,
        payer = user,
        space = 8,
        seeds = [b"job-consumed", coproc_job.key().as_ref()],
        bump
    )]
    pub job_consumed: Account<'info, JobConsumed>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmitLiqTicket<'info> {
    /// CHECK: Job account verified manually in function
    pub coproc_job: UncheckedAccount<'info>,
    /// CHECK: Config account verified manually in function
    pub coproc_config: UncheckedAccount<'info>,
    pub user: Signer<'info>,
}

/* ===== Errors ===== */
#[error_code]
pub enum LendErr {
    #[msg("Job PDA mismatch for commitment")] BadJobPda,
    #[msg("Job is not finalized")] JobNotFinal,
    #[msg("Wrong function id for withdraw")] BadFunction,
    #[msg("Not the job submitter")] NotJobSubmitter,
    #[msg("Bad context data for withdraw")] BadContextData,
    #[msg("Serialize failed")] SerializeFail,
    #[msg("Insufficient vault balance")] InsufficientVaultBalance,
    #[msg("Expected IR digest mismatch")] BadIRDigest,
    #[msg("Coprocessor config account has wrong owner")] BadCoprocConfigOwner,
    #[msg("Failed to deserialize coprocessor job")] JobDeserializeFail,
    #[msg("Snapshot deserialize failed")] SnapshotDeserializeFail,
    #[msg("Missing external pointer hash on job")] MissingExternalPtr,
    #[msg("Oracle snapshot hash mismatch with job")] OraclePtrMismatch,
    #[msg("Oracle snapshot rehash mismatch")] OraclePtrRehashMismatch,
    #[msg("Oracle snapshot too stale")] OracleStale,
    #[msg("Job is not finalized")] JobNotFinalized,
    #[msg("Wrong job function ID")] WrongJobFunction,
    #[msg("Snapshot hash mismatch with job")] SnapshotHashMismatch,
}
