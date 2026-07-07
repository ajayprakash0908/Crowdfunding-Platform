import { 
  rpc, 
  TransactionBuilder, 
  xdr, 
  scValToNative, 
  nativeToScVal, 
  Contract, 
  Transaction,
  TimeoutInfinite,
  Account
} from 'stellar-sdk';
import { StellarWalletsKit, WalletNetwork, FreighterModule, xBullModule } from '@creit.tech/stellar-wallets-kit';

// Network configuration
export const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || 'Test Stellar Network ; September 2015';

// Contract addresses
export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_CONTRACT_ADDRESS || '';
export const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS || 'CDLZFC3SYJYDZT7K67VZ75HPJFCBQ2BBVGTICN2V45PESTCTFBX6JGSZ'; // Default native XLM testnet wrapped

export const server = new rpc.Server(RPC_URL);

// Initialize Wallets Kit
export const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: 'freighter',
  modules: [
    new FreighterModule(),
    new xBullModule()
  ]
});

export interface DecodedEvent {
  id: string;
  type: string; // 'auction_created' | 'new_bid' | 'auction_ended'
  contractId: string;
  ledger: string;
  topics: any[];
  value: any;
  timestamp?: number;
}

// Fetch events from Stellar RPC
export async function getContractEvents(
  contractAddress: string, 
  startLedger?: number
): Promise<DecodedEvent[]> {
  try {
    // If startLedger is not provided, start from 1000 ledgers back to catch recent history
    let ledgerStart = startLedger;
    if (!ledgerStart) {
      const state = await server.getLatestLedger();
      ledgerStart = Math.max(state.sequence - 2000, 0);
    }

    const eventsResponse = await server.getEvents({
      startLedger: ledgerStart,
      filters: [
        {
          type: 'contract',
          contractIds: [contractAddress]
        }
      ],
      limit: 100
    });

    return eventsResponse.events.map((e) => {
      const decodedTopics = e.topic.map((t) => scValToNative(t));
      const decodedValue = scValToNative(e.value);
      
      let type = 'unknown';
      if (decodedTopics[0] === 'auction_created') type = 'auction_created';
      else if (decodedTopics[0] === 'new_bid') type = 'new_bid';
      else if (decodedTopics[0] === 'auction_ended') type = 'auction_ended';

      return {
        id: e.id,
        type,
        contractId: e.contractId.toString(),
        ledger: e.ledger.toString(),
        topics: decodedTopics,
        value: decodedValue,
        // Mock timestamp based on ledger index for sorting
        timestamp: Date.now() - (100 - Number(e.ledger) % 100) * 5000 
      };
    });
  } catch (err) {
    console.error('Error fetching contract events:', err);
    return [];
  }
}

// Submit a transaction with status tracking
export async function submitTransaction(
  sourceAddress: string,
  txOperation: xdr.Operation,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  try {
    onStatusChange('building');
    const account = await server.getAccount(sourceAddress);
    
    let transaction = new TransactionBuilder(account, {
      fee: '100000', // temporary fee placeholder
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(txOperation)
      .setTimeout(TimeoutInfinite)
      .build() as Transaction;

    // Simulate transaction to get fees and resource limits
    const sim = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    // Assemble the transaction using simulation resource fees
    transaction = rpc.assembleTransaction(transaction, sim).build() as Transaction;

    onStatusChange('awaiting signature');
    
    // Sign using wallets-kit
    const signedResult = await kit.signTransaction(transaction.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: sourceAddress
    });

    onStatusChange('submitting');
    
    const signedTx = TransactionBuilder.fromXDR(signedResult.signedTxXdr, NETWORK_PASSPHRASE) as Transaction;
    const sendResponse = await server.sendTransaction(signedTx);
    
    if (sendResponse.status === 'ERROR') {
      throw new Error(`RPC send error: ${JSON.stringify(sendResponse.errorResult)}`);
    }

    const txHash = sendResponse.hash;
    onStatusChange('confirming', txHash);

    // Poll transaction status
    let attempts = 0;
    while (attempts < 12) {
      const getResponse = await server.getTransaction(txHash);
      if (getResponse.status === 'SUCCESS') {
        onStatusChange('success', txHash);
        return txHash;
      } else if (getResponse.status === 'FAILED') {
        throw new Error('Transaction execution failed on ledger');
      }
      // Wait 3 seconds
      await new Promise((res) => setTimeout(res, 3000));
      attempts++;
    }
    throw new Error('Transaction polling timed out');
  } catch (err: any) {
    console.error('Submit transaction failed:', err);
    onStatusChange('error', undefined, err.message || 'Transaction rejected or failed');
    throw err;
  }
}

// 1. FACTORY: Create Auction
export async function createAuctionTx(
  sourceAddress: string,
  itemName: string,
  metadataUri: string,
  reservePrice: string,
  durationSecs: number,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(FACTORY_ADDRESS);
  const op = contract.call(
    'create_auction',
    nativeToScVal(sourceAddress, { type: 'address' }),
    nativeToScVal(TOKEN_ADDRESS, { type: 'address' }),
    nativeToScVal(itemName, { type: 'string' }),
    nativeToScVal(metadataUri, { type: 'string' }),
    nativeToScVal(BigInt(reservePrice), { type: 'i128' }),
    nativeToScVal(BigInt(durationSecs), { type: 'u64' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 2. AUCTION: Place Bid
export async function placeBidTx(
  sourceAddress: string,
  auctionAddress: string,
  amount: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(auctionAddress);
  const op = contract.call(
    'bid',
    nativeToScVal(sourceAddress, { type: 'address' }),
    nativeToScVal(BigInt(amount), { type: 'i128' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 3. AUCTION: End Auction
export async function endAuctionTx(
  sourceAddress: string,
  auctionAddress: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(auctionAddress);
  const op = contract.call(
    'end_auction',
    nativeToScVal(sourceAddress, { type: 'address' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 4. FACTORY: Get all auctions
export async function listAuctions(): Promise<string[]> {
  if (!FACTORY_ADDRESS) return [];
  try {
    const contract = new Contract(FACTORY_ADDRESS);
    const transaction = new TransactionBuilder(
      new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '-1'),
      {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE
      }
    )
      .addOperation(contract.call('list_auctions'))
      .setTimeout(TimeoutInfinite)
      .build();

    const sim = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      return [];
    }

    const value = xdr.ScVal.fromXDR(sim.result.retval.toXDR());
    const addresses = scValToNative(value) as any[];
    return addresses.map((addr) => addr.toString());
  } catch (err) {
    console.error('Failed to list auctions:', err);
    return [];
  }
}

// 5. AUCTION: Get status
export interface AuctionStatus {
  seller: string;
  token: string;
  itemName: string;
  itemMetadataUri: string;
  reservePrice: bigint;
  endTime: bigint;
  highestBid: bigint;
  highestBidder: string | null;
  ended: boolean;
  contractAddress: string;
}

export async function getAuctionStatus(auctionAddress: string): Promise<AuctionStatus | null> {
  try {
    const contract = new Contract(auctionAddress);
    const transaction = new TransactionBuilder(
      new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '-1'),
      {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE
      }
    )
      .addOperation(contract.call('get_status'))
      .setTimeout(TimeoutInfinite)
      .build();

    const sim = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      return null;
    }

    const scVal = xdr.ScVal.fromXDR(sim.result.retval.toXDR());
    const status = scValToNative(scVal) as any;

    return {
      seller: status.seller.toString(),
      token: status.token.toString(),
      itemName: status.item_name.toString(),
      itemMetadataUri: status.item_metadata_uri.toString(),
      reservePrice: BigInt(status.reserve_price.toString()),
      endTime: BigInt(status.end_time.toString()),
      highestBid: BigInt(status.highest_bid.toString()),
      highestBidder: status.highest_bidder ? status.highest_bidder.toString() : null,
      ended: status.ended,
      contractAddress: auctionAddress
    };
  } catch (err) {
    console.error(`Failed to query status for auction ${auctionAddress}:`, err);
    return null;
  }
}

// 6. TOKEN: Get Balance
export async function getTokenBalance(tokenAddress: string, userAddress: string): Promise<bigint> {
  try {
    const contract = new Contract(tokenAddress);
    const transaction = new TransactionBuilder(
      new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '-1'),
      {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE
      }
    )
      .addOperation(contract.call('balance', nativeToScVal(userAddress, { type: 'address' })))
      .setTimeout(TimeoutInfinite)
      .build();

    const sim = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      return 0n;
    }

    const val = xdr.ScVal.fromXDR(sim.result.retval.toXDR());
    return BigInt(scValToNative(val).toString());
  } catch (err) {
    console.error('Failed to fetch token balance:', err);
    return 0n;
  }
}

// 7. TOKEN: Mint Test Tokens
export async function mintTokensTx(
  sourceAddress: string,
  amount: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(TOKEN_ADDRESS);
  const op = contract.call(
    'mint',
    nativeToScVal(sourceAddress, { type: 'address' }),
    nativeToScVal(BigInt(amount), { type: 'i128' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}
