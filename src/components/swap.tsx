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
  const suiClient = useSuiClient();
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
      const deepBookClient = new DeepBookClient({
        client: suiClient,
        address: account.address,
        env: NETWORK,
      });

      const tx = new TransactionBlock();

      // Split coins in one operation
      const suiAmountInMist = BigInt(Math.floor(amtNum * 1e9));
      const feeSuiMist = BigInt(DEFAULT_FEE_COVERAGE_SUI * 1e9);
      const [primarySuiCoin, suiForFee] = tx.splitCoins(tx.gas, [
        tx.pure(suiAmountInMist, "u64"),
        tx.pure(feeSuiMist, "u64"),
      ]);

      // Swap for DEEP
      const [, deepObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
        typeArguments: [DEEP_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(SUI_DEEP_POOL_ID),
          suiForFee,
          tx.pure(0, "u64"),
          tx.pure(0, "u64"),
          tx.object("0x6"),
        ],
      });

      // Main swap
      const [, usdcObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_base_for_quote`,
        typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
        arguments: [
          tx.object(SUI_USDC_POOL_ID),
          primarySuiCoin,
          deepObtained,
          tx.pure(minOutNum ? BigInt(minOutNum * 1e9) : 0n, "u64"),
          tx.object("0x6"),
        ],
      });

      tx.transferObjects([usdcObtained], tx.pure(account.address));
      tx.setGasBudget(OVERESTIMATED_GAS_BUDGET);

      // Proper serialization
      (tx as any).toJSON = () => ({
        transactionBlock: tx.serialize(),
      });

      const result = await signAndExecute({
        transactionBlock: tx,
        chain: "sui:mainnet",
      });
      setTxResult(result.digest);
    } catch (e: any) {
      const message = e.message || "Transaction rejected by wallet";
      setError(message);
      console.error("Full error:", e);
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
