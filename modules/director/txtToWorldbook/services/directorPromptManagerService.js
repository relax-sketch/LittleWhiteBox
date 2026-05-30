export const DIRECTOR_PROMPT_MANAGER_IDENTIFIER = 'westworldDirector';
export const DIRECTOR_PROMPT_MANAGER_NAME = 'WestWorld Director';
export const DEFAULT_DIRECTOR_PROMPT_MANAGER_DEPTH = 4;
export const DEFAULT_DIRECTOR_PROMPT_MANAGER_ORDER = 100;
export const DEFAULT_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION = 0;
const ABSOLUTE_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION = 1;

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

    if (promptManager?.activeCharacter) {
        let activeOrder = [];
        if (typeof promptManager.getPromptOrderForCharacter === 'function') {
            activeOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
        }

        if (!Array.isArray(activeOrder) || activeOrder.length === 0) {
            const characterId = promptManager.activeCharacter.id;
            settings.prompt_order.push({
                character_id: characterId,
                order: [{ identifier, enabled: true }],
            });
            changed = true;
        } else {
            changed = insertOrderReference(activeOrder, identifier, true) || changed;
        }
    }

    const activeEntry = typeof promptManager?.getPromptOrderEntry === 'function'
        ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
        : null;

    return {
        changed,
        activeEnabled: activeEntry?.enabled === true,
        orderCount: settings.prompt_order.filter((list) => Array.isArray(list?.order)).length,
    };
}

export function createDirectorPromptManagerPrompt(options = {}) {
    const injectionPosition = Number.isFinite(Number(options.injectionPosition))
        ? Number(options.injectionPosition)
        : DEFAULT_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION;
    const prompt = {
        identifier: options.identifier || DIRECTOR_PROMPT_MANAGER_IDENTIFIER,
        name: options.name || DIRECTOR_PROMPT_MANAGER_NAME,
        role: options.role || 'system',
        content: String(options.content || ''),
        system_prompt: false,
        position: 0,
        injection_position: injectionPosition,
        injection_trigger: [],
        forbid_overrides: false,
        extension: true,
    };
    if (injectionPosition === ABSOLUTE_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION) {
        prompt.injection_depth = clampInteger(
            options.depth,
            DEFAULT_DIRECTOR_PROMPT_MANAGER_DEPTH,
            0,
            999,
        );
        prompt.injection_order = clampInteger(
            options.order,
            DEFAULT_DIRECTOR_PROMPT_MANAGER_ORDER,
            -10000,
            10000,
        );
    }
    return prompt;
}

export function ensureDirectorPromptManagerEntry(promptManager, options = {}) {
    const settings = promptManager?.serviceSettings;
    if (!settings || typeof settings !== 'object') {
        return { ok: false, reason: 'prompt-manager-settings-missing' };
    }

    settings.prompts = Array.isArray(settings.prompts) ? settings.prompts : [];

    const identifier = options.identifier || DIRECTOR_PROMPT_MANAGER_IDENTIFIER;
    const injectionPosition = Number.isFinite(Number(options.injectionPosition))
        ? Number(options.injectionPosition)
        : DEFAULT_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION;
    let changed = false;
    let prompt = findPrompt(settings, identifier);

    if (!prompt) {
        prompt = createDirectorPromptManagerPrompt({
            identifier,
            injectionPosition,
            depth: options.depth,
            order: options.order,
            content: options.content,
        });
        settings.prompts.push(prompt);
        changed = true;
    } else {
        const previousInjectionPosition = prompt.injection_position;
        const previousDepth = prompt.injection_depth;
        const previousOrder = prompt.injection_order;
        const updates = {
            name: DIRECTOR_PROMPT_MANAGER_NAME,
            role: 'system',
            system_prompt: false,
            extension: true,
        };
        Object.entries(updates).forEach(([key, value]) => {
            if (prompt[key] !== value) {
                prompt[key] = value;
                changed = true;
            }
        });
        if (!Number.isFinite(Number(previousInjectionPosition))) {
            prompt.injection_position = injectionPosition;
            changed = true;
        }
        const resolvedInjectionPosition = Number.isFinite(Number(prompt.injection_position))
            ? Number(prompt.injection_position)
            : injectionPosition;
        if (resolvedInjectionPosition === ABSOLUTE_DIRECTOR_PROMPT_MANAGER_INJECTION_POSITION) {
            if (!Number.isFinite(Number(previousDepth))) {
                prompt.injection_depth = DEFAULT_DIRECTOR_PROMPT_MANAGER_DEPTH;
                changed = true;
            }
            if (!Number.isFinite(Number(previousOrder))) {
                prompt.injection_order = DEFAULT_DIRECTOR_PROMPT_MANAGER_ORDER;
                changed = true;
            }
        }
        if (options.content !== undefined && prompt.content !== String(options.content || '')) {
            prompt.content = String(options.content || '');
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

export function setDirectorPromptManagerContent(promptManager, content = '', options = {}) {
    const ensured = ensureDirectorPromptManagerEntry(promptManager, options);
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

export function clearDirectorPromptManagerContent(promptManager, reason = '', options = {}) {
    const result = setDirectorPromptManagerContent(promptManager, '', options);
    return {
        ...result,
        cleared: result.ok === true,
        reason: String(reason || ''),
    };
}

export function getDirectorPromptManagerStatus(promptManager, options = {}) {
    const settings = promptManager?.serviceSettings;
    if (!settings || typeof settings !== 'object') {
        return { ok: false, reason: 'prompt-manager-settings-missing' };
    }

    const identifier = options.identifier || DIRECTOR_PROMPT_MANAGER_IDENTIFIER;
    const prompt = findPrompt(settings, identifier);
    const activeEntry = typeof promptManager?.getPromptOrderEntry === 'function'
        ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
        : null;

    return {
        ok: true,
        exists: !!prompt,
        identifier,
        activeEnabled: activeEntry?.enabled === true,
        contentLength: String(prompt?.content || '').length,
        role: prompt?.role || '',
        injectionPosition: prompt?.injection_position,
        injectionDepth: prompt?.injection_depth,
        injectionOrder: prompt?.injection_order,
        orderReferenced: !!activeEntry,
    };
}
