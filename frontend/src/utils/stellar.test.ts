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
  getTokenBalance,
  calculateProgress,
  validateCampaignInputs
} from './stellar';

describe('Stellar Soroban Utils', () => {
  it('should have the correct testnet passphrase configured', () => {
    expect(NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
  });

  it('should handle getContractEvents errors gracefully by returning empty array', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(server, 'getEvents').mockRejectedValueOnce(new Error('Network offline'));

    const events = await getContractEvents('CDLZFC3SYJYDZT7K67VZ75HPJFCBQ2BBVGTICN2V45PESTCTFBX6JGSZ', 100);
    
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

  describe('calculateProgress', () => {
    it('should return 0 when goal is zero or negative', () => {
      expect(calculateProgress(100n, 0n)).toBe(0);
      expect(calculateProgress(100n, -50n)).toBe(0);
    });

    it('should calculate correct percentage progress', () => {
      expect(calculateProgress(50n, 100n)).toBe(50);
      expect(calculateProgress(333n, 1000n)).toBe(33);
      expect(calculateProgress(0n, 1000n)).toBe(0);
    });

    it('should cap progress at 100% when goal is exceeded', () => {
      expect(calculateProgress(150n, 100n)).toBe(100);
      expect(calculateProgress(2000n, 500n)).toBe(100);
    });
  });

  describe('validateCampaignInputs', () => {
    it('should reject invalid or negative goals', () => {
      expect(validateCampaignInputs('', '3600', 'ipfs://abc').valid).toBe(false);
      expect(validateCampaignInputs('-100', '3600', 'ipfs://abc').valid).toBe(false);
      expect(validateCampaignInputs('abc', '3600', 'ipfs://abc').valid).toBe(false);
    });

    it('should reject invalid or negative durations', () => {
      expect(validateCampaignInputs('1000', '', 'ipfs://abc').valid).toBe(false);
      expect(validateCampaignInputs('1000', '-300', 'ipfs://abc').valid).toBe(false);
      expect(validateCampaignInputs('1000', 'xyz', 'ipfs://abc').valid).toBe(false);
    });

    it('should reject invalid metadata URI formats', () => {
      expect(validateCampaignInputs('1000', '3600', '').valid).toBe(false);
      expect(validateCampaignInputs('1000', '3600', 'invalid-link').valid).toBe(false);
    });

    it('should approve valid input parameters', () => {
      expect(validateCampaignInputs('1000', '3600', 'ipfs://metadata').valid).toBe(true);
      expect(validateCampaignInputs('5000', '86400', 'https://example.com/meta').valid).toBe(true);
    });
  });
});
