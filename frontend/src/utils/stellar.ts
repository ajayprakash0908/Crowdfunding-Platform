import { 
  rpc, 
  TransactionBuilder, 
  xdr, 
  scValToNative, 
  nativeToScVal, 
  Contract, 
  Transaction,
  TimeoutInfinite,
  Account,
  Address
} from 'stellar-sdk';
import { StellarWalletsKit, WalletNetwork, FreighterModule, xBullModule } from '@creit.tech/stellar-wallets-kit';

// Network configuration
export const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || 'Test Stellar Network ; September 2015';

// Contract addresses
export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_CONTRACT_ADDRESS || 'CB7SNUNVEH562AGTFPV4O34ITUOO7FRZIJYRCYI3OEHSVY5WFZ4GT7FR';
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
  type: string; // 'campaign_created' | 'contribution' | 'withdrawn' | 'refunded' | 'unknown'
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
    if (!contractAddress) return [];
    
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
      const eventTopic = decodedTopics[0]?.toString();
      
      if (eventTopic === 'campaign_created') type = 'campaign_created';
      else if (eventTopic === 'contribution') type = 'contribution';
      else if (eventTopic === 'withdrawn') type = 'withdrawn';
      else if (eventTopic === 'refunded') type = 'refunded';

      return {
        id: e.id,
        type,
        contractId: e.contractId.toString(),
        ledger: e.ledger.toString(),
        topics: decodedTopics,
        value: decodedValue,
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
      fee: '100000', 
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(txOperation)
      .setTimeout(TimeoutInfinite)
      .build() as Transaction;

    const sim = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    transaction = rpc.assembleTransaction(transaction, sim).build() as Transaction;

    onStatusChange('awaiting signature');
    
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

    let attempts = 0;
    while (attempts < 12) {
      const getResponse = await server.getTransaction(txHash);
      if (getResponse.status === 'SUCCESS') {
        onStatusChange('success', txHash);
        return txHash;
      } else if (getResponse.status === 'FAILED') {
        throw new Error('Transaction execution failed on ledger');
      }
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

// 1. FACTORY: Create Campaign
export async function createCampaignTx(
  sourceAddress: string,
  goal: string,
  durationSecs: number,
  metadataUri: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(FACTORY_ADDRESS);
  const op = contract.call(
    'create_campaign',
    nativeToScVal(Address.fromString(sourceAddress), { type: 'address' }),
    nativeToScVal(Address.fromString(TOKEN_ADDRESS), { type: 'address' }),
    nativeToScVal(BigInt(goal), { type: 'i128' }),
    nativeToScVal(BigInt(durationSecs), { type: 'u64' }),
    nativeToScVal(metadataUri, { type: 'string' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 2. CAMPAIGN: Contribute
export async function contributeTx(
  sourceAddress: string,
  campaignAddress: string,
  amount: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(campaignAddress);
  const op = contract.call(
    'contribute',
    nativeToScVal(Address.fromString(sourceAddress), { type: 'address' }),
    nativeToScVal(BigInt(amount), { type: 'i128' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 3. CAMPAIGN: Withdraw
export async function withdrawTx(
  sourceAddress: string,
  campaignAddress: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(campaignAddress);
  const op = contract.call(
    'withdraw',
    nativeToScVal(Address.fromString(sourceAddress), { type: 'address' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 4. CAMPAIGN: Refund
export async function refundTx(
  sourceAddress: string,
  campaignAddress: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(campaignAddress);
  const op = contract.call(
    'refund',
    nativeToScVal(Address.fromString(sourceAddress), { type: 'address' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 5. FACTORY: List campaigns
export async function listCampaigns(): Promise<string[]> {
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
      .addOperation(contract.call('list_campaigns'))
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
    console.error('Failed to list campaigns:', err);
    return [];
  }
}

// 6. CAMPAIGN: Get status
export interface CampaignStatus {
  raised: bigint;
  goal: bigint;
  deadline: bigint;
  goalMet: boolean; // Map goal_met
  creator: string;
  token: string;
  ended: boolean;
  metadataUri: string;
  contractAddress: string;
}

export async function getCampaignStatus(campaignAddress: string): Promise<CampaignStatus | null> {
  try {
    const contract = new Contract(campaignAddress);
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
      raised: BigInt(status.raised.toString()),
      goal: BigInt(status.goal.toString()),
      deadline: BigInt(status.deadline.toString()),
      goalMet: status.goal_met,
      creator: status.creator.toString(),
      token: status.token.toString(),
      ended: status.ended,
      metadataUri: status.metadata_uri.toString(),
      contractAddress: campaignAddress
    };
  } catch (err) {
    console.error(`Failed to query status for campaign ${campaignAddress}:`, err);
    return null;
  }
}

// 7. TOKEN: Get Balance
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
      .addOperation(contract.call('balance', nativeToScVal(Address.fromString(userAddress), { type: 'address' })))
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

// 8. TOKEN: Mint Test Tokens
export async function mintTokensTx(
  sourceAddress: string,
  amount: string,
  onStatusChange: (status: string, txHash?: string, error?: string) => void
): Promise<string> {
  const contract = new Contract(TOKEN_ADDRESS);
  const op = contract.call(
    'mint',
    nativeToScVal(Address.fromString(sourceAddress), { type: 'address' }),
    nativeToScVal(BigInt(amount), { type: 'i128' })
  );

  return submitTransaction(sourceAddress, op, onStatusChange);
}

// 9. Crowdfunding Utilities for UI Logic & Testing
export function calculateProgress(raised: bigint, goal: bigint): number {
  if (goal <= 0n) return 0;
  const progress = Number((raised * 100n) / goal);
  return progress > 100 ? 100 : progress;
}

export function validateCampaignInputs(
  goal: string, 
  durationSecs: string, 
  metadataUri: string
): { valid: boolean; error?: string } {
  if (!goal || isNaN(Number(goal)) || Number(goal) <= 0) {
    return { valid: false, error: 'Goal must be a positive number' };
  }
  if (!durationSecs || isNaN(Number(durationSecs)) || Number(durationSecs) <= 0) {
    return { valid: false, error: 'Duration must be a positive number of seconds' };
  }
  if (!metadataUri || !metadataUri.startsWith('ipfs://') && !metadataUri.startsWith('http://') && !metadataUri.startsWith('https://')) {
    return { valid: false, error: 'Metadata URI must be a valid IPFS or HTTP link' };
  }
  return { valid: true };
}

