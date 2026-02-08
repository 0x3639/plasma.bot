import { QSR_ZTS } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getWalletAddress } from './wallet.js';
import { CONFIG } from '../config/index.js';

/**
 * In-memory QSR reservation for in-flight fuse transactions.
 * Prevents concurrent requests from both passing the balance check
 * before the chain has updated.
 */
let reservedQsr = 0;

export function reserveQsr(amount: number): void {
  reservedQsr += amount;
}

export function releaseQsr(amount: number): void {
  reservedQsr = Math.max(0, reservedQsr - amount);
}

export function getReservedQsr(): number {
  return reservedQsr;
}

/**
 * Atomically check balance and reserve QSR in a single synchronous step.
 * Because Node.js is single-threaded, no `await` between check and reserve
 * means no concurrent request can sneak in between.
 *
 * @param amount QSR to reserve (human-readable units)
 * @param currentBalance Live balance from chain (already fetched via async call)
 * @returns true if reserved successfully, false if insufficient balance
 */
export function tryReserveQsr(amount: number, currentBalance: number): boolean {
  if ((currentBalance - reservedQsr) < amount) return false;
  reservedQsr += amount;
  return true;
}

/**
 * Get the current QSR balance of the bot's wallet in human-readable units.
 * Always queried live from the Zenon node — never stored in the DB.
 */
export async function getQsrBalance(): Promise<number> {
  const zenon = getZenon();
  const address = getWalletAddress();

  const accountInfo = await zenon.ledger.getAccountInfoByAddress(address);

  if (!accountInfo || !accountInfo.balanceInfoMap) {
    return 0;
  }

  const qsrZtsStr = QSR_ZTS.toString();
  for (const [token, balanceInfo] of Object.entries(accountInfo.balanceInfoMap)) {
    if (token === qsrZtsStr || balanceInfo?.token?.tokenStandard?.toString() === qsrZtsStr) {
      const balance = balanceInfo.balance;
      if (balance) {
        // Convert from base units (8 decimals) to human-readable
        return Number(balance.toString()) / Math.pow(10, CONFIG.QSR_DECIMALS);
      }
    }
  }

  return 0;
}

/**
 * Check if the wallet balance is above the unfuse threshold.
 */
export async function isAboveThreshold(): Promise<boolean> {
  const balance = await getQsrBalance();
  return balance >= CONFIG.BALANCE_THRESHOLD_QSR;
}

/**
 * Check if the wallet can afford a fusion of the given QSR amount.
 * Users can fuse down to 0 — the threshold only triggers unfusing.
 */
export async function canAffordFusion(tierQsr: number): Promise<boolean> {
  const balance = await getQsrBalance();
  return (balance - reservedQsr) >= tierQsr;
}

/**
 * Get the QSR available for fusing (wallet balance minus in-flight reservations).
 * Users can fuse until the wallet is empty. The BALANCE_THRESHOLD_QSR
 * only controls when the bot starts unfusing old fusions to reclaim QSR.
 */
export async function getAvailableQsr(): Promise<number> {
  const balance = await getQsrBalance();
  return Math.max(0, balance - reservedQsr);
}
