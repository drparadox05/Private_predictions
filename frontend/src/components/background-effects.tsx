export function BackgroundEffects() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-aurora opacity-80" />
      <div className="absolute inset-0 bg-grid bg-[size:48px_48px] opacity-20" />
      <div className="absolute -left-16 top-24 h-72 w-72 rounded-full bg-cyan/20 blur-3xl" />
      <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-purple/20 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-pink/10 blur-3xl" />
      <div className="absolute left-10 top-10 h-2 w-2 rounded-full bg-cyan shadow-[0_0_18px_rgba(56,189,248,0.9)] animate-pulseSlow" />
      <div className="absolute right-20 top-24 h-2 w-2 rounded-full bg-purple shadow-[0_0_18px_rgba(139,92,246,0.9)] animate-pulseSlow" />
      <div className="absolute left-1/4 top-1/2 h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_14px_rgba(56,189,248,0.9)] animate-float" />
      <div className="absolute bottom-24 right-1/4 h-1.5 w-1.5 rounded-full bg-pink shadow-[0_0_14px_rgba(236,72,153,0.9)] animate-float" />
    </div>
  );
}
