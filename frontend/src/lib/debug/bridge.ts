/**
 * Dev-only debug bridge: lets a developer (or Claude) watch and drive this page
 * from the dev server, mainly to debug the iOS home-screen app.
 *
 * - Sends console output, errors and lifecycle events (visibility, pagehide/show,
 *   freeze/resume, viewport and keyboard changes) to the dev server. Events that
 *   happen while disconnected (e.g. the app was suspended) are buffered and sent
 *   on reconnect, with their original timestamps.
 * - Answers commands: run JavaScript, report layout measurements, and render a
 *   screenshot of the page (re-drawn from the DOM, so no keyboard or iOS chrome).
 *
 * Loaded only by the dev server with KITSU_DEBUG_BRIDGE=1 (see vite.config.ts).
 */

type BridgeEvent = { t: number; kind: string; data?: unknown };

const MAX_BUFFER = 2000;
const clientId = (() => {
    try {
        const saved = sessionStorage.getItem('kitsu-debug-client');
        if (saved) return saved;
        const id = Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('kitsu-debug-client', id);
        return id;
    } catch {
        return Math.random().toString(36).slice(2, 10);
    }
})();

let socket: WebSocket | null = null;
let buffer: BridgeEvent[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function describe(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
    if (typeof value !== 'object') return value;
    if (value instanceof Error) return { error: value.name, message: value.message, stack: value.stack };
    if (value instanceof Element) {
        const el = value as Element;
        return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}>`;
    }
    if (depth > 3) return '[…]';
    try {
        if (Array.isArray(value)) return value.slice(0, 50).map((v) => describe(v, depth + 1));
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = describe(v, depth + 1);
        return out;
    } catch {
        return String(value);
    }
}

function send(message: unknown): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try {
        socket.send(JSON.stringify(message));
        return true;
    } catch {
        return false;
    }
}

function record(kind: string, data?: unknown): void {
    const event: BridgeEvent = { t: Date.now(), kind, ...(data !== undefined ? { data: describe(data) } : {}) };
    if (!send({ type: 'event', event })) {
        buffer.push(event);
        if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    }
}

/** Where things are on screen: the numbers that keyboard and scrolling bugs are about. */
function measure(): Record<string, unknown> {
    const vv = window.visualViewport;
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const ps = getComputedStyle(probe);
    const safeArea = { top: ps.paddingTop, right: ps.paddingRight, bottom: ps.paddingBottom, left: ps.paddingLeft };
    probe.remove();

    // Elements that scroll, with how far
    const scrollers = [...document.querySelectorAll<HTMLElement>('*')]
        .filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
        .slice(0, 10)
        .map((el) => ({
            el: describe(el),
            scrollTop: Math.round(el.scrollTop),
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
        }));

    const active = document.activeElement;
    return {
        url: location.href,
        standalone: (navigator as any).standalone ?? null,
        displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
        visibility: document.visibilityState,
        window: { innerWidth, innerHeight, scrollY: Math.round(scrollY), devicePixelRatio },
        visualViewport: vv
            ? { width: vv.width, height: vv.height, offsetTop: vv.offsetTop, pageTop: vv.pageTop, scale: vv.scale }
            : null,
        documentHeight: document.documentElement.scrollHeight,
        appHeightVar: getComputedStyle(document.documentElement).getPropertyValue('--app-height') || null,
        safeArea,
        activeElement: active && active !== document.body ? describe(active) : null,
        activeElementRect: active && active !== document.body ? active.getBoundingClientRect().toJSON() : null,
        scrollers
    };
}

async function screenshot(): Promise<string> {
    const { domToPng } = await import('modern-screenshot');
    return domToPng(document.documentElement, {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        style: { transform: `translateY(-${window.scrollY}px)` }
    });
}

async function handle(command: { id: string; op: string; code?: string }): Promise<void> {
    let result: unknown;
    let error: string | undefined;
    try {
        if (command.op === 'eval') {
            // Async so code can await; return a value to see it
            const fn = new Function(`return (async () => { ${command.code ?? ''} })()`);
            result = describe(await fn());
        } else if (command.op === 'measure') {
            result = measure();
        } else if (command.op === 'screenshot') {
            result = await screenshot();
        } else {
            error = `unknown op ${command.op}`;
        }
    } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    send({ type: 'result', id: command.id, result, error });
}

function connect(): void {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__debug/ws`;
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
        send({
            type: 'hello',
            clientId,
            userAgent: navigator.userAgent,
            standalone: (navigator as any).standalone ?? matchMedia('(display-mode: standalone)').matches,
            url: location.href
        });
        const pending = buffer;
        buffer = [];
        for (const event of pending) send({ type: 'event', event: { ...event, buffered: true } });
    };
    ws.onmessage = (msg) => {
        try {
            void handle(JSON.parse(String(msg.data)));
        } catch {
            /* ignore malformed */
        }
    };
    ws.onclose = () => {
        if (socket === ws) socket = null;
        reconnectTimer = setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
}

export function startDebugBridge(): void {
    if (started) return;
    started = true;

    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            record(`console.${level}`, args.length === 1 ? args[0] : args);
        };
    }

    window.addEventListener('error', (e) => record('error', { message: e.message, source: e.filename, line: e.lineno, error: e.error }));
    window.addEventListener('unhandledrejection', (e) => record('unhandledrejection', e.reason));

    // App lifecycle: the iOS suspend/resume story
    document.addEventListener('visibilitychange', () => {
        record('visibilitychange', document.visibilityState);
        if (document.visibilityState === 'visible') connect();
    });
    window.addEventListener('pagehide', (e) => record('pagehide', { persisted: e.persisted }));
    window.addEventListener('pageshow', (e) => {
        record('pageshow', { persisted: e.persisted });
        connect();
    });
    document.addEventListener('freeze', () => record('freeze'));
    document.addEventListener('resume', () => {
        record('resume');
        connect();
    });
    window.addEventListener('online', () => record('online'));
    window.addEventListener('offline', () => record('offline'));
    window.addEventListener('focus', () => record('window.focus'));
    window.addEventListener('blur', () => record('window.blur'));
    window.addEventListener('orientationchange', () => record('orientationchange', screen.orientation?.type));

    // Keyboard and viewport: throttled so scrolling doesn't flood the log
    let viewportTimer: ReturnType<typeof setTimeout> | undefined;
    const viewportChanged = (why: string) => {
        clearTimeout(viewportTimer);
        viewportTimer = setTimeout(() => {
            const vv = window.visualViewport;
            record('viewport', {
                why,
                innerHeight,
                visualHeight: vv?.height,
                offsetTop: vv?.offsetTop,
                scrollY: Math.round(scrollY),
                active: describe(document.activeElement)
            });
        }, 150);
    };
    window.visualViewport?.addEventListener('resize', () => viewportChanged('visualViewport.resize'));
    window.visualViewport?.addEventListener('scroll', () => viewportChanged('visualViewport.scroll'));
    window.addEventListener('resize', () => viewportChanged('window.resize'));
    document.addEventListener('focusin', (e) => record('focusin', e.target));
    document.addEventListener('focusout', (e) => record('focusout', e.target));

    record('start', { url: location.href });
    connect();
}
