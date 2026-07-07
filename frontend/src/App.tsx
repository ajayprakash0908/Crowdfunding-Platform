import React, { useState, useEffect } from 'react';
import { 
  createAuctionTx, 
  placeBidTx, 
  endAuctionTx, 
  listAuctions, 
  getAuctionStatus, 
  getTokenBalance, 
  mintTokensTx,
  FACTORY_ADDRESS,
  TOKEN_ADDRESS,
  NETWORK_PASSPHRASE,
  getContractEvents,
  kit,
  type AuctionStatus,
  type DecodedEvent
} from './utils/stellar';

// Mock/Sandbox Mode Constants
const MOCK_SELLER = 'GDDS2SELLER...MOCK';
const MOCK_BIDDER_1 = 'GD352BIDDER1...MOCK';
const MOCK_BIDDER_2 = 'GD532BIDDER2...MOCK';

export default function App() {
  // Wallet state
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [nativeBalance, setNativeBalance] = useState<string>('0');
  const [tokenBalance, setTokenBalance] = useState<string>('0');
  const [isSandbox, setIsSandbox] = useState<boolean>(false);
  
  // Contracts state
  const factoryAddress = FACTORY_ADDRESS || 'CBDK...';
  const [auctions, setAuctions] = useState<AuctionStatus[]>([]);
  const [loadingAuctions, setLoadingAuctions] = useState<boolean>(false);
  const [recentEvents, setRecentEvents] = useState<DecodedEvent[]>([]);
  
  // Create Auction Form state
  const [itemName, setItemName] = useState<string>('');
  const [metadataUri, setMetadataUri] = useState<string>('');
  const [reservePrice, setReservePrice] = useState<string>('100');
  const [durationSecs, setDurationSecs] = useState<string>('3600');
  
  // Bidding Form state
  const [bidAmounts, setBidAmounts] = useState<{ [contractAddr: string]: string }>({});
  
  // Transaction Progress state
  const [txStatus, setTxStatus] = useState<string>('idle'); // idle, building, awaiting signature, submitting, confirming, success, error
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [txError, setTxError] = useState<string | undefined>(undefined);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'endTime' | 'highestBid'>('endTime');

  // Trigger countdown ticks
  const [_tick, setTick] = useState<number>(0);

  // Poll intervals
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize and load initial auctions
  useEffect(() => {
    if (isSandbox) {
      loadSandboxAuctions();
    } else {
      loadRealAuctions();
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

  // Load Real Auctions from Soroban Factory
  const loadRealAuctions = async () => {
    if (!factoryAddress || factoryAddress.startsWith('CBDK')) return;
    setLoadingAuctions(true);
    try {
      const addresses = await listAuctions();
      const loaded: AuctionStatus[] = [];
      for (const addr of addresses) {
        const status = await getAuctionStatus(addr);
        if (status) {
          loaded.push(status);
        }
      }
      setAuctions(loaded);
    } catch (err) {
      console.error('Failed to load real auctions:', err);
    } finally {
      setLoadingAuctions(false);
    }
  };

  // Load Initial Mock Auctions for Sandbox Mode
  const loadSandboxAuctions = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const mockList: AuctionStatus[] = [
      {
        contractAddress: 'CAUC_MOCK_GOLDEN_SWORD',
        seller: MOCK_SELLER,
        token: TOKEN_ADDRESS,
        itemName: 'Mythic Golden Sword',
        itemMetadataUri: 'https://images.unsplash.com/photo-1595152772835-219674b2a8a6?w=200&auto=format&fit=crop&q=60',
        reservePrice: 250n,
        endTime: now + 120n, // 2 minutes remaining
        highestBid: 250n,
        highestBidder: MOCK_BIDDER_1,
        ended: false
      },
      {
        contractAddress: 'CAUC_MOCK_CYBER_CROWN',
        seller: MOCK_SELLER,
        token: TOKEN_ADDRESS,
        itemName: 'Cyber Neon Crown',
        itemMetadataUri: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=60',
        reservePrice: 500n,
        endTime: now + 3600n, // 1 hour remaining
        highestBid: 0n,
        highestBidder: null,
        ended: false
      },
      {
        contractAddress: 'CAUC_MOCK_PIXEL_SHIELD',
        seller: MOCK_SELLER,
        token: TOKEN_ADDRESS,
        itemName: 'Vintage Pixel Shield',
        itemMetadataUri: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop&q=60',
        reservePrice: 100n,
        endTime: now - 30n, // Expired
        highestBid: 450n,
        highestBidder: MOCK_BIDDER_2,
        ended: false
      }
    ];
    setAuctions(mockList);
  };

  // Refresh native and token balances
  const refreshBalances = async () => {
    if (!userAddress) return;
    if (isSandbox) {
      // Keep static mock balance or read from localStorage
      const cached = localStorage.getItem(`sandbox_bal_${userAddress}`);
      setTokenBalance(cached || '10000');
      setNativeBalance('150');
    } else {
      try {
        const bal = await getTokenBalance(TOKEN_ADDRESS, userAddress);
        setTokenBalance(bal.toString());
        // Simple mock for Native XLM to avoid heavy RPC calls
        setNativeBalance('85.4');
      } catch (err) {
        console.error('Balance check failed:', err);
      }
    }
  };

  // Poll Real Soroban Events
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
        type: 'sandbox_connect',
        contractId: 'SANDBOX',
        ledger: '1',
        topics: ['Wallet Connected', randAddr],
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
        
        // Load initial real events
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

  // Mint Tokens (Testnet Faucet / Sandbox Mint)
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
          type: 'new_bid',
          contractId: TOKEN_ADDRESS,
          ledger: '99',
          topics: ['token_mint', userAddress],
          value: 500,
          timestamp: Date.now()
        };
        setRecentEvents((prev) => [mockEvt, ...prev]);
        setTimeout(() => setTxStatus('idle'), 2000);
      }, 1000);
    } else {
      try {
        await mintTokensTx(userAddress, '1000', (status, hash, err) => {
          setTxStatus(status);
          setTxHash(hash);
          setTxError(err);
        });
        refreshBalances();
      } catch (err) {
        console.error('Mint failed', err);
      }
    }
  };

  // Create Auction Submit
  const handleCreateAuction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName || !reservePrice || !durationSecs) return;
    
    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('awaiting signature');
        setTimeout(() => {
          setTxStatus('submitting');
          setTimeout(() => {
            const now = BigInt(Math.floor(Date.now() / 1000));
            const newAuctionAddr = `CAUC_MOCK_${itemName.replace(/\s+/g, '_').toUpperCase()}_${Date.now()}`;
            const newAuction: AuctionStatus = {
              contractAddress: newAuctionAddr,
              seller: userAddress,
              token: TOKEN_ADDRESS,
              itemName,
              itemMetadataUri: metadataUri || 'https://images.unsplash.com/photo-1563089145-599997674d42?w=200&auto=format&fit=crop&q=60',
              reservePrice: BigInt(reservePrice),
              endTime: now + BigInt(durationSecs),
              highestBid: 0n,
              highestBidder: null,
              ended: false
            };
            setAuctions([newAuction, ...auctions]);
            
            const mockEvt: DecodedEvent = {
              id: `evt_create_${Date.now()}`,
              type: 'auction_created',
              contractId: factoryAddress,
              ledger: '100',
              topics: ['auction_created', userAddress, newAuctionAddr],
              value: [itemName, reservePrice, durationSecs],
              timestamp: Date.now()
            };
            setRecentEvents((prev) => [mockEvt, ...prev]);

            setTxStatus('success');
            setItemName('');
            setMetadataUri('');
            setTimeout(() => setTxStatus('idle'), 2000);
          }, 800);
        }, 800);
      }, 500);
    } else {
      try {
        await createAuctionTx(
          userAddress,
          itemName,
          metadataUri || 'ipfs://placeholder',
          reservePrice,
          parseInt(durationSecs),
          (status, hash, err) => {
            setTxStatus(status);
            setTxHash(hash);
            setTxError(err);
          }
        );
        setItemName('');
        setMetadataUri('');
        loadRealAuctions();
      } catch (err) {
        console.error('Create auction failed', err);
      }
    }
  };

  // Place Bid Submit
  const handlePlaceBid = async (auctionAddress: string) => {
    const amount = bidAmounts[auctionAddress];
    if (!amount) return;
    const bidValue = BigInt(amount);

    const targetAuction = auctions.find((a) => a.contractAddress === auctionAddress);
    if (!targetAuction) return;

    if (bidValue <= targetAuction.highestBid) {
      alert(`Bid must be higher than current highest bid (${targetAuction.highestBid} tokens)`);
      return;
    }
    if (bidValue < targetAuction.reservePrice) {
      alert(`Bid must be at least the reserve price (${targetAuction.reservePrice} tokens)`);
      return;
    }

    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('awaiting signature');
        setTimeout(() => {
          setTxStatus('submitting');
          setTimeout(() => {
            // Apply outbid refund simulation or balance checks
            const currentBal = BigInt(tokenBalance);
            if (currentBal < bidValue) {
              setTxStatus('error');
              setTxError('Insufficient wrapped token balance');
              return;
            }

            // Update local state
            setAuctions(
              auctions.map((a) => {
                if (a.contractAddress === auctionAddress) {
                  // If anti-sniping threshold (60s) is violated, extend auction by 60s
                  const now = BigInt(Math.floor(Date.now() / 1000));
                  const timeLeft = a.endTime - now;
                  let newEndTime = a.endTime;
                  if (timeLeft > 0n && timeLeft <= 60n) {
                    newEndTime = now + 60n;
                  }

                  return {
                    ...a,
                    highestBid: bidValue,
                    highestBidder: userAddress,
                    endTime: newEndTime
                  };
                }
                return a;
              })
            );

            // Deduct balance
            const newBal = (currentBal - bidValue).toString();
            setTokenBalance(newBal);
            localStorage.setItem(`sandbox_bal_${userAddress}`, newBal);

            const mockEvt: DecodedEvent = {
              id: `evt_bid_${Date.now()}`,
              type: 'new_bid',
              contractId: auctionAddress,
              ledger: '101',
              topics: ['new_bid', userAddress, bidValue.toString()],
              value: targetAuction.endTime,
              timestamp: Date.now()
            };
            setRecentEvents((prev) => [mockEvt, ...prev]);

            setTxStatus('success');
            setBidAmounts({ ...bidAmounts, [auctionAddress]: '' });
            setTimeout(() => setTxStatus('idle'), 2000);
          }, 800);
        }, 800);
      }, 500);
    } else {
      try {
        await placeBidTx(userAddress, auctionAddress, amount, (status, hash, err) => {
          setTxStatus(status);
          setTxHash(hash);
          setTxError(err);
        });
        setBidAmounts({ ...bidAmounts, [auctionAddress]: '' });
        loadRealAuctions();
        refreshBalances();
      } catch (err) {
        console.error('Bid failed', err);
      }
    }
  };

  // End Auction Action
  const handleEndAuction = async (auctionAddress: string) => {
    if (isSandbox) {
      setTxStatus('building');
      setTimeout(() => {
        setTxStatus('submitting');
        setTimeout(() => {
          setAuctions(
            auctions.map((a) => {
              if (a.contractAddress === auctionAddress) {
                return { ...a, ended: true };
              }
              return a;
            })
          );
          
          const target = auctions.find((a) => a.contractAddress === auctionAddress);
          const mockEvt: DecodedEvent = {
            id: `evt_end_${Date.now()}`,
            type: 'auction_ended',
            contractId: auctionAddress,
            ledger: '102',
            topics: ['auction_ended', target?.seller || '', target?.highestBidder || 'None'],
            value: target?.highestBid.toString() || '0',
            timestamp: Date.now()
          };
          setRecentEvents((prev) => [mockEvt, ...prev]);

          setTxStatus('success');
          setTimeout(() => setTxStatus('idle'), 2000);
        }, 800);
      }, 500);
    } else {
      try {
        await endAuctionTx(userAddress, auctionAddress, (status, hash, err) => {
          setTxStatus(status);
          setTxHash(hash);
          setTxError(err);
        });
        loadRealAuctions();
        refreshBalances();
      } catch (err) {
        console.error('End auction failed', err);
      }
    }
  };

  // Format countdown string
  const formatTimeLeft = (endTime: bigint) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const diff = endTime - now;
    if (diff <= 0n) return 'Expired';
    
    const hrs = diff / 3600n;
    const mins = (diff % 3600n) / 60n;
    const secs = diff % 60n;
    
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Filtered & Sorted Auctions
  const filteredAuctions = auctions
    .filter((a) => {
      const matchSearch = a.itemName.toLowerCase().includes(searchQuery.toLowerCase());
      const now = BigInt(Math.floor(Date.now() / 1000));
      const expired = a.endTime <= now || a.ended;
      if (filterStatus === 'active') return matchSearch && !expired;
      if (filterStatus === 'completed') return matchSearch && expired;
      return matchSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'endTime') {
        return Number(a.endTime - b.endTime);
      } else {
        return Number(b.highestBid - a.highestBid);
      }
    });

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px' }}>
      {/* HEADER */}
      <header className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="live-dot"></div>
          <div>
            <h1 className="glow-text-rainbow" style={{ fontSize: '24px', margin: 0 }}>Stellar Soroban Auctions</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '2px 0 0 0' }}>
              Connected to <strong style={{ color: '#818cf8' }}>Testnet</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {walletConnected && (
            <div style={{ display: 'flex', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '8px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>XLM Balance</span>
                <strong style={{ fontSize: '14px', color: '#10b981' }}>{nativeBalance} XLM</strong>
              </div>
              <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Wrapped Token</span>
                <strong style={{ fontSize: '14px', color: 'var(--secondary)' }}>{tokenBalance} BID</strong>
              </div>
            </div>
          )}

          {walletConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="glass-card" style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)' }}>
                {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
                {isSandbox && <span style={{ marginLeft: '6px', fontSize: '10px', padding: '2px 6px', background: '#3b82f6', borderRadius: '4px' }}>Sandbox</span>}
              </span>
              <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={() => handleConnectWallet('freighter')}>
                Connect Freighter
              </button>
              <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px', borderColor: '#3b82f6' }} onClick={() => handleConnectWallet('sandbox')}>
                Enter Sandbox
              </button>
            </div>
          )}
        </div>
      </header>

      {/* DASHBOARD METRICS */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Total Auctions Registered</span>
          <h2 style={{ fontSize: '28px', marginTop: '6px' }}>{auctions.length}</h2>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Active Auctions</span>
          <h2 style={{ fontSize: '28px', marginTop: '6px', color: '#10b981' }}>
            {auctions.filter((a) => {
              const now = BigInt(Math.floor(Date.now() / 1000));
              return a.endTime > now && !a.ended;
            }).length}
          </h2>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Highest Bid Recorded</span>
          <h2 style={{ fontSize: '28px', marginTop: '6px', color: 'var(--secondary)' }}>
            {Math.max(...auctions.map((a) => Number(a.highestBid)), 0)} BID
          </h2>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Network Passphrase</span>
          <h2 style={{ fontSize: '13px', marginTop: '12px', color: 'var(--text-muted)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {NETWORK_PASSPHRASE}
          </h2>
        </div>
      </section>

      {/* MAIN TWO-COLUMN BODY */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '32px', alignItems: 'start' }}>
        {/* LEFT COLUMN: auctions grid */}
        <div>
          {/* SEARCH & FILTERS BAR */}
          <div className="glass-card" style={{ display: 'flex', gap: '16px', padding: '16px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              className="form-input" 
              placeholder="Search items..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 2, minWidth: '200px' }}
            />
            
            <select 
              className="form-input" 
              value={filterStatus}
              onChange={(e: any) => setFilterStatus(e.target.value)}
              style={{ flex: 1, minWidth: '130px' }}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="completed">Completed Only</option>
            </select>

            <select 
              className="form-input" 
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              style={{ flex: 1, minWidth: '130px' }}
            >
              <option value="endTime">Sort by Time Remaining</option>
              <option value="highestBid">Sort by Highest Bid</option>
            </select>
          </div>

          {loadingAuctions ? (
            <div className="glass-card shimmer" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '16px' }}>
              <h3>Loading smart contract auctions...</h3>
            </div>
          ) : filteredAuctions.length === 0 ? (
            <div className="glass-card" style={{ padding: '48px', textAlign: 'center', borderRadius: '16px' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>No auctions match your filters.</h3>
              <p style={{ marginTop: '8px' }}>Create one on the right sidebar to get started!</p>
            </div>
          ) : (
            <div className="grid-container">
              {filteredAuctions.map((auc) => {
                const now = BigInt(Math.floor(Date.now() / 1000));
                const expired = auc.endTime <= now;
                const isWinner = auc.highestBidder === userAddress;
                
                return (
                  <div key={auc.contractAddress} className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ height: '180px', position: 'relative', background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)' }}>
                      {auc.itemMetadataUri.startsWith('http') ? (
                        <img 
                          src={auc.itemMetadataUri} 
                          alt={auc.itemName} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '48px' }}>
                          📦
                        </div>
                      )}
                      
                      {/* Badge status */}
                      <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '6px' }}>
                        {isWinner && userAddress && (
                          <span style={{ 
                            padding: '4px 10px', 
                            borderRadius: '8px', 
                            fontSize: '11px', 
                            fontWeight: 'bold',
                            background: '#eab308',
                            color: 'black'
                          }}>
                            {auc.ended ? '🏆 WON' : '🏆 WINNING'}
                          </span>
                        )}
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: '8px', 
                          fontSize: '11px', 
                          fontWeight: 'bold',
                          background: auc.ended ? '#3f3f46' : expired ? '#ef4444' : '#10b981',
                          color: 'white'
                        }}>
                          {auc.ended ? 'ENDED' : expired ? 'EXPIRED' : 'LIVE'}
                        </span>
                      </div>
                    </div>

                    <div style={{ padding: '20px', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>{auc.itemName}</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '4px 0', fontFamily: 'monospace' }}>
                          Contract: {auc.contractAddress.slice(0, 8)}...{auc.contractAddress.slice(-6)}
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '4px 0', fontFamily: 'monospace' }}>
                          Seller: {auc.seller.slice(0, 8)}...{auc.seller.slice(-6)}
                        </p>
                      </div>

                      <div style={{ margin: '16px 0', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Highest Bid</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--secondary)' }}>
                            {auc.highestBid > 0n ? `${auc.highestBid} BID` : 'No bids yet'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Reserve Price</span>
                          <span style={{ fontWeight: '500' }}>{auc.reservePrice.toString()} BID</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Time Remaining</span>
                          <span style={{ fontWeight: 'bold', color: expired ? '#ef4444' : '#6366f1', fontFamily: 'monospace' }}>
                            {formatTimeLeft(auc.endTime)}
                          </span>
                        </div>
                      </div>

                      {/* BIDDING CONTROLS */}
                      <div>
                        {auc.ended ? (
                          <div style={{ textAlign: 'center', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>
                              {auc.highestBidder ? `Won by ${auc.highestBidder.slice(0, 6)}...${auc.highestBidder.slice(-4)}` : 'Reserve not met / Ended'}
                            </p>
                          </div>
                        ) : expired ? (
                          <button 
                            className="btn-primary" 
                            style={{ width: '100%', justifyContent: 'center' }}
                            disabled={!walletConnected}
                            onClick={() => handleEndAuction(auc.contractAddress)}
                          >
                            {walletConnected ? 'Finalize & Payout' : 'Connect Wallet to End'}
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input 
                              type="number" 
                              className="form-input" 
                              placeholder="Bid amount..."
                              value={bidAmounts[auc.contractAddress] || ''}
                              onChange={(e) => setBidAmounts({
                                ...bidAmounts,
                                [auc.contractAddress]: e.target.value
                              })}
                              style={{ width: '60%' }}
                            />
                            <button 
                              className="btn-primary"
                              style={{ flexGrow: 1, padding: '10px 12px', fontSize: '13px' }}
                              disabled={!walletConnected}
                              onClick={() => handlePlaceBid(auc.contractAddress)}
                            >
                              Place Bid
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: create form, faucets, status */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* CONFIG & DEV UTILS */}
          {walletConnected && (
            <div className="glass-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Developer Sandbox Faucet</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '14px' }}>
                Mint test BID tokens to bid in auctions.
              </p>
              <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleMintTokens}>
                🎁 Mint 500 BID
              </button>
            </div>
          )}

          {/* CREATE AUCTION FORM */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>List New Item</h3>
            <form onSubmit={handleCreateAuction} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Item Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Rare Cyber Helmet" 
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Metadata / Image URL</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="ipfs://... or https://image" 
                  value={metadataUri}
                  onChange={(e) => setMetadataUri(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Reserve Price</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="100" 
                    value={reservePrice}
                    onChange={(e) => setReservePrice(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Duration (secs)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="3600" 
                    value={durationSecs}
                    onChange={(e) => setDurationSecs(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                disabled={!walletConnected}
              >
                Launch Auction
              </button>
            </form>
          </div>

          {/* REAL-TIME EVENT STREAM */}
          <div className="glass-card" style={{ padding: '20px', maxHeight: '400px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px' }}>Live Event Feed</h3>
              <span className="live-dot" style={{ background: '#10b981' }}></span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentEvents.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '16px 0' }}>
                  No events recorded yet.
                </p>
              ) : (
                recentEvents.map((evt) => (
                  <div key={evt.id} style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderLeft: '3px solid var(--primary)', borderRadius: '0 8px 8px 0', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '600', marginBottom: '4px' }}>
                      <span style={{ color: '#a5b4fc' }}>{evt.type.toUpperCase().replace('_', ' ')}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Ledger {evt.ledger}</span>
                    </div>
                    {evt.type === 'auction_created' && (
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px' }}>
                        Seller: {evt.topics[1]?.toString().slice(0, 6)}... created dynamic auction at {evt.topics[2]?.toString().slice(0, 6)}...
                      </p>
                    )}
                    {evt.type === 'new_bid' && (
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px' }}>
                        Bidder: {evt.topics[1]?.toString().slice(0, 6)}... placed bid of {evt.topics[2]?.toString()} BID
                      </p>
                    )}
                    {evt.type === 'auction_ended' && (
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px' }}>
                        Auction finalized. Winner: {evt.topics[2]?.toString().slice(0, 6)}... with bid of {evt.value?.toString()} BID
                      </p>
                    )}
                    {evt.type === 'sandbox_connect' && (
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px' }}>
                        User {evt.topics[1]?.toString().slice(0, 6)}... connected to Sandbox environment.
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* TRANSACTION OVERLAY MODAL */}
      {txStatus !== 'idle' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(3, 3, 3, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="glass-card" style={{ padding: '32px', width: '90%', maxWidth: '440px', textAlign: 'center' }}>
            {txStatus === 'building' && (
              <>
                <div className="live-dot" style={{ background: '#3b82f6', width: '24px', height: '24px', margin: '0 auto 16px auto' }}></div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Simulating Host Call</h3>
                <p style={{ color: 'var(--text-muted)' }}>Simulating transaction parameters and calculating gas resource fees on Stellar network...</p>
              </>
            )}

            {txStatus === 'awaiting signature' && (
              <>
                <div className="live-dot" style={{ background: '#eab308', width: '24px', height: '24px', margin: '0 auto 16px auto' }}></div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Awaiting Wallet Signature</h3>
                <p style={{ color: 'var(--text-muted)' }}>Please review and sign the transaction envelope in your wallet extension...</p>
              </>
            )}

            {txStatus === 'submitting' && (
              <>
                <div className="live-dot" style={{ background: '#a855f7', width: '24px', height: '24px', margin: '0 auto 16px auto' }}></div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Broadcasting to Stellar</h3>
                <p style={{ color: 'var(--text-muted)' }}>Sending signed transaction envelope to Soroban RPC node...</p>
              </>
            )}

            {txStatus === 'confirming' && (
              <>
                <div className="live-dot" style={{ background: '#6366f1', width: '24px', height: '24px', margin: '0 auto 16px auto' }}></div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Confirming on Ledger</h3>
                <p style={{ color: 'var(--text-muted)' }}>Transaction broadcasted. Polling ledger consensus for result...</p>
                {txHash && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', background: 'rgba(255,255,255,0.03)', padding: '6px', borderRadius: '4px', wordBreak: 'break-all', marginTop: '12px' }}>
                    Hash: {txHash}
                  </p>
                )}
              </>
            )}

            {txStatus === 'success' && (
              <>
                <div style={{ color: '#10b981', fontSize: '48px', marginBottom: '16px' }}>✓</div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px', color: '#10b981' }}>Transaction Confirmed!</h3>
                <p style={{ color: 'var(--text-muted)' }}>Successfully finalized on the Stellar consensus ledger.</p>
                {txHash && (
                  <a 
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ display: 'inline-block', marginTop: '14px', fontSize: '13px', textDecoration: 'underline' }}
                  >
                    View on Stellar Expert Explorer
                  </a>
                )}
                <div style={{ marginTop: '20px' }}>
                  <button className="btn-secondary" style={{ padding: '6px 16px' }} onClick={() => setTxStatus('idle')}>
                    Close
                  </button>
                </div>
              </>
            )}

            {txStatus === 'error' && (
              <>
                <div style={{ color: '#ef4444', fontSize: '48px', marginBottom: '16px' }}>⚠</div>
                <h3 style={{ fontSize: '20px', marginBottom: '8px', color: '#ef4444' }}>Transaction Failed</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', wordBreak: 'break-word', background: 'rgba(239, 68, 68, 0.05)', padding: '12px', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px' }}>
                  {txError || 'An unknown error occurred during execution.'}
                </p>
                <div style={{ marginTop: '20px' }}>
                  <button className="btn-secondary" style={{ padding: '6px 16px' }} onClick={() => setTxStatus('idle')}>
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
