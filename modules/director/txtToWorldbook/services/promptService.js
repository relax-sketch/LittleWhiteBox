import { PROMPT_MODULE_IDS } from './promptRegistryService.js';

export function createPromptService(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        getEnabledCategories,
        generateDynamicJsonTemplate,
        defaultWorldbookPrompt,
        defaultPlotPrompt,
        defaultStylePrompt,
    } = deps;

    function getLanguagePrefix() {
        const fragments = [];
        if (AppState.settings.language === 'zh') {
            fragments.push(promptRegistryService.renderModule(PROMPT_MODULE_IDS.LANGUAGE_ZH));
        }
        const prefix = AppState.settings.promptGlobal?.prefix || '';
        if (prefix) fragments.push(prefix);
        return fragments.length > 0 ? `${fragments.join('\n\n')}\n\n` : '';
    }

    function messagesToString(messages) {
        if (typeof messages === 'string') return messages;
        if (!Array.isArray(messages) || messages.length === 0) return '';
        if (messages.length === 1) return messages[0].content || '';
        return messages.map((m) => {
            const roleLabel = m.role === 'system' ? '[System]' : m.role === 'assistant' ? '[Assistant]' : '[User]';
            return `${roleLabel}\n${m.content}`;
        }).join('\n\n');
    }

    function applyMessageChain(prompt) {
        const chain = AppState.settings.promptMessageChain;
        if (!Array.isArray(chain) || chain.length === 0) {
            return [{ role: 'user', content: prompt }];
        }
        const enabledMessages = chain.filter((m) => m.enabled !== false);
        if (enabledMessages.length === 0) {
            return [{ role: 'user', content: prompt }];
        }
        return enabledMessages.map((msg) => ({
            role: msg.role || 'user',
            content: (msg.content || '').replace(/\{PROMPT\}/g, prompt),
        })).filter((m) => m.content.trim().length > 0);
    }

    function convertToGeminiContents(messages) {
        const systemMsgs = messages.filter((m) => m.role === 'system');
        const nonSystemMsgs = messages.filter((m) => m.role !== 'system');
        const merged = [];

        for (const msg of nonSystemMsgs) {
            const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
            if (merged.length > 0 && merged[merged.length - 1].role === geminiRole) {
                merged[merged.length - 1].parts[0].text += '\n\n' + msg.content;
            } else {
                merged.push({ role: geminiRole, parts: [{ text: msg.content }] });
            }
        }

        if (merged.length > 0 && merged[0].role !== 'user') {
            merged.unshift({
                role: 'user',
                parts: [{ text: promptRegistryService.renderModule(PROMPT_MODULE_IDS.GEMINI_USER_BRIDGE) }],
            });
        }

        const result = { contents: merged };
        if (systemMsgs.length > 0) {
            result.systemInstruction = {
                parts: [{ text: systemMsgs.map((m) => m.content).join('\n\n') }],
            };
        }
        return result;
    }

    function buildSystemPrompt() {
        const dynamicTemplate = generateDynamicJsonTemplate();
        const enabledCatNames = getEnabledCategories().map((c) => c.name);
        if (AppState.settings.enablePlotOutline) enabledCatNames.push('剧情大纲');
        if (AppState.settings.enableLiteraryStyle) enabledCatNames.push('文风配置');
        let worldbookPrompt = promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM, {
            DYNAMIC_JSON_TEMPLATE: dynamicTemplate,
            ENABLED_CATEGORY_NAMES: enabledCatNames.join('、'),
        });

        const additionalParts = [];
        if (AppState.settings.enablePlotOutline) {
            additionalParts.push(promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_PLOT));
        }
        if (AppState.settings.enableLiteraryStyle) {
            additionalParts.push(promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_STYLE));
        }
        if (additionalParts.length === 0) return worldbookPrompt;

        let fullPrompt = worldbookPrompt;
        const insertContent = ',\n' + additionalParts.join(',\n');
        fullPrompt = fullPrompt.replace(/(\}\s*)\n\`\`\`/, `${insertContent}\n$1\n\`\`\``);
        return fullPrompt;
    }

    function getPreviousMemoryContext(index) {
        if (index <= 0) return '';

        const safeContentSnippet = (entry) => {
            const raw = entry?.['内容'];
            if (typeof raw === 'string') return raw.substring(0, 200);
            if (raw === null || raw === undefined) return '';
            if (Array.isArray(raw)) {
                return raw
                    .map((item) => String(item ?? '').trim())
                    .filter(Boolean)
                    .join('；')
                    .substring(0, 200);
            }
            if (typeof raw === 'object') {
                try {
                    return JSON.stringify(raw).substring(0, 200);
                } catch (_) {
                    return String(raw).substring(0, 200);
                }
            }
            return String(raw).substring(0, 200);
        };

        for (let i = index - 1; i >= 0; i--) {
            const prevMemory = AppState.memory.queue[i];
            if (prevMemory && prevMemory.processed && prevMemory.result && !prevMemory.failed) {
                const plotContext = [];
                const result = prevMemory.result;

                if (result['剧情大纲']) {
                    for (const entryName in result['剧情大纲']) {
                        plotContext.push(`${entryName}: ${safeContentSnippet(result['剧情大纲'][entryName])}`);
                    }
                }
                if (result['剧情节点']) {
                    for (const entryName in result['剧情节点']) {
                        plotContext.push(`${entryName}: ${safeContentSnippet(result['剧情节点'][entryName])}`);
                    }
                }
                if (result['章节剧情']) {
                    for (const entryName in result['章节剧情']) {
                        plotContext.push(`${entryName}: ${safeContentSnippet(result['章节剧情'][entryName])}`);
                    }
                }

                if (plotContext.length > 0) {
                    return promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT, {
                        PREVIOUS_CHAPTER_INDEX: i + 1,
                        PLOT_CONTEXT: plotContext.join('\n'),
                    });
                }
                break;
            }
        }
        return '';
    }

    function getChapterForcePrompt(chapterIndex) {
        return promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER, {
            CHAPTER_INDEX: chapterIndex,
        });
    }

    return {
        getLanguagePrefix,
        messagesToString,
        applyMessageChain,
        convertToGeminiContents,
        buildSystemPrompt,
        getPreviousMemoryContext,
        getChapterForcePrompt,
    };
}
