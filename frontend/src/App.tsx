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
      } catch (err: any) {
        console.error('Create campaign transaction failed:', err);
        setTxStatus('error');
        setTxError(err.message || 'Create campaign failed');
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
      } catch (err: any) {
        console.error('Contribution failed:', err);
        setTxStatus('error');
        setTxError(err.message || 'Contribution failed');
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
      setTxError('Goal was not met. Campaign cannot be withdrawn');
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
      } catch (err: any) {
        console.error('Withdrawal failed:', err);
        setTxStatus('error');
        setTxError(err.message || 'Withdrawal failed');
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
      } catch (err: any) {
        console.error('Refund transaction failed:', err);
        setTxStatus('error');
        setTxError(err.message || 'Refund failed');
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
      return <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Expired</span>;
    }
    const secs = Number(diff % 60n);
    const mins = Number((diff / 60n) % 60n);
    const hours = Number(diff / 3600n);
    return (
      <span className="text-teal" style={{ fontWeight: 'bold' }}>
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header Navbar */}
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <span className="logo-text">FUNDSTREAMPACK</span>
            <span className="badge-soroban">Soroban L3</span>
          </div>

          <div className="flex-row">
            {walletConnected ? (
              <div className="flex-row">
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Wallet Balance</span>
                  <span className="text-teal text-mono" style={{ fontWeight: 'bold', fontSize: '14px' }}>
                    {tokenBalance} TOK | {nativeBalance} XLM
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="live-dot" style={{ backgroundColor: isSandbox ? '#f59e0b' : '#10b981' }}></span>
                  <span className="text-mono" style={{ fontSize: '13px' }}>{formatAddress(userAddress)}</span>
                </div>
                <button onClick={handleMintTokens} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                  Faucet Fnd
                </button>
                <button onClick={handleDisconnect} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex-row">
                <button onClick={() => handleConnectWallet('freighter')} className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Freighter Wallet
                </button>
                <button onClick={() => handleConnectWallet('sandbox')} className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Sandbox (Mock)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Campaign Container */}
      <main className="app-container main-layout">
        {/* Left Column: Forms, Live Feeds, and Info */}
        <div className="sidebar">
          {/* Active Campaign Creator Form */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <h2 className="card-title">Create Campaign</h2>
            <form onSubmit={handleCreateCampaign}>
              <div className="form-group">
                <label className="form-label">Goal Amount (TOK)</label>
                <input
                  type="number"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="form-input text-mono"
                  placeholder="e.g. 1000"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Duration (Seconds)</label>
                <input
                  type="number"
                  value={durationSecs}
                  onChange={(e) => setDurationSecs(e.target.value)}
                  className="form-input text-mono"
                  placeholder="e.g. 3600"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description / Metadata URL</label>
                <input
                  type="text"
                  value={metadataUri}
                  onChange={(e) => setMetadataUri(e.target.value)}
                  className="form-input"
                  placeholder="ipfs://..."
                />
              </div>

              {!walletConnected ? (
                <div style={{ fontSize: '12px', color: '#f59e0b', textAlign: 'center', padding: '8px 0', fontWeight: 'bold' }}>
                  Connect wallet to register campaign
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={txStatus !== 'idle' && txStatus !== 'success' && txStatus !== 'error'}
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                >
                  Launch Campaign
                </button>
              )}
            </form>
          </div>

          {/* Activity Feeds */}
          <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <h2 className="card-title">Live Activity Feed</h2>
            <div className="event-list">
              {recentEvents.length === 0 ? (
                <div className="text-muted" style={{ textAlign: 'center', padding: '30px 0', fontSize: '14px' }}>
                  No recent campaign events.
                </div>
              ) : (
                recentEvents.map((evt) => (
                  <div key={evt.id} className="event-card">
                    <div className="flex-between" style={{ marginBottom: '6px' }}>
                      <span className="badge-soroban" style={{ fontSize: '9px' }}>
                        {evt.type}
                      </span>
                      <span className="text-muted text-mono" style={{ fontSize: '10px' }}>Ledger #{evt.ledger}</span>
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '13px', fontWeight: '600' }}>{evt.value.toString()}</p>
                    {evt.topics[1] && (
                      <span className="text-muted text-mono" style={{ fontSize: '10px' }}>
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
        <div className="content-section">
          {/* Transaction Steps & Error Logs */}
          {txStatus !== 'idle' && (
            <div className={`alert-box ${
              txStatus === 'error' ? 'alert-error' :
              txStatus === 'success' ? 'alert-success' :
              'alert-info'
            }`}>
              <div className="flex-between" style={{ marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Transaction Monitor</span>
                <button onClick={() => setTxStatus('idle')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}>Dismiss</button>
              </div>
              <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                <span className="live-dot" style={{ backgroundColor: txStatus === 'error' ? '#ef4444' : txStatus === 'success' ? '#10b981' : '#6366f1' }}></span>
                <span style={{ fontWeight: '800', fontSize: '13px', textTransform: 'uppercase' }}>{txStatus}</span>
                {txHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-mono"
                    style={{ fontSize: '12px', color: '#2dd4bf', textDecoration: 'underline' }}
                  >
                    View TX on Explorer
                  </a>
                )}
              </div>
              {txError && <p style={{ fontSize: '12px', margin: '8px 0 0 0', padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>{txError}</p>}
            </div>
          )}

          {/* Search/Sort and Controls */}
          <div className="flex-between" style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns by address..."
                className="form-input"
                style={{ padding: '8px 12px', fontSize: '13px' }}
              />
            </div>
            <div className="flex-row">
              {(['all', 'active', 'success', 'failed'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className="btn-secondary"
                  style={{ 
                    padding: '6px 12px', 
                    fontSize: '11px', 
                    background: filterStatus === st ? 'rgba(99,102,241,0.15)' : '',
                    borderColor: filterStatus === st ? 'var(--primary)' : ''
                  }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Campaigns Grid */}
          <div className="grid-container">
            {loadingCampaigns ? (
              <div className="text-muted shimmer" style={{ gridColumn: '1 / -1', padding: '60px 0', textAlign: 'center', borderRadius: '16px' }}>
                Fetching active campaigns from Soroban ledger...
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="text-muted" style={{ gridColumn: '1 / -1', padding: '60px 0', textAlign: 'center', border: '2px dashed rgba(255,255,255,0.05)', borderRadius: '16px', fontSize: '15px' }}>
                No crowdfunding campaigns matched current search criteria.
              </div>
            ) : (
              filteredCampaigns.map((camp) => {
                const progress = calculateProgress(camp.raised, camp.goal);
                const isFinished = camp.ended;
                
                return (
                  <div key={camp.contractAddress} className="glass-card campaign-card">
                    {/* Top image banner wrapper */}
                    <div className="campaign-header-img" style={{ backgroundImage: camp.metadataUri.startsWith('http') ? `url(${camp.metadataUri})` : 'none' }}>
                      {!camp.metadataUri.startsWith('http') && (
                        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--primary)' }}>METADATA:</span>
                          <p style={{ margin: '4px 0', color: '#e4e4e7', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{camp.metadataUri}</p>
                        </div>
                      )}
                      
                      <div className="campaign-overlay">
                        <div className="flex-between">
                          <span className="text-mono" style={{ fontSize: '11px', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
                            {formatAddress(camp.contractAddress)}
                          </span>
                          {camp.goalMet && (
                            <span style={{ fontSize: '10px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              GOAL MET 🏆
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Progress Metrics and Actions */}
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', flex: '1', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="flex-between" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          <span>Creator:</span>
                          <span className="text-mono">{formatAddress(camp.creator)}</span>
                        </div>

                        {/* Progress Bar math */}
                        <div style={{ marginTop: '4px' }}>
                          <div className="flex-between" style={{ fontSize: '13px', marginBottom: '4px' }}>
                            <span style={{ fontWeight: '800', color: '#f4f4f5' }}>{camp.raised.toString()} TOK <span style={{ fontWeight: 'normal', fontSize: '11px', color: 'var(--text-muted)' }}>raised</span></span>
                            <span className="text-teal text-mono" style={{ fontWeight: 'bold' }}>{progress}%</span>
                          </div>
                          <div className="progress-bar-container">
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                          </div>
                          <div className="flex-between" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            <span>Goal: {camp.goal.toString()} TOK</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>Ends:</span> {renderTimeLeft(camp.deadline)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Campaign Control Button Form */}
                      <div>
                        {isFinished ? (
                          <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Campaign Concluded
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {/* Donate input group */}
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <input
                                type="number"
                                value={contributionAmounts[camp.contractAddress] || ''}
                                onChange={(e) => setContributionAmounts({
                                  ...contributionAmounts,
                                  [camp.contractAddress]: e.target.value
                                })}
                                disabled={!walletConnected}
                                placeholder="Amount"
                                className="form-input text-mono"
                                style={{ padding: '6px 10px', fontSize: '12px', flex: '1' }}
                              />
                              <button
                                onClick={() => handleContribute(camp.contractAddress)}
                                disabled={!walletConnected}
                                className="btn-primary"
                                style={{ padding: '6px 16px', fontSize: '12px', whiteSpace: 'nowrap' }}
                              >
                                Donate
                              </button>
                            </div>

                            {/* Withdrawal/Refund actions */}
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleWithdraw(camp)}
                                disabled={!walletConnected}
                                className="btn-secondary"
                                style={{ flex: '1', padding: '6px 8px', fontSize: '11px', justifyContent: 'center' }}
                              >
                                Withdraw
                              </button>
                              <button
                                onClick={() => handleRefund(camp.contractAddress)}
                                disabled={!walletConnected}
                                className="btn-secondary"
                                style={{ flex: '1', padding: '6px 8px', fontSize: '11px', justifyContent: 'center', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
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
      <footer style={{ borderTop: '1px solid var(--border-glow)', padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', background: '#050508', marginTop: '40px' }}>
        <p style={{ margin: '0', fontWeight: 'bold' }}>FundStreamPack Crowdfunding Platform &copy; 2026</p>
        <p className="text-mono" style={{ margin: '4px 0 0 0', color: 'rgba(255,255,255,0.2)' }}>Contract Factory: {factoryAddress}</p>
      </footer>
    </div>
  );
}
