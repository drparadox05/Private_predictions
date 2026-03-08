export function MarketOrderBook() {
  const placeholders = Array.from({ length: 6 }, (_, index) => ({
    id: index,
    side: index % 2 === 0 ? "Encrypted YES" : "Encrypted NO",
    size: `${120 + index * 35} USDC`,
    state: index < 2 ? "Queued" : index < 4 ? "Pending epoch close" : "Awaiting settlement"
  }));

  return (
    <div className="space-y-3">
      {placeholders.map((row) => (
        <div key={row.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-white">{row.side}</p>
            <p className="mt-1 text-slate-500">Ciphertext hidden until CRE settlement</p>
          </div>
          <div className="text-right">
            <p className="font-medium text-slate-200">{row.size}</p>
            <p className="mt-1 text-slate-500">{row.state}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
