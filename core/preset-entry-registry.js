export const DEFAULT_PRESET_ENTRY_INJECTION_POSITION = 0;
export const ABSOLUTE_PRESET_ENTRY_INJECTION_POSITION = 1;
export const DEFAULT_PRESET_ENTRY_DEPTH = 4;
export const DEFAULT_PRESET_ENTRY_ORDER = 100;

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function findPrompt(settings, identifier) {
    return Array.isArray(settings?.prompts)
        ? settings.prompts.find((prompt) => prompt?.identifier === identifier)
        : null;
}

function insertOrderReference(order, identifier, enabled = true) {
    if (!Array.isArray(order)) return false;
    if (order.some((entry) => entry?.identifier === identifier)) return false;

    const reference = { identifier, enabled };
    const chatHistoryIndex = order.findIndex((entry) => entry?.identifier === 'chatHistory');
    if (chatHistoryIndex >= 0) {
        order.splice(chatHistoryIndex + 1, 0, reference);
    } else {
        order.push(reference);
    }
    return true;
}

function ensureOrderReferences(promptManager, identifier) {
    const settings = promptManager?.serviceSettings;
    if (!settings) return { changed: false, activeEnabled: false, orderCount: 0 };

    settings.prompt_order = Array.isArray(settings.prompt_order) ? settings.prompt_order : [];

    let changed = false;
    for (const list of settings.prompt_order) {
        if (!list || !Array.isArray(list.order)) continue;
        changed = insertOrderReference(list.order, identifier, true) || changed;
    }

    const activeCharacterId = promptManager?.activeCharacter?.id;
    const activeList = activeCharacterId === undefined
        ? null
        : settings.prompt_order.find((entry) => entry?.character_id === activeCharacterId);

    if (promptManager?.activeCharacter) {
        if (activeList) {
            activeList.order = Array.isArray(activeList.order) ? activeList.order : [];
            changed = insertOrderReference(activeList.order, identifier, true) || changed;
        } else {
            settings.prompt_order.push({
                character_id: activeCharacterId,
                order: [{ identifier, enabled: true }],
            });
            changed = true;
        }
    }

    const activeEntry = activeList?.order?.find((entry) => entry?.identifier === identifier)
        || (typeof promptManager?.getPromptOrderEntry === 'function'
            ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
            : null);

    return {
        changed,
        activeEnabled: activeEntry?.enabled === true,
        orderCount: settings.prompt_order.filter((list) => Array.isArray(list?.order)).length,
    };
}

export function createPresetEntryPrompt(options = {}) {
    const injectionPosition = Number.isFinite(Number(options.injectionPosition))
        ? Number(options.injectionPosition)
        : DEFAULT_PRESET_ENTRY_INJECTION_POSITION;
    const prompt = {
        identifier: options.identifier,
        name: options.name || options.identifier,
        role: options.role || 'system',
        content: String(options.content || ''),
        system_prompt: false,
        position: 0,
        injection_position: injectionPosition,
        injection_trigger: [],
        forbid_overrides: false,
        extension: true,
    };

    if (injectionPosition === ABSOLUTE_PRESET_ENTRY_INJECTION_POSITION) {
        prompt.injection_depth = clampInteger(options.depth, DEFAULT_PRESET_ENTRY_DEPTH, 0, 999);
        prompt.injection_order = clampInteger(options.order, DEFAULT_PRESET_ENTRY_ORDER, -10000, 10000);
    }

    return prompt;
}

export function ensurePresetEntry(promptManager, options = {}) {
    const settings = promptManager?.serviceSettings;
    const identifier = String(options.identifier ?? '');
    if (!identifier) return { ok: false, reason: 'identifier-missing' };
    if (!settings || typeof settings !== 'object') {
        return { ok: false, reason: 'prompt-manager-settings-missing' };
    }

    settings.prompts = Array.isArray(settings.prompts) ? settings.prompts : [];

    const injectionPosition = Number.isFinite(Number(options.injectionPosition))
        ? Number(options.injectionPosition)
        : DEFAULT_PRESET_ENTRY_INJECTION_POSITION;
    let changed = false;
    let prompt = findPrompt(settings, identifier);

    if (!prompt) {
        prompt = createPresetEntryPrompt({
            ...options,
            identifier,
            injectionPosition,
        });
        settings.prompts.push(prompt);
        changed = true;
    } else {
        const updates = {
            name: options.name || prompt.name || identifier,
            role: options.role || 'system',
            system_prompt: false,
            extension: true,
        };
        Object.entries(updates).forEach(([key, value]) => {
            if (prompt[key] !== value) {
                prompt[key] = value;
                changed = true;
            }
        });
        if (!Number.isFinite(Number(prompt.injection_position))) {
            prompt.injection_position = injectionPosition;
            changed = true;
        }
        if (options.content !== undefined && prompt.content !== String(options.content || '')) {
            prompt.content = String(options.content || '');
            changed = true;
        }
    }

    if (Number(prompt.injection_position) === ABSOLUTE_PRESET_ENTRY_INJECTION_POSITION) {
        const depth = clampInteger(prompt.injection_depth, DEFAULT_PRESET_ENTRY_DEPTH, 0, 999);
        if (!Number.isFinite(Number(prompt.injection_depth)) || Number(prompt.injection_depth) !== depth) {
            prompt.injection_depth = depth;
            changed = true;
        }

        const order = clampInteger(prompt.injection_order, DEFAULT_PRESET_ENTRY_ORDER, -10000, 10000);
        if (!Number.isFinite(Number(prompt.injection_order)) || Number(prompt.injection_order) !== order) {
            prompt.injection_order = order;
            changed = true;
        }
    }

    const orderResult = ensureOrderReferences(promptManager, identifier);
    changed = orderResult.changed || changed;

    return {
        ok: true,
        changed,
        prompt,
        identifier,
        activeEnabled: orderResult.activeEnabled,
        orderCount: orderResult.orderCount,
    };
}

export function setPresetEntryContent(promptManager, content = '', options = {}) {
    const ensured = ensurePresetEntry(promptManager, options);
    if (!ensured.ok) return ensured;

    const value = String(content || '');
    const changed = ensured.prompt.content !== value;
    ensured.prompt.content = value;

    return {
        ...ensured,
        changed: ensured.changed || changed,
        contentLength: value.length,
    };
}

export function clearPresetEntryContent(promptManager, reason = '', options = {}) {
    const result = setPresetEntryContent(promptManager, '', options);
    return {
        ...result,
        cleared: result.ok === true,
        reason: String(reason || ''),
    };
}

export function getPresetEntryStatus(promptManager, options = {}) {
    const settings = promptManager?.serviceSettings;
    const identifier = String(options.identifier ?? '');
    if (!identifier) return { ok: false, reason: 'identifier-missing' };
    if (!settings || typeof settings !== 'object') {
        return { ok: false, reason: 'prompt-manager-settings-missing' };
    }

    const prompt = findPrompt(settings, identifier);
    const activeEntry = typeof promptManager?.getPromptOrderEntry === 'function'
        ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
        : null;

    return {
        ok: true,
        exists: !!prompt,
        activeEnabled: activeEntry?.enabled === true,
        contentLength: String(prompt?.content || '').length,
        orderCount: Array.isArray(settings.prompt_order)
            ? settings.prompt_order.filter((list) => Array.isArray(list?.order)).length
            : 0,
    };
}
