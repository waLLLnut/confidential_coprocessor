'use client';

import { useState } from 'react';
import Link from 'next/link';
import { JobRow, FUNCTION_NAMES } from '@/lib/types';
import { truncateHash, genCommitment, computeCodeDigest, formatHash } from '@/lib/hash';
import { getIrForFunction } from '@/lib/ir';

export default function ExecutorPage() {
  const [selectedJob, setSelectedJob] = useState('');
  const [resultCommitment, setResultCommitment] = useState('');
  const [snapshotPda, setSnapshotPda] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // Mock jobs for demo
  const mockJobs: JobRow[] = [
    {
      pubkey: 'Job1Abc...xyz',
      functionId: 100,
      status: 'Submitted',
      expectedCodeDigest: '0x123...',
      contextData: '0x789...',
      submitter: 'User1...'
    },
    {
      pubkey: 'Job2Def...uvw',
      functionId: 300,
      status: 'Submitted',
      expectedCodeDigest: '0xabc...',
      contextData: '0x012...',
      submitter: 'User1...'
    }
  ];

  const handlePostResult = () => {
    if (!selectedJob) {
      addLog('Error: No job selected');
      return;
    }

    const job = mockJobs.find(j => j.pubkey === selectedJob);
    if (!job) return;

    // Generate IR and compute digest
    const ir = getIrForFunction(job.functionId);
    const digest = computeCodeDigest(ir);
    
    // Generate result commitment
    const commitment = genCommitment();
    
    addLog(`Posting result for job ${truncateHash(selectedJob)}`);
    addLog(`  Function ID: ${job.functionId} (${FUNCTION_NAMES[job.functionId]})`);
    addLog(`  Code Digest: ${truncateHash(formatHash(digest))}`);
    addLog(`  Result Commitment: ${truncateHash(formatHash(commitment))}`);
    
    if (snapshotPda) {
      addLog(`  External PTR Hash: ${truncateHash(snapshotPda)}`);
    }
    
    addLog('✅ Result posted successfully');
  };

  const handleFinalize = () => {
    if (!selectedJob) {
      addLog('Error: No job selected');
      return;
    }
    
    addLog(`Finalizing job ${truncateHash(selectedJob)}`);
    addLog('✅ Job finalized successfully');
  };

  const handleRecordSnapshot = () => {
    const slot = Math.floor(Date.now() / 1000);
    addLog(`Recording oracle snapshot at slot ${slot}`);
    addLog(`  Price: $142.75`);
    addLog(`  Confidence: ±$0.10`);
    addLog(`✅ Snapshot recorded successfully`);
    setSnapshotPda(`Snap${Math.random().toString(36).substring(7)}`);
  };

  const addLog = (message: string) => {
    setLogs(prev => [message, ...prev].slice(0, 20));
  };

  return (
    <>
      {/* Navigation */}
      <nav className="border-b border-[#1C1F2A] mb-6">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-[#6F4FF2]">Confidential Coprocessor</h1>
            <div className="flex gap-4">
              <Link href="/" className="text-gray-400 hover:text-[#6F4FF2] transition">Lending</Link>
              <Link href="/executor" className="text-white hover:text-[#6F4FF2] transition">Executor</Link>
              <Link href="/events" className="text-gray-400 hover:text-[#6F4FF2] transition">Events</Link>
            </div>
          </div>
          <div className="text-sm text-gray-400">
            Executor: <span className="font-mono text-[#6F4FF2]">Exec7x9s...4nK</span>
          </div>
        </div>
      </nav>

      <div className="grid grid-cols-12 gap-6">
        {/* Actions Panel */}
        <div className="col-span-8 space-y-6">
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <h2 className="text-xl font-semibold mb-6">Executor Actions</h2>
            
            {/* Post Result */}
            <div className="space-y-4 mb-8">
              <h3 className="text-lg font-medium text-[#6F4FF2]">Post Result</h3>
              
              <div>
                <label className="block text-sm text-gray-400 mb-2">Select Job</label>
                <select 
                  value={selectedJob}
                  onChange={(e) => setSelectedJob(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                >
                  <option value="">Select a job...</option>
                  {mockJobs.filter(j => j.status === 'Submitted').map(job => (
                    <option key={job.pubkey} value={job.pubkey}>
                      {job.pubkey} - FID {job.functionId} ({FUNCTION_NAMES[job.functionId]})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Result Commitment (auto-generated)</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={resultCommitment}
                    readOnly
                    placeholder="Click generate..."
                    className="flex-1 px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg"
                  />
                  <button
                    onClick={() => {
                      const commitment = genCommitment();
                      setResultCommitment(formatHash(commitment));
                    }}
                    className="px-4 py-3 bg-[#6F4FF2] hover:bg-[#5A3FD6] text-white rounded-lg transition"
                  >
                    Generate
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Snapshot PDA (for LIQ jobs)</label>
                <input 
                  type="text"
                  value={snapshotPda}
                  onChange={(e) => setSnapshotPda(e.target.value)}
                  placeholder="Optional..."
                  className="w-full px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                />
              </div>

              <button
                onClick={handlePostResult}
                className="w-full py-3 bg-[#6F4FF2] hover:bg-[#5A3FD6] text-white font-semibold rounded-lg transition"
              >
                Post Result
              </button>
            </div>

            {/* Finalize */}
            <div className="space-y-4 mb-8 pt-8 border-t border-[#1C1F2A]">
              <h3 className="text-lg font-medium text-[#6F4FF2]">Finalize Job</h3>
              <button
                onClick={handleFinalize}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
              >
                Finalize Selected Job
              </button>
            </div>

            {/* Record Snapshot */}
            <div className="space-y-4 pt-8 border-t border-[#1C1F2A]">
              <h3 className="text-lg font-medium text-[#6F4FF2]">Record Oracle Snapshot</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <input 
                  type="text"
                  placeholder="Price (e.g. 142.75)"
                  className="px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                />
                <input 
                  type="text"
                  placeholder="Confidence (e.g. 0.10)"
                  className="px-4 py-3 bg-[#0B0B10] border border-[#1C1F2A] rounded-lg focus:border-[#6F4FF2] outline-none"
                />
              </div>
              
              <button
                onClick={handleRecordSnapshot}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
              >
                Record Snapshot
              </button>
            </div>
          </div>
        </div>

        {/* Executor Logs */}
        <div className="col-span-4">
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A]">
            <h3 className="text-lg font-semibold mb-4">Executor Logs</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {logs.length > 0 ? (
                logs.map((log, i) => (
                  <div key={i} className="text-sm font-mono">
                    <span className="text-gray-500">[{new Date().toLocaleTimeString()}]</span>{' '}
                    <span className={log.includes('✅') ? 'text-green-400' : log.includes('Error') ? 'text-red-400' : 'text-gray-300'}>
                      {log}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-gray-500 text-sm">No logs yet...</div>
              )}
            </div>
          </div>

          {/* Metrics Publisher */}
          <div className="bg-[#11131A] rounded-2xl p-6 border border-[#1C1F2A] mt-6">
            <h3 className="text-lg font-semibold mb-4">Metrics Publisher</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">TVL:</span>
                <span>$1,234,567</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Utilization:</span>
                <span>67.5%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Total Users:</span>
                <span>42</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Auto-publishing every 30s
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}