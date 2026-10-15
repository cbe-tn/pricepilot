export default function Loading() {
  return (
    <div className="grid gap-4">
      <div className="skeleton h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton h-72" />
    </div>
  );
}
