import React, { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions"; /* Updated to use Transaction from new SDK */
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

  const baseSymbol = BASE_TOKEN_SYMBOL; // "SUI"
  const quoteSymbol = QUOTE_TOKEN_SYMBOL; // "USDC"
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
      // Initialize DeepBook client (for potential future use or queries)
      const deepBookClient = new DeepBookClient({
        client: suiClient,
        address: account.address,
        env: NETWORK,
      });

      // Create a new transaction block (programmable transaction)
      const tx =
        new Transaction(); /* Using new Transaction class (formerly TransactionBlock) */

      // Convert the swap amount and fee to smallest units (1 SUI or USDC = 10^9 base units)
      const swapAmount = BigInt(Math.floor(amtNum * 1e9));
      const feeAmount = BigInt(Math.floor(DEFAULT_FEE_COVERAGE_SUI * 1e9));

      let primarySuiCoin; // Coin<SUI> to swap (if swapping SUI)
      let suiForFee; // Coin<SUI> to convert to DEEP for fees

      if (inputToken === "BASE") {
        // Splitting the gas coin into two: one for the main swap amount, one for fee coverage
        [primarySuiCoin, suiForFee] = tx.splitCoins(tx.gas, [
          tx.pure(swapAmount, "u64"),
          tx.pure(feeAmount, "u64"),
        ]);
      } else {
        // If swapping USDC, only split the gas coin for the fee portion (keep remainder for gas)
        [suiForFee] = tx.splitCoins(tx.gas, [tx.pure(feeAmount, "u64")]);

        // Fetch a USDC coin owned by the user to swap (needs at least 'swapAmount')
        const { data: coins } = await suiClient.getCoins({
          owner: account.address,
          coinType: USDC_COIN_TYPE,
        });
        if (!coins.length) {
          throw new Error("No USDC coins available in your account.");
        }
        // Choose a USDC coin with sufficient balance (here we take the largest coin)
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

        // Split the USDC coin to the exact amount to swap (if coin has more than needed)
        const [usdcToSwap] = tx.splitCoins(tx.object(coinToUse.coinObjectId), [
          tx.pure(swapAmount, "u64"),
        ]);

        // Perform the swap: USDC (quote) to SUI (base) using DEEP for fees
        const minSuiOut = tx.pure(
          minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n,
          "u64"
        );
        // Move call: swap_exact_quote_for_base on SUI/USDC pool (USDC -> SUI)
        const [, suiObtained] = tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
          arguments: [
            tx.object(SUI_USDC_POOL_ID), // SUI/USDC pool object
            usdcToSwap, // Coin<USDC> to swap for SUI
            suiForFee, // Coin<DEEP> (actually SUI coin to be converted to DEEP in step1)
            minSuiOut, // Minimum SUI to receive
            tx.object("0x6"), // Clock object (global clock ID)
          ],
        });
        // Transfer the obtained SUI to the user's address
        tx.transferObjects([suiObtained], tx.pure(account.address));
      }

      // === Step 1: Swap a portion of SUI -> DEEP for fee coverage ===
      // (This is common for both scenarios. In USDC->SUI case, primarySuiCoin is undefined and not used in this step.)
      const [, deepObtained] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_quote_for_base`,
        typeArguments: [DEEP_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(SUI_DEEP_POOL_ID), // SUI/DEEP pool object
          suiForFee, // Coin<SUI> to swap for DEEP (fee coverage)
          tx.pure(0, "u64"), // Fee input for this swap (not used here, 0)
          tx.pure(0, "u64"), // min_base_out (0 to accept any amount of DEEP)
          tx.object("0x6"), // Clock object
        ],
      });
      const deepCoinForFee = deepObtained;

      if (inputToken === "BASE") {
        // === Step 2 (BASE→QUOTE): Main Swap SUI -> USDC using DEEP for fees ===
        const minUsdcOut = tx.pure(
          minOutNum ? BigInt(Math.floor(minOutNum * 1e9)) : 0n,
          "u64"
        );
        const [, usdcObtained] = tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::swap_exact_base_for_quote`,
          typeArguments: [SUI_COIN_TYPE, USDC_COIN_TYPE],
          arguments: [
            tx.object(SUI_USDC_POOL_ID), // SUI/USDC pool object
            primarySuiCoin, // Coin<SUI> to swap for USDC
            deepCoinForFee, // Coin<DEEP> for fee coverage
            minUsdcOut, // Minimum USDC to receive
            tx.object("0x6"), // Clock object
          ],
        });
        // Transfer the obtained USDC to the user's address
        tx.transferObjects([usdcObtained], tx.pure(account.address));
      }

      // Set an overestimated gas budget for the transaction
      tx.setGasBudget(OVERESTIMATED_GAS_BUDGET);

      // Log the serialized transaction for debugging
      console.log("Serialized transaction:", tx.serialize());

      // Sign and execute the transaction block via the connected wallet
      const result = await signAndExecute({
        transaction: tx /* Using 'transaction' param as per latest dApp Kit */,
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
      {/* Input for selecting base or quote token to swap from */}
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
