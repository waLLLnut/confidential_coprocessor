// Auto-initialize config after deployment (like Ethereum constructor)

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

module.exports = async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider with proper commitment
  const connection = new anchor.web3.Connection(
    provider.connection.rpcEndpoint,
    { commitment: 'confirmed' }
  );
  
  const wallet = provider.wallet;
  const newProvider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed'
  });
  
  anchor.setProvider(newProvider);

  console.log("🚀 Post-deployment initialization...");
  
  const coproc = anchor.workspace.confCoprocessor;
  
  // Find config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    coproc.programId
  );
  
  try {
    // Check if config already exists
    await coproc.account.config.fetch(configPda);
    console.log("✅ Config already initialized:", configPda.toBase58());
    return;
  } catch (e) {
    // Config doesn't exist, initialize it
    console.log("🔧 Initializing config...");
  }
  
  try {
    // Initialize with deployer as both authority and executor
    const tx = await coproc.methods
      .initializeConfig(
        provider.wallet.publicKey, // executor = deployer
        new anchor.BN(0) // challenge_window_slots = 0 for demo
      )
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
      
    console.log("✅ Config initialized!");
    console.log("   Config PDA:", configPda.toBase58());
    console.log("   Authority:", provider.wallet.publicKey.toBase58());
    console.log("   Executor:", provider.wallet.publicKey.toBase58());
    console.log("   TX:", tx);
    
  } catch (error) {
    console.error("❌ Config initialization failed:", error);
    throw error;
  }
};
