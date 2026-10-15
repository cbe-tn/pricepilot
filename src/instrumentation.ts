// Next.js server startup hook: launch the background worker that finds competitor offers by
// product reference and keeps their prices current. Disable with PRICEPILOT_SCHEDULER=0.
// The Node-only code lives in instrumentation-node.ts so the edge bundle never pulls in `pg`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
