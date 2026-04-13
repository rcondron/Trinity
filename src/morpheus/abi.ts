/**
 * Morpheus Diamond Proxy ABI fragments (Base mainnet).
 *
 * Only the functions Trinity needs are included — keeping the ABI lean avoids
 * bundling the entire Diamond surface. Grouped by facet for readability.
 *
 * Contract: 0x6aBE1d282f72B474E54527D93b979A4f64d3030a (Base)
 * MOR Token: 0x7431aDa8a591C955a994a21710752EF9b882b8e3 (Base)
 */

// ---- Addresses --------------------------------------------------------------

export const DIAMOND_ADDRESS = "0x6aBE1d282f72B474E54527D93b979A4f64d3030a";
export const MOR_TOKEN_ADDRESS = "0x7431aDa8a591C955a994a21710752EF9b882b8e3";
export const BASE_CHAIN_ID = 8453;

// Testnet (Base Sepolia)
export const DIAMOND_ADDRESS_TESTNET = "0x6e4d0B775E3C3b02683A6F277Ac80240C4aFF930";
export const MOR_TOKEN_TESTNET = "0x5C80Ddd187054E1E4aBBfFCD750498e81d34FfA3";
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// ---- ERC-20 (MOR token) ----------------------------------------------------

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

// ---- ModelRegistry facet ----------------------------------------------------

export const MODEL_REGISTRY_ABI = [
  // Read
  "function getActiveModelIds(uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getModelIds(uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getModel(bytes32 modelId_) view returns (tuple(bytes32 ipfsCID, uint256 fee, uint256 stake, address owner, string name, string[] tags, uint128 createdAt, bool isDeleted))",
  "function getIsModelActive(bytes32 modelId_) view returns (bool)",
  "function getModelId(address account_, bytes32 baseModelId_) pure returns (bytes32)",
  "function getModelMinimumStake() view returns (uint256)",
] as const;

// ---- ProviderRegistry facet -------------------------------------------------

export const PROVIDER_REGISTRY_ABI = [
  // Read
  "function getActiveProviders(uint256 offset_, uint256 limit_) view returns (address[], uint256)",
  "function getProvider(address provider_) view returns (tuple(string endpoint, uint256 stake, uint128 createdAt, uint128 limitPeriodEnd, uint256 limitPeriodEarned, bool isDeleted))",
  "function getIsProviderActive(address provider_) view returns (bool)",
  "function getProviderMinimumStake() view returns (uint256)",
] as const;

// ---- Marketplace facet ------------------------------------------------------

export const MARKETPLACE_ABI = [
  // Read
  "function getModelActiveBids(bytes32 modelId_, uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getProviderActiveBids(address provider_, uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getBid(bytes32 bidId_) view returns (tuple(address provider, bytes32 modelId, uint256 pricePerSecond, uint256 nonce, uint128 createdAt, uint128 deletedAt))",
  "function isBidActive(bytes32 bidId_) view returns (bool)",
  "function getBidId(address provider_, bytes32 modelId_, uint256 nonce_) view returns (bytes32)",
  "function getToken() view returns (address)",
  "function getMinMaxBidPricePerSecond() view returns (uint256, uint256)",
] as const;

// ---- SessionRouter facet ----------------------------------------------------

export const SESSION_ROUTER_ABI = [
  // Write
  "function openSession(address user_, uint256 amount_, bool isDirectPaymentFromUser_, bytes approvalEncoded_, bytes signature_) returns (bytes32)",
  "function closeSession(bytes receiptEncoded_, bytes signature_) external",
  "function claimForProvider(bytes32 sessionId_) external",
  "function withdrawUserStakes(address user_, uint8 iterations_) external",

  // Read
  "function getSession(bytes32 sessionId_) view returns (tuple(address user, bytes32 bidId, uint256 stake, bytes closeoutReceipt, uint256 closeoutType, uint256 providerWithdrawnAmount, uint128 openedAt, uint128 endsAt, uint128 closedAt, bool isActive, bool isDirectPaymentFromUser))",
  "function getUserSessions(address user_, uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getProviderSessions(address provider_, uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getModelSessions(bytes32 modelId_, uint256 offset_, uint256 limit_) view returns (bytes32[], uint256)",
  "function getTotalSessions(address user_) view returns (uint256)",
  "function getSessionEnd(uint256 amount_, uint256 pricePerSecond_, uint128 openedAt_) view returns (uint128)",
  "function stakeToStipend(uint256 amount_, uint128 timestamp_) view returns (uint256)",
  "function stipendToStake(uint256 stipend_, uint128 timestamp_) view returns (uint256)",
  "function getUserStakesOnHold(address user_, uint8 iterations_) view returns (uint256 available_, uint256 hold_)",
  "function getTodaysBudget(uint128 timestamp_) view returns (uint256)",
  "function getComputeBalance(uint128 timestamp_) view returns (uint256)",
  "function totalMORSupply(uint128 timestamp_) view returns (uint256)",
  "function getMaxSessionDuration() view returns (uint128)",
  "function getPools() view returns (tuple(uint256 initialReward, uint256 rewardDecrease, uint128 payoutStart, uint128 decreaseInterval)[])",

  // Events
  "event SessionOpened(address indexed user, bytes32 indexed sessionId, address indexed providerId)",
  "event SessionClosed(address indexed user, bytes32 indexed sessionId, address indexed providerId)",
] as const;

// ---- Stats ------------------------------------------------------------------

export const STATS_ABI = [
  "function getProviderModelStats(bytes32 modelId_, address provider_) view returns (tuple(tuple(int64 mean, int64 sqSum, uint32 count) tpsScaled1000, tuple(int64 mean, int64 sqSum, uint32 count) ttftMs, uint32 totalDuration, uint32 successCount, uint32 totalCount))",
  "function getModelStats(bytes32 modelId_) view returns (tuple(tuple(int64 mean, int64 sqSum, uint32 count) tpsScaled1000, tuple(int64 mean, int64 sqSum, uint32 count) ttftMs, tuple(int64 mean, int64 sqSum, uint32 count) totalDuration, uint32 count))",
] as const;

// ---- Combined ABI for the Diamond -------------------------------------------

export const DIAMOND_ABI = [
  ...MODEL_REGISTRY_ABI,
  ...PROVIDER_REGISTRY_ABI,
  ...MARKETPLACE_ABI,
  ...SESSION_ROUTER_ABI,
  ...STATS_ABI,
] as const;
