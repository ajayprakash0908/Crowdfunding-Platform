import { describe, it, expect, vi } from 'vitest';

// Mock browser-specific wallets-kit to allow Node.js tests to run
vi.mock('@creit.tech/stellar-wallets-kit', () => {
  return {
    StellarWalletsKit: vi.fn().mockImplementation(() => ({
      getAddress: vi.fn().mockResolvedValue({ address: 'GDDS2SELLER' }),
      signTransaction: vi.fn()
    })),
    WalletNetwork: { TESTNET: 'TESTNET' },
    FreighterModule: vi.fn(),
    xBullModule: vi.fn()
  };
});

import { 
  NETWORK_PASSPHRASE, 
  getContractEvents, 
  server, 
  getTokenBalance 
} from './stellar';

describe('Stellar Soroban Utils', () => {
  it('should have the correct testnet passphrase configured', () => {
    expect(NETWORK_PASSPHRASE).toBe('Test Stellar Network ; September 2015');
  });

  it('should handle getContractEvents errors gracefully by returning empty array', async () => {
    // Spy on console.error to avoid test output noise
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Force a mock failure in server.getEvents
    vi.spyOn(server, 'getEvents').mockRejectedValueOnce(new Error('Network offline'));

    const events = await getContractEvents('CDLZFC3SYJYDZT7K67VZ75HPJFCBQ2BBVGTICN2V45PESTCTFBX6JGSZ');
    
    expect(events).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });

  it('should return 0 balance when balance check fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(server, 'simulateTransaction').mockRejectedValueOnce(new Error('Simulation failed'));

    const balance = await getTokenBalance('CDLZFC3SYJYDZT7K67VZ75HPJFCBQ2BBVGTICN2V45PESTCTFBX6JGSZ', 'GDDS2SELLER');
    
    expect(balance).toBe(0n);
    expect(consoleSpy).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });
});
