/**
 * Morpheus Compute Client
 *
 * Reads the on-chain model/provider/bid registries and manages sessions
 * (open, close, withdraw) against the Morpheus Diamond Proxy on Base.
 *
 * Requires ethers.js v6 — added as an optional dependency. If the user hasn't
 * installed it, the client throws a clear error at construction time.
 */

import {
  DIAMOND_ADDRESS,
  DIAMOND_ADDRESS_TESTNET,
  MOR_TOKEN_ADDRESS,
  MOR_TOKEN_TESTNET,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DIAMOND_ABI,
  ERC20_ABI,
} from "./abi.js";

// ---- Types ------------------------------------------------------------------

export interface MorpheusModel {
  modelId: string;
  name: string;
  ipfsCID: string;
  fee: bigint;
  stake: bigint;
  owner: string;
  tags: string[];
  createdAt: number;
}

export interface MorpheusProvider {
  address: string;
  endpoint: string;
  stake: bigint;
  createdAt: number;
  isActive: boolean;
}

export interface MorpheusBid {
  bidId: string;
  provider: string;
  modelId: string;
  pricePerSecond: bigint;
  nonce: bigint;
  createdAt: number;
}

export interface MorpheusSession {
  sessionId: string;
  user: string;
  bidId: string;
  stake: bigint;
  openedAt: number;
  endsAt: number;
  closedAt: number;
  isActive: boolean;
  providerEndpoint: string;
}

export interface ProviderModelStats {
  tpsMean: number;
  ttftMsMean: number;
  successCount: number;
  totalCount: number;
  successRate: number;
}

export interface ComputeClientConfig {
  /** Base RPC URL (default: public Base RPC) */
  rpcUrl?: string;
  /** Private key hex for signing transactions (required for write ops) */
  privateKey?: string;
  /** Use testnet (Base Sepolia) instead of mainnet */
  testnet?: boolean;
}

// ---- Lazy ethers import -----------------------------------------------------

let _ethers: typeof import("ethers") | null = null;

async function getEthers() {
  if (_ethers) return _ethers;
  try {
    _ethers = await import("ethers");
    return _ethers;
  } catch {
    throw new Error(
      "ethers.js v6 is required for Morpheus compute integration. " +
      "Install it with: pnpm add ethers"
    );
  }
}

// ---- Client -----------------------------------------------------------------

export class MorpheusComputeClient {
  private config: Required<ComputeClientConfig>;
  private _provider: any = null;   // ethers.JsonRpcProvider
  private _signer: any = null;     // ethers.Wallet
  private _diamond: any = null;    // ethers.Contract
  private _morToken: any = null;   // ethers.Contract
  private _ready: Promise<void>;

  constructor(config: ComputeClientConfig = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || (config.testnet
        ? "https://sepolia.base.org"
        : "https://mainnet.base.org"),
      privateKey: config.privateKey || "",
      testnet: config.testnet ?? false,
    };
    this._ready = this._init();
  }

  private async _init() {
    const ethers = await getEthers();
    this._provider = new ethers.JsonRpcProvider(this.config.rpcUrl);

    const diamondAddr = this.config.testnet ? DIAMOND_ADDRESS_TESTNET : DIAMOND_ADDRESS;
    const morAddr = this.config.testnet ? MOR_TOKEN_TESTNET : MOR_TOKEN_ADDRESS;

    if (this.config.privateKey) {
      this._signer = new ethers.Wallet(this.config.privateKey, this._provider);
      this._diamond = new ethers.Contract(diamondAddr, DIAMOND_ABI, this._signer);
      this._morToken = new ethers.Contract(morAddr, ERC20_ABI, this._signer);
    } else {
      // Read-only mode (no private key — can browse models/providers but not open sessions).
      this._diamond = new ethers.Contract(diamondAddr, DIAMOND_ABI, this._provider);
      this._morToken = new ethers.Contract(morAddr, ERC20_ABI, this._provider);
    }
  }

  private async ensureReady() { await this._ready; }

  get address(): string { return this._signer?.address ?? ""; }

  // ---- Model Registry -------------------------------------------------------

  async listModels(offset = 0, limit = 100): Promise<MorpheusModel[]> {
    await this.ensureReady();
    const [ids] = await this._diamond.getActiveModelIds(offset, limit);
    const models: MorpheusModel[] = [];
    for (const id of ids) {
      try {
        const m = await this._diamond.getModel(id);
        models.push({
          modelId: id,
          name: m.name,
          ipfsCID: m.ipfsCID,
          fee: m.fee,
          stake: m.stake,
          owner: m.owner,
          tags: [...m.tags],
          createdAt: Number(m.createdAt),
        });
      } catch { /* skip unreadable models */ }
    }
    return models;
  }

  async getModel(modelId: string): Promise<MorpheusModel | null> {
    await this.ensureReady();
    try {
      const m = await this._diamond.getModel(modelId);
      return {
        modelId,
        name: m.name,
        ipfsCID: m.ipfsCID,
        fee: m.fee,
        stake: m.stake,
        owner: m.owner,
        tags: [...m.tags],
        createdAt: Number(m.createdAt),
      };
    } catch { return null; }
  }

  // ---- Provider Registry ----------------------------------------------------

  async listProviders(offset = 0, limit = 100): Promise<MorpheusProvider[]> {
    await this.ensureReady();
    const [addrs] = await this._diamond.getActiveProviders(offset, limit);
    const providers: MorpheusProvider[] = [];
    for (const addr of addrs) {
      try {
        const p = await this._diamond.getProvider(addr);
        providers.push({
          address: addr,
          endpoint: p.endpoint,
          stake: p.stake,
          createdAt: Number(p.createdAt),
          isActive: !p.isDeleted,
        });
      } catch { /* skip */ }
    }
    return providers;
  }

  async getProvider(address: string): Promise<MorpheusProvider | null> {
    await this.ensureReady();
    try {
      const p = await this._diamond.getProvider(address);
      return {
        address,
        endpoint: p.endpoint,
        stake: p.stake,
        createdAt: Number(p.createdAt),
        isActive: !p.isDeleted,
      };
    } catch { return null; }
  }

  // ---- Marketplace (Bids) ---------------------------------------------------

  async getBidsForModel(modelId: string, offset = 0, limit = 50): Promise<MorpheusBid[]> {
    await this.ensureReady();
    const [bidIds] = await this._diamond.getModelActiveBids(modelId, offset, limit);
    const bids: MorpheusBid[] = [];
    for (const bidId of bidIds) {
      try {
        const b = await this._diamond.getBid(bidId);
        bids.push({
          bidId,
          provider: b.provider,
          modelId: b.modelId,
          pricePerSecond: b.pricePerSecond,
          nonce: b.nonce,
          createdAt: Number(b.createdAt),
        });
      } catch { /* skip */ }
    }
    return bids;
  }

  // ---- Provider Stats -------------------------------------------------------

  async getProviderStats(modelId: string, providerAddr: string): Promise<ProviderModelStats | null> {
    await this.ensureReady();
    try {
      const s = await this._diamond.getProviderModelStats(modelId, providerAddr);
      const successCount = Number(s.successCount);
      const totalCount = Number(s.totalCount);
      return {
        tpsMean: Number(s.tpsScaled1000.mean) / 1000,
        ttftMsMean: Number(s.ttftMs.mean),
        successCount,
        totalCount,
        successRate: totalCount > 0 ? successCount / totalCount : 0,
      };
    } catch { return null; }
  }

  /**
   * Select the best bid for a model based on provider reputation.
   * Ranks by success rate (descending), then TPS (descending), then price (ascending).
   */
  async selectBestBid(modelId: string): Promise<{ bid: MorpheusBid; stats: ProviderModelStats | null; provider: MorpheusProvider | null } | null> {
    const bids = await this.getBidsForModel(modelId);
    if (bids.length === 0) return null;

    const scored = await Promise.all(bids.map(async (bid) => {
      const stats = await this.getProviderStats(modelId, bid.provider);
      const provider = await this.getProvider(bid.provider);
      const score = stats
        ? stats.successRate * 1000 + stats.tpsMean - Number(bid.pricePerSecond) / 1e12
        : -Number(bid.pricePerSecond) / 1e12;
      return { bid, stats, provider, score };
    }));

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    return { bid: best.bid, stats: best.stats, provider: best.provider };
  }

  // ---- MOR Token ------------------------------------------------------------

  async getMorBalance(): Promise<bigint> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    return this._morToken.balanceOf(this._signer.address);
  }

  async getMorAllowance(): Promise<bigint> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    const diamondAddr = this.config.testnet ? DIAMOND_ADDRESS_TESTNET : DIAMOND_ADDRESS;
    return this._morToken.allowance(this._signer.address, diamondAddr);
  }

  async approveMor(amount: bigint): Promise<string> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    const diamondAddr = this.config.testnet ? DIAMOND_ADDRESS_TESTNET : DIAMOND_ADDRESS;
    const tx = await this._morToken.approve(diamondAddr, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ---- Sessions -------------------------------------------------------------

  async openSession(
    stakeAmount: bigint,
    approvalEncoded: Uint8Array,
    providerSignature: Uint8Array,
  ): Promise<string> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured — cannot open session");

    // Ensure allowance covers the stake.
    const allowance = await this.getMorAllowance();
    if (allowance < stakeAmount) {
      await this.approveMor(stakeAmount);
    }

    const tx = await this._diamond.openSession(
      this._signer.address,
      stakeAmount,
      true, // isDirectPaymentFromUser
      approvalEncoded,
      providerSignature,
    );
    const receipt = await tx.wait();

    // Extract sessionId from the SessionOpened event.
    const event = receipt.logs.find(
      (l: any) => l.fragment?.name === "SessionOpened",
    );
    return event?.args?.[1] ?? receipt.hash;
  }

  async closeSession(receiptEncoded: Uint8Array, signature: Uint8Array): Promise<string> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    const tx = await this._diamond.closeSession(receiptEncoded, signature);
    const r = await tx.wait();
    return r.hash;
  }

  async getSession(sessionId: string): Promise<MorpheusSession | null> {
    await this.ensureReady();
    try {
      const s = await this._diamond.getSession(sessionId);
      // Resolve provider endpoint from the bid.
      let endpoint = "";
      try {
        const bid = await this._diamond.getBid(s.bidId);
        const prov = await this._diamond.getProvider(bid.provider);
        endpoint = prov.endpoint;
      } catch { /* endpoint stays empty */ }

      return {
        sessionId,
        user: s.user,
        bidId: s.bidId,
        stake: s.stake,
        openedAt: Number(s.openedAt),
        endsAt: Number(s.endsAt),
        closedAt: Number(s.closedAt),
        isActive: s.isActive,
        providerEndpoint: endpoint,
      };
    } catch { return null; }
  }

  async listUserSessions(offset = 0, limit = 50): Promise<MorpheusSession[]> {
    await this.ensureReady();
    if (!this._signer) return [];
    const [ids] = await this._diamond.getUserSessions(this._signer.address, offset, limit);
    const sessions: MorpheusSession[] = [];
    for (const id of ids) {
      const s = await this.getSession(id);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  async withdrawStakes(iterations = 10): Promise<string> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    const tx = await this._diamond.withdrawUserStakes(this._signer.address, iterations);
    const r = await tx.wait();
    return r.hash;
  }

  async getStakesOnHold(): Promise<{ available: bigint; held: bigint }> {
    await this.ensureReady();
    if (!this._signer) throw new Error("No wallet configured");
    const [available, hold] = await this._diamond.getUserStakesOnHold(this._signer.address, 255);
    return { available, held: hold };
  }

  // ---- Utility --------------------------------------------------------------

  async estimateSessionDuration(stakeAmount: bigint, pricePerSecond: bigint): Promise<number> {
    await this.ensureReady();
    const ethers = await getEthers();
    const now = Math.floor(Date.now() / 1000);
    try {
      const end = await this._diamond.getSessionEnd(stakeAmount, pricePerSecond, now);
      return Number(end) - now;
    } catch {
      // Fallback: simple division.
      if (pricePerSecond === 0n) return 0;
      const stipend = stakeAmount; // approximate
      return Number(stipend / pricePerSecond);
    }
  }

  async getTodaysBudget(): Promise<bigint> {
    await this.ensureReady();
    const now = Math.floor(Date.now() / 1000);
    return this._diamond.getTodaysBudget(now);
  }
}

export default MorpheusComputeClient;
