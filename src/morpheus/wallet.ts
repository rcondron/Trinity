/**
 * Trinity Wallet Manager
 *
 * Generates and manages an HD wallet (BIP-39 mnemonic + BIP-44 derivation)
 * for the Trinity agent. The mnemonic is encrypted at rest inside the
 * container's persistent volume (/root/.Trinity/wallet.enc).
 *
 * Address derivation path: m/44'/60'/0'/0/N
 *   - Index 0: Main gateway address (used for Morpheus compute sessions)
 *   - Index 1+: Sub-agent addresses (derived on demand for additional sessions)
 *
 * The wallet is created once during onboarding and persists across restarts
 * via the trinity_agent_data Docker volume. The encryption key is derived
 * from a user-supplied passphrase using PBKDF2.
 *
 * Requires ethers.js v6 (lazy import, same as compute-client.ts).
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ---- Types ------------------------------------------------------------------

export interface WalletInfo {
  /** Index in the HD derivation path. */
  index: number;
  /** Ethereum address (checksummed). */
  address: string;
  /** Label for display. */
  label: string;
}

export interface WalletState {
  /** Whether the wallet has been initialized. */
  initialized: boolean;
  /** Primary gateway address (index 0). */
  address: string;
  /** All derived addresses. */
  addresses: WalletInfo[];
  /** Number of derived addresses. */
  derivedCount: number;
}

interface EncryptedWalletFile {
  version: 1;
  /** AES-256-GCM encrypted mnemonic. */
  ciphertext: string;
  /** Initialization vector (hex). */
  iv: string;
  /** GCM auth tag (hex). */
  tag: string;
  /** PBKDF2 salt (hex). */
  salt: string;
  /** PBKDF2 iterations. */
  iterations: number;
  /** Number of addresses derived from this mnemonic. */
  derivedCount: number;
  /** Derived addresses (public info only, stored for quick lookup). */
  addresses: WalletInfo[];
  /** Creation timestamp. */
  createdAt: string;
}

// ---- Crypto helpers ---------------------------------------------------------

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32; // AES-256
const ALGORITHM = "aes-256-gcm";

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

function encrypt(plaintext: string, passphrase: string): { ciphertext: string; iv: string; tag: string; salt: string; iterations: number } {
  const salt = randomBytes(32);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return {
    ciphertext,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
    iterations: PBKDF2_ITERATIONS,
  };
}

function decrypt(data: { ciphertext: string; iv: string; tag: string; salt: string; iterations: number }, passphrase: string): string {
  const salt = Buffer.from(data.salt, "hex");
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(data.iv, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(data.tag, "hex"));
  let plaintext = decipher.update(data.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");
  return plaintext;
}

// ---- Lazy ethers import -----------------------------------------------------

let _ethers: typeof import("ethers") | null = null;

async function getEthers() {
  if (_ethers) return _ethers;
  try {
    _ethers = await import("ethers");
    return _ethers;
  } catch {
    throw new Error("ethers.js v6 is required for wallet management. Install it with: pnpm add ethers");
  }
}

// ---- Wallet Manager ---------------------------------------------------------

const DERIVATION_BASE = "m/44'/60'/0'/0/";

export class TrinityWallet {
  private walletPath: string;
  private mnemonic: string | null = null;
  private addresses: WalletInfo[] = [];
  private _loaded = false;

  /**
   * @param dataDir  Persistent data directory (e.g. /root/.Trinity).
   */
  constructor(dataDir: string) {
    this.walletPath = join(dataDir, "wallet.enc");
  }

  /** Whether an encrypted wallet file exists. */
  get exists(): boolean {
    return existsSync(this.walletPath);
  }

  /** Whether the mnemonic is loaded (decrypted) in memory. */
  get unlocked(): boolean {
    return this.mnemonic !== null;
  }

  // ---- Create ---------------------------------------------------------------

  /**
   * Generate a new wallet (BIP-39 mnemonic), derive the first N addresses,
   * and encrypt the mnemonic to disk.
   *
   * @param passphrase  Encryption passphrase (from user during onboarding).
   * @param initialAddresses  How many addresses to derive upfront (default 3).
   * @returns The mnemonic phrase (show ONCE to the user, then never again).
   */
  async create(passphrase: string, initialAddresses = 3): Promise<{ mnemonic: string; addresses: WalletInfo[] }> {
    if (this.exists) throw new Error("Wallet already exists. Use unlock() or reset().");
    if (!passphrase || passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters.");

    const ethers = await getEthers();

    // Generate a 12-word mnemonic.
    const wallet = ethers.Wallet.createRandom();
    const phrase = wallet.mnemonic!.phrase;

    // Derive addresses.
    const addresses = await this._deriveAddresses(phrase, initialAddresses);

    // Encrypt and save.
    const encrypted = encrypt(phrase, passphrase);
    const file: EncryptedWalletFile = {
      version: 1,
      ...encrypted,
      derivedCount: initialAddresses,
      addresses,
      createdAt: new Date().toISOString(),
    };

    mkdirSync(dirname(this.walletPath), { recursive: true });
    writeFileSync(this.walletPath, JSON.stringify(file, null, 2), { mode: 0o600 });

    // Load into memory.
    this.mnemonic = phrase;
    this.addresses = addresses;
    this._loaded = true;

    console.log(`[Wallet] Created new wallet with ${initialAddresses} addresses. Primary: ${addresses[0]!.address}`);
    return { mnemonic: phrase, addresses };
  }

  // ---- Unlock ---------------------------------------------------------------

  /**
   * Decrypt the wallet file and load the mnemonic into memory.
   * Must be called on every gateway startup.
   */
  async unlock(passphrase: string): Promise<WalletState> {
    if (!this.exists) throw new Error("No wallet found. Run create() first.");

    const raw = JSON.parse(readFileSync(this.walletPath, "utf8")) as EncryptedWalletFile;

    try {
      this.mnemonic = decrypt(raw, passphrase);
    } catch {
      throw new Error("Wrong passphrase — could not decrypt wallet.");
    }

    this.addresses = raw.addresses;
    this._loaded = true;

    console.log(`[Wallet] Unlocked. ${this.addresses.length} addresses loaded. Primary: ${this.addresses[0]?.address}`);
    return this.getState();
  }

  // ---- Derive ---------------------------------------------------------------

  /**
   * Derive a new address at the next available index.
   * The wallet must be unlocked. The new address is persisted to the encrypted file.
   */
  async deriveNext(passphrase: string, label?: string): Promise<WalletInfo> {
    if (!this.mnemonic) throw new Error("Wallet is locked.");

    const ethers = await getEthers();
    const nextIndex = this.addresses.length;
    const hdNode = ethers.HDNodeWallet.fromPhrase(this.mnemonic, undefined, DERIVATION_BASE + nextIndex);

    const info: WalletInfo = {
      index: nextIndex,
      address: hdNode.address,
      label: label || `sub-agent-${nextIndex}`,
    };

    this.addresses.push(info);
    await this._persist(passphrase);

    console.log(`[Wallet] Derived address #${nextIndex}: ${info.address} (${info.label})`);
    return info;
  }

  // ---- Key access -----------------------------------------------------------

  /**
   * Get the private key for a specific address index.
   * Used internally when opening Morpheus sessions.
   */
  async getPrivateKey(index: number): Promise<string> {
    if (!this.mnemonic) throw new Error("Wallet is locked.");
    const ethers = await getEthers();
    const hdNode = ethers.HDNodeWallet.fromPhrase(this.mnemonic, undefined, DERIVATION_BASE + index);
    return hdNode.privateKey;
  }

  /**
   * Get the primary gateway private key (index 0).
   */
  async getGatewayKey(): Promise<string> {
    return this.getPrivateKey(0);
  }

  /**
   * Get or derive a key for a sub-agent session.
   * If the index doesn't exist yet, derives it.
   */
  async getSubAgentKey(index: number, passphrase?: string): Promise<{ key: string; address: string }> {
    if (!this.mnemonic) throw new Error("Wallet is locked.");

    // Derive more addresses if needed.
    while (this.addresses.length <= index) {
      if (!passphrase) throw new Error(`Address #${index} not yet derived and no passphrase provided.`);
      await this.deriveNext(passphrase, `sub-agent-${this.addresses.length}`);
    }

    const key = await this.getPrivateKey(index);
    return { key, address: this.addresses[index]!.address };
  }

  // ---- State ----------------------------------------------------------------

  getState(): WalletState {
    return {
      initialized: this.exists,
      address: this.addresses[0]?.address ?? "",
      addresses: this.addresses.map((a) => ({ ...a })),
      derivedCount: this.addresses.length,
    };
  }

  /** Get public address info without unlocking. */
  getPublicState(): WalletState {
    if (this.exists && !this._loaded) {
      try {
        const raw = JSON.parse(readFileSync(this.walletPath, "utf8")) as EncryptedWalletFile;
        return {
          initialized: true,
          address: raw.addresses[0]?.address ?? "",
          addresses: raw.addresses,
          derivedCount: raw.derivedCount,
        };
      } catch { /* fall through */ }
    }
    return this.getState();
  }

  // ---- Internals ------------------------------------------------------------

  private async _deriveAddresses(phrase: string, count: number): Promise<WalletInfo[]> {
    const ethers = await getEthers();
    const addresses: WalletInfo[] = [];
    const labels = ["gateway (primary)", "sub-agent-1", "sub-agent-2", "sub-agent-3", "sub-agent-4"];

    for (let i = 0; i < count; i++) {
      const hdNode = ethers.HDNodeWallet.fromPhrase(phrase, undefined, DERIVATION_BASE + i);
      addresses.push({
        index: i,
        address: hdNode.address,
        label: labels[i] || `sub-agent-${i}`,
      });
    }
    return addresses;
  }

  private async _persist(passphrase: string): Promise<void> {
    if (!this.mnemonic) return;
    const encrypted = encrypt(this.mnemonic, passphrase);
    const file: EncryptedWalletFile = {
      version: 1,
      ...encrypted,
      derivedCount: this.addresses.length,
      addresses: this.addresses,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(this.walletPath, JSON.stringify(file, null, 2), { mode: 0o600 });
  }
}

// ---- Singleton --------------------------------------------------------------

let _wallet: TrinityWallet | null = null;

export function getTrinityWallet(dataDir?: string): TrinityWallet {
  if (!_wallet) {
    _wallet = new TrinityWallet(dataDir || process.env.TRINITY_HOME || "/root/.Trinity");
  }
  return _wallet;
}

export default TrinityWallet;
