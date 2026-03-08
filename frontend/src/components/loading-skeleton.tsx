export function LoadingSkeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-xl bg-[linear-gradient(90deg,rgba(15,23,42,0.7),rgba(56,189,248,0.2),rgba(15,23,42,0.7))] bg-[length:200%_100%] animate-shimmer`}
    />
  );
}
