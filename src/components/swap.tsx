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
} from "../config";

const Swap: React.FC = () => {
  const account = useCurrentAccount();
  const suiClient = useSuiClient(); // Sui RPC client from context
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [inputToken, setInputToken] = useState<"BASE" | "QUOTE">("BASE");
  const [amount, setAmount] = useState("");
  const [minOut, setMinOut] = useState("");
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return null;
  }

  const baseSymbol = BASE_TOKEN_SYMBOL;
  const quoteSymbol = QUOTE_TOKEN_SYMBOL;
  const fromTokenSymbol = inputToken === "BASE" ? baseSymbol : quoteSymbol;
  const toTokenSymbol = inputToken === "BASE" ? quoteSymbol : baseSymbol;

  const handleSwap = async () => {
    setError(null);
    setTxResult(null);

    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setError("Please enter a valid swap amount.");
      return;
    }
    const minOutNum = minOut ? parseFloat(minOut) : 0;
    setLoading(true);

    try {
      // Initialize DeepBook client (if needed for further helper methods)
      const deepBookClient = new DeepBookClient({
        client: suiClient,
        address: account.address,
        env: NETWORK,
      });

      // Create a new TransactionBlock
      const tx = new TransactionBlock();

      // Convert SUI amount to Mist (1 SUI = 10^9 Mist)
      const suiAmountInMist = BigInt(Math.floor(amtNum * 1e9));
      const feeSuiMist = BigInt(Math.floor(DEFAULT_FEE_COVERAGE_SUI * 1e9));

      // Split coins from tx.gas:
      // - primarySuiCoin: the main coin used for the swap
      // - suiForFee: the coin to be swapped for DEEP (for fee coverage)
      const [primarySuiCoin, suiForFee] = tx.splitCoins(tx.gas, [
        tx.pure(suiAmountInMist, "u64"),
        tx.pure(feeSuiMist, "u64"),
      ]);

      // === Step 1: Swap SUI → DEEP for fee coverage ===
      // This move call swaps the portion of SUI (suiForFee) into DEEP tokens.
      // SUI is the quote asset and DEEP is the base asset.
      const [, deepObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
        typeArguments: [DEEP_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(SUI_DEEP_POOL_ID), // SUI/DEEP pool object
          suiForFee, // Coin<SUI> to swap for DEEP
          tx.pure(0, "u64"), // Fee input; adjust if needed
          tx.pure(0, "u64"), // min_base_out; set to 0 to accept any DEEP
          tx.object("0x6"), // Clock object (ensure this ID is correct for your network)
        ],
      });
      // deepObtained is now the Coin<DEEP> used to cover fees.
      const deepCoinForFee = deepObtained;

      // === Step 2: Main Swap: SUI → USDC using DEEP for fees ===
      // Calculate the minimum acceptable USDC (as a u64 pure value)
      const minUsdcOut = tx.pure(
        minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n,
        "u64"
      );
      const [, usdcObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_base_for_quote`,
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
        arguments: [
          tx.object(SUI_USDC_POOL_ID), // SUI/USDC pool object
          primarySuiCoin, // Coin<SUI> to swap
          deepCoinForFee, // Coin<DEEP> used for fee coverage
          minUsdcOut, // Minimum USDC output
          tx.object("0x6"), // Clock object
        ],
      });

      // Transfer the obtained USDC to the user's address
      tx.transferObjects([usdcObtained], tx.pure(account.address));

      // Set an overestimated gas budget
      tx.setGasBudget(OVERESTIMATED_GAS_BUDGET);

      // Set up transaction serialization.
      // Here we override the toJSON method so that dapp-kit can properly serialize the transaction.
      // This example wraps the serialized transaction block inside an object.
      (tx as any).toJSON = () => ({
        transactionBlock: tx.serialize(),
      });

      // Log the serialized transaction for debugging.
      console.log("Serialized transaction:", tx.serialize());

      // Sign and execute the transaction.
      // Note: Depending on your dapp-kit version, the key might be `transactionBlock` or `transaction`.
      // Adjust accordingly.
      const result = await signAndExecute({
        transactionBlock: tx,
        chain: "sui:mainnet",
      });
      setTxResult(result.digest);
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
