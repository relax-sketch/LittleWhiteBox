import { createInitialDirectorRuntimeState } from '../core/state.js';

const MAX_LOGS = 160;

function cloneJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return value;
    }
}

function ensureExperience(AppState) {
    if (!AppState.experience || typeof AppState.experience !== 'object') {
        AppState.experience = {};
    }
    if (!AppState.experience.directorRuntime || typeof AppState.experience.directorRuntime !== 'object') {
        AppState.experience.directorRuntime = createInitialDirectorRuntimeState();
    } else {
        AppState.experience.directorRuntime = {
            ...createInitialDirectorRuntimeState(),
            ...AppState.experience.directorRuntime,
            restore: {
                ...createInitialDirectorRuntimeState().restore,
                ...(AppState.experience.directorRuntime.restore || {}),
            },
            lastInjection: {
                ...createInitialDirectorRuntimeState().lastInjection,
                ...(AppState.experience.directorRuntime.lastInjection || {}),
            },
        };
    }
    if (!Array.isArray(AppState.experience.directorLogs)) {
        AppState.experience.directorLogs = [];
    }
    return AppState.experience.directorRuntime;
}

export function createDirectorTelemetryService(deps = {}) {
    const {
        AppState,
        Logger,
        debugEnabled = () => false,
    } = deps;

    function runtime() {
        return ensureExperience(AppState);
    }

    function makeRunId(prefix = 'wwd') {
        const time = Date.now().toString(36);
        const rand = Math.random().toString(36).slice(2, 8);
        return `${prefix}-${time}-${rand}`;
    }

    function writeLog(level, phase, message, data = {}) {
        const item = {
            at: Date.now(),
            level: String(level || 'info'),
            phase: String(phase || ''),
            runId: data?.runId || runtime().lastRunId || '',
            message: String(message || ''),
            data: cloneJson(data || {}),
        };
        const logs = AppState.experience.directorLogs;
        logs.push(item);
        if (logs.length > MAX_LOGS) {
            logs.splice(0, logs.length - MAX_LOGS);
        }

        const loggerMethod = item.level === 'error' ? 'error' : (item.level === 'warn' ? 'warn' : 'info');
        Logger?.[loggerMethod]?.('DirectorTelemetry', `${item.phase}: ${item.message}`, item.data);
        try {
            if (typeof debugEnabled === 'function' && debugEnabled()) {
                console.debug('[WestWorld][DirectorTelemetry]', item);
            }
        } catch (_) {}
        return item;
    }

    function patchRuntime(patch = {}, phase = '') {
        const rt = runtime();
        Object.assign(rt, patch);
        if (phase) rt.phase = phase;
        return rt;
    }

    function markHookRegistered(data = {}) {
        const at = Date.now();
        patchRuntime({
            hookRegistered: true,
            hookRegisteredAt: at,
            lastEventAt: at,
            lastEventType: 'hook-registered',
        }, 'idle');
        writeLog('info', 'hook-registered', 'director prompt hook registered', data);
    }

    function markEvent(eventType, data = {}) {
        patchRuntime({
            lastEventAt: Date.now(),
            lastEventType: String(eventType || ''),
        });
        writeLog('info', 'event', String(eventType || 'event'), data);
    }

    function markGateSkipped(reason, data = {}) {
        patchRuntime({
            lastSkipReason: String(reason || ''),
            lastEventAt: Date.now(),
        }, 'gate-skipped');
        writeLog('info', 'gate-skipped', String(reason || 'skipped'), data);
    }

    function markRunStarted({ runId = makeRunId(), chapterIndex = -1, beatIndex = -1, beatCount = 0, session = null } = {}) {
        patchRuntime({
            lastRunId: runId,
            lastRunAt: Date.now(),
            lastRunDurationMs: 0,
            lastChapterIndex: chapterIndex,
            lastBeatIndex: beatIndex,
            lastBeatCount: beatCount,
            lastSkipReason: '',
            lastError: '',
            session,
            lastSession: session,
        }, 'running');
        writeLog('info', 'running', 'director run started', { runId, chapterIndex, beatIndex, beatCount, session });
        return runId;
    }

    function markRestore(status, data = {}) {
        patchRuntime({
            restore: {
                status,
                at: Date.now(),
                restored: status === 'restored',
                reason: String(data.reason || ''),
                memoryCount: Number.isFinite(data.memoryCount) ? data.memoryCount : 0,
                durationMs: Number.isFinite(data.durationMs) ? data.durationMs : 0,
            },
        });
        writeLog(status === 'failed' ? 'warn' : 'info', 'restore', `runtime restore ${status}`, data);
    }

    function markApiResult({ runId, source = 'model', durationMs = 0, chapterIndex = -1, beatIndex = -1, beatCount = 0 } = {}) {
        patchRuntime({
            lastDecisionSource: String(source || ''),
            lastRunDurationMs: Number.isFinite(durationMs) ? durationMs : runtime().lastRunDurationMs,
            lastChapterIndex: chapterIndex,
            lastBeatIndex: beatIndex,
            lastBeatCount: beatCount,
        }, String(source || '').startsWith('fallback') ? 'fallback' : 'api-called');
        writeLog('info', 'api-called', 'director decision ready', { runId, source, durationMs, chapterIndex, beatIndex, beatCount });
    }

    function markInjected(injectionInfo = {}) {
        const rt = runtime();
        patchRuntime({
            lastInjection: {
                ...rt.lastInjection,
                ...cloneJson(injectionInfo),
                injected: injectionInfo.injected === true,
                at: injectionInfo.at || Date.now(),
            },
            invalidated: false,
            invalidationReason: '',
            invalidatedAt: 0,
        }, injectionInfo.injected === true ? 'injected' : 'failed');
        writeLog(injectionInfo.injected === true ? 'info' : 'warn', 'injected', 'director injection inspected', injectionInfo);
    }

    function markFailed(error, data = {}) {
        const message = error?.message || String(error || 'unknown error');
        patchRuntime({
            lastError: message,
            lastRunDurationMs: Number.isFinite(data.durationMs) ? data.durationMs : runtime().lastRunDurationMs,
        }, 'failed');
        writeLog('error', 'failed', message, data);
    }

    function markInvalidated(reason, data = {}) {
        patchRuntime({
            invalidated: true,
            invalidatedAt: Date.now(),
            invalidationReason: String(reason || ''),
            lastSkipReason: String(reason || ''),
        }, 'needs-resync');
        writeLog('warn', 'needs-resync', String(reason || 'runtime invalidated'), data);
    }

    function getStatus() {
        return cloneJson(runtime());
    }

    function getLogs(limit = 50) {
        const count = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 50);
        const logs = AppState.experience?.directorLogs || [];
        return cloneJson(count > 0 ? logs.slice(-count) : logs);
    }

    function clearLogs() {
        ensureExperience(AppState);
        AppState.experience.directorLogs = [];
    }

    return {
        makeRunId,
        markHookRegistered,
        markEvent,
        markGateSkipped,
        markRunStarted,
        markRestore,
        markApiResult,
        markInjected,
        markFailed,
        markInvalidated,
        getStatus,
        getLogs,
        clearLogs,
        runtime,
        writeLog,
    };
}
