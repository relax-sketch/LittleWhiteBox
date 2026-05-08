import { extension_settings } from '../../../../../extensions.js';
import { getRequestHeaders, saveSettingsDebounced, substituteParamsExtended } from '../../../../../../script.js';
import { getStorySummaryForEna } from '../story-summary/story-summary.js';
import { buildVectorPromptText } from '../story-summary/generate/prompt.js';
import { getVectorConfig } from '../story-summary/data/config.js';
import { extensionFolderPath } from '../../core/constants.js';
import { EnaPlannerStorage } from '../../core/server-storage.js';
import { postToIframe, isTrustedIframeEvent } from '../../core/iframe-messaging.js';
import { DEFAULT_PROMPT_BLOCKS, BUILTIN_TEMPLATES } from './ena-planner-presets.js';
import { getDefaultApiPrefix, joinApiUrl, resolveApiBaseUrl } from '../../shared/common/openai-url-utils.js';
import { formatOutlinePrompt } from '../story-outline/story-outline.js';
import { shouldSendOnEnter } from '../../../../../../scripts/RossAscends-mods.js';
import jsyaml from '../../libs/js-yaml.mjs';

const EXT_NAME = 'ena-planner';
const OVERLAY_ID = 'xiaobaix-ena-planner-overlay';
const HTML_PATH = `${extensionFolderPath}/modules/ena-planner/ena-planner.html`;
const VECTOR_RECALL_TIMEOUT_MS = 15000;
const PLANNER_REQUEST_TIMEOUT_MS = 180000;

/**
 * -------------------------
 * Default settings
 * --------------------------
 */
function getDefaultSettings() {
    return {
        enabled: true,
        skipIfPlotPresent: true,
        mergeConsecutiveSystemMessages: false,

        // Chat history: tags to strip from AI responses (besides <think>)
        chatExcludeTags: ['行动选项', 'UpdateVariable', 'StatusPlaceHolderImpl'],

        // Worldbook: always read character-linked lorebooks by default
        // User can also opt-in to include global worldbooks
        includeGlobalWorldbooks: false,
        excludeWorldbookPosition4: true,
        // Worldbook entry names containing these strings will be excluded
        worldbookExcludeNames: ['mvu_update'],

        // Plot extraction
        plotCount: 2,
        // Planner response tags to keep, in source order (empty = keep full response)
        responseKeepTags: ['plot', 'note', 'plot-log', 'state'],

        // Vectors Enhanced knowledge recall for planner context
        vectorKnowledge: {
            enabled: false,
        },

        // Optional WestWorld director context for planner messages
        westWorldDirector: {
            enabled: false,
            maxLength: 4000,
        },

        // Planner prompts (designer)
        promptBlocks: structuredClone(DEFAULT_PROMPT_BLOCKS),
        // Saved prompt templates: { name: promptBlocks[] }
        promptTemplates: structuredClone(BUILTIN_TEMPLATES),
        // Currently selected prompt template name in UI
        activePromptTemplate: '',

        // Planner API
        api: {
            channel: 'openai',
            baseUrl: '',
            prefixMode: 'auto',
            customPrefix: '',
            apiKey: '',
            model: '',
            stream: true,
            temperature: 1,
            top_p: 1,
            top_k: 0,
            presence_penalty: '',
            frequency_penalty: '',
            max_tokens: ''
        },

        // Logs
        logsPersist: true,
        logsMax: 20
    };
}

/**
 * -------------------------
 * Local state
 * --------------------------
 */
const state = {
    isPlanning: false,
    bypassNextSend: false,
    lastInjectedText: '',
    vectorKnowledgeSuccessNotified: false,
    logs: []
};

let config = null;
let overlay = null;
let iframeMessageBound = false;
let sendListenersInstalled = false;
let sendClickHandler = null;
let sendKeydownHandler = null;

/**
 * -------------------------
 * Helpers
 * --------------------------
 */
function ensureSettings() {
    const d = getDefaultSettings();
    const s = config || structuredClone(d);

    function deepMerge(target, src) {
        for (const k of Object.keys(src)) {
            if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
                target[k] = target[k] ?? {};
                deepMerge(target[k], src[k]);
            } else if (target[k] === undefined) {
                target[k] = src[k];
            }
        }
    }
    deepMerge(s, d);
    if (!Array.isArray(s.responseKeepTags)) s.responseKeepTags = structuredClone(d.responseKeepTags);
    else s.responseKeepTags = normalizeResponseKeepTags(s.responseKeepTags);
    if (!s.vectorKnowledge || typeof s.vectorKnowledge !== 'object') s.vectorKnowledge = structuredClone(d.vectorKnowledge);
    else {
        const vk = s.vectorKnowledge;
        vk.enabled = !!vk.enabled;
        delete vk.maxResults;
        delete vk.scoreThreshold;
        delete vk.selectedTaskRefs;
        delete vk.queryInstructionEnabled;
        delete vk.queryInstruction;
        delete vk.template;
    }
    if (!s.westWorldDirector || typeof s.westWorldDirector !== 'object') {
        s.westWorldDirector = structuredClone(d.westWorldDirector);
    } else {
        const ww = s.westWorldDirector;
        ww.enabled = !!ww.enabled;
        const maxLength = Math.max(0, Math.min(20000, parseInt(ww.maxLength, 10) || d.westWorldDirector.maxLength));
        ww.maxLength = maxLength;
    }

    // Migration: remove old keys that are no longer needed
    delete s.includeCharacterLorebooks;
    delete s.includeCharDesc;
    delete s.includeCharPersonality;
    delete s.includeCharScenario;
    delete s.includeVectorRecall;
    delete s.historyMessageCount;
    delete s.worldbookActivationMode;

    config = s;
    return s;
}

function normalizeResponseKeepTags(tags) {
    const src = Array.isArray(tags) ? tags : [];
    const cleaned = [];
    for (const raw of src) {
        const t = String(raw || '')
            .trim()
            .replace(/^<+|>+$/g, '')
            .toLowerCase();
        if (!/^[a-z][a-z0-9_-]*$/.test(t)) continue;
        if (!cleaned.includes(t)) cleaned.push(t);
    }
    return cleaned;
}

async function loadConfig() {
    const loaded = await EnaPlannerStorage.get('config', null);
    config = (loaded && typeof loaded === 'object') ? loaded : getDefaultSettings();
    ensureSettings();
    state.logs = Array.isArray(await EnaPlannerStorage.get('logs', [])) ? await EnaPlannerStorage.get('logs', []) : [];

    if (extension_settings?.[EXT_NAME]) {
        delete extension_settings[EXT_NAME];
        saveSettingsDebounced?.();
    }
    return config;
}

async function saveConfigNow() {
    ensureSettings();
    await EnaPlannerStorage.set('config', config);
    await EnaPlannerStorage.set('logs', state.logs);
    try {
        return await EnaPlannerStorage.saveNow({ silent: false });
    } catch {
        return false;
    }
}

function toastInfo(msg) {
    if (window.toastr?.info) return window.toastr.info(msg);
    console.log('[EnaPlanner]', msg);
}
function toastErr(msg) {
    if (window.toastr?.error) return window.toastr.error(msg);
    console.error('[EnaPlanner]', msg);
}

function clampLogs() {
    const s = ensureSettings();
    if (state.logs.length > s.logsMax) state.logs = state.logs.slice(0, s.logsMax);
}

function persistLogsMaybe() {
    const s = ensureSettings();
    if (!s.logsPersist) return;
    state.logs = state.logs.slice(0, s.logsMax);
    EnaPlannerStorage.set('logs', state.logs).catch(() => {});
}

function loadPersistedLogsMaybe() {
    const s = ensureSettings();
    if (!s.logsPersist) state.logs = [];
}

function nowISO() {
    return new Date().toISOString();
}

function runWithTimeout(taskFactory, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        Promise.resolve()
            .then(taskFactory)
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
    });
}

function normalizeUrlBase(u) {
    if (!u) return '';
    return u.replace(/\/+$/g, '');
}

function getDefaultPrefixByChannel(channel) {
    return getDefaultApiPrefix(channel);
}

function buildApiPrefix() {
    const s = ensureSettings();
    if (s.api.prefixMode === 'custom' && s.api.customPrefix?.trim()) return s.api.customPrefix.trim();
    return getDefaultPrefixByChannel(s.api.channel);
}

function buildUrl(path) {
    const s = ensureSettings();
    const base = normalizeUrlBase(s.api.baseUrl);
    const resolvedBase = resolveApiBaseUrl(base, buildApiPrefix());
    return joinApiUrl(resolvedBase, path);
}

function setSendUIBusy(busy) {
    const sendBtn = document.getElementById('send_but') || document.getElementById('send_button');
    const textarea = document.getElementById('send_textarea');
    if (sendBtn) sendBtn.disabled = !!busy;
    if (textarea) textarea.disabled = !!busy;
}

function safeStringify(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

/**
 * -------------------------
 * ST context helpers
 * --------------------------
 */
function getContextSafe() {
    try { return window.SillyTavern?.getContext?.() ?? null; } catch { return null; }
}

function getCurrentCharSafe() {
    try {
        // Method 1: via getContext()
        const ctx = getContextSafe();
        if (ctx) {
            const cid = ctx.characterId ?? ctx.this_chid;
            const chars = ctx.characters;
            if (chars && cid != null && chars[cid]) return chars[cid];
        }
        // Method 2: global this_chid + characters
        const st = window.SillyTavern;
        if (st) {
            const chid = st.this_chid ?? window.this_chid;
            const chars = st.characters ?? window.characters;
            if (chars && chid != null && chars[chid]) return chars[chid];
        }
        // Method 3: bare globals (some ST versions)
        if (window.this_chid != null && window.characters) {
            return window.characters[window.this_chid] ?? null;
        }
    } catch { }
    return null;
}

/**
 * -------------------------
 * Character card — always include desc/personality/scenario
 * --------------------------
 */
function formatCharCardBlock(charObj) {
    if (!charObj) return '';
    const name = charObj?.name ?? '';
    const description = charObj?.description ?? '';
    const personality = charObj?.personality ?? '';
    const scenario = charObj?.scenario ?? '';

    const parts = [];
    parts.push(`【角色卡】${name}`.trim());
    if (description) parts.push(`【description】\n${description}`);
    if (personality) parts.push(`【personality】\n${personality}`);
    if (scenario) parts.push(`【scenario】\n${scenario}`);
    return parts.join('\n\n');
}

/**
 * -------------------------
 * Chat history — ALL unhidden, AI responses ONLY
 * Strip: unclosed think blocks, configurable tags
 * --------------------------
 */
function cleanAiMessageText(text) {
    let out = String(text ?? '');

    // 1) Strip everything before and including </think> (handles unclosed think blocks)
    out = out.replace(/^[\s\S]*?<\/think>/i, '');
    out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
    out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');

    // 2) Strip user-configured exclude tags
    //    NOTE: JS \b does NOT work after CJK characters, so we use [^>]*> instead.
    //    Order matters: try block match first (greedy), then mop up orphan open/close tags.
    const s = ensureSettings();
    const tags = s.chatExcludeTags ?? [];
    for (const tag of tags) {
        if (!tag) continue;
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // First: match full block <tag ...>...</tag>
        const blockRe = new RegExp(`<${escaped}[^>]*>[\\s\\S]*?<\\/${escaped}>`, 'gi');
        out = out.replace(blockRe, '');
        // Then: mop up any orphan closing tags </tag>
        const closeRe = new RegExp(`<\\/${escaped}>`, 'gi');
        out = out.replace(closeRe, '');
        // Finally: mop up orphan opening or self-closing tags <tag ...> or <tag/>
        const openRe = new RegExp(`<${escaped}(?:[^>]*)\\/?>`, 'gi');
        out = out.replace(openRe, '');
    }

    return out.trim();
}

function collectRecentChatSnippet(chat, maxMessages) {
    if (!Array.isArray(chat) || chat.length === 0) return '';

    // Filter: not system, not hidden, and NOT user messages (AI only)
    const aiMessages = chat.filter(m =>
        !m?.is_system && !m?.is_user && !m?.extra?.hidden
    );

    if (!aiMessages.length) return '';

    // If maxMessages specified, only take the last N
    const selected = (maxMessages && maxMessages > 0)
        ? aiMessages.slice(-maxMessages)
        : aiMessages;

    const lines = [];
    for (const m of selected) {
        const name = m?.name ? `${m.name}` : 'assistant';
        const raw = (m?.mes ?? '').trim();
        if (!raw) continue;
        const cleaned = cleanAiMessageText(raw);
        if (!cleaned) continue;
        lines.push(`[${name}] ${cleaned}`);
    }

    if (!lines.length) return '';
    return `<chat_history>\n${lines.join('\n')}\n</chat_history>`;
}

function getCachedStorySummary() {
    const live = getStorySummaryForEna();
    const ctx = getContextSafe();
    const meta = ctx?.chatMetadata ?? window.chat_metadata;

    if (live && live.trim().length > 30) {
        // 拿到了新的，存起来
        if (meta) {
            meta.ena_cached_story_summary = live;
            saveSettingsDebounced();
        }
        return live;
    }

    // 没拿到（首轮/重启），从 chat_metadata 读上次的
    if (meta?.ena_cached_story_summary) {
        console.log('[EnaPlanner] Using persisted story summary from chat_metadata');
        return meta.ena_cached_story_summary;
    }

    return '';
}

function applyVectorKnowledgeTemplate(text) {
    const body = String(text || '').trim();
    if (!body) return '';
    return `<planner_vector_knowledge>\n${body}\n</planner_vector_knowledge>`;
}

async function waitForVectorsEnhancedApi(methodName, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const api = window.VectorsEnhanced?.[methodName];
        if (typeof api === 'function') return api;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

function buildPlannerVectorQuery(rawUserInput, parts = {}) {
    const input = String(rawUserInput || '').trim();
    if (input) return input;
    return String(parts?.fallback || '').trim();
}

async function buildVectorsEnhancedKnowledge(rawUserInput, parts = {}) {
    const s = ensureSettings();
    const vk = s.vectorKnowledge || {};
    if (!vk.enabled) return { text: '', stats: null, error: '' };

    const api = await waitForVectorsEnhancedApi('queryForPrompt');
    if (typeof api !== 'function') {
        return { text: '', stats: null, error: 'Vectors Enhanced 查询接口不可用' };
    }

    const result = await api({
        queryText: buildPlannerVectorQuery(rawUserInput, parts),
        template: '{{text}}',
    });

    const raw = String(result?.text || result?.rawText || '').trim();
    if (!raw) return { text: '', stats: result?.stats || null, error: '' };
    if (!state.vectorKnowledgeSuccessNotified) {
        const stats = result?.stats || {};
        const finalCount = Number(stats.finalCount || 0);
        const originalCount = Number(stats.originalQueryCount || 0);
        const countText = finalCount > 0
            ? `返回 ${finalCount} 块${originalCount && originalCount !== finalCount ? `（原始命中 ${originalCount}）` : ''}`
            : '已返回内容';
        toastInfo(`剧情规划向量知识库召回成功：${countText}`);
        state.vectorKnowledgeSuccessNotified = true;
    }
    return {
        text: applyVectorKnowledgeTemplate(raw),
        stats: result?.stats || null,
        error: '',
    };
}

function getWestWorldApiSafe() {
    try {
        return window.WestWorld || window.WestWorldTxtToWorldbook || window.StoryWeaver || window.StoryWeaverTxtToWorldbook || null;
    } catch (_) {
        return null;
    }
}

function normalizePostDepthNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function insertPostDepthInjections(messages, injections = []) {
    if (!Array.isArray(messages) || !Array.isArray(injections) || !injections.length) return messages;
    const out = messages.slice();
    const normalized = injections
        .filter((item) => item && item.role && typeof item.content === 'string' && item.content.trim())
        .map((item) => ({
            ...item,
            depth: normalizePostDepthNumber(item.depth, 0, 0, 100),
            order: normalizePostDepthNumber(item.order, 100, -10000, 10000),
        }))
        .sort((a, b) => a.order - b.order);

    for (const item of normalized) {
        const insertPos = Math.max(0, Math.min(out.length, out.length - item.depth));
        out.splice(insertPos, 0, {
            role: item.role,
            content: item.content,
            identifier: item.identifier || 'westworld-director-current',
        });
    }
    return out;
}

async function buildWestWorldDirectorBlock() {
    const s = ensureSettings();
    const ww = s.westWorldDirector || {};
    if (!ww.enabled) return { text: '', injection: null, meta: null, error: '' };

    const api = getWestWorldApiSafe();
    if (!api || typeof api.getDirectorPromptForLittleWhiteBox !== 'function') {
        return { text: '', injection: null, meta: null, error: 'westworld-api-missing' };
    }

    try {
        const result = await api.getDirectorPromptForLittleWhiteBox({
            includeMarker: true,
            includeDiagnostics: false,
            maxLength: Math.max(0, Math.min(20000, parseInt(ww.maxLength, 10) || 4000)),
            mode: 'current',
        });
        if (!result?.ok || !result?.injection?.content) {
            return {
                text: '',
                injection: null,
                meta: result?.meta || null,
                error: result?.reason || 'westworld-director-empty',
            };
        }

        const context = result.context || {};
        const chapter = context.chapter || {};
        const beat = context.beat || {};
        const header = [
            '<westworld_director>',
            `chapter: ${Number.isInteger(chapter.index) ? chapter.index + 1 : 'unknown'}`,
            `beat: ${Number.isInteger(beat.index) ? `${beat.index + 1}/${beat.count || 0}` : 'unknown'}`,
            'content:',
        ].join('\n');

        const injection = result.injection || {};
        const content = `${header}\n${injection.content}\n</westworld_director>`;
        return {
            text: content,
            injection: {
                role: injection.role || 'system',
                content,
                identifier: injection.identifier || 'westworld-director-current',
                position: injection.position || 'IN_CHAT',
                depth: normalizePostDepthNumber(injection.depth, 0, 0, 100),
                order: normalizePostDepthNumber(injection.order, 100, -10000, 10000),
            },
            meta: result.meta || null,
            error: '',
        };
    } catch (error) {
        return {
            text: '',
            injection: null,
            meta: null,
            error: error?.message || String(error),
        };
    }
}

function getVectorsEnhancedTaskOptionsForUi() {
    const api = window.VectorsEnhanced?.getPlannerTaskOptions;
    if (typeof api === 'function') {
        try {
            const tasks = api();
            return Array.isArray(tasks) ? tasks : [];
        } catch (e) {
            console.warn('[EnaPlanner] Failed to read Vectors Enhanced task API:', e);
        }
    }

    const ctx = getContextSafe();
    const chatId = ctx?.chatId || '';
    const ve = extension_settings?.vectors_enhanced;
    const local = chatId && Array.isArray(ve?.vector_tasks?.[chatId]) ? ve.vector_tasks[chatId] : [];
    return local.map(task => ({
        ref: `${task.ownerChatId || chatId}::${task.taskId}`,
        taskId: task.taskId,
        name: task.name || task.taskId,
        enabled: !!task.enabled,
        global: !!task.global,
        external: task.type === 'external',
        orphaned: !!task.orphaned,
        ownerChatId: task.ownerChatId || chatId,
        weight: Number(task.vectorQueryWeight ?? 1) || 0,
    }));
}

/**
 * -------------------------
 * Plot extraction
 * --------------------------
 */
function extractLastNPlots(chat, n) {
    if (!Array.isArray(chat) || chat.length === 0) return [];
    const want = Math.max(0, Number(n) || 0);
    if (!want) return [];

    const plots = [];
    const plotRe = /<plot\b[^>]*>[\s\S]*?<\/plot>/gi;

    for (let i = chat.length - 1; i >= 0; i--) {
        const text = chat[i]?.mes ?? '';
        if (!text) continue;
        const matches = [...text.matchAll(plotRe)];
        for (let j = matches.length - 1; j >= 0; j--) {
            plots.push(matches[j][0]);
            if (plots.length >= want) return plots;
        }
    }
    return plots;
}

function formatPlotsBlock(plotList) {
    if (!Array.isArray(plotList) || plotList.length === 0) return '';
    // plotList is [newest, ..., oldest] from extractLastNPlots
    // Reverse to chronological: oldest first, newest last
    const chrono = [...plotList].reverse();
    const lines = [];
    chrono.forEach((p, idx) => {
        lines.push(`【plot -${chrono.length - idx}】\n${p}`);
    });
    return `<previous_plots>\n${lines.join('\n\n')}\n</previous_plots>`;
}

/**
 * -------------------------
 * Worldbook — read via ST API (like idle-watcher)
 * Always read character-linked worldbooks.
 * Optionally include global worldbooks.
 * Activation: constant (blue) + keyword scan (green) only.
 * --------------------------
 */

async function getCharacterWorldbooks() {
    const ctx = getContextSafe();
    const charObj = getCurrentCharSafe();
    const worldNames = [];

    // From character object (multiple paths)
    if (charObj) {
        const paths = [
            charObj?.data?.extensions?.world,
            charObj?.world,
            charObj?.data?.character_book?.name,
        ];
        for (const w of paths) {
            if (w && !worldNames.includes(w)) worldNames.push(w);
        }
    }

    // From context
    if (ctx) {
        try {
            const cid = ctx.characterId ?? ctx.this_chid;
            const chars = ctx.characters ?? window.characters;
            if (chars && cid != null) {
                const c = chars[cid];
                const paths = [
                    c?.data?.extensions?.world,
                    c?.world,
                ];
                for (const w of paths) {
                    if (w && !worldNames.includes(w)) worldNames.push(w);
                }
            }
        } catch { }

        // ST context may expose chat-linked worldbooks via world_names
        try {
            if (ctx.worldNames && Array.isArray(ctx.worldNames)) {
                for (const w of ctx.worldNames) {
                    if (w && !worldNames.includes(w)) worldNames.push(w);
                }
            }
        } catch { }
    }

    // Fallback: try ST's selected character world info
    try {
        const sw = window.selected_world_info;
        if (typeof sw === 'string' && sw && !worldNames.includes(sw)) {
            worldNames.push(sw);
        }
    } catch { }

    // Fallback: try reading from chat metadata
    try {
        const chat = ctx?.chat ?? [];
        if (chat.length > 0 && chat[0]?.extra?.world) {
            const w = chat[0].extra.world;
            if (!worldNames.includes(w)) worldNames.push(w);
        }
    } catch { }

    console.log('[EnaPlanner] Character worldbook names found:', worldNames);
    return worldNames.filter(Boolean);
}

async function getGlobalWorldbooks() {
    // Try to get the list of currently active global worldbooks
    try {
        // ST stores active worldbooks in world_info settings
        const ctx = getContextSafe();
        if (ctx?.world_info?.globalSelect) {
            return Array.isArray(ctx.world_info.globalSelect) ? ctx.world_info.globalSelect : [];
        }
    } catch { }

    // Fallback: try window.selected_world_info
    try {
        if (window.selected_world_info && Array.isArray(window.selected_world_info)) {
            return window.selected_world_info;
        }
    } catch { }

    return [];
}

async function getWorldbookData(worldName) {
    if (!worldName) return null;
    try {
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: worldName }),
        });
        if (response.ok) {
            const data = await response.json();
            // ST returns { entries: {...} } or { entries: [...] }
            let entries = data?.entries;
            if (entries && !Array.isArray(entries)) {
                entries = Object.values(entries);
            }
            return { name: worldName, entries: entries || [] };
        }
    } catch (e) {
        console.warn(`[EnaPlanner] Failed to load worldbook "${worldName}":`, e);
    }
    return null;
}

function keywordPresent(text, kw) {
    if (!kw) return false;
    return text.toLowerCase().includes(kw.toLowerCase());
}

function matchSelective(entry, scanText) {
    const keys = Array.isArray(entry?.key) ? entry.key.filter(Boolean) : [];
    const keys2 = Array.isArray(entry?.keysecondary) ? entry.keysecondary.filter(Boolean) : [];

    const total = keys.length;
    if (total === 0) return false;
    const hit = keys.reduce((acc, kw) => acc + (keywordPresent(scanText, kw) ? 1 : 0), 0);

    let ok = false;
    const logic = entry?.selectiveLogic ?? 0;
    if (logic === 0) ok = (total === 0) ? true : hit > 0;       // and_any
    else if (logic === 1) ok = (total === 0) ? true : hit < total; // not_all
    else if (logic === 2) ok = (total === 0) ? true : hit === 0;  // not_any
    else if (logic === 3) ok = (total === 0) ? true : hit === total; // and_all

    if (!ok) return false;

    if (keys2.length) {
        const hit2 = keys2.reduce((acc, kw) => acc + (keywordPresent(scanText, kw) ? 1 : 0), 0);
        if (hit2 <= 0) return false;
    }
    return true;
}

function sortWorldEntries(entries) {
    // Sort to mimic ST insertion order within our worldbook block.
    // Position priority: 0 (before char def) → 1 (after char def) → 4 (system depth)
    // Within pos=4: depth descending (bigger depth = further from chat = earlier)
    // Same position+depth: order ascending (higher order = closer to chat_history = later)
    const posPriority = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
    return [...entries].sort((a, b) => {
        const pa = posPriority[Number(a?.position ?? 0)] ?? 99;
        const pb = posPriority[Number(b?.position ?? 0)] ?? 99;
        if (pa !== pb) return pa - pb;
        // For same position (especially pos=4): bigger depth = earlier
        const da = Number(a?.depth ?? 0);
        const db = Number(b?.depth ?? 0);
        if (da !== db) return db - da;
        // Same position+depth: order ascending (smaller order first, bigger order later)
        const oa = Number(a?.order ?? 0);
        const ob = Number(b?.order ?? 0);
        return oa - ob;
    });
}

async function buildWorldbookBlock(scanText) {
    const s = ensureSettings();

    // 1. Always get character-linked worldbooks
    const charWorldNames = await getCharacterWorldbooks();

    // 2. Optionally get global worldbooks
    let globalWorldNames = [];
    if (s.includeGlobalWorldbooks) {
        globalWorldNames = await getGlobalWorldbooks();
    }

    // Deduplicate
    const allWorldNames = [...new Set([...charWorldNames, ...globalWorldNames])];

    if (!allWorldNames.length) {
        console.log('[EnaPlanner] No worldbooks to load');
        return '';
    }

    console.log('[EnaPlanner] Loading worldbooks:', allWorldNames);

    // Fetch all worldbook data
    const worldbookResults = await Promise.all(allWorldNames.map(name => getWorldbookData(name)));
    const allEntries = [];

    for (const wb of worldbookResults) {
        if (!wb || !wb.entries) continue;
        for (const entry of wb.entries) {
            if (!entry) continue;
            allEntries.push({ ...entry, _worldName: wb.name });
        }
    }

    // Filter: not disabled
    let entries = allEntries.filter(e => !e?.disable && !e?.disabled);

    // Filter: exclude entries whose name contains any of the configured exclude patterns
    const nameExcludes = s.worldbookExcludeNames ?? ['mvu_update'];
    entries = entries.filter(e => {
        const comment = String(e?.comment || e?.name || e?.title || '');
        for (const pat of nameExcludes) {
            if (pat && comment.includes(pat)) return false;
        }
        return true;
    });

    // Filter: exclude position=4 if configured
    if (s.excludeWorldbookPosition4) {
        entries = entries.filter(e => Number(e?.position) !== 4);
    }

    if (!entries.length) return '';

    // Activation: constant (blue) + keyword scan (green) only
    const active = [];
    for (const e of entries) {
        // Blue light: constant entries always included
        if (e?.constant) {
            active.push(e);
            continue;
        }
        // Green light: keyword-triggered entries
        if (matchSelective(e, scanText)) {
            active.push(e);
            continue;
        }
    }

    if (!active.length) return '';

    // Build EJS context for rendering worldbook templates
    const ejsCtx = buildEjsContext();

    const sorted = sortWorldEntries(active);
    const parts = [];
    for (const e of sorted) {
        const comment = e?.comment || e?.name || e?.title || '';
        const head = `【WorldBook:${e._worldName}】${comment ? ' ' + comment : ''}`.trim();
        let body = String(e?.content ?? '').trim();
        if (!body) continue;

        // Try EJS rendering if the entry contains EJS tags
        if (body.includes('<%')) {
            body = renderEjsTemplate(body, ejsCtx);
        }

        parts.push(`${head}\n${body}`);
    }

    if (!parts.length) return '';
    return `<worldbook>\n${parts.join('\n\n---\n\n')}\n</worldbook>`;
}

/**
 * -------------------------
 * EJS rendering for worldbook entries
 * --------------------------
 */
function getChatVariables() {
  let vars = {};

  // 1) Chat-level variables
  try {
    const ctx = getContextSafe();
    if (ctx?.chatMetadata?.variables) vars = { ...ctx.chatMetadata.variables };
  } catch {}
  if (!Object.keys(vars).length) {
    try {
      if (window.chat_metadata?.variables) vars = { ...window.chat_metadata.variables };
    } catch {}
  }
  if (!Object.keys(vars).length) {
    try {
      const ctx = getContextSafe();
      if (ctx?.chat_metadata?.variables) vars = { ...ctx.chat_metadata.variables };
    } catch {}
  }

  // 2) Always merge message-level variables (some presets store vars here instead of chat-level)
  try {
    const msgVars = getLatestMessageVarTable();
    if (msgVars && typeof msgVars === 'object') {
      for (const key of Object.keys(msgVars)) {
        // Skip MVU internal metadata keys
        if (key === 'schema' || key === 'display_data' || key === 'delta_data') continue;
        if (vars[key] === undefined) {
          // Chat-level doesn't have this key at all — take from message-level
          vars[key] = msgVars[key];
        } else if (
          vars[key] && typeof vars[key] === 'object' && !Array.isArray(vars[key]) &&
          msgVars[key] && typeof msgVars[key] === 'object' && !Array.isArray(msgVars[key])
        ) {
          // Both have this key as objects — shallow merge (message-level fills gaps)
          for (const subKey of Object.keys(msgVars[key])) {
            if (vars[key][subKey] === undefined) {
              vars[key][subKey] = msgVars[key][subKey];
            }
          }
        }
      }
    }
  } catch {}

  return vars;
}

function buildEjsContext() {
    const vars = getChatVariables();

    // getvar: read a chat variable (supports dot-path for nested objects)
    function getvar(name) {
        if (!name) return '';
        let val;
        if (vars[name] !== undefined) {
            val = vars[name];
        } else {
            const parts = String(name).split('.');
            let cur = vars;
            for (const p of parts) {
                if (cur == null || typeof cur !== 'object') return '';
                cur = cur[p];
            }
            val = cur ?? '';
        }
        // 字符串布尔值转为真正的布尔值
        if (val === 'false' || val === 'False' || val === 'FALSE') return false;
        if (val === 'true' || val === 'True' || val === 'TRUE') return true;
        return val;
    }

    // setvar: write a chat variable (no-op for our purposes, just to avoid errors)
    function setvar(name, value) {
        if (name) vars[name] = value;
        return value;
    }

    return {
        getvar, setvar,
        vars,
        Number, Math, JSON, String, Array, Object, parseInt, parseFloat,
        console: { log: () => { }, warn: () => { }, error: () => { } },
    };
}

function renderEjsTemplate(template, ctx) {
    // Try window.ejs first (ST loads this library)
    if (window.ejs?.render) {
        try {
            return window.ejs.render(template, ctx, { async: false });
        } catch (e) {
            console.warn('[EnaPlanner] EJS render failed, trying fallback:', e?.message);
        }
    }

    // Safe degradation when ejs is not available.
    console.warn('[EnaPlanner] window.ejs not available, skipping EJS rendering. Template returned as-is.');
    return template;
}

/**
 * -------------------------
 * Template rendering helpers
 * --------------------------
 */
async function prepareEjsEnv() {
    try {
        const et = window.EjsTemplate;
        if (!et) return null;
        const fn = et.prepareContext || et.preparecontext;
        if (typeof fn !== 'function') return null;
        return await fn.call(et, {});
    } catch { return null; }
}

async function evalEjsIfPossible(text, env) {
    try {
        const et = window.EjsTemplate;
        if (!et || !env) return text;
        const fn = et.evalTemplate || et.evaltemplate;
        if (typeof fn !== 'function') return text;
        return await fn.call(et, text, env);
    } catch { return text; }
}

function substituteMacrosViaST(text) {
    try { return substituteParamsExtended(text); } catch { return text; }
}

function deepGet(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function resolveGetMessageVariableMacros(text, messageVars) {
    return text.replace(/{{\s*get_message_variable::([^}]+)\s*}}/g, (_, rawPath) => {
        const path = String(rawPath || '').trim();
        if (!path) return '';
        return safeStringify(deepGet(messageVars, path));
    });
}

function resolveFormatMessageVariableMacros(text, messageVars) {
    return text.replace(/{{\s*format_message_variable::([^}]+)\s*}}/g, (_, rawPath) => {
        const path = String(rawPath || '').trim();
        if (!path) return '';
        const val = deepGet(messageVars, path);
        if (val == null) return '';
        if (typeof val === 'string') return val;
        try { return jsyaml.dump(val, { lineWidth: -1, noRefs: true }); } catch { return safeStringify(val); }
    });
}

function getLatestMessageVarTable() {
    try {
        if (window.Mvu?.getMvuData) {
            return window.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
        }
    } catch { }
    try {
        const getVars = window.TavernHelper?.getVariables || window.Mvu?.getMvuData;
        if (typeof getVars === 'function') {
            return getVars({ type: 'message', message_id: 'latest' });
        }
    } catch { }
    return {};
}

async function renderTemplateAll(text, env, messageVars) {
    let out = String(text ?? '');
    out = await evalEjsIfPossible(out, env);
    out = substituteMacrosViaST(out);
    out = resolveGetMessageVariableMacros(out, messageVars);
    out = resolveFormatMessageVariableMacros(out, messageVars);
    return out;
}

/**
 * -------------------------
 * Planner response filtering
 * --------------------------
 */
function stripThinkBlocks(text) {
    let out = String(text ?? '');
    out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
    out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
    return out.trim();
}

function extractSelectedBlocksInOrder(text, tagNames) {
    const names = normalizeResponseKeepTags(tagNames);
    if (!Array.isArray(names) || names.length === 0) return '';
    const src = String(text ?? '');
    const blocks = [];
    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`<(${escapedNames.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
    let m;
    while ((m = re.exec(src)) !== null) {
        blocks.push(m[0]);
    }
    return blocks.join('\n\n').trim();
}

function filterPlannerForInput(rawFull) {
    const noThink = stripThinkBlocks(rawFull);
    const tags = ensureSettings().responseKeepTags;
    const selected = extractSelectedBlocksInOrder(noThink, tags);
    if (selected) return selected;
    return noThink;
}

function filterPlannerPreview(rawPartial) {
    return stripThinkBlocks(rawPartial);
}

/**
 * -------------------------
 * Planner API calls
 * --------------------------
 */
async function callPlanner(messages, options = {}) {
    const s = ensureSettings();
    if (!s.api.baseUrl) throw new Error('未配置 API URL');
    if (!s.api.apiKey) throw new Error('未配置 API KEY');
    if (!s.api.model) throw new Error('未选择模型');

    const url = buildUrl('/chat/completions');

    const body = {
        model: s.api.model,
        messages,
        stream: !!s.api.stream
    };

    const t = Number(s.api.temperature);
    if (!Number.isNaN(t)) body.temperature = t;
    const tp = Number(s.api.top_p);
    if (!Number.isNaN(tp)) body.top_p = tp;
    const tk = Number(s.api.top_k);
    if (!Number.isNaN(tk) && tk > 0) body.top_k = tk;
    const pp = s.api.presence_penalty === '' ? null : Number(s.api.presence_penalty);
    if (pp != null && !Number.isNaN(pp)) body.presence_penalty = pp;
    const fp = s.api.frequency_penalty === '' ? null : Number(s.api.frequency_penalty);
    if (fp != null && !Number.isNaN(fp)) body.frequency_penalty = fp;
    const mt = s.api.max_tokens === '' ? null : Number(s.api.max_tokens);
    if (mt != null && !Number.isNaN(mt) && mt > 0) body.max_tokens = mt;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PLANNER_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                ...getRequestHeaders(),
                Authorization: `Bearer ${s.api.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`规划请求失败: ${res.status} ${text}`.slice(0, 500));
        }

        if (!s.api.stream) {
            const data = await res.json();
            const text = String(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '');
            if (text) options?.onDelta?.(text, text);
            return text;
        }

        // SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let full = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const chunks = buf.split('\n\n');
            buf = chunks.pop() ?? '';

            for (const ch of chunks) {
                const lines = ch.split('\n').map(x => x.trim()).filter(Boolean);
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (payload === '[DONE]') continue;
                    try {
                        const j = JSON.parse(payload);
                        const delta = j?.choices?.[0]?.delta;
                        const piece = delta?.content ?? delta?.text ?? '';
                        if (piece) {
                            full += piece;
                            options?.onDelta?.(piece, full);
                        }
                    } catch { }
                }
            }
        }
        return full;
    } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
            throw new Error(`规划请求超时（>${Math.floor(PLANNER_REQUEST_TIMEOUT_MS / 1000)}s）`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchModelsForUi() {
    const s = ensureSettings();
    if (!s.api.baseUrl) throw new Error('请先填写 API URL');
    if (!s.api.apiKey) throw new Error('请先填写 API KEY');
    const url = buildUrl('/models');
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            ...getRequestHeaders(),
            Authorization: `Bearer ${s.api.apiKey}`
        }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`拉取模型失败: ${res.status} ${text}`.slice(0, 300));
    }
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map(x => x?.id).filter(Boolean);
}

async function debugWorldbookForUi() {
    let out = '正在诊断世界书读取...\n';
    const charWb = await getCharacterWorldbooks();
    out += `角色世界书名称: ${JSON.stringify(charWb)}\n`;
    const globalWb = await getGlobalWorldbooks();
    out += `全局世界书名称: ${JSON.stringify(globalWb)}\n`;
    const all = [...new Set([...charWb, ...globalWb])];
    for (const name of all) {
        const data = await getWorldbookData(name);
        const count = data?.entries?.length ?? 0;
        const enabled = data?.entries?.filter(e => !e?.disable && !e?.disabled)?.length ?? 0;
        out += `  "${name}": ${count} 条目, ${enabled} 已启用\n`;
    }
    if (!all.length) {
        out += '⚠️ 未找到任何世界书。请检查角色卡是否绑定了世界书。\n';
        const charObj = getCurrentCharSafe();
        out += `charObj存在: ${!!charObj}\n`;
        if (charObj) {
            out += `charObj.world: ${charObj?.world}\n`;
            out += `charObj.data.extensions.world: ${charObj?.data?.extensions?.world}\n`;
        }
        const ctx = getContextSafe();
        out += `ctx存在: ${!!ctx}\n`;
        if (ctx) {
            out += `ctx.characterId: ${ctx?.characterId}\n`;
            out += `ctx.this_chid: ${ctx?.this_chid}\n`;
        }
    }
    return out;
}

function debugCharForUi() {
    const charObj = getCurrentCharSafe();
    if (!charObj) {
        const ctx = getContextSafe();
        return [
            '⚠️ 未检测到角色。',
            `ctx: ${!!ctx}, ctx.characterId: ${ctx?.characterId}, ctx.this_chid: ${ctx?.this_chid}`,
            `window.this_chid: ${window.this_chid}`,
            `window.characters count: ${window.characters?.length ?? 'N/A'}`
        ].join('\n');
    }
    const block = formatCharCardBlock(charObj);
    return [
        `角色名: ${charObj?.name}`,
        `desc长度: ${(charObj?.description ?? '').length}`,
        `personality长度: ${(charObj?.personality ?? '').length}`,
        `scenario长度: ${(charObj?.scenario ?? '').length}`,
        `world: ${charObj?.world ?? charObj?.data?.extensions?.world ?? '(无)'}`,
        `---\n${block.slice(0, 500)}...`
    ].join('\n');
}

async function debugVectorKnowledgeForUi() {
    const api = await waitForVectorsEnhancedApi('diagnosePlannerQuery');
    if (typeof api !== 'function') {
        const tasks = getVectorsEnhancedTaskOptionsForUi();
        return [
            'Vectors Enhanced 诊断接口不可用。',
            `window.VectorsEnhanced: ${!!window.VectorsEnhanced}`,
            `queryForPrompt: ${typeof window.VectorsEnhanced?.queryForPrompt}`,
            `getPlannerTaskOptions: ${typeof window.VectorsEnhanced?.getPlannerTaskOptions}`,
            `可见任务数: ${tasks.length}`,
            '',
            '请确认 vectors-enhanced 已加载到当前酒馆页面，并已更新到包含诊断接口的版本。',
        ].join('\n');
    }

    const ctx = getContextSafe();
    const chat = ctx?.chat ?? window.SillyTavern?.chat ?? [];
    const draftInput = String(document.getElementById('send_textarea')?.value || '').trim();
    const lastUserInput = Array.isArray(chat)
        ? [...chat]
            .reverse()
            .find(m => m?.is_user && !m?.is_system && !m?.extra?.hidden)?.mes
        : '';
    const testQuery = draftInput || String(lastUserInput || '').trim() || '测试剧情规划向量知识库召回';

    return await api({
        queryText: testQuery,
    });
}

async function debugWestWorldForUi() {
    const s = ensureSettings();
    const api = getWestWorldApiSafe();
    if (!api) return 'WestWorld API 不可用';

    const status = typeof api.getDirectorRuntimeStatus === 'function'
        ? api.getDirectorRuntimeStatus()
        : (typeof api.getDirectorStatus === 'function' ? api.getDirectorStatus() : null);
    const context = typeof api.getDirectorContext === 'function'
        ? api.getDirectorContext({ includeRuntime: true })
        : null;
    const prompt = typeof api.getDirectorPromptForLittleWhiteBox === 'function'
        ? await api.getDirectorPromptForLittleWhiteBox({
            includeMarker: true,
            maxLength: Math.max(0, Math.min(20000, parseInt(s.westWorldDirector?.maxLength, 10) || 4000)),
            mode: 'current',
        })
        : { ok: false, reason: 'getDirectorPromptForLittleWhiteBox-missing' };

    return JSON.stringify({
        enabledInEna: !!s.westWorldDirector?.enabled,
        status,
        context,
        prompt: prompt?.ok ? {
            ok: true,
            meta: prompt.meta || null,
            contentLength: String(prompt.injection?.content || '').length,
            identifier: prompt.injection?.identifier || '',
            position: prompt.injection?.position || '',
            depth: prompt.injection?.depth ?? 0,
            order: prompt.injection?.order ?? 100,
        } : prompt,
    }, null, 2);
}

/**
 * -------------------------
 * Build planner messages
 * --------------------------
 */
function getPromptBlocksByRole(role) {
    const s = ensureSettings();
    return (s.promptBlocks || []).filter(b => b?.role === role && String(b?.content ?? '').trim());
}

function mergeConsecutiveSystemMessages(messages) {
    const merged = [];
    for (const message of messages) {
        const role = String(message?.role || '').trim();
        const content = typeof message?.content === 'string' ? message.content : '';
        if (!role) continue;

        if (role === 'system' && merged.length > 0 && merged[merged.length - 1]?.role === 'system') {
            merged[merged.length - 1].content = `${merged[merged.length - 1].content}\n\n${content}`;
            continue;
        }

        merged.push({ ...message, role, content });
    }
    return merged;
}

async function buildPlannerMessages(rawUserInput) {
    const s = ensureSettings();
    const ctx = getContextSafe();
    const chat = ctx?.chat ?? window.SillyTavern?.chat ?? [];
    const charObj = getCurrentCharSafe();
    const env = await prepareEjsEnv();
    const messageVars = getLatestMessageVarTable();

    const enaSystemBlocks = getPromptBlocksByRole('system');
    const enaAssistantBlocks = getPromptBlocksByRole('assistant');
    const enaUserBlocks = getPromptBlocksByRole('user');

    const charBlockRaw = formatCharCardBlock(charObj);

    // --- Story memory: try fresh vector recall with current user input ---
    let cachedSummary = '';
    let recallSource = 'none';
    try {
        const vectorCfg = getVectorConfig();
        if (vectorCfg?.enabled) {
            const result = await runWithTimeout(
                () => buildVectorPromptText(false, {
                    pendingUserMessage: rawUserInput,
                }),
                VECTOR_RECALL_TIMEOUT_MS,
                `向量召回超时（>${Math.floor(VECTOR_RECALL_TIMEOUT_MS / 1000)}s）`
            );
            cachedSummary = result?.text?.trim() || '';
            if (cachedSummary) recallSource = 'fresh';
        }
    } catch (e) {
        console.warn('[Ena] Fresh vector recall failed, falling back to cached data:', e);
    }
    if (!cachedSummary) {
        cachedSummary = getCachedStorySummary();
        if (cachedSummary) recallSource = 'stale';
    }
    console.log(`[Ena] Story memory source: ${recallSource}`);

    // --- Chat history: last 2 AI messages (floors N-1 & N-3) ---
    // Two messages instead of one to avoid cross-device cache miss:
    // story_summary cache is captured during main AI generation, so if
    // user switches device and triggers Ena before a new generation,
    // having N-3 as backup context prevents a gap.
    const recentChatRaw = collectRecentChatSnippet(chat, 2);

    const plotsRaw = formatPlotsBlock(extractLastNPlots(chat, s.plotCount));
    let vectorRaw = '';
    let vectorKnowledgeStats = null;
    let vectorKnowledgeError = '';
    try {
        const result = await runWithTimeout(
            () => buildVectorsEnhancedKnowledge(rawUserInput, { recentChatRaw, plotsRaw }),
            VECTOR_RECALL_TIMEOUT_MS,
            `剧情规划向量知识库召回超时（>${Math.floor(VECTOR_RECALL_TIMEOUT_MS / 1000)}s）`
        );
        vectorRaw = result?.text || '';
        vectorKnowledgeStats = result?.stats || null;
        vectorKnowledgeError = result?.error || '';
        if (vectorKnowledgeError) console.warn('[Ena] Vectors Enhanced knowledge skipped:', vectorKnowledgeError);
    } catch (e) {
        vectorKnowledgeError = String(e?.message ?? e);
        console.warn('[Ena] Vectors Enhanced knowledge recall failed:', e);
    }
    let westWorldDirectorRaw = '';
    let westWorldDirectorInjection = null;
    let westWorldDirectorMeta = null;
    let westWorldDirectorError = '';
    try {
        const result = await buildWestWorldDirectorBlock();
        westWorldDirectorRaw = result?.text || '';
        westWorldDirectorInjection = result?.injection || null;
        westWorldDirectorMeta = result?.meta || null;
        westWorldDirectorError = result?.error || '';
        if (westWorldDirectorError) console.warn('[Ena] WestWorld director context skipped:', westWorldDirectorError);
    } catch (e) {
        westWorldDirectorError = String(e?.message ?? e);
        console.warn('[Ena] WestWorld director context failed:', e);
    }

    // Build scanText for worldbook keyword activation
    const scanText = [charBlockRaw, recentChatRaw, vectorRaw, westWorldDirectorRaw, plotsRaw, rawUserInput].join('\n\n');

    const worldbookRaw = await buildWorldbookBlock(scanText);
    const outlineRaw = typeof formatOutlinePrompt === 'function' ? (formatOutlinePrompt() || '') : '';

    // Render templates/macros
    const charBlock = await renderTemplateAll(charBlockRaw, env, messageVars);
    const recentChat = await renderTemplateAll(recentChatRaw, env, messageVars);
    const plots = await renderTemplateAll(plotsRaw, env, messageVars);
    const vector = await renderTemplateAll(vectorRaw, env, messageVars);
    const westWorldDirector = await renderTemplateAll(westWorldDirectorRaw, env, messageVars);
    const storySummary = cachedSummary.trim().length > 30 ? await renderTemplateAll(cachedSummary, env, messageVars) : '';
    const worldbook = await renderTemplateAll(worldbookRaw, env, messageVars);
    const userInput = await renderTemplateAll(rawUserInput, env, messageVars);
    const storyOutline = outlineRaw.trim().length > 10 ? await renderTemplateAll(outlineRaw, env, messageVars) : '';

    const messages = [];

    // 1) Ena system prompts
    for (const b of enaSystemBlocks) {
        const content = await renderTemplateAll(b.content, env, messageVars);
        messages.push({ role: 'system', content });
    }

    // 2) Character card
    if (String(charBlock).trim()) messages.push({ role: 'system', content: charBlock });

    // 3) Worldbook
    if (String(worldbook).trim()) messages.push({ role: 'system', content: worldbook });

    // 3.5) Story Outline / 剧情地图（小白板世界架构）
    if (storyOutline.trim()) {
        messages.push({ role: 'system', content: `<plot_map>\n${storyOutline}\n</plot_map>` });
    }

    // 4) Chat history (last 2 AI responses — floors N-1 & N-3)
    if (String(recentChat).trim()) messages.push({ role: 'system', content: recentChat });

    // 4.5) Story memory (小白X <剧情记忆> — after chat context, before plots)
    if (storySummary.trim()) {
        messages.push({ role: 'system', content: `<story_summary>\n${storySummary}\n</story_summary>` });
    }

    // 5) Vectors Enhanced knowledge recall for the planner
    if (String(vector).trim()) messages.push({ role: 'system', content: vector });

    // 6) Previous plots
    if (String(plots).trim()) messages.push({ role: 'system', content: plots });

    // 7) User input (with friendly framing)
    const userMsgContent = `以下是玩家的最新指令哦~:\n[${userInput}]`;
    messages.push({ role: 'user', content: userMsgContent });

    // Extra user blocks before user message
    for (const b of enaUserBlocks) {
        const content = await renderTemplateAll(b.content, env, messageVars);
        messages.splice(Math.max(0, messages.length - 1), 0, { role: 'system', content: `【extra-user-block】\n${content}` });
    }

    // 8) Assistant blocks
    for (const b of enaAssistantBlocks) {
        const content = await renderTemplateAll(b.content, env, messageVars);
        messages.push({ role: 'assistant', content });
    }

    let finalMessages = s.mergeConsecutiveSystemMessages ? mergeConsecutiveSystemMessages(messages) : messages;
    if (String(westWorldDirector).trim()) {
        finalMessages = insertPostDepthInjections(finalMessages, [{
            ...(westWorldDirectorInjection || {}),
            role: westWorldDirectorInjection?.role || 'system',
            content: westWorldDirector,
            identifier: westWorldDirectorInjection?.identifier || 'westworld-director-current',
            depth: westWorldDirectorInjection?.depth,
            order: westWorldDirectorInjection?.order,
        }]);
    }

    return {
        messages: finalMessages,
        meta: {
            charBlockRaw,
            worldbookRaw,
            recentChatRaw,
            vectorRaw,
            vectorKnowledgeStats,
            vectorKnowledgeError,
            westWorldDirectorRaw,
            westWorldDirectorMeta,
            westWorldDirectorError,
            cachedSummaryLen: cachedSummary.length,
            plotsRaw,
        },
    };
}

/**
 * -------------------------
 * Planning runner + logging
 * --------------------------
 */
async function runPlanningOnce(rawUserInput, silent = false, options = {}) {
    const s = ensureSettings();

    const log = {
        time: nowISO(), ok: false, model: s.api.model,
        requestMessages: [], rawReply: '', filteredReply: '', error: ''
    };

    try {
        const { messages } = await buildPlannerMessages(rawUserInput);
        log.requestMessages = messages;

        const rawReply = await callPlanner(messages, options);
        log.rawReply = rawReply;

        const filtered = filterPlannerForInput(rawReply);
        log.filteredReply = filtered;
        log.ok = true;

        state.logs.unshift(log); clampLogs(); persistLogsMaybe();
        return { rawReply, filtered };
    } catch (e) {
        log.error = String(e?.message ?? e);
        state.logs.unshift(log); clampLogs(); persistLogsMaybe();
        if (!silent) toastErr(log.error);
        throw e;
    }
}

/**
 * -------------------------
 * Intercept send
 * --------------------------
 */
function getSendTextarea() { return document.getElementById('send_textarea'); }
function getSendButton() { return document.getElementById('send_but') || document.getElementById('send_button'); }

function shouldInterceptNow() {
    const s = ensureSettings();
    if (!s.enabled || state.isPlanning) return false;
    const ta = getSendTextarea();
    if (!ta) return false;
    const txt = String(ta.value ?? '').trim();
    if (!txt) return false;
    if (state.bypassNextSend) return false;
    if (s.skipIfPlotPresent && /<plot\b/i.test(txt)) return false;
    return true;
}

async function doInterceptAndPlanThenSend() {
    const ta = getSendTextarea();
    const btn = getSendButton();
    if (!ta || !btn) return;

    const raw = String(ta.value ?? '').trim();
    if (!raw) return;

    state.isPlanning = true;
    setSendUIBusy(true);

    try {
        toastInfo('Ena Planner：正在规划…');
        const { filtered } = await runPlanningOnce(raw, false, {
            onDelta(_piece, full) {
                if (!state.isPlanning) return;
                if (!ensureSettings().api.stream) return;
                const preview = filterPlannerPreview(full);
                ta.value = `${raw}\n\n${preview}`.trim();
            }
        });
        const merged = `${raw}\n\n${filtered}`.trim();
        ta.value = merged;
        state.lastInjectedText = merged;

        state.bypassNextSend = true;
        btn.click();
    } catch (err) {
        ta.value = raw;
        state.lastInjectedText = '';
        throw err;
    } finally {
        state.isPlanning = false;
        setSendUIBusy(false);
        setTimeout(() => { state.bypassNextSend = false; }, 800);
    }
}

function installSendInterceptors() {
    if (sendListenersInstalled) return;
    sendClickHandler = (e) => {
        const btn = getSendButton();
        if (!btn) return;
        if (e.target !== btn && !btn.contains(e.target)) return;
        if (!shouldInterceptNow()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        doInterceptAndPlanThenSend().catch(err => toastErr(String(err?.message ?? err)));
    };
    sendKeydownHandler = (e) => {
        const ta = getSendTextarea();
        if (!ta || e.target !== ta) return;
        if (e.key === 'Enter' && !e.shiftKey && shouldSendOnEnter()) {
            if (!shouldInterceptNow()) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            doInterceptAndPlanThenSend().catch(err => toastErr(String(err?.message ?? err)));
        }
    };
    document.addEventListener('click', sendClickHandler, true);
    document.addEventListener('keydown', sendKeydownHandler, true);
    sendListenersInstalled = true;
}

function uninstallSendInterceptors() {
    if (!sendListenersInstalled) return;
    if (sendClickHandler) document.removeEventListener('click', sendClickHandler, true);
    if (sendKeydownHandler) document.removeEventListener('keydown', sendKeydownHandler, true);
    sendClickHandler = null;
    sendKeydownHandler = null;
    sendListenersInstalled = false;
}

function getIframeConfigPayload() {
    const s = ensureSettings();
    return {
        ...s,
        logs: state.logs,
    };
}

function openSettings() {
    if (document.getElementById(OVERLAY_ID)) return;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: ${window.innerHeight}px;
        background: rgba(0,0,0,0.5);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = HTML_PATH;
    iframe.style.cssText = `
        width: min(1200px, 96vw);
        height: min(980px, 94vh);
        max-height: calc(100% - 24px);
        border: none;
        border-radius: 12px;
        background: #1a1a1a;
    `;

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    if (!iframeMessageBound) {
        // Guarded by isTrustedIframeEvent (origin + source).
        // eslint-disable-next-line no-restricted-syntax
        window.addEventListener('message', handleIframeMessage);
        iframeMessageBound = true;
    }
}

function closeSettings() {
    const overlayEl = document.getElementById(OVERLAY_ID);
    if (overlayEl) overlayEl.remove();
    overlay = null;
}

async function handleIframeMessage(ev) {
    const iframe = overlay?.querySelector('iframe');
    if (!isTrustedIframeEvent(ev, iframe)) return;
    if (!ev.data?.type?.startsWith('xb-ena:')) return;

    const { type, payload } = ev.data;
    switch (type) {
        case 'xb-ena:ready':
            postToIframe(iframe, { type: 'xb-ena:config', payload: getIframeConfigPayload() });
            break;
        case 'xb-ena:close':
            closeSettings();
            break;
        case 'xb-ena:save-config': {
            const requestId = payload?.requestId || '';
            const patch = (payload && typeof payload.patch === 'object') ? payload.patch : payload;
            Object.assign(ensureSettings(), patch || {});
            const ok = await saveConfigNow();
            if (ok) {
                postToIframe(iframe, {
                    type: 'xb-ena:config-saved',
                    payload: {
                        ...getIframeConfigPayload(),
                        requestId
                    }
                });
            } else {
                postToIframe(iframe, {
                    type: 'xb-ena:config-save-error',
                    payload: {
                        message: '保存失败',
                        requestId
                    }
                });
            }
            break;
        }
        case 'xb-ena:reset-prompt-default': {
            const requestId = payload?.requestId || '';
            const s = ensureSettings();
            s.promptBlocks = getDefaultSettings().promptBlocks;
            const ok = await saveConfigNow();
            if (ok) {
                postToIframe(iframe, {
                    type: 'xb-ena:config-saved',
                    payload: {
                        ...getIframeConfigPayload(),
                        requestId
                    }
                });
            } else {
                postToIframe(iframe, {
                    type: 'xb-ena:config-save-error',
                    payload: {
                        message: '重置失败',
                        requestId
                    }
                });
            }
            break;
        }
        case 'xb-ena:run-test': {
            try {
                const fake = payload?.text || '（测试输入）我想让你帮我规划下一步剧情。';
                await runPlanningOnce(fake, true);
                postToIframe(iframe, { type: 'xb-ena:test-done' });
                postToIframe(iframe, { type: 'xb-ena:logs', payload: { logs: state.logs } });
            } catch (err) {
                postToIframe(iframe, { type: 'xb-ena:test-error', payload: { message: String(err?.message ?? err) } });
            }
            break;
        }
        case 'xb-ena:logs-request':
            postToIframe(iframe, { type: 'xb-ena:logs', payload: { logs: state.logs } });
            break;
        case 'xb-ena:logs-clear':
            state.logs = [];
            await saveConfigNow();
            postToIframe(iframe, { type: 'xb-ena:logs', payload: { logs: state.logs } });
            break;
        case 'xb-ena:vector-tasks-request': {
            const tasks = getVectorsEnhancedTaskOptionsForUi();
            postToIframe(iframe, { type: 'xb-ena:vector-tasks', payload: { tasks } });
            break;
        }
        case 'xb-ena:fetch-models': {
            try {
                const models = await fetchModelsForUi();
                postToIframe(iframe, { type: 'xb-ena:models', payload: { models } });
            } catch (err) {
                postToIframe(iframe, { type: 'xb-ena:models-error', payload: { message: String(err?.message ?? err) } });
            }
            break;
        }
        case 'xb-ena:debug-worldbook': {
            try {
                const output = await debugWorldbookForUi();
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output } });
            } catch (err) {
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output: String(err?.message ?? err) } });
            }
            break;
        }
        case 'xb-ena:debug-char': {
            const output = debugCharForUi();
            postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output } });
            break;
        }
        case 'xb-ena:debug-vector-knowledge': {
            try {
                const output = await debugVectorKnowledgeForUi();
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output } });
            } catch (err) {
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output: String(err?.stack || err?.message || err) } });
            }
            break;
        }
        case 'xb-ena:debug-westworld': {
            try {
                const output = await debugWestWorldForUi();
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output } });
            } catch (err) {
                postToIframe(iframe, { type: 'xb-ena:debug-output', payload: { output: String(err?.stack || err?.message || err) } });
            }
            break;
        }
    }
}

export async function initEnaPlanner() {
    await loadConfig();
    loadPersistedLogsMaybe();
    installSendInterceptors();
    window.xiaobaixEnaPlanner = { openSettings, closeSettings };
}

export function cleanupEnaPlanner() {
    uninstallSendInterceptors();
    closeSettings();
    if (iframeMessageBound) {
        window.removeEventListener('message', handleIframeMessage);
        iframeMessageBound = false;
    }
    delete window.xiaobaixEnaPlanner;
}
