export default function Loading() {
  return (
    <div
      aria-label="Page loading"
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden"
    >
      <div className="route-loading-bar h-full bg-[hsl(var(--brand-orange))]" />
      <span className="sr-only">Loading page</span>
    </div>
  );
}
