function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderWarnings(warnings = []) {
    if (warnings.length === 0) return '';
    const messages = warnings.map((warning) => (
        warning.type === 'empty-body'
            ? '正文为空，保存后该模块将不输出正文。'
            : `缺少占位符 ${escapeHtml(warning.placeholder)}，仍可保存但运行时内容可能不完整。`
    ));
    return `<div class="ttw-setting-hint" style="color:#f39c12;margin:6px 0;">${messages.join('<br>')}</div>`;
}

function renderLayerTextarea(scopeAttributes, layer, value, rows) {
    const label = layer === 'prefix' ? '模块前缀' : layer === 'body' ? '正文' : '模块后缀';
    return `
        <label style="display:block;margin-top:7px;font-size:12px;color:var(--ttw-text-secondary);">${label}</label>
        <textarea class="ttw-textarea-small ${scopeAttributes.className}" ${scopeAttributes.attributes} data-layer="${layer}" rows="${rows}">${escapeHtml(value)}</textarea>`;
}

const MODULE_LABELS = Object.freeze({
    'common.language.zh': '中文回复指令',
    'common.gemini.user-bridge': 'Gemini 用户消息桥接',
    'worldbook.system': '世界书主请求',
    'worldbook.plot': '剧情大纲片段',
    'worldbook.style': '文风配置片段',
    'worldbook.previous-context': '上一章节上下文',
    'worldbook.relevant-context': '相关世界书摘录',
    'worldbook.previous-end.parallel': '并行模式前文结尾',
    'worldbook.previous-end.serial': '串行模式前文结尾',
    'worldbook.force-chapter': '强制章节标记',
    'worldbook.force-reminder': '章节标记提醒',
    'worldbook.extract.parallel': '并行世界书请求',
    'worldbook.extract.serial': '串行世界书请求',
    'worldbook.extract.serial-start': '串行首次分析指令',
    'worldbook.extract.serial-incremental': '串行增量更新指令',
    'worldbook.extract.serial-accumulate': '串行累积补充指令',
    'worldbook.reroll.extra': '重抽附加要求',
    'worldbook.repair': '修复世界书请求',
    'worldbook.repair.existing-worldbook': '修复时已有世界书',
    'worldbook.reroll.single-entry': '单条重抽请求',
    'worldbook.reroll.category-guide': '单条重抽分类指南',
    'worldbook.reroll.previous-end': '单条重抽前文结尾',
    'worldbook.reroll.current-entry': '单条重抽当前条目',
    'merge.imported-entry': '导入条目合并请求',
    'merge.consolidate': '整理条目请求',
    'merge.consolidate.rules': '整理条目强制规则',
    'merge.alias': '别名判断请求',
    'merge.alias.pair': '别名判断配对格式',
    'director.chapter-assets': '导演章节资产请求',
    'director.chapter-assets.previous-outline': '导演上一章摘要',
    'director.chapter-assets.retry': '导演章节资产重试说明',
    'director.entry-events': '导演入场事件识别',
    'director.framework': '导演判定请求',
    'director.injection': '演员注入内容',
    'director.fallback.new-beat': '本地兜底：新节拍',
    'director.fallback.in-beat': '本地兜底：节拍内',
    'director.fallback.end': '本地兜底：节拍结束',
    'director.context.empty': '导演上下文空值',
    'director.context.current-beat': '导演当前节拍标签',
    'director.context.mode.new-beat': '导演模式：新节拍',
    'director.context.mode.in-beat': '导演模式：节拍内',
    'director.context.entry-line': '导演入场事件行',
    'director.context.start.new-beat-default': '导演开场默认：新节拍',
    'director.context.start.in-beat-default': '导演开场默认：节拍内',
    'director.context.start.large-jump-entry': '导演开场：跨节拍入场',
    'director.context.start.large-jump-user': '导演开场：跨节拍用户输入',
    'director.context.start.large-jump-default': '导演开场：跨节拍默认',
    'director.context.start.assistant-new-beat': '导演开场：承接 AI 后入场',
    'director.context.start.assistant': '导演开场：承接 AI',
    'director.context.start.entry': '导演开场：入场事件',
    'director.context.start.user': '导演开场：用户输入',
    'director.context.start.default': '导演开场：默认',
    'director.context.end.boundary': '导演收束：用户边界',
    'director.context.end.free-play': '导演收束：自由演出',
    'director.context.end.user': '导演收束：用户输入',
    'director.context.end.default': '导演收束：默认',
    'director.normalize.start-rich': '导演动作规范：丰富起手',
    'director.normalize.step': '导演动作规范：推进步骤',
    'director.default.start': '导演默认开场',
    'director.default.end': '导演默认收束',
    'director.injection.current-missing': '当前节拍原文缺省',
    'director.injection.next-missing': '下一节拍缺省',
    'director.injection.next-entry-missing': '下一入场事件缺省',
    'director.injection.next-preview-missing': '下一节拍预览缺省',
    'director.injection.exit-missing': '退出事件缺省',
    'director.injection.default-steps': '注入默认步骤',
    'director.injection.default-action': '注入默认动作',
    'director.injection.requirement.switched': '注入要求：已切拍',
    'director.injection.requirement.stay': '注入要求：停留当前节拍',
    'director.next-preview.summary': '下一节拍摘要',
    'chapter.opening': '章节开场白',
    'chapter.opening.no-summary': '章节摘要缺省',
    'chapter.opening.no-carry': '承上素材缺省',
    'chapter.opening.no-lead': '启下素材缺省',
});

const MODULE_GROUPS = Object.freeze([
    { title: '通用层', description: '语言、模型桥接与全局请求层。', match: (id) => id.startsWith('common.') },
    { title: '世界书处理', description: '主世界书生成、上下文、章节标记和并行/串行请求。', match: (id) => id.startsWith('worldbook.') && !id.startsWith('worldbook.reroll.') && !id.startsWith('worldbook.repair') },
    { title: '重抽与修复', description: '单条重抽、附加要求和修复请求。', match: (id) => id.startsWith('worldbook.reroll.') || id.startsWith('worldbook.repair') },
    { title: '整理 / 合并', description: '导入合并、整理条目和别名判断。', match: (id) => id.startsWith('merge.') },
    { title: '导演切拍与演出', description: '导演 API 判定、章节资产、本地兜底和演员注入主体。', match: (id) => (
        id.startsWith('director.chapter-assets')
        || id === 'director.entry-events'
        || id === 'director.framework'
        || id === 'director.injection'
        || id.startsWith('director.fallback.')
        || id === 'director.next-preview.summary'
    ) },
    { title: '导演上下文片段', description: '构造导演判定上下文时使用的可编辑短片段。', match: (id) => id.startsWith('director.context.') || id.startsWith('director.normalize.') || id.startsWith('director.default.') },
    { title: '导演注入缺省片段', description: '演员注入内容缺少运行时数据时使用的备用文字。', match: (id) => id.startsWith('director.injection.') },
    { title: '章节交互', description: '章节开场白和承上启下缺省说明。', match: (id) => id.startsWith('chapter.') },
]);

function getModuleDisplayTitle(module) {
    return MODULE_LABELS[module.id] || module.title || module.id;
}

function renderModuleDetails(module) {
    const displayTitle = getModuleDisplayTitle(module);
    return `
        <details class="ttw-prompt-section" style="margin-bottom:10px;" ${module.id === 'worldbook.system' ? 'open' : ''}>
            <summary style="cursor:pointer;padding:8px 0;font-weight:500;">
                ${escapeHtml(displayTitle)}
                <code style="margin-left:6px;">${escapeHtml(module.id)}</code>
            </summary>
            ${renderWarnings(module.warnings)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'prefix', module.prefix, 2)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'body', module.body, 6)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'suffix', module.suffix, 2)}
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="ttw-btn ttw-btn-small ttw-save-registry-module" data-module-id="${escapeHtml(module.id)}">保存</button>
                <button class="ttw-btn ttw-btn-small ttw-reset-registry-module" data-module-id="${escapeHtml(module.id)}">恢复默认</button>
            </div>
        </details>`;
}

function renderModuleGroups(modules) {
    const remaining = [...modules];
    const sections = [];
    for (const group of MODULE_GROUPS) {
        const groupModules = remaining.filter((module) => group.match(module.id));
        if (groupModules.length === 0) continue;
        for (const module of groupModules) {
            remaining.splice(remaining.indexOf(module), 1);
        }
        sections.push(`
            <section class="ttw-prompt-group" style="margin-top:16px;">
                <div class="ttw-prompt-group-separator" style="border-top:1px solid rgba(255,255,255,0.14);margin:16px 0 10px;"></div>
                <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(group.title)}</div>
                <div class="ttw-setting-hint" style="margin-bottom:8px;">${escapeHtml(group.description)}</div>
                ${groupModules.map(renderModuleDetails).join('')}
            </section>`);
    }
    if (remaining.length > 0) {
        sections.push(`
            <section class="ttw-prompt-group" style="margin-top:16px;">
                <div class="ttw-prompt-group-separator" style="border-top:1px solid rgba(255,255,255,0.14);margin:16px 0 10px;"></div>
                <div style="font-weight:600;margin-bottom:4px;">其他提示词片段</div>
                <div class="ttw-setting-hint" style="margin-bottom:8px;">尚未归入固定流程组的可编辑模块。</div>
                ${remaining.map(renderModuleDetails).join('')}
            </section>`);
    }
    return sections.join('');
}

export function buildPromptEditorHtml({ globalLayers = {}, modules = [], categories = [] } = {}) {
    const moduleHtml = renderModuleGroups(modules);

    const categoryHtml = categories.map((category, index) => {
        const layers = category.promptLayers || { prefix: '', body: category.contentGuide || '', suffix: '' };
        return `
        <details class="ttw-prompt-section" style="margin-bottom:10px;">
            <summary style="cursor:pointer;padding:8px 0;font-weight:500;">分类提示词: ${escapeHtml(category.name)}</summary>
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'prefix', layers.prefix, 2)}
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'body', layers.body, 5)}
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'suffix', layers.suffix, 2)}
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="ttw-btn ttw-btn-small ttw-save-category-layers" data-category-index="${index}">保存</button>
                <button class="ttw-btn ttw-btn-small ttw-reset-category-layers" data-category-index="${index}">恢复默认</button>
            </div>
        </details>`;
    }).join('');

    return `
        <div class="ttw-prompt-section" style="margin-bottom:14px;">
            <div style="font-weight:600;margin-bottom:6px;">提示词如何生成</div>
            <div class="ttw-setting-hint">
                完整模型请求通常按“中文回复指令 / 全局前缀 → 模块前缀 → 模块正文 → 模块后缀 → 全局后缀 → 消息链”组合。
                运行时数据通过占位符注入，例如 <code>{CHAPTER_CONTENT}</code>、<code>{DYNAMIC_JSON_TEMPLATE}</code>。
                导演注入到 SillyTavern / LittleWhite 的演员执行内容只使用导演注入相关模块，不叠加全局层或主 AI 消息链。
            </div>
        </div>
        <div class="ttw-prompt-section" style="margin-bottom:14px;">
            <div style="font-weight:500;margin-bottom:6px;">全局后缀</div>
            <div class="ttw-setting-hint">完整模型请求仅追加一次；导演注入演员模块不使用全局层。</div>
            <textarea id="ttw-global-suffix-prompt" class="ttw-textarea-small" rows="3">${escapeHtml(globalLayers.suffix || '')}</textarea>
            <button class="ttw-btn ttw-btn-small" id="ttw-save-global-suffix" style="margin-top:8px;">保存全局后缀</button>
        </div>
        <div class="ttw-setting-hint" style="margin-bottom:8px;">所有提示词模块均可编辑前缀、正文与后缀；缺少占位符只提示警告，不阻止保存。</div>
        <div id="ttw-registry-module-list">${moduleHtml}</div>
        <div class="ttw-prompt-group-separator" style="border-top:1px solid rgba(255,255,255,0.14);margin:16px 0 10px;"></div>
        <div style="font-weight:500;margin:16px 0 8px;">分类提取提示词</div>
        <div class="ttw-setting-hint" style="margin-bottom:8px;">分类提示词会作为世界书分类规则的一部分参与生成；工程资源包不会携带这些提示词内容。</div>
        <div id="ttw-registry-category-list">${categoryHtml || '<div class="ttw-setting-hint">暂无分类配置</div>'}</div>`;
}

const LEGACY_BODY_KEYS = Object.freeze({
    'worldbook.system': 'customWorldbookPrompt',
    'worldbook.plot': 'customPlotPrompt',
    'worldbook.style': 'customStylePrompt',
    'merge.imported-entry': 'customMergePrompt',
    'merge.consolidate': 'customConsolidatePrompt',
    'merge.alias': 'customAliasMergePrompt',
    'director.chapter-assets': 'customChapterAssetsPrompt',
    'director.framework': 'customDirectorFrameworkPrompt',
    'director.injection': 'customDirectorInjectionPrompt',
    'worldbook.reroll.single-entry': 'customRerollPrompt',
});

const LEGACY_SUFFIX_KEYS = Object.freeze({
    'director.framework': 'customDirectorFrameworkSuffix',
    'director.injection': 'customDirectorInjectionSuffix',
});

export function createPromptEditorView(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        saveCurrentSettings,
        saveCustomCategories,
        ErrorHandler,
    } = deps;

    function renderPromptEditor() {
        const host = document.getElementById('ttw-prompt-registry-host');
        if (!host || !promptRegistryService) return;
        const modules = promptRegistryService.listModules().map((module) => ({
            ...module,
            warnings: promptRegistryService.getWarnings(module.id, module),
        }));
        host.innerHTML = buildPromptEditorHtml({
            globalLayers: AppState.settings.promptGlobal || {},
            modules,
            categories: AppState.persistent.customCategories || [],
        });
        const prefix = document.getElementById('ttw-prefix-prompt');
        if (prefix) prefix.value = AppState.settings.promptGlobal?.prefix || '';
    }

    function readModuleLayers(container, moduleId) {
        const layers = {};
        for (const layer of ['prefix', 'body', 'suffix']) {
            const input = container.querySelector(`.ttw-registry-layer-input[data-module-id="${moduleId}"][data-layer="${layer}"]`);
            layers[layer] = input?.value || '';
        }
        return layers;
    }

    function mirrorLegacyModule(moduleId, layers) {
        const bodyKey = LEGACY_BODY_KEYS[moduleId];
        if (bodyKey) AppState.settings[bodyKey] = layers.body;
        const suffixKey = LEGACY_SUFFIX_KEYS[moduleId];
        if (suffixKey) AppState.settings[suffixKey] = layers.suffix;
    }

    function bindPromptEditorEvents({ modalContainer, EventDelegate }) {
        EventDelegate.on(modalContainer, '#ttw-save-global-suffix', 'click', () => {
            const suffix = modalContainer.querySelector('#ttw-global-suffix-prompt')?.value || '';
            AppState.settings.promptGlobal = { ...(AppState.settings.promptGlobal || {}), suffix };
            AppState.settings.customSuffixPrompt = suffix;
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            ErrorHandler?.showUserSuccess?.('全局后缀已保存');
        });

        EventDelegate.on(modalContainer, '.ttw-save-registry-module', 'click', (event, button) => {
            const moduleId = button.getAttribute('data-module-id');
            const layers = readModuleLayers(modalContainer, moduleId);
            promptRegistryService.setOverride(moduleId, layers);
            mirrorLegacyModule(moduleId, layers);
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.('提示词模块已保存');
        });

        EventDelegate.on(modalContainer, '.ttw-reset-registry-module', 'click', (event, button) => {
            const moduleId = button.getAttribute('data-module-id');
            const restored = promptRegistryService.resetOverride(moduleId);
            mirrorLegacyModule(moduleId, { body: '', suffix: '' });
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.(`已恢复默认: ${restored.id}`);
        });

        EventDelegate.on(modalContainer, '.ttw-save-category-layers', 'click', async (event, button) => {
            const index = Number.parseInt(button.getAttribute('data-category-index'), 10);
            const category = AppState.persistent.customCategories[index];
            if (!category) return;
            const layers = {};
            for (const layer of ['prefix', 'body', 'suffix']) {
                layers[layer] = modalContainer.querySelector(`.ttw-category-layer-input[data-category-index="${index}"][data-layer="${layer}"]`)?.value || '';
            }
            category.promptLayers = layers;
            category.contentGuide = layers.body;
            await saveCustomCategories();
            ErrorHandler?.showUserSuccess?.(`已保存分类提示词: ${category.name}`);
        });

        EventDelegate.on(modalContainer, '.ttw-reset-category-layers', 'click', async (event, button) => {
            const index = Number.parseInt(button.getAttribute('data-category-index'), 10);
            const category = AppState.persistent.customCategories[index];
            if (!category) return;
            category.promptLayers = { ...(category.promptDefaultLayers || { prefix: '', body: '', suffix: '' }) };
            category.contentGuide = category.promptLayers.body || '';
            await saveCustomCategories();
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.(`已恢复分类默认提示词: ${category.name}`);
        });
    }

    return {
        renderPromptEditor,
        bindPromptEditorEvents,
    };
}
