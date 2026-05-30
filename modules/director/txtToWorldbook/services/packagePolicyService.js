import { PROMPT_MODULE_IDS } from './promptRegistryService.js';

const PROMPT_CONFIG_TYPE = 'WestWorld.promptConfig';
const RESOURCE_PACKAGE_TYPE = 'WestWorld.taskState';
const RESOURCE_PACKAGE_VERSION = '3.6.0';

const PROMPT_SETTING_KEYS = Object.freeze([
    'promptConfigVersion',
    'promptGlobal',
    'promptOverrides',
    'promptPrefixPresets',
    'selectedPromptPrefixPreset',
    'promptMessageChain',
    'consolidatePromptPresets',
    'consolidateCategoryPresetMap',
]);

const RESOURCE_SETTING_KEYS = Object.freeze([
    'chunkSize',
    'minChunkSize',
    'language',
    'enablePlotOutline',
    'enableLiteraryStyle',
    'useVolumeMode',
    'parallelEnabled',
    'parallelConcurrency',
    'parallelMainConcurrency',
    'parallelDirectorConcurrency',
    'parallelMode',
    'chapterCompletionMode',
    'forceChapterMarker',
    'enableChapterOutline',
    'chapterOutlineMaxRetries',
    'chapterOpeningTargetLength',
    'directorEnabled',
    'directorMode',
    'directorFallbackOnError',
    'directorRunEveryTurn',
    'directorInjectionMode',
    'allowRecursion',
    'filterResponseTags',
    'worldbookForceReExtract',
]);

const RESOURCE_CATEGORY_KEYS = Object.freeze([
    'name',
    'enabled',
    'isBuiltin',
    'defaultPosition',
    'defaultDepth',
    'defaultOrder',
    'autoIncrementOrder',
]);

const LEGACY_BODY_MODULES = Object.freeze({
    customWorldbookPrompt: PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM,
    customPlotPrompt: PROMPT_MODULE_IDS.WORLDBOOK_PLOT,
    customStylePrompt: PROMPT_MODULE_IDS.WORLDBOOK_STYLE,
    customMergePrompt: PROMPT_MODULE_IDS.MERGE_IMPORTED,
    customConsolidatePrompt: PROMPT_MODULE_IDS.MERGE_CONSOLIDATE,
    customAliasMergePrompt: PROMPT_MODULE_IDS.MERGE_ALIAS,
    customChapterAssetsPrompt: PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS,
    customDirectorFrameworkPrompt: PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK,
    customDirectorInjectionPrompt: PROMPT_MODULE_IDS.DIRECTOR_INJECTION,
    customRerollPrompt: PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL,
});

const LEGACY_SUFFIX_MODULES = Object.freeze({
    customDirectorFrameworkSuffix: PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK,
    customDirectorInjectionSuffix: PROMPT_MODULE_IDS.DIRECTOR_INJECTION,
});

function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function copyOwnKeys(source, keys) {
    const output = {};
    for (const key of keys) {
        if (hasOwn(source, key)) output[key] = clone(source[key]);
    }
    return output;
}

function copyPromptLayers(layers) {
    const source = layers && typeof layers === 'object' ? layers : {};
    return {
        prefix: typeof source.prefix === 'string' ? source.prefix : '',
        body: typeof source.body === 'string' ? source.body : '',
        suffix: typeof source.suffix === 'string' ? source.suffix : '',
    };
}

function buildCategoryPromptLayers(categories) {
    return (Array.isArray(categories) ? categories : [])
        .filter((category) => category && typeof category.name === 'string')
        .map((category) => ({
            name: category.name,
            ...(hasOwn(category, 'entryExample') ? { entryExample: String(category.entryExample || '') } : {}),
            ...(hasOwn(category, 'keywordsExample') ? { keywordsExample: clone(category.keywordsExample) } : {}),
            promptLayers: copyPromptLayers(
                category.promptLayers || { body: category.contentGuide || '' }
            ),
        }));
}

function sanitizeResourceCategory(category) {
    return copyOwnKeys(category && typeof category === 'object' ? category : {}, RESOURCE_CATEGORY_KEYS);
}

function sanitizeResourceExperience(experience) {
    const result = clone(experience && typeof experience === 'object' ? experience : {});
    delete result.directorLastInjectionPrompt;
    delete result.directorLogs;
    if (result.directorRuntime?.lastInjection) {
        delete result.directorRuntime.lastInjection.content;
        delete result.directorRuntime.lastInjection.contentPreview;
    }
    return result;
}

export function buildPromptConfigPackage(state) {
    const settings = state?.settings || {};
    return {
        version: '1.0.0',
        type: PROMPT_CONFIG_TYPE,
        timestamp: Date.now(),
        ...copyOwnKeys(settings, PROMPT_SETTING_KEYS),
        categoryPromptLayers: buildCategoryPromptLayers(state?.persistent?.customCategories),
    };
}

export function filterLegacyPromptImport(payload = {}) {
    const settings = payload?.settings && typeof payload.settings === 'object'
        ? payload.settings
        : {};
    const promptData = {
        ...copyOwnKeys(settings, PROMPT_SETTING_KEYS),
        ...copyOwnKeys(payload, PROMPT_SETTING_KEYS),
    };
    const overrides = clone(promptData.promptOverrides || {});
    const legacySource = { ...settings };
    const nestedPrompts = payload?.prompts && typeof payload.prompts === 'object' ? payload.prompts : {};
    const nestedMap = {
        worldbookPrompt: 'customWorldbookPrompt',
        consolidatePrompt: 'customConsolidatePrompt',
        chapterAssetsPrompt: 'customChapterAssetsPrompt',
        directorFrameworkPrompt: 'customDirectorFrameworkPrompt',
        directorInjectionPrompt: 'customDirectorInjectionPrompt',
        plotPrompt: 'customPlotPrompt',
        stylePrompt: 'customStylePrompt',
        mergePrompt: 'customMergePrompt',
        rerollPrompt: 'customRerollPrompt',
    };
    for (const [key, legacyKey] of Object.entries(nestedMap)) {
        if (typeof nestedPrompts[key] === 'string') legacySource[legacyKey] = nestedPrompts[key];
    }
    for (const [key, moduleId] of Object.entries(LEGACY_BODY_MODULES)) {
        if (typeof legacySource[key] !== 'string' || legacySource[key] === '') continue;
        overrides[moduleId] = { ...(overrides[moduleId] || {}), body: legacySource[key] };
    }
    for (const [key, moduleId] of Object.entries(LEGACY_SUFFIX_MODULES)) {
        if (typeof legacySource[key] !== 'string' || legacySource[key] === '') continue;
        overrides[moduleId] = { ...(overrides[moduleId] || {}), suffix: legacySource[key] };
    }
    if (!promptData.promptGlobal || typeof promptData.promptGlobal !== 'object') {
        promptData.promptGlobal = { prefix: '', suffix: '' };
    }
    if (!promptData.promptGlobal.prefix && typeof legacySource.promptPrefixPreset === 'string') {
        promptData.promptGlobal.prefix = legacySource.promptPrefixPreset;
    }
    if (!promptData.promptGlobal.suffix && typeof legacySource.customSuffixPrompt === 'string') {
        promptData.promptGlobal.suffix = legacySource.customSuffixPrompt;
    }
    promptData.promptConfigVersion = Number(promptData.promptConfigVersion) || 1;
    promptData.promptOverrides = overrides;
    const categories = Array.isArray(payload.categoryPromptLayers)
        ? payload.categoryPromptLayers
        : payload.customWorldbookCategories;
    promptData.categoryPromptLayers = buildCategoryPromptLayers(categories);
    return promptData;
}

export function applyPromptConfigPackage(state, payload) {
    const promptData = filterLegacyPromptImport(payload);
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    for (const key of PROMPT_SETTING_KEYS) {
        if (hasOwn(promptData, key)) state.settings[key] = clone(promptData[key]);
    }
    const categories = Array.isArray(state?.persistent?.customCategories)
        ? state.persistent.customCategories
        : [];
    const importedByName = new Map(
        (promptData.categoryPromptLayers || []).map((category) => [category.name, category])
    );
    for (const category of categories) {
        const imported = importedByName.get(category.name);
        if (!imported) continue;
        if (hasOwn(imported, 'entryExample')) category.entryExample = String(imported.entryExample || '');
        if (hasOwn(imported, 'keywordsExample')) category.keywordsExample = clone(imported.keywordsExample);
        category.promptLayers = copyPromptLayers(imported.promptLayers);
        category.contentGuide = category.promptLayers.body;
    }
    return promptData;
}

export function buildResourcePackage(state) {
    const settings = state?.settings || {};
    return {
        version: RESOURCE_PACKAGE_VERSION,
        type: RESOURCE_PACKAGE_TYPE,
        timestamp: Date.now(),
        memoryQueue: clone(state?.memory?.queue || []),
        generatedWorldbook: clone(state?.worldbook?.generated || {}),
        worldbookVolumes: clone(state?.worldbook?.volumes || []),
        currentVolumeIndex: state?.worldbook?.currentVolumeIndex || 0,
        fileHash: state?.file?.hash || null,
        originalFileName: state?.file?.current?.name || null,
        novelName: state?.file?.novelName || '',
        experience: sanitizeResourceExperience(state?.experience),
        resourceSettings: copyOwnKeys(settings, RESOURCE_SETTING_KEYS),
        parallelConfig: clone(state?.config?.parallel || {}),
        categoryLightSettings: clone(state?.config?.categoryLight || {}),
        customWorldbookCategories: (state?.persistent?.customCategories || []).map(sanitizeResourceCategory),
        chapterRegexSettings: clone(state?.config?.chapterRegex || {}),
        defaultWorldbookEntriesUI: clone(state?.persistent?.defaultEntries || []),
        categoryDefaultConfig: clone(state?.config?.categoryDefault || {}),
        entryPositionConfig: clone(state?.config?.entryPosition || {}),
        processingState: {
            incrementalMode: !!state?.processing?.incrementalMode,
            volumeMode: !!state?.processing?.volumeMode,
        },
        queueState: {
            startIndex: Number.isInteger(state?.memory?.startIndex) ? state.memory.startIndex : 0,
            userSelectedIndex: Number.isInteger(state?.memory?.userSelectedIndex) ? state.memory.userSelectedIndex : null,
        },
    };
}

export function filterLegacyResourceImport(payload = {}) {
    const allowedTopLevelKeys = [
        'version',
        'type',
        'timestamp',
        'memoryQueue',
        'generatedWorldbook',
        'worldbookVolumes',
        'currentVolumeIndex',
        'fileHash',
        'originalFileName',
        'novelName',
        'experience',
        'parallelConfig',
        'categoryLightSettings',
        'chapterRegexSettings',
        'defaultWorldbookEntriesUI',
        'categoryDefaultConfig',
        'entryPositionConfig',
        'processingState',
        'queueState',
    ];
    const filtered = copyOwnKeys(payload, allowedTopLevelKeys);
    if (hasOwn(filtered, 'experience')) {
        filtered.experience = sanitizeResourceExperience(filtered.experience);
    }
    const resourceSettings = {
        ...copyOwnKeys(payload?.settings || {}, RESOURCE_SETTING_KEYS),
        ...copyOwnKeys(payload?.resourceSettings || {}, RESOURCE_SETTING_KEYS),
    };
    if (Object.keys(resourceSettings).length > 0) filtered.resourceSettings = resourceSettings;
    if (Array.isArray(payload.customWorldbookCategories)) {
        filtered.customWorldbookCategories = payload.customWorldbookCategories.map(sanitizeResourceCategory);
    }
    return filtered;
}

export function applyResourcePackage(state, payload) {
    const resource = filterLegacyResourceImport(payload);
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    Object.assign(state.settings, clone(resource.resourceSettings || {}));
    if (resource.parallelConfig && state.config) state.config.parallel = clone(resource.parallelConfig);
    if (resource.categoryLightSettings && state.config) state.config.categoryLight = clone(resource.categoryLightSettings);
    if (resource.chapterRegexSettings && state.config) state.config.chapterRegex = clone(resource.chapterRegexSettings);
    if (resource.categoryDefaultConfig && state.config) state.config.categoryDefault = clone(resource.categoryDefaultConfig);
    if (resource.entryPositionConfig && state.config) state.config.entryPosition = clone(resource.entryPositionConfig);
    if (resource.defaultWorldbookEntriesUI && state.persistent) {
        state.persistent.defaultEntries = clone(resource.defaultWorldbookEntriesUI);
    }
    if (Array.isArray(resource.customWorldbookCategories) && state.persistent) {
        const localByName = new Map(
            (state.persistent.customCategories || []).map((category) => [category.name, category])
        );
        state.persistent.customCategories = resource.customWorldbookCategories.map((category) => {
            const local = localByName.get(category.name);
            if (!local) return clone(category);
            return {
                ...clone(category),
                ...(hasOwn(local, 'contentGuide') ? { contentGuide: local.contentGuide } : {}),
                ...(hasOwn(local, 'entryExample') ? { entryExample: local.entryExample } : {}),
                ...(hasOwn(local, 'keywordsExample') ? { keywordsExample: clone(local.keywordsExample) } : {}),
                ...(hasOwn(local, 'promptLayers') ? { promptLayers: clone(local.promptLayers) } : {}),
                ...(hasOwn(local, 'promptDefaultLayers') ? { promptDefaultLayers: clone(local.promptDefaultLayers) } : {}),
            };
        });
    }
    return resource;
}

export function createPackagePolicyService() {
    return {
        buildPromptConfigPackage,
        applyPromptConfigPackage,
        buildResourcePackage,
        applyResourcePackage,
        filterLegacyPromptImport,
        filterLegacyResourceImport,
    };
}
