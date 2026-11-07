// Dev-only: remote debugging bridge, started as early as possible to catch startup errors
if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_BRIDGE === '1') {
    import('$lib/debug/bridge').then((m) => m.startDebugBridge());
}
