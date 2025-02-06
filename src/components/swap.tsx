import React, { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions"; // New Transaction class from @mysten/sui
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
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  // Component state
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
      // Initialize DeepBook client (if needed)
      const deepBookClient = new DeepBookClient({
        client: suiClient,
        address: account.address,
        env: NETWORK,
      });

      // Create a new Transaction (replacing the old TransactionBlock)
      const tx = new Transaction();

      // Convert swap amount and fee to base units (1 SUI/USDC = 10^9 units)
      const swapAmount = BigInt(Math.floor(amtNum * 1e9));
      const feeAmount = BigInt(Math.floor(DEFAULT_FEE_COVERAGE_SUI * 1e9));

      let primarySuiCoin; // For BASE swap
      let suiForFee; // For fee conversion to DEEP

      if (inputToken === "BASE") {
        // Splitting the gas coin into two parts using the new pure helper for u64
        [primarySuiCoin, suiForFee] = tx.splitCoins(tx.gas, [
          tx.pure.u64(swapAmount),
          tx.pure.u64(feeAmount),
        ]);
      } else {
        // If swapping USDC, only extract fee from gas coin
        [suiForFee] = tx.splitCoins(tx.gas, [tx.pure.u64(feeAmount)]);

        // Fetch a USDC coin owned by the user
        const { data: coins } = await suiClient.getCoins({
          owner: account.address,
          coinType: USDC_COIN_TYPE,
        });
        if (!coins.length) {
          throw new Error("No USDC coins available in your account.");
        }
        // Sort coins to select one with highest balance
        coins.sort((a, b) => BigInt(b.balance) - BigInt(a.balance));
        const coinToUse = coins[0];
        if (BigInt(coinToUse.balance) < swapAmount) {
          throw new Error("Insufficient USDC balance for the swap amount.");
        }
        console.log(
          "Selected USDC coin:",
          coinToUse.coinObjectId,
          "Balance:",
          coinToUse.balance
        );

        // Split the USDC coin to get the exact amount for swap
        const [usdcToSwap] = tx.splitCoins(tx.object(coinToUse.coinObjectId), [
          tx.pure.u64(swapAmount),
        ]);

        // Perform the swap: USDC (quote) to SUI (base) using DEEP for fees
        const minSuiOut = tx.pure.u64(
          minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n
        );
        const [, suiObtained] = tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
          arguments: [
            tx.object(SUI_USDC_POOL_ID),
            usdcToSwap,
            suiForFee,
            minSuiOut,
            tx.object("0x6"),
          ],
        });
        // Transfer the obtained SUI to the user's address
        tx.transferObjects([suiObtained], tx.pure.address(account.address));
      }

      // === Swap a portion of SUI -> DEEP for fee coverage (common for both cases) ===
      const [, deepObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
        typeArguments: [DEEP_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(SUI_DEEP_POOL_ID),
          suiForFee,
          tx.pure.u64(0n),
          tx.pure.u64(0n),
          tx.object("0x6"),
        ],
      });
      const deepCoinForFee = deepObtained;

      if (inputToken === "BASE") {
        // === Main Swap for BASE→QUOTE: SUI -> USDC using DEEP for fees ===
        const minUsdcOut = tx.pure.u64(
          minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n
        );
        const [, usdcObtained] = tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_base_for_quote`,
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
          arguments: [
            tx.object(SUI_USDC_POOL_ID),
            primarySuiCoin,
            deepCoinForFee,
            minUsdcOut,
            tx.object("0x6"),
          ],
        });
        // Transfer the obtained USDC to the user's address
        tx.transferObjects([usdcObtained], tx.pure.address(account.address));
      }

      // Set the gas budget explicitly
      tx.setGasBudget(OVERESTIMATED_GAS_BUDGET);

      // Debug log: output the serialized transaction
      console.log("Serialized transaction:", tx.serialize());

      // Sign and execute the transaction via the connected wallet
      const result = await signAndExecute({
        transaction: tx,
        chain: "sui:mainnet",
      });
      console.log("Transaction result:", result);
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
