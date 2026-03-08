"use client";

import { ChevronDown, LogOut, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useAccount, useChainId, useConnect, useDisconnect, useEnsName } from "wagmi";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { walletConnectEnabled } from "@/lib/wagmi";
import { formatAddress } from "@/lib/utils";

const connectorMeta: Record<string, { label: string; description: string }> = {
  injected: { label: "MetaMask / Injected", description: "Use the browser wallet already installed in your session." },
  walletConnect: { label: "WalletConnect", description: "Connect with a mobile wallet or desktop wallet using WalletConnect." },
  coinbaseWalletSDK: { label: "Coinbase Wallet", description: "Connect using Coinbase Wallet." }
};

export function WalletConnectButton() {
  const [isMounted, setIsMounted] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const { address, isConnected, chain } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: 1, query: { enabled: false } });
  const chainId = useChainId();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const label = useMemo(() => ensName ?? formatAddress(address), [address, ensName]);
  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.id !== "walletConnect" || walletConnectEnabled),
    [connectors]
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isPending) {
      setConnectingId(null);
    }
  }, [isPending]);

  useEffect(() => {
    if (isConnected) {
      setIsModalOpen(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  async function handleConnect(connectorUid: string) {
    const connector = visibleConnectors.find((entry) => entry.uid === connectorUid);
    if (!connector) {
      toast.error("Selected wallet connector is unavailable.");
      return;
    }

    try {
      setConnectingId(connector.id);
      await connectAsync({ connector });
      setIsModalOpen(false);
    } catch (error) {
      setConnectingId(null);
      toast.error("Wallet connection failed", {
        description: error instanceof Error ? error.message : "The selected wallet provider could not connect."
      });
    }
  }

  if (!isMounted) {
    return (
      <Button className="gap-2" type="button">
        <Wallet className="h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  if (!isConnected) {
    return (
      <>
        <Button className="gap-2" type="button" onClick={() => setIsModalOpen(true)}>
          <Wallet className="h-4 w-4" />
          Connect Wallet
        </Button>
        {isModalOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="fixed inset-0 z-[120] flex min-h-screen items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
                <Panel className="max-h-[85vh] w-full max-w-xl overflow-y-auto p-6" onClick={(event) => event.stopPropagation()}>
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.34em] text-cyan/70">Secure Access</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">Choose a wallet</h3>
                      <p className="mt-2 text-sm text-slate-400">
                        Connect a wallet to inspect balances, approve collateral, and prepare encrypted market actions.
                      </p>
                    </div>
                    <Button variant="ghost" className="px-3" type="button" onClick={() => setIsModalOpen(false)}>
                      Close
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {visibleConnectors.map((connector) => {
                      const meta = connectorMeta[connector.id] ?? {
                        label: connector.name,
                        description: "Connect using the selected wallet provider."
                      };
                      const statusLabel = isPending && connectingId === connector.id ? "Connecting" : connector.id === "walletConnect" ? "Open QR" : "Click to connect";

                      return (
                        <button
                          type="button"
                          key={connector.uid}
                          onClick={() => void handleConnect(connector.uid)}
                          disabled={isPending}
                          className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-cyan/40 hover:bg-cyan/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">{meta.label}</p>
                            <p className="mt-1 text-sm text-slate-400">{meta.description}</p>
                          </div>
                          <div className="text-right text-xs uppercase tracking-[0.3em] text-cyan/70">
                            {statusLabel}
                          </div>
                        </button>
                      );
                    })}
                    {visibleConnectors.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
                        No wallet connectors are currently configured for this environment.
                      </div>
                    ) : null}
                  </div>
                </Panel>
              </div>,
              document.body
            )
          : null}
      </>
    );
  }

  return (
    <div className="relative">
      <Button variant="secondary" type="button" className="gap-2 border-cyan/20 bg-cyan/10 text-cyan-100" onClick={() => setIsMenuOpen((open) => !open)}>
        <ShieldCheck className="h-4 w-4" />
        {label}
        <ChevronDown className="h-4 w-4" />
      </Button>
      {isMenuOpen ? (
        <Panel className="absolute right-0 top-14 z-50 w-72 p-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Connected</p>
              <p className="mt-2 text-sm font-medium text-white">{formatAddress(address)}</p>
              <p className="mt-1 text-sm text-slate-400">{chain?.name ?? `Chain ${chainId}`}</p>
            </div>
            <Button
              variant="ghost"
              type="button"
              className="w-full justify-start gap-2 border border-white/10 bg-white/5"
              onClick={() => {
                disconnect();
                setIsMenuOpen(false);
              }}
            >
              <LogOut className="h-4 w-4" />
              Disconnect
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
