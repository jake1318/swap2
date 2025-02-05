import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import Swap from "./components/swap";

function App() {
  const account = useCurrentAccount();

  return (
    <div className="App">
      <header className="header">
        <ConnectButton />
      </header>

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
