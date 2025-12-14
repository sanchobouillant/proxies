type LogCallback = (level: string, message: string, timestamp: number) => void;
let logCallback: LogCallback | null = null;

export function setLogCallback(cb: LogCallback) {
    logCallback = cb;
}

export function setupLogger() {
    // Keep reference to original console methods to avoid infinite loops if we used them in emit (we don't)
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    function getTimestamp() {
        return new Date().toISOString().replace('T', ' ').split('.')[0];
    }

    const emit = (level: string, args: any[]) => {
        if (logCallback) {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            logCallback(level, msg, Date.now());
        }
    };

    console.log = (...args) => {
        originalLog(`[${getTimestamp()}]`, ...args);
        emit('INFO', args);
    };

    console.error = (...args) => {
        originalError(`[${getTimestamp()}]`, ...args);
        emit('ERROR', args);
    };

    console.warn = (...args) => {
        originalWarn(`[${getTimestamp()}]`, ...args);
        emit('WARN', args);
    };

    console.info = (...args) => {
        originalInfo(`[${getTimestamp()}]`, ...args);
        emit('INFO', args);
    };
}

// Auto-run setup
setupLogger();
