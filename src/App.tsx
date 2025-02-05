import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { Box } from "@radix-ui/themes"; // (Optional: If using Radix UI for layout, otherwise remove)
import Swap from "./components/swap";

function App() {
  const account = useCurrentAccount();

  return (
    <div className="App">
      {/* Header with Connect Wallet button */}
      <header className="header">
        <ConnectButton />{" "}
        {/* Sui dApp Kit's wallet connect button&#8203;:contentReference[oaicite:9]{index=9} */}
      </header>

      {/* If wallet connected, show swap form; otherwise prompt to connect */}
      {account ? (
        <div className="swap-container">
          <Swap />
        </div>
      ) : (
        <div className="swap-container">
          <p>Please connect your Sui wallet to use the swap application.</p>
        </div>
      )}
    </div>
  );
}

export default App;
