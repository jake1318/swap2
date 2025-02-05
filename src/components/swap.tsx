// Swap.tsx
import React, { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import {
  DEFAULT_POOL_KEY,
  DEFAULT_DEEP_AMOUNT,
  BASE_TOKEN_SYMBOL,
  QUOTE_TOKEN_SYMBOL,
  NETWORK,
  SUI_COIN_TYPE,
  USDC_COIN_TYPE,
  DEEP_COIN_TYPE,
  DEEPBOOK_PACKAGE_ID,
  SUI_USDC_POOL_ID,
  SUI_DEEP_POOL_ID,
  DEFAULT_FEE_COVERAGE_SUI,
  OVERESTIMATED_GAS_BUDGET,
  DEFAULT_SLIPPAGE_PERCENT,
} from "../config";

const Swap: React.FC = () => {
  const account = useCurrentAccount();
  const suiClient = useSuiClient(); // Sui RPC client from context
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction(); // Hook to sign & execute the transaction

  // Component state for form inputs and feedback
  const [inputToken, setInputToken] = useState<"BASE" | "QUOTE">("BASE"); // 'BASE' = SUI, 'QUOTE' = USDC in this pool
  const [amount, setAmount] = useState(""); // SUI amount to swap (string)
  const [minOut, setMinOut] = useState(""); // Minimum acceptable output (optional)
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return null; // Do not render if wallet not connected
  }

  // Determine token symbols for UI display
  const baseSymbol = BASE_TOKEN_SYMBOL;
  const quoteSymbol = QUOTE_TOKEN_SYMBOL;
  const fromTokenSymbol = inputToken === "BASE" ? baseSymbol : quoteSymbol;
  const toTokenSymbol = inputToken === "BASE" ? quoteSymbol : baseSymbol;

  const handleSwap = async () => {
    setError(null);
    setTxResult(null);
    // Validate the input amount
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setError("Please enter a valid swap amount.");
      return;
    }
    const minOutNum = minOut ? parseFloat(minOut) : 0;
    setLoading(true);
    try {
      // Initialize DeepBook client
      const deepBookClient = new DeepBookClient({
        client: suiClient,
        address: account.address,
        env: NETWORK,
      });

      // Create a new TransactionBlock (atomic transaction)
      const tx = new TransactionBlock();

      // Convert SUI amount (from input) to Mist (1 SUI = 10^9 Mist)
      const suiAmountInMist = BigInt(Math.floor(amtNum * 1e9));
      // Split a coin from tx.gas for the main swap input.
      const [primarySuiCoin] = tx.splitCoins(tx.gas, [
        tx.pure(suiAmountInMist, "u64"),
      ]);

      // === Step 1: Pre-swap SUI -> DEEP for fee coverage ===
      // For simplicity, we assume the user needs to acquire DEEP.
      // In production, check the user’s DEEP balance first.
      const feeSuiMist = BigInt(Math.floor(DEFAULT_FEE_COVERAGE_SUI * 1e9)); // e.g., 0.1 SUI in Mist
      const [suiForFee] = tx.splitCoins(tx.gas, [tx.pure(feeSuiMist, "u64")]);

      // Execute the SUI -> DEEP swap on the SUI/DEEP pool.
      // Here we use swap_exact_quote_for_base because in the SUI/DEEP pool,
      // SUI is the quote asset and DEEP is the base asset.
      const [, deepObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
        typeArguments: [DEEP_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(SUI_DEEP_POOL_ID), // SUI/DEEP pool object
          suiForFee, // Coin<SUI> to swap for DEEP
          tx.pure(0, "u64"), // Fee input (0) since pool is 0% fee; adjust if necessary
          tx.pure(0, "u64"), // min_base_out: 0 (accept any DEEP) – you might calculate a minimum here
          tx.object("0x6"), // Clock object
        ],
      });
      const deepCoinForFee = deepObtained;

      // === Step 2: Main Swap: SUI -> USDC using DEEP for fees ===
      // Calculate minimum USDC out (for demonstration, set to 0; replace with your calculation)
      const minUsdcOut = tx.pure(
        minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n,
        "u64"
      );
      // Execute the SUI -> USDC swap on the SUI/USDC pool using swap_exact_base_for_quote.
      const [, usdcObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_base_for_quote`,
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
        arguments: [
          tx.object(SUI_USDC_POOL_ID), // SUI/USDC pool object
          primarySuiCoin, // Coin<SUI> to swap
          deepCoinForFee, // Coin<DEEP> to pay fees
          minUsdcOut, // min_quote_out (minimum USDC expected)
          tx.object("0x6"), // Clock object
        ],
      });

      // Transfer the obtained USDC to the user's address.
      tx.transferObjects([usdcObtained], tx.pure(account.address, "address"));

      // Set an overestimated gas budget
      tx.setGasBudget(OVERESTIMATED_GAS_BUDGET);

      // IMPORTANT: Attach a toJSON method so that dapp-kit can serialize the transaction.
      (tx as any).toJSON = () => tx.serialize();

      // Log the serialized transaction payload before signing.
      console.log("Serialized transaction:", tx.serialize());

      // Override type checking if needed – cast tx to any to match expected types.
      const result = await signAndExecute({
        transaction: tx as any,
        chain: "sui:mainnet",
      });
      setTxResult(result.digest || "Transaction submitted");
    } catch (e: any) {
      console.error("Swap transaction failed:", e);
      setError(e.message || "Swap failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{ padding: "1rem", border: "1px solid #ccc", borderRadius: "8px" }}
    >
      <h2>Swap</h2>
      <div style={{ marginBottom: "0.5rem" }}>
        <label>From:</label>{" "}
        <select
          value={inputToken}
          onChange={(e) =>
            setInputToken(e.target.value === "BASE" ? "BASE" : "QUOTE")
          }
          style={{ marginRight: "0.5rem" }}
        >
          <option value="BASE">{baseSymbol}</option>
          <option value="QUOTE">{quoteSymbol}</option>
        </select>
        <input
          type="number"
          step="any"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: "8rem" }}
        />
      </div>
      <div style={{ marginBottom: "0.5rem" }}>
        <label>To:</label> <strong>{toTokenSymbol}</strong>
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <label>Min Output (optional):</label>{" "}
        <input
          type="number"
          step="any"
          placeholder="0"
          value={minOut}
          onChange={(e) => setMinOut(e.target.value)}
          style={{ width: "8rem" }}
        />
      </div>
      <button
        onClick={handleSwap}
        disabled={loading}
        style={{
          padding: "0.5rem 1rem",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Swapping…" : `Swap ${fromTokenSymbol} for ${toTokenSymbol}`}
      </button>

      {/* Display transaction result or error */}
      {txResult && (
        <div style={{ marginTop: "1rem", color: "green" }}>
          ✅ Swap successful. Transaction Digest: <code>{txResult}</code>
        </div>
      )}
      {error && (
        <div style={{ marginTop: "1rem", color: "red" }}>❌ {error}</div>
      )}
    </div>
  );
};

export default Swap;
