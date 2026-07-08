import React, { useState, useEffect } from 'react';
import { 
  createCampaignTx, 
  contributeTx, 
  withdrawTx, 
  refundTx, 
  listCampaigns, 
  getCampaignStatus, 
  getTokenBalance, 
  mintTokensTx,
  calculateProgress,
  validateCampaignInputs,
  FACTORY_ADDRESS,
  TOKEN_ADDRESS,
  getContractEvents,
  kit,
  type CampaignStatus,
  type DecodedEvent
} from './utils/stellar';

// Mock Constants for Sandbox Simulation
const MOCK_CREATOR = 'GDDS2CREATOR...MOCK';

export default function App() {
  // Wallet state
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [nativeBalance, setNativeBalance] = useState<string>('0');
  const [tokenBalance, setTokenBalance] = useState<string>('0');
  const [isSandbox, setIsSandbox] = useState<boolean>(false);
  
  // Campaigns list state
  const factoryAddress = FACTORY_ADDRESS || 'CB7SNUNVEH562AGTFPV4O34ITUOO7FRZIJYRCYI3OEHSVY5WFZ4GT7FR';
  const [campaigns, setCampaigns] = useState<CampaignStatus[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState<boolean>(false);
  const [recentEvents, setRecentEvents] = useState<DecodedEvent[]>([]);
  
  // Create Campaign Form state
  const [goal, setGoal] = useState<string>('1000');
  const [durationSecs, setDurationSecs] = useState<string>('3600');
  const [metadataUri, setMetadataUri] = useState<string>('ipfs://campaign-init-meta');
  
  // Contribution Form state
  const [contributionAmounts, setContributionAmounts] = useState<{ [contractAddr: string]: string }>({});
  
  // Transaction Progress state
  const [txStatus, setTxStatus] = useState<string>('idle'); // idle, building, awaiting signature, submitting, confirming, success, error
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [txError, setTxError] = useState<string | undefined>(undefined);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'success' | 'failed'>('all');

  // Trigger ticker updates
  const [_tick, setTick] = useState<number>(0);

  // Poll ticks for countdowns
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize and load campaigns
  useEffect(() => {
    if (isSandbox) {
      loadSandboxCampaigns();
    } else {
      loadRealCampaigns();
    }
  }, [isSandbox, factoryAddress]);

  // Periodic polling for events and balances
  useEffect(() => {
    if (!walletConnected || !userAddress) return;
    
    const pollInterval = setInterval(() => {
      refreshBalances();
      if (!isSandbox) {
        pollRealEvents();
      }
    }, 8000);

    return () => clearInterval(pollInterval);
  }, [walletConnected, userAddress, isSandbox]);

  // Load Real Campaigns from Soroban
  const loadRealCampaigns = async () => {
    if (!factoryAddress || factoryAddress.startsWith('CB7S') === false) return;
    setLoadingCampaigns(true);
    try {
      const addresses = await listCampaigns();
      const loaded: CampaignStatus[] = [];
      for (const addr of addresses) {
        const status = await getCampaignStatus(addr);
        if (status) {
          loaded.push(status);
        }
      }
      setCampaigns(loaded);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  // Load Initial Mock Campaigns for Sandbox
  const loadSandboxCampaigns = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const mockList: CampaignStatus[] = [
      {
        contractAddress: 'CCAMP_MOCK_SAVE_THE_OCEAN',
        creator: MOCK_CREATOR,
        token: TOKEN_ADDRESS,
        goal: 5000n,
        deadline: now + 300n, // 5 minutes remaining
        raised: 3200n,
        goalMet: false,
        ended: false,
        metadataUri: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&auto=format&fit=crop&q=60'
      },
      {
        contractAddress: 'CCAMP_MOCK_SOLAR_POWER_KITS',
        creator: MOCK_CREATOR,
        token: TOKEN_ADDRESS,
        goal: 10000n,
        deadline: now + 7200n, // 2 hours remaining
        raised: 12000n,
        goalMet: true,
        ended: false,
        metadataUri: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=200&auto=format&fit=crop&q=60'
      },
      {
        contractAddress: 'CCAMP_MOCK_OLD_LIBRARY_BOOKS',
        creator: MOCK_CREATOR,
        token: TOKEN_ADDRESS,
        goal: 2500n,
        deadline: now - 30n, // Expired
        raised: 1500n,
        goalMet: false,
        ended: false,
        metadataUri: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=200&auto=format&fit=crop&q=60'
      }
    ];
    setCampaigns(mockList);
  };

  // Refresh balances
  const refreshBalances = async () => {
    if (!userAddress) return;
    if (isSandbox) {
      const cached = localStorage.getItem(`sandbox_bal_${userAddress}`);
      setTokenBalance(cached || '10000');
      setNativeBalance('150');
    } else {
      try {
        const bal = await getTokenBalance(TOKEN_ADDRESS, userAddress);
        setTokenBalance(bal.toString());
        setNativeBalance('84.2'); // Standard static placeholder for Native XLM fees
      } catch (err) {
        console.error('Balance check failed:', err);
      }
    }
  };

  // Poll Real Events
  const pollRealEvents = async () => {
    if (!factoryAddress) return;
    try {
      const factoryEvents = await getContractEvents(factoryAddress);
      setRecentEvents(factoryEvents);
    } catch (err) {
      console.error('Error polling events:', err);
    }
  };

  // Connect Wallet Action
  const handleConnectWallet = async (type: 'freighter' | 'sandbox') => {
    if (type === 'sandbox') {
      setIsSandbox(true);
      const randAddr = 'G' + Math.random().toString(36).substring(2, 15).toUpperCase() + 'SANDBOX';
      setUserAddress(randAddr);
      setWalletConnected(true);
      localStorage.setItem(`sandbox_bal_${randAddr}`, '10000');
      setTokenBalance('10000');
      setNativeBalance('150');
      
      const mockEvent: DecodedEvent = {
        id: 'evt_sandbox_init',
        type: 'campaign_created',
        contractId: 'SANDBOX',
        ledger: '1',
        topics: ['Sandbox Connected', randAddr],
        value: 'Sandbox Mode Active',
        timestamp: Date.now()
      };
      setRecentEvents([mockEvent]);
    } else {
      setIsSandbox(false);
      try {
        setTxStatus('awaiting signature');
        const { address } = await kit.getAddress();
        setUserAddress(address);
        setWalletConnected(true);
        setTxStatus('idle');
        
        const factoryEvents = await getContractEvents(factoryAddress);
        setRecentEvents(factoryEvents);
      } catch (err: any) {
        setTxStatus('error');
        setTxError(err.message || 'Freighter connection failed');
      }
    }
  };

  // Disconnect Wallet
  const handleDisconnect = () => {
    setWalletConnected(false);
    setUserAddress('');
    setNativeBalance('0');
    setTokenBalance('0');
  };

  // Mint Tokens (Testnet Faucet)
  const handleMintTokens = async () => {
    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('success');
        const newBal = (BigInt(tokenBalance) + 500n).toString();
        setTokenBalance(newBal);
        localStorage.setItem(`sandbox_bal_${userAddress}`, newBal);
        
        const mockEvt: DecodedEvent = {
          id: `evt_mint_${Date.now()}`,
          type: 'contribution',
          contractId: TOKEN_ADDRESS,
          ledger: '99',
          topics: ['token_mint', userAddress],
          value: '500 Tokens Faucet Minted',
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
      }, 1000);
    } else {
      try {
        setTxError(undefined);
        await mintTokensTx(userAddress, '500', (status, hash, err) => {
          setTxStatus(status);
          setTxHash(hash);
          if (err) setTxError(err);
        });
        await refreshBalances();
      } catch (err) {
        console.error('Minting failed:', err);
      }
    }
  };

  // Create Campaign Submit
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Form Input Validation
    const validation = validateCampaignInputs(goal, durationSecs, metadataUri);
    if (!validation.valid) {
      setTxStatus('error');
      setTxError(validation.error);
      return;
    }

    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('success');
        const now = BigInt(Math.floor(Date.now() / 1000));
        const newCampaign: CampaignStatus = {
          contractAddress: `CCAMP_MOCK_${Date.now()}`,
          creator: userAddress,
          token: TOKEN_ADDRESS,
          goal: BigInt(goal),
          deadline: now + BigInt(durationSecs),
          raised: 0n,
          goalMet: false,
          ended: false,
          metadataUri
        };
        setCampaigns((prev) => [newCampaign, ...prev]);
        
        const mockEvt: DecodedEvent = {
          id: `evt_camp_${Date.now()}`,
          type: 'campaign_created',
          contractId: newCampaign.contractAddress,
          ledger: '100',
          topics: ['campaign_created', userAddress],
          value: `Goal: ${goal} Tokens`,
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
      }, 1200);
    } else {
      try {
        setTxError(undefined);
        await createCampaignTx(
          userAddress,
          goal,
          Number(durationSecs),
          metadataUri,
          (status, hash, err) => {
            setTxStatus(status);
            setTxHash(hash);
            if (err) setTxError(err);
          }
        );
        await loadRealCampaigns();
      } catch (err) {
        console.error('Create campaign transaction failed:', err);
      }
    }
  };

  // Contribute to Campaign
  const handleContribute = async (campaignAddress: string) => {
    const amount = contributionAmounts[campaignAddress] || '';
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setTxStatus('error');
      setTxError('Please enter a positive contribution amount');
      return;
    }

    // Check balance
    if (BigInt(amount) > BigInt(tokenBalance)) {
      setTxStatus('error');
      setTxError('Insufficient balance to contribute');
      return;
    }

    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('success');
        
        // Update campaigns list
        const updated = campaigns.map((c) => {
          if (c.contractAddress === campaignAddress) {
            const raised = c.raised + BigInt(amount);
            return {
              ...c,
              raised,
              goalMet: raised >= c.goal
            };
          }
          return c;
        });
        setCampaigns(updated);

        // Deduct balance
        const newBal = (BigInt(tokenBalance) - BigInt(amount)).toString();
        setTokenBalance(newBal);
        localStorage.setItem(`sandbox_bal_${userAddress}`, newBal);

        // Record donor contribution record locally
        const cachedDonorContrib = localStorage.getItem(`sandbox_contrib_${userAddress}_${campaignAddress}`) || '0';
        const newDonorContrib = (BigInt(cachedDonorContrib) + BigInt(amount)).toString();
        localStorage.setItem(`sandbox_contrib_${userAddress}_${campaignAddress}`, newDonorContrib);

        // Event log
        const mockEvt: DecodedEvent = {
          id: `evt_contrib_${Date.now()}`,
          type: 'contribution',
          contractId: campaignAddress,
          ledger: '101',
          topics: ['contribution', userAddress],
          value: `Contributed: ${amount} Tokens`,
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
        setContributionAmounts({ ...contributionAmounts, [campaignAddress]: '' });
      }, 1200);
    } else {
      try {
        setTxError(undefined);
        await contributeTx(
          userAddress,
          campaignAddress,
          amount,
          (status, hash, err) => {
            setTxStatus(status);
            setTxHash(hash);
            if (err) setTxError(err);
          }
        );
        setContributionAmounts({ ...contributionAmounts, [campaignAddress]: '' });
        await refreshBalances();
        await loadRealCampaigns();
      } catch (err) {
        console.error('Contribution failed:', err);
      }
    }
  };

  // Withdraw Campaign Funds (Creator only)
  const handleWithdraw = async (campaign: CampaignStatus) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    
    // Check Campaign Target conditions
    if (now < campaign.deadline) {
      setTxStatus('error');
      setTxError('Cannot withdraw before the deadline has expired');
      return;
    }
    if (campaign.raised < campaign.goal) {
      setTxStatus('error');
      setTxError('Goal was not met. Campign cannot be withdrawn');
      return;
    }

    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('success');
        
        // Update campaigns list
        const updated = campaigns.map((c) => {
          if (c.contractAddress === campaign.contractAddress) {
            return { ...c, ended: true };
          }
          return c;
        });
        setCampaigns(updated);

        // Increase creator balance
        if (campaign.creator === userAddress) {
          const newBal = (BigInt(tokenBalance) + campaign.raised).toString();
          setTokenBalance(newBal);
          localStorage.setItem(`sandbox_bal_${userAddress}`, newBal);
        }

        const mockEvt: DecodedEvent = {
          id: `evt_withdraw_${Date.now()}`,
          type: 'withdrawn',
          contractId: campaign.contractAddress,
          ledger: '102',
          topics: ['withdrawn', campaign.creator],
          value: `Withdrawn: ${campaign.raised} Tokens`,
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
      }, 1500);
    } else {
      try {
        setTxError(undefined);
        await withdrawTx(
          userAddress,
          campaign.contractAddress,
          (status, hash, err) => {
            setTxStatus(status);
            setTxHash(hash);
            if (err) setTxError(err);
          }
        );
        await refreshBalances();
        await loadRealCampaigns();
      } catch (err) {
        console.error('Withdrawal failed:', err);
      }
    }
  };

  // Request Donor Refund (Donor only)
  const handleRefund = async (campaignAddress: string) => {
    const campaign = campaigns.find(c => c.contractAddress === campaignAddress);
    if (!campaign) return;
    
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < campaign.deadline) {
      setTxStatus('error');
      setTxError('Cannot claim refund before campaign deadline has passed');
      return;
    }
    if (campaign.raised >= campaign.goal) {
      setTxStatus('error');
      setTxError('Goal was met. Refunds are disabled');
      return;
    }

    if (isSandbox) {
      setTxStatus('building');
      const contribCached = localStorage.getItem(`sandbox_contrib_${userAddress}_${campaignAddress}`) || '0';
      const contribVal = BigInt(contribCached);
      if (contribVal <= 0n) {
        setTxStatus('error');
        setTxError('No contribution balance found to refund');
        return;
      }

      setTimeout(() => {
        setTxStatus('success');
        
        // Update campaigns list
        const updated = campaigns.map((c) => {
          if (c.contractAddress === campaignAddress) {
            return {
              ...c,
              raised: c.raised - contribVal
            };
          }
          return c;
        });
        setCampaigns(updated);

        // Return balance
        const newBal = (BigInt(tokenBalance) + contribVal).toString();
        setTokenBalance(newBal);
        localStorage.setItem(`sandbox_bal_${userAddress}`, newBal);
        localStorage.setItem(`sandbox_contrib_${userAddress}_${campaignAddress}`, '0');

        const mockEvt: DecodedEvent = {
          id: `evt_refund_${Date.now()}`,
          type: 'refunded',
          contractId: campaignAddress,
          ledger: '103',
          topics: ['refunded', userAddress],
          value: `Refunded: ${contribVal} Tokens`,
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
      }, 1500);
    } else {
      try {
        setTxError(undefined);
        await refundTx(
          userAddress,
          campaignAddress,
          (status, hash, err) => {
            setTxStatus(status);
            setTxHash(hash);
            if (err) setTxError(err);
          }
        );
        await refreshBalances();
        await loadRealCampaigns();
      } catch (err) {
        console.error('Refund transaction failed:', err);
      }
    }
  };

  // Helper: Format address
  const formatAddress = (addr: string) => {
    if (!addr) return '';
    return addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
  };

  // Helper: Format countdown timer
  const renderTimeLeft = (deadline: bigint) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const diff = deadline - now;
    if (diff <= 0n) {
      return <span className="text-red-500 font-semibold font-mono">Expired</span>;
    }
    const secs = Number(diff % 60n);
    const mins = Number((diff / 60n) % 60n);
    const hours = Number(diff / 3600n);
    return (
      <span className="text-emerald-400 font-semibold font-mono">
        {hours}h {mins}m {secs}s
      </span>
    );
  };

  // Filtering list
  const filteredCampaigns = campaigns.filter((c) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const isExpired = now >= c.deadline;
    
    // Search
    const matchesSearch = c.contractAddress.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.metadataUri.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    // Filters
    if (filterStatus === 'active') return !isExpired && !c.ended;
    if (filterStatus === 'success') return c.raised >= c.goal;
    if (filterStatus === 'failed') return isExpired && c.raised < c.goal;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Header Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent tracking-wider">
              FUNDSTREAMPACK
            </span>
            <span className="px-2 py-0.5 text-xs font-bold uppercase rounded bg-teal-500/20 text-teal-400 border border-teal-500/30">
              Soroban L3
            </span>
          </div>

          <div className="flex items-center gap-3">
            {walletConnected ? (
              <div className="flex items-center gap-3">
                {/* Balance labels */}
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs text-slate-400">Balance</span>
                  <span className="text-sm font-bold text-teal-400 font-mono">
                    {tokenBalance} TOK | {nativeBalance} XLM
                  </span>
                </div>
                <div className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 text-sm font-medium flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isSandbox ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                  <span className="font-mono">{formatAddress(userAddress)}</span>
                </div>
                <button
                  onClick={handleMintTokens}
                  className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 active:scale-95 transition-all"
                >
                  Faucet Fnd
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg bg-red-950/40 hover:bg-red-900/40 text-red-400 border border-red-900/40 transition-all"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => handleConnectWallet('freighter')}
                  className="px-4 py-2 text-sm font-bold uppercase rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 active:scale-95 transition-all shadow-lg shadow-teal-500/10"
                >
                  Freighter Wallet
                </button>
                <button
                  onClick={() => handleConnectWallet('sandbox')}
                  className="px-4 py-2 text-sm font-bold uppercase rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:scale-95 transition-all"
                >
                  Sandbox (Mock)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Campaign Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Forms, Live Feeds, and Info */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Active Campaign Creator Form */}
          <div className="bg-slate-900/80 rounded-2xl p-5 border border-slate-800/80 shadow-xl backdrop-blur-sm">
            <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 bg-gradient-to-b from-emerald-400 to-teal-500 rounded-full"></span>
              Create Campaign
            </h2>
            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Goal Amount (TOK)</label>
                <input
                  type="number"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                  placeholder="e.g. 1000"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Duration (Seconds)</label>
                <input
                  type="number"
                  value={durationSecs}
                  onChange={(e) => setDurationSecs(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                  placeholder="e.g. 3600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Description / Metadata URL</label>
                <input
                  type="text"
                  value={metadataUri}
                  onChange={(e) => setMetadataUri(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-teal-500"
                  placeholder="ipfs://..."
                />
              </div>

              {!walletConnected ? (
                <div className="text-xs text-amber-400 text-center font-medium py-2">
                  Connect wallet to register campaign
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={txStatus !== 'idle' && txStatus !== 'success' && txStatus !== 'error'}
                  className="w-full py-2.5 font-bold uppercase rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 disabled:opacity-50 active:scale-95 transition-all shadow-md"
                >
                  Launch Campaign
                </button>
              )}
            </form>
          </div>

          {/* Activity Feeds */}
          <div className="bg-slate-900/80 rounded-2xl p-5 border border-slate-800/80 shadow-xl flex-1 flex flex-col min-h-[300px]">
            <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 bg-gradient-to-b from-teal-400 to-indigo-500 rounded-full"></span>
              Live Activity Feed
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 max-h-[320px] pr-1 scrollbar-thin">
              {recentEvents.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-10">No recent campaign events.</div>
              ) : (
                recentEvents.map((evt) => (
                  <div key={evt.id} className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/50 flex flex-col gap-1.5 hover:border-slate-700/50 transition-all">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`px-2 py-0.5 rounded font-bold uppercase text-[9px] ${
                        evt.type === 'campaign_created' ? 'bg-emerald-500/20 text-emerald-400' :
                        evt.type === 'contribution' ? 'bg-sky-500/20 text-sky-400' :
                        evt.type === 'withdrawn' ? 'bg-amber-500/20 text-amber-400' : 'bg-purple-500/20 text-purple-400'
                      }`}>
                        {evt.type}
                      </span>
                      <span className="text-slate-500 font-mono">Ledger #{evt.ledger}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-200">{evt.value.toString()}</p>
                    {evt.topics[1] && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        By: {formatAddress(evt.topics[1].toString())}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Columns: Dashboard and Live Campaign Cards */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Transaction Steps & Error Logs */}
          {txStatus !== 'idle' && (
            <div className={`p-4 rounded-2xl border flex flex-col gap-2 ${
              txStatus === 'error' ? 'bg-red-950/30 border-red-900/50 text-red-300' :
              txStatus === 'success' ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300' :
              'bg-slate-900/90 border-slate-800 text-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold tracking-wider">Transaction State</span>
                <button onClick={() => setTxStatus('idle')} className="text-xs font-semibold hover:underline">Dismiss</button>
              </div>
              <div className="flex items-center gap-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    txStatus === 'error' ? 'bg-red-500' :
                    txStatus === 'success' ? 'bg-emerald-500' :
                    'bg-teal-400 animate-ping'
                  }`}></span>
                  <span className="font-bold text-sm uppercase tracking-wide">{txStatus}</span>
                </div>
                {txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-teal-400 underline font-mono hover:text-teal-300"
                  >
                    View on Stellar.Expert
                  </a>
                )}
              </div>
              {txError && <p className="text-xs font-medium text-red-400/90 bg-red-950/40 p-2 rounded-lg border border-red-900/20">{txError}</p>}
            </div>
          )}

          {/* Search/Sort and Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/40 p-3 rounded-xl border border-slate-800">
            <div className="relative w-full sm:max-w-xs">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              {(['all', 'active', 'success', 'failed'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-bold uppercase rounded-lg border tracking-wider transition-all ${
                    filterStatus === st 
                      ? 'bg-teal-500/20 border-teal-500 text-teal-400 shadow-md shadow-teal-500/5' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Campaigns Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {loadingCampaigns ? (
              <div className="col-span-full py-20 text-center text-slate-400 font-medium">
                Fetching campaigns from Soroban ledger...
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="col-span-full py-20 text-center text-slate-500 font-medium bg-slate-900/10 rounded-2xl border border-slate-800 border-dashed">
                No campaigns match the filter settings.
              </div>
            ) : (
              filteredCampaigns.map((camp) => {
                const progress = calculateProgress(camp.raised, camp.goal);
                const isFinished = camp.ended;
                
                return (
                  <div key={camp.contractAddress} className="bg-slate-900/70 rounded-2xl border border-slate-800 overflow-hidden flex flex-col justify-between hover:border-slate-700/80 shadow-lg hover:shadow-xl transition-all">
                    {/* Top banner / Image simulation */}
                    <div className="h-32 bg-slate-850 relative flex items-center justify-center overflow-hidden">
                      {camp.metadataUri.startsWith('http') ? (
                        <img src={camp.metadataUri} alt="campaign banner" className="w-full h-full object-cover opacity-80" />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/80 to-slate-900/80 flex flex-col items-center justify-center p-4">
                          <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-widest font-mono">CAMP DESCRIPTION</span>
                          <p className="text-xs text-center text-slate-300 font-semibold mt-1 truncate max-w-xs">{camp.metadataUri}</p>
                        </div>
                      )}
                      {camp.goalMet && (
                        <span className="absolute top-3 right-3 bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow">
                          Goal Met 🏆
                        </span>
                      )}
                    </div>

                    {/* Progress Metrics */}
                    <div className="p-5 flex-1 flex flex-col justify-between gap-5">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-mono text-[11px]">{formatAddress(camp.contractAddress)}</span>
                          <span className="font-medium text-slate-300">Creator: {formatAddress(camp.creator)}</span>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-end text-sm">
                            <span className="font-black text-slate-100 font-mono text-base">
                              {camp.raised.toString()} <span className="text-xs font-semibold text-slate-400">raised</span>
                            </span>
                            <span className="text-xs font-bold text-teal-400 font-mono">{progress}%</span>
                          </div>
                          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                            <div className="bg-gradient-to-r from-emerald-400 to-teal-500 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[11px] text-slate-400 font-semibold">
                            <span>Goal: {camp.goal.toString()} TOK</span>
                            <span>Time Left: {renderTimeLeft(camp.deadline)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Control buttons */}
                      <div className="space-y-3 pt-2">
                        {isFinished ? (
                          <div className="w-full py-2 bg-slate-800/40 rounded-xl text-center text-xs font-bold text-slate-400 uppercase tracking-widest border border-slate-850">
                            Campaign Claimed/Ended
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {/* Contribute form */}
                            <div className="flex gap-2">
                              <input
                                type="number"
                                value={contributionAmounts[camp.contractAddress] || ''}
                                onChange={(e) => setContributionAmounts({
                                  ...contributionAmounts,
                                  [camp.contractAddress]: e.target.value
                                })}
                                disabled={!walletConnected}
                                placeholder="TOK amount"
                                className="w-24 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs focus:outline-none focus:border-teal-500 font-mono text-slate-200"
                              />
                              <button
                                onClick={() => handleContribute(camp.contractAddress)}
                                disabled={!walletConnected}
                                className="flex-1 py-1.5 text-xs font-black uppercase rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 disabled:opacity-40 transition-all"
                              >
                                Donate
                              </button>
                            </div>

                            {/* Withdraw / Refund actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleWithdraw(camp)}
                                disabled={!walletConnected}
                                className="flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40 disabled:opacity-30 transition-all"
                              >
                                Withdraw
                              </button>
                              <button
                                onClick={() => handleRefund(camp.contractAddress)}
                                disabled={!walletConnected}
                                className="flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 disabled:opacity-30 transition-all"
                              >
                                Refund
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-600">
        <p className="font-semibold">FundStreamPack Crowdfunding Platform &copy; 2026</p>
        <p className="mt-1 font-mono text-slate-700">Contract Factory Network: {factoryAddress}</p>
      </footer>
    </div>
  );
}
