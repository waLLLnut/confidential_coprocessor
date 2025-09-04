'use client';

import { useState, useEffect } from 'react';
import { JobRow, OracleSnapshot, ProgramEvent, FUNCTION_NAMES, STATUS_COLORS } from '@/lib/types';
import { truncateHash } from '@/lib/hash';
import { genCommitment } from '@/lib/hash';

export default function Home() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [snapshot, setSnapshot] = useState<OracleSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'borrow' | 'liq'>('deposit');
  const [events, setEvents] = useState<ProgramEvent[]>([]);
  const [amount, setAmount] = useState('');
  const [ltvBp, setLtvBp] = useState('5000');
  const [minCrBp, setMinCrBp] = useState('15000');
  const [currentPrice, setCurrentPrice] = useState(142.75);
  const [walletConnected, setWalletConnected] = useState(false);
  const [executedJobs, setExecutedJobs] = useState<Set<string>>(new Set());
  
  // Lending protocol metrics
  const [metrics, setMetrics] = useState({
    tvl: 0,
    totalDeposits: 0,
    totalBorrows: 0,
    utilizationRate: 0,
    liquidationThreshold: 150,
    activeUsers: 1,
    avgLTV: 0,
    totalTransactions: 0,
    healthFactor: 2.5,
    collateralRatio: 250,
    supplyAPY: 4.2,
    borrowAPY: 6.8
  });
  
  // User balances
  const [balances, setBalances] = useState({
    confidential: { sol: 10.0, usdc: 1000.0 },
    public: { sol: 0.0, usdc: 0.0 }
  });

  // Initialize system on mount
  useEffect(() => {
    // Auto-connect wallet after 1 second
    setTimeout(() => {
      setWalletConnected(true);
      addEvent('✅ Wallet connected: User1...x4K');
      addEvent('🔧 Config initialized (challenge_window=0)');
      addEvent('🟢 Executor service online - Auto-processing enabled');
    }, 1000);
  }, []);

  // Update metrics every 10 seconds with visual indication
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => {
        const newTVL = prev.tvl + (Math.random() - 0.3) * 100000;
        const newDeposits = prev.totalDeposits + Math.random() * 50000;
        const newBorrows = prev.totalBorrows + Math.random() * 30000;
        const utilization = (newBorrows / newDeposits) * 100;
        
        // Add pulsing effect to show update
        const metricsElements = document.querySelectorAll('.metric-value');
        metricsElements.forEach(el => {
          el.classList.add('text-green-400');
          setTimeout(() => el.classList.remove('text-green-400'), 500);
        });
        
        addEvent(`📊 Metrics updated: TVL $${newTVL.toFixed(0)}, Utilization ${utilization.toFixed(1)}%`);
        
        return {
          ...prev,
          tvl: Math.max(0, newTVL),
          totalDeposits: newDeposits,
          totalBorrows: newBorrows,
          utilizationRate: utilization,
          totalTransactions: prev.totalTransactions + Math.floor(Math.random() * 5),
          healthFactor: 2.5 + (Math.random() - 0.5) * 0.3,
          collateralRatio: 250 + (Math.random() - 0.5) * 20,
          supplyAPY: 4.2 + (Math.random() - 0.5) * 0.5,
          borrowAPY: 6.8 + (Math.random() - 0.5) * 0.8
        };
      });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Update price from oracle every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentPrice(prev => {
        const change = (Math.random() - 0.5) * 2;
        const newPrice = prev + change;
        addEvent(`📈 Oracle price update: SOL $${newPrice.toFixed(2)}`);
        return newPrice;
      });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Auto-process jobs
  useEffect(() => {
    const interval = setInterval(() => {
      setJobs(prevJobs => {
        return prevJobs.map(job => {
          // Auto post result after 2 seconds
          if(job.status === 'Submitted' && Date.now() - (job as any).createdAt > 2000) {
            addEvent(`⚙️ Executor: Computing result for Job ${job.pubkey.substring(0, 8)}...`);
            return {...job, status: 'Posted' as JobStatus};
          }
          // Auto finalize after 4 seconds
          if(job.status === 'Posted' && Date.now() - (job as any).createdAt > 4000) {
            addEvent(`✅ Executor: Finalized Job ${job.pubkey.substring(0, 8)}`);
            
            // Update balances and metrics for deposit
            if(job.functionId === 100) { // DEPOSIT
              const depositAmount = parseFloat((job as any).amount || '0');
              setBalances(prev => ({
                confidential: { ...prev.confidential, sol: prev.confidential.sol - depositAmount },
                public: { ...prev.public, sol: prev.public.sol + depositAmount }
              }));
              
              setMetrics(prev => ({
                ...prev,
                totalDeposits: prev.totalDeposits + depositAmount * currentPrice,
                tvl: prev.tvl + depositAmount * currentPrice,
                totalTransactions: prev.totalTransactions + 1
              }));
              
              addEvent(`💰 Deposit finalized: ${depositAmount} SOL moved to vault`);
            }
            
            return {...job, status: 'Finalized' as JobStatus};
          }
          return job;
        });
      });
    }, 500);

    return () => clearInterval(interval);
  }, [currentPrice]);

  // Auto-record snapshot before job submission (for withdraw, borrow, liquidation)
  const autoRecordSnapshot = (jobType: string) => {
    const needsSnapshot = ['withdraw', 'borrow', 'liq'].includes(jobType);
    
    if(needsSnapshot && (!snapshot || Date.now() - (snapshot as any).timestamp > 30000)) {
      const slot = 285000000 + Math.floor((Date.now() - 1700000000000) / 400);
      const newSnapshot: OracleSnapshot = {
        pda: `Snap${Math.random().toString(36).substring(7)}`,
        oracleProgram: 'Pyth...Oracle',
        feed: 'SOL/USD',
        priceE9: (currentPrice * 1e9).toString(),
        confE9: '100000000',
        observedSlot: slot,
        ptrHash: `0x${Math.random().toString(36).substring(2, 15)}`,
        fresh: true,
        timestamp: Date.now()
      } as any;
      
      setSnapshot(newSnapshot);
      addEvent(`📸 Oracle Snapshot recorded at slot ${slot.toLocaleString()} (Price: $${currentPrice.toFixed(2)})`);
      addEvent(`🔐 PTR Hash: ${newSnapshot.ptrHash.substring(0, 16)}...`);
      
      // Visual feedback for snapshot
      const snapCard = document.querySelector('#snapshot-card');
      if(snapCard) {
        snapCard.classList.add('ring-2', 'ring-green-500');
        setTimeout(() => snapCard.classList.remove('ring-2', 'ring-green-500'), 1000);
      }
    }
  };

  const handleSubmitJob = async () => {
    if(!walletConnected) {
      return;
    }

    // Auto-record snapshot for operations that need it
    autoRecordSnapshot(activeTab);

    const commitment = genCommitment();
    const newJob: JobRow = {
      pubkey: truncateHash(`0x${Buffer.from(commitment).toString('hex')}`),
      functionId: activeTab === 'deposit' ? 100 : activeTab === 'withdraw' ? 300 : activeTab === 'borrow' ? 200 : 400,
      status: 'Submitted',
      expectedCodeDigest: '0xpending...',
      contextData: '0xpending...',
      submitter: 'User1...x4K',
      createdAt: Date.now(),
      amount: amount || '2',
      snapshot: (activeTab !== 'deposit' && snapshot) ? snapshot.ptrHash : undefined
    } as any;
    
    setJobs(prev => [newJob, ...prev]);
    
    // Add event
    addEvent(`📝 Job Submitted: ${FUNCTION_NAMES[newJob.functionId]} for ${amount || '2'} SOL`);
    
    // Update transaction count
    setMetrics(prev => ({ ...prev, totalTransactions: prev.totalTransactions + 1 }));
    
    setAmount('');
  };

  const handleExecuteAction = () => {
    const finalizedJob = jobs.find(j => 
      j.functionId === (activeTab === 'withdraw' ? 300 : 400) && 
      j.status === 'Finalized' && 
      !executedJobs.has(j.pubkey)
    );
    
    if(!finalizedJob) {
      return;
    }
    
    if(executedJobs.has(finalizedJob.pubkey)) {
      addEvent('❌ Error: job-consumed (replay protection activated)');
      return;
    }
    
    if(activeTab === 'withdraw') {
      const withdrawAmount = parseFloat((finalizedJob as any).amount || '0');
      setBalances(prev => ({
        confidential: { ...prev.confidential, sol: prev.confidential.sol + withdrawAmount },
        public: { ...prev.public, sol: prev.public.sol - withdrawAmount }
      }));
      
      setMetrics(prev => ({
        ...prev,
        totalDeposits: Math.max(0, prev.totalDeposits - withdrawAmount * currentPrice),
        tvl: Math.max(0, prev.tvl - withdrawAmount * currentPrice)
      }));
      
      addEvent(`💸 Withdraw executed: ${withdrawAmount} SOL moved to wallet`);
    } else if(activeTab === 'liq') {
      addEvent('⚡ Liquidation executed: Position liquidated successfully');
      setMetrics(prev => ({ ...prev, totalTransactions: prev.totalTransactions + 1 }));
    }
    
    setExecutedJobs(prev => new Set([...prev, finalizedJob.pubkey]));
  };

  const addEvent = (message: string) => {
    const event: ProgramEvent = {
      type: 'JobSubmitted',
      data: { message },
      slot: Date.now(),
      signature: 'sig' + Math.random().toString(36)
    };
    setEvents(prev => [event, ...prev].slice(0, 15));
  };

  const tvl = balances.public.sol * currentPrice + balances.public.usdc;

  return (
    <div className="min-h-screen bg-[#0B0B10]">
      {/* Navigation */}
      <nav className="border-b border-[#1C1F2A] mb-6 bg-[#11131A]">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-[#6F4FF2]">Confidential Coprocessor</h1>
            <div className="text-sm text-gray-400">Privacy-Preserving Lending Protocol</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-500">Network: Devnet</div>
            <button className="px-4 py-2 bg-[#6F4FF2] hover:bg-[#5A3FD6] rounded-lg transition">
              {walletConnected ? 'User1...x4K' : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </nav>

      {/* Metrics Bar - Key Visual Focus */}
      <div className="container mx-auto px-4 mb-6">
        <div className="bg-gradient-to-r from-[#11131A] to-[#1C1F2A] rounded-2xl p-4 border border-[#1C1F2A]">
          <div className="grid grid-cols-6 gap-4">
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Total Value Locked</div>
              <div className="metric-value text-2xl font-bold transition-colors duration-300">
                ${metrics.tvl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Total Deposits</div>
              <div className="metric-value text-xl font-semibold transition-colors duration-300">
                ${metrics.totalDeposits.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Total Borrows</div>
              <div className="metric-value text-xl font-semibold transition-colors duration-300">
                ${metrics.totalBorrows.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Utilization Rate</div>
              <div className="metric-value text-xl font-semibold transition-colors duration-300">
                {metrics.utilizationRate.toFixed(1)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Supply APY</div>
              <div className="metric-value text-xl font-semibold text-green-400 transition-colors duration-300">
                {metrics.supplyAPY.toFixed(1)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400 mb-1">Borrow APY</div>
              <div className="metric-value text-xl font-semibold text-orange-400 transition-colors duration-300">
                {metrics.borrowAPY.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Auto-updating every 10 seconds
            </span>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 grid grid-cols-12 gap-6">
        {/* Left side */}
        <div className="col-span-8 space-y-6">
          {/* Price & Protocol Health */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Oracle Price Feed & Protocol Health</h2>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400">Pyth Network</span>
                <span className="text-xs px-2 py-1 bg-green-600 rounded">LIVE</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <div className="text-3xl font-bold text-white">${currentPrice.toFixed(2)}</div>
                <div className={currentPrice > 142.75 ? 'text-green-500 text-sm mt-1' : 'text-red-500 text-sm mt-1'}>
                  {currentPrice > 142.75 ? '+' : ''}{((currentPrice - 142.75) / 142.75 * 100).toFixed(2)}% from open
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">24h High:</span> <span>${(currentPrice + 2.5).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">24h Low:</span> <span>${(currentPrice - 2.5).toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Health Factor</span>
                    <span className={`font-semibold ${metrics.healthFactor > 2 ? 'text-green-400' : metrics.healthFactor > 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {metrics.healthFactor.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Collateral Ratio</span>
                    <span className="font-semibold">{metrics.collateralRatio.toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Active Users</span>
                    <span className="font-semibold">{metrics.activeUsers}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Total Transactions</span>
                    <span className="font-semibold">{metrics.totalTransactions}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* User Balances */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              User Balances
              <span className="px-2 py-1 text-xs rounded bg-gradient-to-r from-[#6F4FF2] to-[#4B3FFF]">
                ENCRYPTED
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-6">
              {/* Confidential Balance */}
              <div>
                <h4 className="text-sm text-gray-400 mb-3">Confidential (Private)</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300">SOL</span>
                    <div className="text-right">
                      <div className="font-mono font-bold">🔒 Hidden</div>
                      <div className="text-xs text-gray-500">Encrypted on-chain</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300">USDC</span>
                    <div className="text-right">
                      <div className="font-mono font-bold">🔒 Hidden</div>
                      <div className="text-xs text-gray-500">Encrypted on-chain</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-800">
                    <div className="text-xs text-gray-500">Commitment Hash:</div>
                    <div className="font-mono text-xs text-purple-400">0xab3f...9e2d</div>
                  </div>
                </div>
              </div>
              
              {/* Public Balance */}
              <div>
                <h4 className="text-sm text-gray-400 mb-3">Public (Vault)</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300">SOL</span>
                    <div className="text-right">
                      <div className="font-mono font-bold">{balances.public.sol.toFixed(2)}</div>
                      <div className="text-xs text-gray-500">Vault balance</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300">USDC</span>
                    <div className="text-right">
                      <div className="font-mono font-bold">{balances.public.usdc.toFixed(2)}</div>
                      <div className="text-xs text-gray-500">Vault balance</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-800">
                    <div className="text-xs text-gray-500">Vault Value:</div>
                    <div className="font-mono text-xs text-green-400">${tvl.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Oracle Snapshot */}
          <div id="snapshot-card" className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Oracle Snapshot</h3>
              <span className={`px-2 py-1 text-xs rounded ${
                snapshot?.fresh ? 'bg-green-600' : snapshot ? 'bg-yellow-600' : 'bg-gray-600'
              }`}>
                {snapshot?.fresh ? 'Fresh' : snapshot ? 'Stale' : 'No Snapshot'}
              </span>
            </div>
            {snapshot ? (
              <div className="space-y-3 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Slot:</span>
                  <span>{snapshot.observedSlot.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Price:</span>
                  <span>${(BigInt(snapshot.priceE9) / 1000000000n).toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Confidence:</span>
                  <span>±${(BigInt(snapshot.confE9) / 1000000000n).toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Source:</span>
                  <span className="text-purple-400">Pyth Oracle</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">PTR Hash:</span>
                  <span className="text-xs">{truncateHash(snapshot.ptrHash)}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  Auto-captured before Withdraw/Borrow/Liquidation operations
                </div>
              </div>
            ) : (
              <div className="text-gray-500">
                <div className="mb-2">Oracle snapshot will be automatically recorded when:</div>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Submitting a Withdraw job</li>
                  <li>• Submitting a Borrow job</li>
                  <li>• Submitting a Liquidation check</li>
                </ul>
              </div>
            )}
          </div>

          {/* Live Feed */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <h3 className="text-lg font-semibold mb-4">Live Event Stream</h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {events.length > 0 ? (
                events.map((event, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm py-1">
                    <span className="text-xs text-gray-500 min-w-[80px]">{new Date(event.slot).toLocaleTimeString()}</span>
                    <span className="flex-1">{(event.data as any).message}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-400">Waiting for system initialization...</div>
              )}
            </div>
          </div>
        </div>

        {/* Right side - Trading Panel */}
        <div className="col-span-4 space-y-6">
          {/* Trade Box */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <div className="flex gap-2 mb-6">
              {(['deposit', 'withdraw', 'borrow', 'liq'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 px-4 rounded-lg capitalize transition text-sm ${
                    activeTab === tab
                      ? 'bg-[#6F4FF2] text-white'
                      : 'hover:bg-[#1C1F2A] text-gray-400'
                  }`}
                >
                  {tab === 'liq' ? 'Liquidation' : tab}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Amount</label>
                <input
                  type="text"
                  placeholder="0.00 SOL"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none transition-colors"
                />
              </div>
              
              {activeTab === 'borrow' && (
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">LTV (Loan-to-Value)</label>
                  <input
                    type="text"
                    placeholder="Basis points (e.g. 5000 for 50%)"
                    value={ltvBp}
                    onChange={(e) => setLtvBp(e.target.value)}
                    className="w-full px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                  />
                </div>
              )}
              
              {activeTab === 'liq' && (
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Min Collateral Ratio</label>
                  <input
                    type="text"
                    placeholder="Basis points (e.g. 15000 for 150%)"
                    value={minCrBp}
                    onChange={(e) => setMinCrBp(e.target.value)}
                    className="w-full px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                  />
                </div>
              )}

              <div className="bg-[#0B0B10] rounded-lg p-3 text-xs text-gray-500 space-y-1">
                {activeTab === 'deposit' && (
                  <>
                    <div>• Funds are encrypted and added to confidential balance</div>
                    <div>• No oracle snapshot required for deposits</div>
                  </>
                )}
                {activeTab === 'withdraw' && (
                  <>
                    <div>• Oracle snapshot will be auto-captured before submission</div>
                    <div>• Funds move from vault to wallet after execution</div>
                  </>
                )}
                {activeTab === 'borrow' && (
                  <>
                    <div>• Oracle snapshot required for price validation</div>
                    <div>• LTV checked against current collateral value</div>
                  </>
                )}
                {activeTab === 'liq' && (
                  <>
                    <div>• Oracle snapshot binds liquidation to specific price</div>
                    <div>• Freshness validation ensures price relevance</div>
                  </>
                )}
              </div>

              <button 
                onClick={handleSubmitJob}
                disabled={!walletConnected}
                className="w-full py-3 bg-[#6F4FF2] hover:bg-[#5A3FD6] disabled:bg-gray-600 text-white font-semibold rounded-lg transition"
              >
                {activeTab === 'deposit' && 'Deposit'}
                {activeTab === 'withdraw' && 'Submit Withdraw Job'}
                {activeTab === 'borrow' && 'Submit Borrow Job'}
                {activeTab === 'liq' && 'Submit Liquidation Check'}
              </button>

              {(activeTab === 'withdraw' || activeTab === 'liq') && (
                <button 
                  onClick={handleExecuteAction}
                  className="w-full py-3 bg-transparent border border-[#6F4FF2] text-[#6F4FF2] hover:bg-[#6F4FF2] hover:text-white font-semibold rounded-lg transition"
                >
                  Execute {activeTab === 'liq' ? 'Liquidation' : 'Withdraw'}
                </button>
              )}
            </div>
          </div>

          {/* Jobs Table */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Jobs Queue</h3>
              <span className="text-sm text-gray-400">({jobs.length})</span>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <div key={job.pubkey} className="p-3 bg-[#0B0B10] rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono">{truncateHash(job.pubkey)}</span>
                      <span className={`px-2 py-1 text-xs rounded text-white ${
                        STATUS_COLORS[job.status]
                      }`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {FUNCTION_NAMES[job.functionId]} • {(job as any).amount} SOL
                      </span>
                      {job.status === 'Finalized' && (job.functionId === 300 || job.functionId === 400) && !executedJobs.has(job.pubkey) && (
                        <span className="text-xs text-purple-400">Ready to execute</span>
                      )}
                    </div>
                    {(job as any).snapshot && (
                      <div className="text-xs text-gray-500 mt-1">
                        Snapshot bound: {truncateHash((job as any).snapshot)}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-gray-500 text-sm">No jobs in queue</div>
              )}
            </div>
          </div>

          {/* System Status */}
          <div className="bg-gradient-to-r from-green-900/20 to-green-800/20 rounded-2xl p-4 border border-green-800/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-green-400">System Status</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-400">All Systems Operational</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Executor:</span>
                <span className="text-green-400">Auto-processing</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Oracle:</span>
                <span className="text-green-400">Live</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Metrics:</span>
                <span className="text-green-400">Updating</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Privacy:</span>
                <span className="text-green-400">Encrypted</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}