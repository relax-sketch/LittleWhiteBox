import { createInitialDirectorRuntimeState } from '../core/state.js';

function clampInt(value, min, max, fallback = min) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(Math.trunc(num), max));
}

function shortHash(text = '') {
    const source = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function getContextSafe() {
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext() || {};
        }
    } catch (_) {}
    try {
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            return window.SillyTavern.getContext() || {};
        }
    } catch (_) {}
    return {};
}

function getMessageText(item) {
    return String(item?.mes || item?.content || '').trim();
}

function resolveRole(item) {
    if (item?.is_user === true) return 'user';
    if (item?.is_system === true) return 'system';
    const role = String(item?.role || '').toLowerCase();
    return role || 'assistant';
}

function latestHash(chat, role) {
    const items = Array.isArray(chat) ? chat : [];
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i] || {};
        if (resolveRole(item) !== role) continue;
        if (item?.is_westworld_director === true || item?.is_storyweaver_director === true) continue;
        const text = getMessageText(item);
        if (text) return shortHash(text);
    }
    return '';
}

function getActiveSwipeId(chat) {
    const items = Array.isArray(chat) ? chat : [];
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i] || {};
        if (resolveRole(item) !== 'assistant') continue;
        return item?.swipe_id ?? item?.swipeId ?? 0;
    }
    return 0;
}

export function ensureExperienceState(AppState, queueLength = 0) {
    if (!AppState.experience || typeof AppState.experience !== 'object') {
        AppState.experience = {};
    }
    const maxIndex = Math.max(0, queueLength - 1);
    const chapterOutline = typeof AppState.experience.chapterOutline === 'string'
        ? AppState.experience.chapterOutline
        : '';
    const chapterScript = AppState.experience.chapterScript && typeof AppState.experience.chapterScript === 'object'
        ? AppState.experience.chapterScript
        : {};
    AppState.experience = {
        chapterOutline,
        chapterScript: {
            ...chapterScript,
            beats: Array.isArray(chapterScript.beats) ? chapterScript.beats : [],
        },
        currentChapterIndex: clampInt(AppState.experience.currentChapterIndex, 0, maxIndex, 0),
        currentBeatIndex: Math.max(0, Number.isInteger(AppState.experience.currentBeatIndex) ? AppState.experience.currentBeatIndex : 0),
        lastChapterIdx: clampInt(AppState.experience.lastChapterIdx, 0, maxIndex, 0),
        lastBeatIdx: Math.max(0, Number.isInteger(AppState.experience.lastBeatIdx) ? AppState.experience.lastBeatIdx : 0),
        directorLastDecision: AppState.experience.directorLastDecision || null,
        directorLastDecisionAt: Number.isFinite(AppState.experience.directorLastDecisionAt) ? AppState.experience.directorLastDecisionAt : 0,
        directorRuntime: {
            ...createInitialDirectorRuntimeState(),
            ...(AppState.experience.directorRuntime || {}),
            restore: {
                ...createInitialDirectorRuntimeState().restore,
                ...(AppState.experience.directorRuntime?.restore || {}),
            },
            lastInjection: {
                ...createInitialDirectorRuntimeState().lastInjection,
                ...(AppState.experience.directorRuntime?.lastInjection || {}),
            },
        },
        directorLogs: Array.isArray(AppState.experience.directorLogs) ? AppState.experience.directorLogs : [],
    };
    return AppState.experience;
}

export function ensureMemoryDirectorRuntime(memory, index = 0) {
    if (!memory || typeof memory !== 'object') return null;
    if (!memory.chapterTitle || !String(memory.chapterTitle).trim()) {
        memory.chapterTitle = `第${index + 1}章`;
    }
    if (typeof memory.chapterOutline !== 'string') {
        memory.chapterOutline = '';
    }
    if (!memory.chapterOutlineStatus) {
        memory.chapterOutlineStatus = 'pending';
    }
    if (typeof memory.chapterOutlineError !== 'string') {
        memory.chapterOutlineError = '';
    }
    if (!memory.chapterScript || typeof memory.chapterScript !== 'object') {
        memory.chapterScript = { keyNodes: [], beats: [] };
    }
    if (!Array.isArray(memory.chapterScript.keyNodes)) {
        memory.chapterScript.keyNodes = [];
    }
    if (!Array.isArray(memory.chapterScript.beats)) {
        memory.chapterScript.beats = [];
    }
    if (!Number.isInteger(memory.chapterCurrentBeatIndex)) {
        memory.chapterCurrentBeatIndex = 0;
    }
    memory.chapterCurrentBeatIndex = Math.max(0, Math.min(memory.chapterCurrentBeatIndex, Math.max(0, memory.chapterScript.beats.length - 1)));
    if (typeof memory.chapterOpeningPreview !== 'string') memory.chapterOpeningPreview = '';
    if (typeof memory.chapterOpeningSent !== 'boolean') memory.chapterOpeningSent = false;
    if (typeof memory.chapterOpeningError !== 'string') memory.chapterOpeningError = '';
    if (typeof memory.chapterOpeningGenerating !== 'boolean') memory.chapterOpeningGenerating = false;
    return memory;
}

export function normalizeDirectorBeatState(AppState) {
    const queue = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue : [];
    ensureExperienceState(AppState, queue.length);
    queue.forEach((memory, index) => ensureMemoryDirectorRuntime(memory, index));
    const chapterIndex = clampInt(AppState.experience.currentChapterIndex, 0, Math.max(0, queue.length - 1), 0);
    AppState.experience.currentChapterIndex = chapterIndex;
    const memory = queue[chapterIndex] || null;
    if (memory) {
        const beatCount = Array.isArray(memory.chapterScript?.beats) ? memory.chapterScript.beats.length : 0;
        const beatIndex = clampInt(memory.chapterCurrentBeatIndex, 0, Math.max(0, beatCount - 1), 0);
        memory.chapterCurrentBeatIndex = beatIndex;
        AppState.experience.chapterOutline = typeof memory.chapterOutline === 'string' ? memory.chapterOutline : '';
        AppState.experience.chapterScript = {
            ...(memory.chapterScript && typeof memory.chapterScript === 'object' ? memory.chapterScript : {}),
            beats: Array.isArray(memory.chapterScript?.beats) ? memory.chapterScript.beats : [],
        };
        AppState.experience.currentBeatIndex = beatIndex;
    } else {
        AppState.experience.chapterOutline = '';
        AppState.experience.chapterScript = { beats: [] };
        AppState.experience.currentBeatIndex = 0;
    }
    return {
        chapterIndex,
        memory,
    };
}

export function applyDirectorRuntimeSnapshot(AppState, snapshot = {}) {
    const memoryQueue = Array.isArray(snapshot.memoryQueue) ? snapshot.memoryQueue : [];
    AppState.memory.queue = memoryQueue;
    AppState.file.hash = snapshot.fileHash || AppState.file.hash || null;
    AppState.file.novelName = snapshot.novelName || AppState.file.novelName || '';
    AppState.experience = {
        ...(AppState.experience || {}),
        ...(snapshot.experience && typeof snapshot.experience === 'object' ? snapshot.experience : {}),
    };
    normalizeDirectorBeatState(AppState);
    return AppState.memory.queue.length;
}

export function getSillyTavernSessionFingerprint(eventData = null) {
    const ctx = getContextSafe();
    const chat = Array.isArray(ctx.chat)
        ? ctx.chat
        : (Array.isArray(eventData?.chat) ? eventData.chat : []);
    const last = chat.length > 0 ? (chat[chat.length - 1] || {}) : {};
    return {
        chatId: ctx.chatId || '',
        characterId: ctx.characterId ?? ctx.this_chid ?? null,
        characterName: ctx.name2 || '',
        groupId: ctx.groupId ?? null,
        chatLength: chat.length,
        lastMessageId: last?.send_date || last?.extra?.gen_id || (chat.length > 0 ? chat.length - 1 : null),
        lastUserHash: latestHash(chat, 'user'),
        lastAssistantHash: latestHash(chat, 'assistant'),
        activeSwipeId: getActiveSwipeId(chat),
    };
}

export function diffSessionFingerprint(previous = null, current = null) {
    if (!previous || !current) return [];
    const keys = ['chatId', 'characterId', 'groupId', 'activeSwipeId'];
    return keys.filter((key) => String(previous[key] ?? '') !== String(current[key] ?? ''));
}

export function diffBoundDirectorSession(bound = null, current = null) {
    if (!bound || !current) return [];
    const keys = ['chatId', 'characterId', 'groupId'];
    return keys.filter((key) => String(bound[key] ?? '') !== String(current[key] ?? ''));
}

export async function ensureDirectorRuntimeReady({
    AppState,
    MemoryHistoryDB,
    telemetry,
} = {}) {
    const startedAt = Date.now();
    normalizeDirectorBeatState(AppState);
    if (Array.isArray(AppState.memory?.queue) && AppState.memory.queue.length > 0) {
        telemetry?.markRestore?.('already-ready', {
            memoryCount: AppState.memory.queue.length,
            durationMs: Date.now() - startedAt,
        });
        return { ok: true, status: 'already-ready', restored: false, memoryCount: AppState.memory.queue.length };
    }
    if (!MemoryHistoryDB || typeof MemoryHistoryDB.loadState !== 'function') {
        telemetry?.markRestore?.('failed', { reason: 'memory-db-missing', durationMs: Date.now() - startedAt });
        return { ok: false, status: 'failed', reason: 'memory-db-missing', restored: false, memoryCount: 0 };
    }

    try {
        const snapshot = await MemoryHistoryDB.loadState();
        if (!snapshot || !Array.isArray(snapshot.memoryQueue) || snapshot.memoryQueue.length <= 0) {
            telemetry?.markRestore?.('no-state', { reason: 'state-missing', durationMs: Date.now() - startedAt });
            return { ok: false, status: 'no-state', reason: 'state-missing', restored: false, memoryCount: 0 };
        }
        const memoryCount = applyDirectorRuntimeSnapshot(AppState, snapshot);
        telemetry?.markRestore?.('restored', { memoryCount, durationMs: Date.now() - startedAt });
        return { ok: true, status: 'restored', restored: true, memoryCount };
    } catch (error) {
        telemetry?.markRestore?.('failed', {
            reason: error?.message || String(error),
            durationMs: Date.now() - startedAt,
        });
        return { ok: false, status: 'failed', reason: error?.message || String(error), restored: false, memoryCount: 0 };
    }
}
