import { createConfig, createStorage, http, cookieStorage } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { polygonAmoy, sepolia } from "wagmi/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
export const walletConnectorLabels = walletConnectProjectId
  ? ["Injected", "Coinbase Wallet", "WalletConnect"]
  : ["Injected", "Coinbase Wallet"];

const connectors = walletConnectProjectId
  ? [
      injected(),
      coinbaseWallet({
        appName: "Private Prediction Markets"
      }),
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        metadata: {
          name: "Private Prediction Markets",
          description: "Privacy-first prediction markets",
          url: "https://private-prediction-markets.local",
          icons: []
        }
      })
    ]
  : [
      injected(),
      coinbaseWallet({
        appName: "Private Prediction Markets"
      })
    ];

export const wagmiConfig = createConfig({
  chains: [sepolia, polygonAmoy],
  connectors,
  storage: createStorage({
    storage: cookieStorage
  }),
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
    [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL)
  },
  ssr: false
});

export const walletConnectEnabled = Boolean(walletConnectProjectId);
