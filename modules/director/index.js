import * as scriptApi from '../../../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../../../extensions.js';
import { promptManager } from '../../../../../../scripts/openai.js';
import { INJECTION_POSITION } from '../../../../../../scripts/PromptManager.js';
import { getDirectorSkipReason as getDirectorGateSkipReason } from './txtToWorldbook/services/directorGateService.js';
import {
    clearPresetEntryContent,
    ensurePresetEntry,
    getPresetEntryStatus,
    setPresetEntryContent,
} from '../../core/preset-entry-registry.js';
import { extractDirectorStateTag } from './txtToWorldbook/services/directorStateTagService.js';

const { saveSettingsDebounced, eventSource, event_types } = scriptApi;

const BRAND_NAME = 'WestWorld';
const LEGACY_BRAND_NAME = 'StoryWeaver';
const extensionName = 'westworld';
const legacyExtensionName = 'storyweaver';
const setupEventNamespace = '.westworld';
const WESTWORLD_REPO_URL = 'https://github.com/relax-sketch/WestWorld';
const LEGACY_REPO_URL = 'https://github.com/lokenpee/StoryWeaver';
const WESTWORLD_DIRECTOR_DEBUG_KEY = 'westworld-director-debug';
const LEGACY_DIRECTOR_DEBUG_KEY = 'storyweaver-director-debug';
const CHAT_CONTROL_BAR_ID = 'westworld-chat-control-bar';
const CHAT_CONTROL_STYLE_ID = 'westworld-chat-control-style';
const EXTERNAL_DIRECTOR_PREPARE_TTL_MS = 60000;
const DIRECTOR_PRESET_ENTRY = {
    identifier: 'westworldDirector',
    name: 'WestWorld Director',
    role: 'system',
};

const defaultSettings = {
    panelCollapsed: true,
    directorSuffixEnabled: true,
};

let settings = {};
let txtToWorldbookModule = null;
let txtToWorldbookInitPromise = null;
let directorPromptReadyHandler = null;
let directorMessageSentHandler = null;
let directorGenerationStartedHandler = null;
let directorPublicApi = null;
let directorBootstrapPromise = null;
const directorLifecycleHandlers = new Map();
const chatControlRefreshHandlers = new Map();
let chatControlRefreshTimer = null;
const directorPromptGate = {
    pendingUserSend: false,
    lastUserSendAt: 0,
    lastGeneration: null,
    lastHandledAt: 0,
    inProgress: false,
    hookRegistered: false,
    hookRegisteredAt: 0,
    lastSkipReason: '',
    lastLifecycleEvent: '',
    lastLifecycleAt: 0,
    externalPrepared: null,
};

function isDirectorTraceEnabled() {
    try {
        return localStorage.getItem(WESTWORLD_DIRECTOR_DEBUG_KEY) === 'true'
            || localStorage.getItem(LEGACY_DIRECTOR_DEBUG_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

function directorTrace(message) {
    if (!isDirectorTraceEnabled()) return;
    console.debug(`[${BRAND_NAME}][DirectorGate] ${message}`);
}

function getExtensionFolderName() {
    const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(import.meta.url);
    return match?.[1] ? decodeURIComponent(match[1]) : BRAND_NAME;
}

function normalizeRepoUrl(repoUrl) {
    const raw = String(repoUrl || WESTWORLD_REPO_URL).trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/$/, '');
    } catch (_error) {
        return '';
    }
}

function getRepoFolderName(repoUrl) {
    try {
        const url = new URL(repoUrl);
        const segments = url.pathname.split('/').filter(Boolean);
        if (!segments.length) return '';
        return decodeURIComponent(segments[segments.length - 1]).replace(/\.git$/i, '');
    } catch (_error) {
        return '';
    }
}

function getJsonHeaders() {
    if (typeof scriptApi.getRequestHeaders === 'function') {
        return scriptApi.getRequestHeaders();
    }
    return {
        'Content-Type': 'application/json',
    };
}

async function updateExtensionByName(extensionFolder) {
    const response = await fetch('/api/extensions/update', {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({
            extensionName: extensionFolder,
            global: false,
        }),
    });

    let text = '';
    try {
        text = await response.text();
    } catch (_error) {
        text = '';
    }

    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_error) {
            data = null;
        }
    }

    return { response, text, data };
}

async function installExtensionFromRepo(repoUrl) {
    const response = await fetch('/api/extensions/install', {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({
            url: repoUrl,
            global: false,
            branch: '',
        }),
    });

    let text = '';
    try {
        text = await response.text();
    } catch (_error) {
        text = '';
    }

    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_error) {
            data = null;
        }
    }

    return { response, text, data };
}

async function updateSelfFromRepo(repoUrl = WESTWORLD_REPO_URL) {
    const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
    if (!normalizedRepoUrl) {
        throw new Error('仓库地址无效，请检查后重试。');
    }

    const currentFolder = getExtensionFolderName();
    const repoFolder = getRepoFolderName(normalizedRepoUrl);
    const candidateFolders = [...new Set([currentFolder, repoFolder, BRAND_NAME, LEGACY_BRAND_NAME].filter(Boolean))];

    for (const folder of candidateFolders) {
        const { response, text, data } = await updateExtensionByName(folder);
        if (response.ok) {
            return {
                mode: 'update',
                extensionFolder: folder,
                repoUrl: normalizedRepoUrl,
                ...(data || {}),
            };
        }

        if (response.status !== 404) {
            const detail = text || response.statusText || `HTTP ${response.status}`;
            throw new Error(`更新失败：${detail}`);
        }
    }

    let installResult = await installExtensionFromRepo(normalizedRepoUrl);
    if (!installResult.response.ok && normalizedRepoUrl === WESTWORLD_REPO_URL) {
        // Fallback for users who still host the repository under the legacy name.
        installResult = await installExtensionFromRepo(LEGACY_REPO_URL);
    }
    if (installResult.response.ok) {
        return {
            mode: 'install',
            repoUrl: normalizedRepoUrl,
            ...(installResult.data || {}),
        };
    }

    const installDetail = installResult.text || installResult.response.statusText || `HTTP ${installResult.response.status}`;
    if (installResult.response.status === 409) {
        throw new Error('检测到同名目录已存在但无法直接更新，请到插件管理页确认该插件安装状态。');
    }
    throw new Error(`安装失败：${installDetail}`);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountDrawerHtml(html) {
    const existingWrapper = document.getElementById('westworld-wrapper');

    const topbarAnchor = $('#extensions-settings-button');
    if (topbarAnchor.length > 0) {
        if (existingWrapper) {
            topbarAnchor.after(existingWrapper);
        } else {
            topbarAnchor.after(html);
        }
        return true;
    }

    const settingsPanel = $('#extensions_settings2');
    if (settingsPanel.length > 0) {
        if (existingWrapper) {
            settingsPanel.append(existingWrapper);
        } else {
            settingsPanel.append(html);
        }
        return true;
    }

    return false;
}

async function mountDrawerWithRetry(html, maxAttempts = 30, intervalMs = 200) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (mountDrawerHtml(html)) {
            return true;
        }
        await delay(intervalMs);
    }
    return false;
}

async function loadTxtToWorldbookModule() {
    if (!txtToWorldbookModule) {
        txtToWorldbookModule = await import('./txtToWorldbook/main.js');
    }
    return txtToWorldbookModule;
}

async function ensureTxtToWorldbookReady() {
    if (!txtToWorldbookInitPromise) {
        txtToWorldbookInitPromise = (async () => {
            const moduleRef = await loadTxtToWorldbookModule();
            await moduleRef.initTxtToWorldbookBridge();
            return moduleRef;
        })();
    }
    return txtToWorldbookInitPromise;
}

function getTxtToWorldbookApiSafe() {
    return txtToWorldbookModule?.getTxtToWorldbookApi?.();
}

function getDirectorGateStatus() {
    return {
        pendingUserSend: directorPromptGate.pendingUserSend,
        lastUserSendAt: directorPromptGate.lastUserSendAt,
        lastGeneration: directorPromptGate.lastGeneration,
        lastHandledAt: directorPromptGate.lastHandledAt,
        inProgress: directorPromptGate.inProgress,
        hookRegistered: directorPromptGate.hookRegistered,
        hookRegisteredAt: directorPromptGate.hookRegisteredAt,
        lastSkipReason: directorPromptGate.lastSkipReason,
        lastLifecycleEvent: directorPromptGate.lastLifecycleEvent,
        lastLifecycleAt: directorPromptGate.lastLifecycleAt,
        externalPrepared: directorPromptGate.externalPrepared,
        promptManager: getDirectorPromptManagerStatusSafe(),
    };
}

function markDirectorEvent(eventType, data = {}) {
    const api = getTxtToWorldbookApiSafe();
    api?.markDirectorEvent?.(eventType, data);
}

function markDirectorGateSkipped(reason, data = {}) {
    directorPromptGate.lastSkipReason = String(reason || '');
    const api = getTxtToWorldbookApiSafe();
    api?.markDirectorGateSkipped?.(reason, data);
}

function invalidateDirectorRuntime(reason, data = {}) {
    directorPromptGate.pendingUserSend = false;
    directorPromptGate.lastGeneration = null;
    directorPromptGate.externalPrepared = null;
    directorPromptGate.lastLifecycleEvent = String(reason || '');
    directorPromptGate.lastLifecycleAt = Date.now();
    const api = getTxtToWorldbookApiSafe();
    api?.invalidateDirectorRuntime?.(reason, data);
}

function extractGenerationContext(eventData) {
    if (eventData && typeof eventData === 'object') {
        return {
            type: eventData.type ?? eventData.generationType ?? directorPromptGate.lastGeneration?.type,
            params: eventData.params ?? eventData.generationParams ?? directorPromptGate.lastGeneration?.params,
            dryRun: eventData.dryRun ?? directorPromptGate.lastGeneration?.dryRun,
        };
    }
    return directorPromptGate.lastGeneration || {};
}

function getDirectorSkipReason(eventData) {
    return getDirectorGateSkipReason(eventData, {
        pendingUserSend: directorPromptGate.pendingUserSend,
        lastUserSendAt: directorPromptGate.lastUserSendAt,
        lastGeneration: extractGenerationContext(eventData),
    });
}

function getDirectorPromptManagerOptions() {
    return {
        injectionPosition: INJECTION_POSITION?.RELATIVE ?? 0,
    };
}

function ensureDirectorPromptManagerEntry(promptManagerRef, options = {}) {
    return ensurePresetEntry(promptManagerRef, {
        ...DIRECTOR_PRESET_ENTRY,
        ...options,
    });
}

function setDirectorPromptManagerContent(promptManagerRef, content, options = {}) {
    return setPresetEntryContent(promptManagerRef, content, {
        ...DIRECTOR_PRESET_ENTRY,
        ...options,
    });
}

function clearDirectorPromptManagerContent(promptManagerRef, reason = '', options = {}) {
    return clearPresetEntryContent(promptManagerRef, reason, {
        ...DIRECTOR_PRESET_ENTRY,
        ...options,
    });
}

function getDirectorPromptManagerStatus(promptManagerRef, options = {}) {
    return getPresetEntryStatus(promptManagerRef, {
        ...DIRECTOR_PRESET_ENTRY,
        ...options,
    });
}

function savePromptManagerStructure(result) {
    if (!result?.ok || result.changed !== true) return;
    try {
        promptManager?.saveServiceSettings?.();
    } catch (error) {
        console.warn('[WestWorld] failed to save PromptManager settings:', error?.message || error);
    }
    try {
        saveSettingsDebounced?.();
    } catch (_) { }
}

function repairDirectorPromptManagerEntry(options = {}) {
    const result = ensureDirectorPromptManagerEntry(promptManager, {
        ...getDirectorPromptManagerOptions(),
        ...(options.clearContent ? { content: '' } : {}),
    });
    if (options.save !== false) {
        savePromptManagerStructure(result);
    }
    return {
        ...result,
        status: getDirectorPromptManagerStatus(promptManager),
    };
}

function getDirectorPromptManagerStatusSafe() {
    return getDirectorPromptManagerStatus(promptManager);
}

function clearDirectorPromptManager(reason = '') {
    const result = clearDirectorPromptManagerContent(promptManager, reason, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt cleared: ${reason || 'no-reason'}`);
    return result;
}

function clearPreparedDirector(reason = '') {
    clearExternalPreparedDirectorPrompt(reason || 'manual-clear');
    return clearDirectorPromptManager(reason || 'manual-clear');
}

function setDirectorPromptManagerDirectorContent(content) {
    const result = setDirectorPromptManagerContent(promptManager, content, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt content length=${String(content || '').length}`);
    return result;
}

function clearExternalPreparedDirectorPrompt(reason = '') {
    if (!directorPromptGate.externalPrepared) return;
    markDirectorEvent('PROMPT_MANAGER_EXTERNAL_PREPARED_CLEARED', {
        reason: String(reason || ''),
        prepared: directorPromptGate.externalPrepared,
    });
    directorPromptGate.externalPrepared = null;
}

function getReusableExternalPreparedDirectorPrompt() {
    const prepared = directorPromptGate.externalPrepared;
    if (!prepared) return null;
    if (Date.now() > prepared.expiresAt) {
        clearExternalPreparedDirectorPrompt('expired');
        return null;
    }
    const status = getDirectorPromptManagerStatusSafe();
    if (!status?.contentLength) {
        clearExternalPreparedDirectorPrompt('prompt-manager-content-empty');
        return null;
    }
    return { prepared, status };
}

async function prepareDirectorPromptForInput(options = {}) {
    const normalizedOptions = typeof options === 'string' ? { userInput: options } : (options || {});
    const userInput = String(
        normalizedOptions.userInput
        || normalizedOptions.rawUserInput
        || normalizedOptions.originalUserInput
        || normalizedOptions.latestUserMessage
        || ''
    ).trim();
    const source = String(normalizedOptions.source || 'external').trim() || 'external';

    if (!userInput) {
        return { ok: false, reason: 'user-input-empty' };
    }

    clearExternalPreparedDirectorPrompt('new-external-prepare');
    directorPromptGate.pendingUserSend = true;
    directorPromptGate.lastUserSendAt = Date.now();

    const result = await prepareDirectorPromptManagerForGeneration({
        type: normalizedOptions.type || source,
        params: {
            ...(normalizedOptions.params || {}),
            external_director_prepare: true,
            source,
        },
        dryRun: normalizedOptions.dryRun === true,
        latestUserMessage: userInput,
        userInput,
        rawUserInput: userInput,
        originalUserInput: userInput,
        source,
    });

    if (!result?.ok) {
        directorPromptGate.externalPrepared = null;
        return result;
    }

    const status = getDirectorPromptManagerStatusSafe();
    directorPromptGate.externalPrepared = {
        source,
        at: Date.now(),
        expiresAt: Date.now() + EXTERNAL_DIRECTOR_PREPARE_TTL_MS,
        inputLength: userInput.length,
        contentLength: status?.contentLength || 0,
        contentHash: result?.meta?.contentHash || '',
        runId: result?.meta?.runId || '',
    };
    markDirectorEvent('PROMPT_MANAGER_EXTERNAL_PREPARED', {
        prepared: directorPromptGate.externalPrepared,
        meta: result?.meta || null,
    });
    return {
        ...result,
        externalPrepared: { ...directorPromptGate.externalPrepared },
        status,
    };
}

async function prepareDirectorPromptManagerForGeneration(eventContext = {}) {
    if (scriptApi.main_api !== 'openai') {
        markDirectorGateSkipped('prompt-manager-openai-only', { mainApi: scriptApi.main_api || '' });
        return { ok: false, reason: 'prompt-manager-openai-only' };
    }

    const generationType = String(eventContext?.type || '');
    const generationParams = eventContext?.params || {};
    const isRegenerateOrSwipe = generationType === 'regenerate'
        || generationType === 'swipe'
        || generationParams.regenerate === true
        || generationParams.swipe === true;

    const promptEntry = repairDirectorPromptManagerEntry({ save: true });
    if (!promptEntry.ok) {
        markDirectorGateSkipped(promptEntry.reason || 'prompt-manager-entry-not-ready', promptEntry);
        return { ok: false, reason: promptEntry.reason || 'prompt-manager-entry-not-ready' };
    }

    if (promptEntry.activeEnabled === false) {
        markDirectorGateSkipped('prompt-manager-entry-disabled', promptEntry.status || promptEntry);
        return { ok: false, reason: 'prompt-manager-entry-disabled' };
    }

    const reusableExternal = getReusableExternalPreparedDirectorPrompt();
    if (reusableExternal) {
        markDirectorEvent('PROMPT_MANAGER_EXTERNAL_REUSED', {
            type: generationType,
            params: generationParams,
            prepared: reusableExternal.prepared,
            status: reusableExternal.status,
        });
        return {
            ok: true,
            reused: true,
            reason: 'external-prepared',
            externalPrepared: reusableExternal.prepared,
            status: reusableExternal.status,
        };
    }

    if (isRegenerateOrSwipe) {
        const status = getDirectorPromptManagerStatusSafe();
        if (!status?.contentLength) {
            markDirectorGateSkipped('prompt-manager-reuse-empty', status || promptEntry);
            return { ok: false, reason: 'prompt-manager-reuse-empty' };
        }
        markDirectorEvent('PROMPT_MANAGER_REUSED', {
            type: generationType,
            params: generationParams,
            status,
        });
        return { ok: true, reused: true, reason: 'regenerate-or-swipe' };
    }

    clearDirectorPromptManager('generation-started');

    if (directorPromptGate.inProgress) {
        markDirectorGateSkipped('inProgress-lock');
        return { ok: false, reason: 'inProgress-lock' };
    }

    const skipReason = getDirectorSkipReason(eventContext);
    if (skipReason) {
        markDirectorGateSkipped(skipReason);
        clearDirectorPromptManager(skipReason);
        return { ok: false, reason: skipReason };
    }

    directorPromptGate.inProgress = true;
    directorPromptGate.lastHandledAt = Date.now();
    try {
        const api = getTxtToWorldbookApiSafe();
        if (!api || typeof api.prepareDirectorInjectionForGeneration !== 'function') {
            markDirectorGateSkipped('txtToWorldbook-api-not-ready');
            clearDirectorPromptManager('txtToWorldbook-api-not-ready');
            return { ok: false, reason: 'txtToWorldbook-api-not-ready' };
        }

        const prepared = await api.prepareDirectorInjectionForGeneration(eventContext);
        let promptToSet = prepared;
        if (!promptToSet?.ok || !promptToSet.content) {
            const reason = prepared?.reason || 'director-content-empty';
            const shouldRespectSkip = [
                'directorEnabled=false',
                'directorMode=off',
                'directorFallbackOnError=false',
                'directorRunEveryTurn=false',
                'state-missing',
                'chapter-missing',
                'beats-missing',
            ].includes(reason);
            if (shouldRespectSkip) {
                markDirectorGateSkipped(reason, prepared || {});
                clearDirectorPromptManager(reason);
                return { ok: false, reason };
            }
            const fallbackPrompt = typeof api.getDirectorInjectionPrompt === 'function'
                ? api.getDirectorInjectionPrompt({ includeMarker: true })
                : null;
            if (!fallbackPrompt?.ok || !fallbackPrompt.content) {
                markDirectorGateSkipped(reason, {
                    prepared: prepared || {},
                    fallback: fallbackPrompt || null,
                });
                clearDirectorPromptManager(reason);
                return { ok: false, reason };
            }
            markDirectorEvent('PROMPT_MANAGER_FALLBACK_CURRENT_BEAT', {
                reason,
                meta: fallbackPrompt.meta || null,
            });
            promptToSet = fallbackPrompt;
        }

        const setResult = setDirectorPromptManagerDirectorContent(promptToSet.content);
        if (!setResult.ok) {
            markDirectorGateSkipped(setResult.reason || 'prompt-manager-set-failed', setResult);
            return { ok: false, reason: setResult.reason || 'prompt-manager-set-failed' };
        }

        markDirectorEvent('PROMPT_MANAGER_READY', {
            contentLength: promptToSet.content.length,
            meta: promptToSet.meta || null,
            status: getDirectorPromptManagerStatusSafe(),
        });
        return { ok: true, meta: promptToSet.meta || null };
    } catch (error) {
        clearDirectorPromptManager('prepare-error');
        console.warn('[WestWorld] director PromptManager prepare failed:', error?.message || error);
        invalidateDirectorRuntime('prompt-manager-prepare-error', { error: error?.message || String(error) });
        return { ok: false, reason: 'prompt-manager-prepare-error' };
    } finally {
        directorPromptGate.inProgress = false;
    }
}

function registerDirectorPromptHook() {
    if (!eventSource || !event_types?.CHAT_COMPLETION_PROMPT_READY) {
        directorTrace('eventSource or CHAT_COMPLETION_PROMPT_READY missing, skip register');
        return;
    }

    if (!directorMessageSentHandler && event_types?.MESSAGE_SENT) {
        directorMessageSentHandler = () => {
            directorPromptGate.pendingUserSend = true;
            directorPromptGate.lastUserSendAt = Date.now();
            markDirectorEvent('MESSAGE_SENT');
            directorTrace('MESSAGE_SENT received, mark pendingUserSend=true');
        };
    }

    if (!directorGenerationStartedHandler && event_types?.GENERATION_STARTED) {
        directorGenerationStartedHandler = async (type, params, dryRun) => {
            directorPromptGate.lastGeneration = {
                type,
                params,
                dryRun,
                at: Date.now(),
            };
            markDirectorEvent('GENERATION_STARTED', { type, dryRun, params });
            const isRegenerate = type === 'regenerate' || type === 'swipe' || !!params?.regenerate || !!params?.swipe;
            if (isRegenerate) {
                directorPromptGate.pendingUserSend = true;
                directorPromptGate.lastUserSendAt = Date.now();
                directorTrace(`GENERATION_STARTED(${type}) treated as user-triggered regenerate/swipe`);
            }
            await prepareDirectorPromptManagerForGeneration({ type, params, dryRun });
        };
    }

    if (!directorPromptReadyHandler) {
        directorPromptReadyHandler = async (eventData) => {
            markDirectorEvent('CHAT_COMPLETION_PROMPT_READY', {
                chatLength: Array.isArray(eventData?.chat) ? eventData.chat.length : -1,
                promptManager: getDirectorPromptManagerStatusSafe(),
            });

            try {
                const api = getTxtToWorldbookApiSafe();
                if (!api || typeof api.recordDirectorPromptReadyInspection !== 'function') {
                    directorTrace('skip ready inspection: txtToWorldbook api not ready');
                    markDirectorGateSkipped('txtToWorldbook-api-not-ready');
                    return;
                }
                const inspected = api.recordDirectorPromptReadyInspection(eventData?.chat);
                if (!inspected?.injected) {
                    directorTrace(`ready inspection miss: ${inspected?.reason || 'director-injection-not-found'}`);
                } else {
                    directorTrace(`ready inspection ok at index=${inspected.insertionIndex}`);
                }
            } catch (error) {
                console.warn('[WestWorld] director ready inspection failed:', error?.message || error);
                invalidateDirectorRuntime('ready-inspection-error', { error: error?.message || String(error) });
            } finally {
                directorPromptGate.pendingUserSend = false;
                clearExternalPreparedDirectorPrompt('prompt-ready');
            }
        };
    }

    if (event_types?.MESSAGE_SENT && directorMessageSentHandler) {
        eventSource.off?.(event_types.MESSAGE_SENT, directorMessageSentHandler);
        eventSource.on(event_types.MESSAGE_SENT, directorMessageSentHandler);
    }

    if (event_types?.GENERATION_STARTED && directorGenerationStartedHandler) {
        eventSource.off?.(event_types.GENERATION_STARTED, directorGenerationStartedHandler);
        eventSource.on(event_types.GENERATION_STARTED, directorGenerationStartedHandler);
    }

    eventSource.off?.(event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    registerDirectorLifecycleHooks();
    directorPromptGate.hookRegistered = true;
    directorPromptGate.hookRegisteredAt = Date.now();
    getTxtToWorldbookApiSafe()?.markDirectorHookRegistered?.({
        gate: getDirectorGateStatus(),
    });
    directorTrace('director prompt hook registered');
}

function registerDirectorLifecycleHooks() {
    const lifecycleEvents = [
        'CHAT_CHANGED',
        'CHAT_CREATED',
        'MESSAGE_SWIPED',
        'MESSAGE_DELETED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'CHARACTER_SELECTED',
    ];

    for (const eventName of lifecycleEvents) {
        const eventType = event_types?.[eventName];
        if (!eventType) continue;
        if (!directorLifecycleHandlers.has(eventName)) {
            directorLifecycleHandlers.set(eventName, (...args) => {
                invalidateDirectorRuntime(eventName.toLowerCase().replace(/_/g, '-'), { args });
                directorTrace(`${eventName} received, director runtime invalidated`);
            });
        }
        const handler = directorLifecycleHandlers.get(eventName);
        eventSource.off?.(eventType, handler);
        eventSource.on(eventType, handler);
    }
}

function ensureSettings() {
    const legacySettings = extension_settings[legacyExtensionName] && typeof extension_settings[legacyExtensionName] === 'object'
        ? extension_settings[legacyExtensionName]
        : null;

    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {
            ...defaultSettings,
            ...(legacySettings || {}),
        };
    }
    settings = {
        ...defaultSettings,
        ...(legacySettings || {}),
        ...extension_settings[extensionName],
    };
    extension_settings[extensionName] = settings;
    extension_settings[legacyExtensionName] = settings;
}

function persistSettings() {
    extension_settings[extensionName] = settings;
    extension_settings[legacyExtensionName] = settings;
    saveSettingsDebounced();
}

function updateDrawerUI() {
    const iconEl = document.getElementById('westworld-icon');
    const panelEl = document.getElementById('westworld-content-panel');
    if (!iconEl) return;

    if (settings.panelCollapsed) {
        iconEl.classList.remove('openIcon');
        iconEl.classList.add('closedIcon');
        if (panelEl) {
            panelEl.classList.remove('openDrawer');
            panelEl.classList.add('closedDrawer');
        }
    } else {
        iconEl.classList.remove('closedIcon');
        iconEl.classList.add('openIcon');
        if (panelEl) {
            panelEl.classList.remove('closedDrawer');
            panelEl.classList.add('openDrawer');
        }
    }
}

async function openTxtToWorldbookPanel() {
    try {
        await ensureTxtToWorldbookReady();
        const api = getTxtToWorldbookApiSafe();
        if (!api || typeof api.open !== 'function') {
            toastr.error('WestWorld converter is not ready yet.');
            return;
        }
        api.open();
    } catch (error) {
        console.error('[WestWorld] failed to open TXT converter:', error);
        toastr.error('WestWorld converter failed to load.');
    }
}

function ensureChatControlStyle() {
    if (document.getElementById(CHAT_CONTROL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHAT_CONTROL_STYLE_ID;
    style.textContent = `
#${CHAT_CONTROL_BAR_ID} {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    padding: 4px 8px 2px;
    font-size: 12px;
    line-height: 1.2;
}
#${CHAT_CONTROL_BAR_ID} .westworld-chat-control-button {
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.25));
    border-radius: 6px;
    background: var(--black30a, rgba(0,0,0,0.3));
    color: var(--SmartThemeBodyColor, inherit);
    cursor: pointer;
}
#${CHAT_CONTROL_BAR_ID} .westworld-chat-control-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
#${CHAT_CONTROL_BAR_ID} .westworld-chat-control-counter {
    min-width: 36px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--SmartThemeBodyColor, inherit);
    opacity: 0.9;
}
#${CHAT_CONTROL_BAR_ID} .westworld-chat-control-state {
    min-width: 44px;
    max-width: 70px;
    padding: 3px 7px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
    border-radius: 6px;
    background: var(--black30a, rgba(0,0,0,0.28));
    color: var(--SmartThemeBodyColor, inherit);
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
}
@media (max-width: 600px) {
    #${CHAT_CONTROL_BAR_ID} {
        justify-content: center;
        flex-wrap: wrap;
    }
}
`;
    document.head.appendChild(style);
}

function getChatControlStatus() {
    const api = getTxtToWorldbookApiSafe();
    if (!api || typeof api.getReadingProgressStatus !== 'function') {
        return { ok: false, reason: 'txtToWorldbook-api-not-ready', display: '0/0', canNextBeat: false, canNextChapter: false, totalBeats: 0 };
    }
    try {
        return api.getReadingProgressStatus();
    } catch (error) {
        console.warn('[WestWorld] failed to read progress status:', error?.message || error);
        return { ok: false, reason: 'status-error', display: '0/0', canNextBeat: false, canNextChapter: false, totalBeats: 0 };
    }
}

function getChatHistorySafe() {
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            const chat = SillyTavern.getContext()?.chat;
            return Array.isArray(chat) ? chat : [];
        }
    } catch (_) { }
    try {
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            const chat = window.SillyTavern.getContext()?.chat;
            return Array.isArray(chat) ? chat : [];
        }
    } catch (_) { }
    return [];
}

function isAssistantChatItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.is_user === true || item.is_system === true) return false;
    if (item.is_westworld_director === true || item.is_storyweaver_director === true) return false;
    const role = String(item.role || '').toLowerCase();
    return !role || role === 'assistant';
}

function getLatestAssistantMessageText() {
    const chat = getChatHistorySafe();
    for (let i = chat.length - 1; i >= 0; i--) {
        const item = chat[i] || {};
        if (!isAssistantChatItem(item)) continue;
        const content = String(item.mes || item.content || '').trim();
        if (content) return content;
    }
    return '';
}

function getChatControlStateStatus() {
    const api = getTxtToWorldbookApiSafe();
    const appSettings = typeof api?.getSettings === 'function' ? api.getSettings() : {};
    return extractDirectorStateTag(getLatestAssistantMessageText(), {
        startTag: appSettings?.directorStateStartTag,
        endTag: appSettings?.directorStateEndTag,
    });
}

function updateChatControlBar() {
    const bar = document.getElementById(CHAT_CONTROL_BAR_ID);
    if (!bar) return;

    const status = getChatControlStatus();
    const hasBeat = status?.ok === true && Number(status.totalBeats || 0) > 0;
    const counter = bar.querySelector('[data-westworld-role="beat-counter"]');
    const stateLabel = bar.querySelector('[data-westworld-role="state-status"]');
    const nextBeatButton = bar.querySelector('[data-westworld-action="next-beat"]');
    const nextChapterButton = bar.querySelector('[data-westworld-action="next-chapter"]');
    const busy = bar.dataset.busy === '1';

    if (counter) {
        counter.textContent = String(status?.display || '0/0');
        counter.title = status?.ok
            ? `WestWorld ${status.currentChapter || 0}/${status.totalChapters || 0}`
            : 'WestWorld 未就绪';
    }
    if (stateLabel) {
        const state = getChatControlStateStatus();
        stateLabel.textContent = state.display;
        stateLabel.title = state.found
            ? `WestWorld state: ${state.value}`
            : `WestWorld state: 未知（标签 ${state.startTag}...${state.endTag} 未匹配）`;
    }
    if (nextBeatButton) {
        nextBeatButton.disabled = busy || !hasBeat || status.canNextBeat !== true;
    }
    if (nextChapterButton) {
        nextChapterButton.disabled = busy || !hasBeat || status.canNextChapter !== true;
    }
}

function scheduleChatControlRefresh(delayMs = 60) {
    if (chatControlRefreshTimer) {
        clearTimeout(chatControlRefreshTimer);
    }
    chatControlRefreshTimer = setTimeout(() => {
        chatControlRefreshTimer = null;
        updateChatControlBar();
    }, Math.max(0, delayMs));
}

function setChatControlBusy(busy) {
    const bar = document.getElementById(CHAT_CONTROL_BAR_ID);
    if (!bar) return;
    bar.dataset.busy = busy ? '1' : '0';
    updateChatControlBar();
}

async function handleChatControlAction(action) {
    const api = getTxtToWorldbookApiSafe();
    if (!api) {
        toastr.warning('WestWorld 未就绪');
        updateChatControlBar();
        return;
    }

    const method = action === 'next-chapter' ? 'nextChapter' : 'nextBeat';
    if (typeof api[method] !== 'function') {
        toastr.warning('WestWorld 控制接口不可用');
        updateChatControlBar();
        return;
    }

    setChatControlBusy(true);
    try {
        const result = await api[method]();
        const status = result?.status || getChatControlStatus();
        if (result?.ok) {
            toastr.success(action === 'next-chapter' ? '已进入下一章' : `已切换到 ${status?.display || '0/0'}`);
        } else {
            toastr.warning(action === 'next-chapter' ? '无法进入下一章' : '无法切换下一拍');
        }
    } catch (error) {
        console.warn('[WestWorld] chat control action failed:', error?.message || error);
        toastr.error(error?.message || 'WestWorld 控制失败');
    } finally {
        setChatControlBusy(false);
        scheduleChatControlRefresh(0);
    }
}

function mountChatControlBar() {
    const formShield = document.getElementById('form_sheld');
    const sendForm = document.getElementById('send_form');
    if (!formShield || !sendForm) return false;

    ensureChatControlStyle();

    const existing = document.getElementById(CHAT_CONTROL_BAR_ID);
    if (existing) {
        existing.remove();
    }

    const bar = document.createElement('div');
    bar.id = CHAT_CONTROL_BAR_ID;
    bar.dataset.busy = '0';
    bar.innerHTML = `
        <button type="button" class="westworld-chat-control-button" data-westworld-action="next-beat">下一拍</button>
        <span class="westworld-chat-control-counter" data-westworld-role="beat-counter">0/0</span>
        <span class="westworld-chat-control-state" data-westworld-role="state-status">未知</span>
        <button type="button" class="westworld-chat-control-button" data-westworld-action="next-chapter">下一章</button>
    `;

    bar.querySelector('[data-westworld-action="next-beat"]')?.addEventListener('click', () => {
        void handleChatControlAction('next-beat');
    });
    bar.querySelector('[data-westworld-action="next-chapter"]')?.addEventListener('click', () => {
        void handleChatControlAction('next-chapter');
    });

    formShield.insertBefore(bar, sendForm);
    updateChatControlBar();
    return true;
}

function registerChatControlRefreshHooks() {
    const refreshEvents = [
        'MESSAGE_SENT',
        'CHAT_CHANGED',
        'CHAT_CREATED',
        'MESSAGE_SWIPED',
        'MESSAGE_DELETED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'MESSAGE_RECEIVED',
        'GENERATION_ENDED',
    ];

    for (const eventName of refreshEvents) {
        const eventType = event_types?.[eventName];
        if (!eventType) continue;
        if (!chatControlRefreshHandlers.has(eventName)) {
            chatControlRefreshHandlers.set(eventName, () => scheduleChatControlRefresh());
        }
        const handler = chatControlRefreshHandlers.get(eventName);
        eventSource.off?.(eventType, handler);
        eventSource.on(eventType, handler);
    }

    $(document)
        .off('click.westworldChatControlRefresh', '#ttw-next-beat-btn,#ttw-prev-beat-btn,#ttw-next-chapter-btn,#ttw-prev-chapter-btn,#ttw-start-reading-first')
        .on('click.westworldChatControlRefresh', '#ttw-next-beat-btn,#ttw-prev-beat-btn,#ttw-next-chapter-btn,#ttw-prev-chapter-btn,#ttw-start-reading-first', () => {
            scheduleChatControlRefresh(160);
        });
}

async function setupUI() {
    const extensionFolder = getExtensionFolderName();

    // Load template using detected folder first, then fallback to the canonical name.
    let html = '';
    try {
        html = await renderExtensionTemplateAsync(`third-party/${extensionFolder}`, 'drawer-component');
    } catch (error) {
        if (extensionFolder !== BRAND_NAME) {
            try {
                html = await renderExtensionTemplateAsync(`third-party/${BRAND_NAME}`, 'drawer-component');
            } catch (_fallbackError) {
                html = await renderExtensionTemplateAsync(`third-party/${LEGACY_BRAND_NAME}`, 'drawer-component');
            }
        } else {
            html = await renderExtensionTemplateAsync(`third-party/${LEGACY_BRAND_NAME}`, 'drawer-component');
        }
    }

    if (!html || !String(html).trim()) {
        throw new Error('WestWorld drawer template is empty.');
    }

    const mounted = await mountDrawerWithRetry(html, 60, 250);
    if (!mounted) {
        // Fallback mount so the icon can still appear even if target selectors change.
        const existingWrapper = document.getElementById('westworld-wrapper');
        if (!existingWrapper) {
            document.body.insertAdjacentHTML('beforeend', html);
        }
        console.warn('[WestWorld] mount target not found, mounted to body fallback.');
    }

    // Rebind with namespace to avoid duplicated handlers on reload.
    $(document).off('click.storyweaver');
    $(document).off(`click${setupEventNamespace}`);
    $(document).on(`click${setupEventNamespace}`, '#westworld-wrapper .drawer-toggle', async (e) => {
        e.stopPropagation();
        await openTxtToWorldbookPanel();
    });
}

async function bootstrap() {
    if (directorPublicApi) {
        return directorPublicApi;
    }
    ensureSettings();
    try {
        await setupUI();
    } catch (error) {
        console.error('[WestWorld] UI mount failed:', error);
        toastr.error('WestWorld UI mount failed. Please reload extensions.');
    }

    try {
        await ensureTxtToWorldbookReady();
        registerDirectorPromptHook();
        mountChatControlBar();
        registerChatControlRefreshHooks();
        repairDirectorPromptManagerEntry({ save: true, clearContent: true });
        window.WestWorld = {
            openTxtConverter: openTxtToWorldbookPanel,
            getTxtToWorldbookApi: getTxtToWorldbookApiSafe,
            updateSelfFromRepo,
            getDirectorGateStatus,
            getDirectorPromptManagerStatus: getDirectorPromptManagerStatusSafe,
            repairDirectorPromptManagerEntry: () => repairDirectorPromptManagerEntry({ save: true }),
            clearDirectorPromptManagerContent: (reason) => clearDirectorPromptManager(reason || 'manual-clear'),
            getDirectorStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
            getDirectorRuntimeStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
            getDirectorLogs: (limit) => getTxtToWorldbookApiSafe()?.getDirectorLogs?.(limit) || [],
            clearDirectorLogs: () => getTxtToWorldbookApiSafe()?.clearDirectorLogs?.(),
            getDirectorContext: (options) => getTxtToWorldbookApiSafe()?.getDirectorContext?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            getDirectorInjectionPrompt: (options) => getTxtToWorldbookApiSafe()?.getDirectorInjectionPrompt?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            getDirectorPromptForLittleWhiteBox: (options) => getTxtToWorldbookApiSafe()?.getDirectorPromptForLittleWhiteBox?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            prepareDirectorPromptForInput,
            clearPreparedDirector,
            inspectDirectorInjection: (chat) => getTxtToWorldbookApiSafe()?.inspectDirectorInjection?.(chat) || { injected: false, reason: 'txtToWorldbook-api-not-ready' },
            testDirectorInjection: (options) => getTxtToWorldbookApiSafe()?.testDirectorInjection?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            bindDirectorSessionToCurrentChapter: () => getTxtToWorldbookApiSafe()?.bindDirectorSessionToCurrentChapter?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            nextBeat: () => getTxtToWorldbookApiSafe()?.nextBeat?.() || Promise.resolve({ ok: false, reason: 'txtToWorldbook-api-not-ready' }),
            nextChapter: () => getTxtToWorldbookApiSafe()?.nextChapter?.() || Promise.resolve({ ok: false, reason: 'txtToWorldbook-api-not-ready' }),
            getReadingProgressStatus: () => getTxtToWorldbookApiSafe()?.getReadingProgressStatus?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready', display: '0/0' },
        };
        scheduleChatControlRefresh(0);
        window.StoryWeaver = window.WestWorld;
        directorPublicApi = window.WestWorld;
        console.log('[WestWorld] Plugin initialized successfully');
        return directorPublicApi;
    } catch (error) {
        console.error('[WestWorld] txtToWorldbook init failed:', error);
        toastr.error('WestWorld failed to initialize TXT converter.');
        throw error;
    }
}

export async function initDirector() {
    if (!directorBootstrapPromise) {
        directorBootstrapPromise = bootstrap();
    }
    const api = await directorBootstrapPromise;
    window.WestWorld = window.WestWorld || api || {};
    window.StoryWeaver = window.WestWorld;
    return window.WestWorld;
}

export function cleanupDirector() {
    if (chatControlRefreshTimer) {
        clearTimeout(chatControlRefreshTimer);
        chatControlRefreshTimer = null;
    }
    try {
        $(document).off(`click${setupEventNamespace}`);
        $(document).off('click.storyweaver');
    } catch (_) { }
    try {
        document.getElementById(CHAT_CONTROL_BAR_ID)?.remove();
        document.getElementById(CHAT_CONTROL_STYLE_ID)?.remove();
        document.getElementById('westworld-wrapper')?.remove();
    } catch (_) { }
    directorPublicApi = null;
    directorBootstrapPromise = null;
    txtToWorldbookModule = null;
    txtToWorldbookInitPromise = null;
    if (window.StoryWeaver === window.WestWorld) {
        delete window.StoryWeaver;
    }
    delete window.WestWorld;
}
