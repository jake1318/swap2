// config.ts
export const NETWORK: "testnet" | "mainnet" = "mainnet"; // Sui network environment (set to mainnet)
export const DEFAULT_POOL_KEY = "SUI_DBUSDC"; // DeepBook V3 pool key for SUI/USDC pair
export const DEFAULT_DEEP_AMOUNT = 1; // DEEP token amount to pay as fees (excess refunded)

// Token symbols for the selected pool, for UI display
export const BASE_TOKEN_SYMBOL = "SUI";
export const QUOTE_TOKEN_SYMBOL = "USDC";

// Sui Mainnet coin type addresses for key tokens:
export const SUI_COIN_TYPE = "0x2::sui::SUI";
export const USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const DEEP_COIN_TYPE =
  "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP";

// DeepBook package and pool IDs on mainnet (replace these with the actual pool object IDs if needed)
export const DEEPBOOK_PACKAGE_ID =
  "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270";
export const SUI_USDC_POOL_ID =
  "0x3b585786b13af1d8ea067ab37101b6513a05d2f90cfe60e8b1d9e1b46a63c4fa"; // SUI/USDC pool
export const SUI_DEEP_POOL_ID =
  "0xb663828d6217467c8a1838a03793da896cbe745b150ebd57d82f814ca579fc22"; // SUI/DEEP pool

// Swap settings
export const DEFAULT_FEE_COVERAGE_SUI = 0.1; // Amount of SUI to swap for DEEP to cover fees
export const DEFAULT_SLIPPAGE_PERCENT = 0.5; // 0.5% slippage tolerance
export const OVERESTIMATED_GAS_BUDGET = 1_000_000_000; // Overestimated gas budget (in Mist)
