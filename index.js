import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getRequestHeaders } from "../../../../script.js";
import { EXT_ID, extensionFolderPath } from "./core/constants.js";
import { executeSlashCommand } from "./core/slash-command.js";
import { EventCenter } from "./core/event-manager.js";
import { initButtonCollapse } from "./widgets/button-collapse.js";
import { initStreamingGeneration } from "./modules/streaming-generation.js";
import {
    initRenderer,
    cleanupRenderer,
    processExistingMessages,
    clearBlobCaches,
    renderHtmlInIframe,
    shrinkRenderedWindowFull
} from "./modules/iframe-renderer.js";
import { initVarCommands, cleanupVarCommands } from "./modules/variables/var-commands.js";
import "./modules/story-summary/story-summary.js";
import "./modules/story-outline/story-outline.js";
import { initEnaPlanner, cleanupEnaPlanner } from "./modules/ena-planner/ena-planner.js";
import { initVectors, cleanupVectors } from "./modules/vectors/index.js";
import { initDirector, cleanupDirector } from "./modules/director/index.js";

extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
    enabled: true,
    storySummary: { enabled: true },
    storyOutline: { enabled: false },
    enaPlanner: { enabled: false },
    vectors: { enabled: true },
    director: { enabled: true },
    useBlob: false,
    wrapperIframe: true,
    renderEnabled: true,
    maxRenderedMessages: 5,
};

const settings = extension_settings[EXT_ID];
settings.vectors ||= { enabled: true };
settings.director ||= { enabled: true };

const DEPRECATED_KEYS = [
    'characterUpdater',
    'promptSections',
    'promptPresets',
    'relationshipGuidelines',
    'scriptAssistant'
];

function cleanupDeprecatedData() {
    const s = extension_settings[EXT_ID];
    if (!s) return;

    let cleaned = false;
    for (const key of DEPRECATED_KEYS) {
        if (key in s) {
            delete s[key];
            cleaned = true;
            console.log(`[LittleWhiteBox] Cleaned deprecated data: ${key}`);
        }
    }

    if (cleaned) {
        saveSettingsDebounced();
        console.log('[LittleWhiteBox] Deprecated data cleanup complete');
    }
}

let isXiaobaixEnabled = settings.enabled;
let moduleCleanupFunctions = new Map();
let updateCheckPerformed = false;

window.isXiaobaixEnabled = isXiaobaixEnabled;
window.testLittleWhiteBoxUpdate = async () => {
    updateCheckPerformed = false;
    await performExtensionUpdateCheck();
};
window.testUpdateUI = () => {
    updateExtensionHeaderWithUpdateNotice();
};
window.testRemoveUpdateUI = () => {
    removeAllUpdateNotices();
};

async function checkLittleWhiteBoxUpdate() {
    try {
        const timestamp = Date.now();
        const localRes = await fetch(`${extensionFolderPath}/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!localRes.ok) return null;
        const localManifest = await localRes.json();
        const localVersion = localManifest.version;
        const remoteRes = await fetch(`https://api.github.com/repos/RT15548/LittleWhiteBox/contents/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!remoteRes.ok) return null;
        const remoteData = await remoteRes.json();
        const remoteManifest = JSON.parse(atob(remoteData.content));
        const remoteVersion = remoteManifest.version;
        return localVersion !== remoteVersion ? { isUpToDate: false, localVersion, remoteVersion } : { isUpToDate: true, localVersion, remoteVersion };
    } catch (e) {
        return null;
    }
}

async function updateLittleWhiteBoxExtension() {
    try {
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: 'LittleWhiteBox', global: true }),
        });
        if (!response.ok) {
            const text = await response.text();
            toastr.error(text || response.statusText, 'LittleWhiteBox update failed', { timeOut: 5000 });
            return false;
        }
        const data = await response.json();
        const message = data.isUpToDate ? 'LittleWhiteBox is up to date' : `LittleWhiteBox updated`;
        const title = data.isUpToDate ? '' : '请刷新页面以应用更新';
        toastr.success(message, title);
        return true;
    } catch (error) {
        toastr.error('Error during update', 'LittleWhiteBox update failed');
        return false;
    }
}

function updateExtensionHeaderWithUpdateNotice() {
    addUpdateTextNotice();
    addUpdateDownloadButton();
}

function addUpdateTextNotice() {
    const selectors = [
        '.inline-drawer-toggle.inline-drawer-header b',
        '.inline-drawer-header b',
        '.littlewhitebox .inline-drawer-header b',
        'div[class*="inline-drawer"] b'
    ];
    let headerElement = null;
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (element.textContent && element.textContent.includes('小白X')) {
                headerElement = element;
                break;
            }
        }
        if (headerElement) break;
    }
    if (!headerElement) {
        setTimeout(() => addUpdateTextNotice(), 1000);
        return;
    }
    if (headerElement.querySelector('.littlewhitebox-update-text')) return;
    const updateTextSmall = document.createElement('small');
    updateTextSmall.className = 'littlewhitebox-update-text';
    updateTextSmall.textContent = '(有可用更新)';
    headerElement.appendChild(updateTextSmall);
}

function addUpdateDownloadButton() {
    const sectionDividers = document.querySelectorAll('.section-divider');
    let totalSwitchDivider = null;
    for (const divider of sectionDividers) {
        if (divider.textContent && divider.textContent.includes('总开关')) {
            totalSwitchDivider = divider;
            break;
        }
    }
    if (!totalSwitchDivider) {
        setTimeout(() => addUpdateDownloadButton(), 1000);
        return;
    }
    if (document.querySelector('#littlewhitebox-update-extension')) return;
    const updateButton = document.createElement('div');
    updateButton.id = 'littlewhitebox-update-extension';
    updateButton.className = 'menu_button fa-solid fa-cloud-arrow-down interactable has-update';
    updateButton.title = '下载并安装小白X的更新';
    updateButton.tabIndex = 0;
    try {
        totalSwitchDivider.style.display = 'flex';
        totalSwitchDivider.style.alignItems = 'center';
        totalSwitchDivider.style.justifyContent = 'flex-start';
    } catch (e) { }
    totalSwitchDivider.appendChild(updateButton);
    try {
        if (window.setupUpdateButtonInSettings) {
            window.setupUpdateButtonInSettings();
        }
    } catch (e) { }
}

function removeAllUpdateNotices() {
    const textNotice = document.querySelector('.littlewhitebox-update-text');
    const downloadButton = document.querySelector('#littlewhitebox-update-extension');
    if (textNotice) textNotice.remove();
    if (downloadButton) downloadButton.remove();
}

async function performExtensionUpdateCheck() {
    if (updateCheckPerformed) return;
    updateCheckPerformed = true;
    try {
        const versionData = await checkLittleWhiteBoxUpdate();
        if (versionData && versionData.isUpToDate === false) {
            updateExtensionHeaderWithUpdateNotice();
        }
    } catch (error) { }
}

function registerModuleCleanup(moduleName, cleanupFunction) {
    moduleCleanupFunctions.set(moduleName, cleanupFunction);
}

function removeSkeletonStyles() {
    try {
        document.querySelectorAll('.xiaobaix-skel').forEach(el => {
            try { el.remove(); } catch (e) { }
        });
        document.getElementById('xiaobaix-skeleton-style')?.remove();
    } catch (e) { }
}

function cleanupAllResources() {
    try {
        EventCenter.cleanupAll();
    } catch (e) { }
    try { window.xbDebugPanelClose?.(); } catch (e) { }
    moduleCleanupFunctions.forEach((cleanupFn) => {
        try {
            cleanupFn();
        } catch (e) { }
    });
    moduleCleanupFunctions.clear();
    try {
        cleanupRenderer();
    } catch (e) { }
    document.querySelectorAll('.memory-button, .mes_history_preview').forEach(btn => btn.remove());
    document.querySelectorAll('#message_preview_btn').forEach(btn => {
        if (btn instanceof HTMLElement) {
            btn.style.display = 'none';
        }
    });
    removeSkeletonStyles();
}

async function waitForElement(selector, root = document, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const element = root.querySelector(selector);
        if (element) return element;
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

function toggleSettingsControls(enabled) {
    const controls = [
        'xiaobaix_use_blob', 'Wrapperiframe', 'xiaobaix_render_enabled',
        'xiaobaix_max_rendered', 'xiaobaix_story_outline_enabled', 'xiaobaix_story_summary_enabled',
        'xiaobaix_ena_planner_enabled', 'xiaobaix_ena_planner_open_settings',
        'xiaobaix_ena_planner_open_settings_secondary', 'xiaobaix_vectors_enabled', 'xiaobaix_director_enabled'
    ];
    controls.forEach(id => {
        $(`#${id}`).prop('disabled', !enabled).closest('.flex-container').toggleClass('disabled-control', !enabled);
    });
    const styleId = 'xiaobaix-disabled-style';
    if (!enabled && !document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `.disabled-control, .disabled-control * { opacity: 0.4 !important; pointer-events: none !important; cursor: not-allowed !important; }`;
        document.head.appendChild(style);
    } else if (enabled) {
        document.getElementById(styleId)?.remove();
    }
    syncFeatureActionButtons();
}

function syncFeatureActionButtons() {
    const bindings = [
        { toggleId: 'xiaobaix_ena_planner_enabled', buttonId: 'xiaobaix_ena_planner_open_settings' },
        { toggleId: 'xiaobaix_ena_planner_enabled', buttonId: 'xiaobaix_ena_planner_open_settings_secondary' }
    ];
    bindings.forEach(({ toggleId, buttonId }) => {
        const toggle = document.getElementById(toggleId);
        const button = document.getElementById(buttonId);
        if (!toggle || !button) return;
        const enabled = isXiaobaixEnabled && !!toggle.checked;
        button.disabled = !enabled;
        button.classList.toggle('disabled-action', !enabled);
    });
}

async function toggleAllFeatures(enabled) {
    if (enabled) {
        toggleSettingsControls(true);
        try { window.XB_applyPrevStates && window.XB_applyPrevStates(); } catch (e) { }
        saveSettingsDebounced();
        initRenderer();
        try { initVarCommands(); } catch (e) { }
        const moduleInits = [
            { condition: extension_settings[EXT_ID].vectors?.enabled, init: initVectors },
            { condition: extension_settings[EXT_ID].director?.enabled, init: initDirector },
            { condition: extension_settings[EXT_ID].enaPlanner?.enabled, init: initEnaPlanner },
            { condition: true, init: initStreamingGeneration },
            { condition: true, init: initButtonCollapse }
        ];
        moduleInits.forEach(({ condition, init }) => {
            if (condition) init();
        });
        try {
            if (isXiaobaixEnabled && settings.wrapperIframe && !document.getElementById('xb-callgen'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` }));
        } catch (e) { }
        try {
            if (isXiaobaixEnabled && !document.getElementById('xb-worldbook'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-worldbook', type: 'module', src: `${extensionFolderPath}/bridges/worldbook-bridge.js` }));
        } catch (e) { }
        if (extension_settings[EXT_ID].storySummary?.enabled) {
            $(document).trigger('xiaobaix:storySummary:toggle', [true]);
        }
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: true } }));
        $(document).trigger('xiaobaix:enabled:toggle', [true]);
    } else {
        try { window.XB_captureAndStoreStates && window.XB_captureAndStoreStates(); } catch (e) { }
        cleanupAllResources();
        if (window.buttonCollapseCleanup) try { window.buttonCollapseCleanup(); } catch (e) { }
        try { cleanupVarCommands(); } catch (e) { }
        try { cleanupVectors(); } catch (e) { }
        try { cleanupDirector(); } catch (e) { }
        try { cleanupEnaPlanner(); } catch (e) { }
        try { clearBlobCaches(); } catch (e) { }
        toggleSettingsControls(false);
        try { window.cleanupWorldbookHostBridge && window.cleanupWorldbookHostBridge(); document.getElementById('xb-worldbook')?.remove(); } catch (e) { }
        try { window.cleanupCallGenerateHostBridge && window.cleanupCallGenerateHostBridge(); document.getElementById('xb-callgen')?.remove(); } catch (e) { }
        if (extension_settings[EXT_ID].storySummary?.enabled) {
            $(document).trigger('xiaobaix:storySummary:toggle', [false]);
        }
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: false } }));
        $(document).trigger('xiaobaix:enabled:toggle', [false]);
    }
}

async function setupSettings() {
    try {
        const settingsContainer = await waitForElement("#extensions_settings");
        if (!settingsContainer) return;
        const response = await fetch(`${extensionFolderPath}/settings.html`);
        const settingsHtml = await response.text();
        $(settingsContainer).append(settingsHtml);

        setupDebugButtonInSettings();

        $("#xiaobaix_enabled").prop("checked", settings.enabled).on("change", async function () {
            const wasEnabled = settings.enabled;
            settings.enabled = $(this).prop("checked");
            isXiaobaixEnabled = settings.enabled;
            window.isXiaobaixEnabled = isXiaobaixEnabled;
            saveSettingsDebounced();
            if (settings.enabled !== wasEnabled) {
                await toggleAllFeatures(settings.enabled);
            }
        });

        if (!settings.enabled) toggleSettingsControls(false);

        document.querySelectorAll('[data-xb-module-tab]').forEach((tab) => {
            tab.addEventListener('click', () => {
                const key = tab.getAttribute('data-xb-module-tab');
                document.querySelectorAll('[data-xb-module-tab]').forEach((item) => {
                    item.classList.toggle('active', item === tab);
                });
                document.querySelectorAll('[data-xb-module-panel]').forEach((panel) => {
                    panel.classList.toggle('active', panel.getAttribute('data-xb-module-panel') === key);
                });
            });
        });

        const moduleConfigs = [
            { id: 'xiaobaix_story_summary_enabled', key: 'storySummary' },
            { id: 'xiaobaix_story_outline_enabled', key: 'storyOutline' },
            { id: 'xiaobaix_vectors_enabled', key: 'vectors', init: initVectors },
            { id: 'xiaobaix_director_enabled', key: 'director', init: initDirector },
            { id: 'xiaobaix_ena_planner_enabled', key: 'enaPlanner', init: initEnaPlanner },
        ];

        moduleConfigs.forEach(({ id, key, init }) => {
            $(`#${id}`).prop("checked", settings[key]?.enabled || false).on("change", async function () {
                if (!isXiaobaixEnabled) return;
                const enabled = $(this).prop('checked');
                if (!enabled && key === 'enaPlanner') {
                    try { cleanupEnaPlanner(); } catch (e) { }
                }
                if (!enabled && key === 'vectors') {
                    try { cleanupVectors(); } catch (e) { }
                }
                if (!enabled && key === 'director') {
                    try { cleanupDirector(); } catch (e) { }
                }
                settings[key] = extension_settings[EXT_ID][key] || {};
                settings[key].enabled = enabled;
                extension_settings[EXT_ID][key] = settings[key];
                saveSettingsDebounced();
                if (moduleCleanupFunctions.has(key)) {
                    moduleCleanupFunctions.get(key)();
                    moduleCleanupFunctions.delete(key);
                }
                if (enabled && init) await init();
                if (key === 'storySummary') {
                    $(document).trigger('xiaobaix:storySummary:toggle', [enabled]);
                }
                if (key === 'storyOutline') {
                    $(document).trigger('xiaobaix:storyOutline:toggle', [enabled]);
                }
                syncFeatureActionButtons();
            });
        });
        syncFeatureActionButtons();

        $("#xiaobaix_ena_planner_open_settings").on("click", function () {
            if (!isXiaobaixEnabled) return;
            if (settings.enaPlanner?.enabled && window.xiaobaixEnaPlanner?.openSettings) {
                window.xiaobaixEnaPlanner.openSettings();
            } else {
                toastr.warning('请先启用剧情规划模块');
            }
        });

        $("#xiaobaix_ena_planner_open_settings_secondary").on("click", function () {
            $("#xiaobaix_ena_planner_open_settings").trigger("click");
        });

        $("#xiaobaix_use_blob").prop("checked", !!settings.useBlob).on("change", async function () {
            if (!isXiaobaixEnabled) return;
            settings.useBlob = $(this).prop("checked");
            saveSettingsDebounced();
        });

        $("#Wrapperiframe").prop("checked", !!settings.wrapperIframe).on("change", async function () {
            if (!isXiaobaixEnabled) return;
            settings.wrapperIframe = $(this).prop("checked");
            saveSettingsDebounced();
            try {
                settings.wrapperIframe
                    ? (!document.getElementById('xb-callgen') && document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` })))
                    : (window.cleanupCallGenerateHostBridge && window.cleanupCallGenerateHostBridge(), document.getElementById('xb-callgen')?.remove());
            } catch (e) { }
        });

        $("#xiaobaix_render_enabled").prop("checked", settings.renderEnabled !== false).on("change", async function () {
            if (!isXiaobaixEnabled) return;
            const wasEnabled = settings.renderEnabled !== false;
            settings.renderEnabled = $(this).prop("checked");
            saveSettingsDebounced();
            if (!settings.renderEnabled && wasEnabled) {
                cleanupRenderer();
            } else if (settings.renderEnabled && !wasEnabled) {
                initRenderer();
                setTimeout(() => processExistingMessages(), 100);
            }
        });

        const normalizeMaxRendered = (raw) => {
            let v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            if (v > 9999) v = 9999;
            return v;
        };

        $("#xiaobaix_max_rendered")
            .val(Number.isFinite(settings.maxRenderedMessages) ? settings.maxRenderedMessages : 5)
            .on("input change", function () {
                if (!isXiaobaixEnabled) return;
                const v = normalizeMaxRendered($(this).val());
                $(this).val(v);
                settings.maxRenderedMessages = v;
                saveSettingsDebounced();
                try { shrinkRenderedWindowFull(); } catch (e) { }
            });

        $(document).off('click.xbreset', '#xiaobaix_reset_btn').on('click.xbreset', '#xiaobaix_reset_btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const MAP = {
                storySummary: 'xiaobaix_story_summary_enabled',
                storyOutline: 'xiaobaix_story_outline_enabled',
                enaPlanner: 'xiaobaix_ena_planner_enabled'
            };
            const ON = ['storySummary'];
            const OFF = ['storyOutline', 'enaPlanner'];
            function setChecked(id, val) {
                const el = document.getElementById(id);
                if (el) {
                    el.checked = !!val;
                    try { $(el).trigger('change'); } catch { }
                }
            }
            ON.forEach(k => setChecked(MAP[k], true));
            OFF.forEach(k => setChecked(MAP[k], false));
            setChecked('xiaobaix_use_blob', false);
            setChecked('Wrapperiframe', true);
            try { saveSettingsDebounced(); } catch (e) { }
        });
    } catch (err) { }
}

function setupDebugButtonInSettings() {
    try {
        if (document.getElementById('xiaobaix-debug-btn')) return;
        const enableCheckbox = document.getElementById('xiaobaix_enabled');
        if (!enableCheckbox) {
            setTimeout(setupDebugButtonInSettings, 800);
            return;
        }
        const row = enableCheckbox.closest('.flex-container') || enableCheckbox.parentElement;
        if (!row) return;
        const actionGroup = row.querySelector('.littlewhitebox-top-actions') || row;

        const btn = document.createElement('div');
        btn.id = 'xiaobaix-debug-btn';
        btn.className = 'menu_button littlewhitebox-top-action-button';
        btn.title = '切换调试监控';
        btn.tabIndex = 0;
        btn.innerHTML = '<span class="dbg-light"></span><span>监控</span>';

        const onActivate = async () => {
            try {
                const mod = await import('./modules/debug-panel/debug-panel.js');
                if (mod?.toggleDebugPanel) await mod.toggleDebugPanel();
            } catch (e) { }
        };
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onActivate(); });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onActivate(); }
        });

        actionGroup.appendChild(btn);
    } catch (e) { }
}

function setupMenuTabs() {
    $(document).on('click', '.menu-tab', function () {
        const targetId = $(this).attr('data-target');
        $('.menu-tab').removeClass('active');
        $('.settings-section').hide();
        $(this).addClass('active');
        $('.' + targetId).show();
    });
    setTimeout(() => {
        $('.js-memory').show();
        $('.task, .instructions').hide();
        $('.menu-tab[data-target="js-memory"]').addClass('active');
        $('.menu-tab[data-target="task"], .menu-tab[data-target="instructions"]').removeClass('active');
    }, 300);
}

window.processExistingMessages = processExistingMessages;
window.renderHtmlInIframe = renderHtmlInIframe;
window.registerModuleCleanup = registerModuleCleanup;
window.updateLittleWhiteBoxExtension = updateLittleWhiteBoxExtension;
window.removeAllUpdateNotices = removeAllUpdateNotices;

jQuery(async () => {
    try {
        cleanupDeprecatedData();
        isXiaobaixEnabled = settings.enabled;
        window.isXiaobaixEnabled = isXiaobaixEnabled;

        if (!document.getElementById('xiaobaix-skeleton-style')) {
            const skelStyle = document.createElement('style');
            skelStyle.id = 'xiaobaix-skeleton-style';
            skelStyle.textContent = `.xiaobaix-iframe-wrapper{position:relative}`;
            document.head.appendChild(skelStyle);
        }

        const response = await fetch(`${extensionFolderPath}/style.css`);
        const styleElement = document.createElement('style');
        styleElement.textContent = await response.text();
        document.head.appendChild(styleElement);

        await setupSettings();

        if (isXiaobaixEnabled) {
            initRenderer();
        }

        try {
            if (isXiaobaixEnabled && settings.wrapperIframe && !document.getElementById('xb-callgen'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` }));
        } catch (e) { }

        try {
            if (isXiaobaixEnabled && !document.getElementById('xb-worldbook'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-worldbook', type: 'module', src: `${extensionFolderPath}/bridges/worldbook-bridge.js` }));
        } catch (e) { }

        try {
            if (isXiaobaixEnabled && !document.getElementById('xb-contextbridge'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-contextbridge', type: 'module', src: `${extensionFolderPath}/bridges/context-bridge.js` }));
        } catch (e) { }

        eventSource.on(event_types.APP_READY, () => {
            setTimeout(performExtensionUpdateCheck, 2000);
        });

        if (isXiaobaixEnabled) {
            try { initVarCommands(); } catch (e) { }

            const moduleInits = [
                { condition: settings.vectors?.enabled, init: initVectors },
                { condition: settings.director?.enabled, init: initDirector },
                { condition: settings.enaPlanner?.enabled, init: initEnaPlanner },
                { condition: true, init: initStreamingGeneration },
                { condition: true, init: initButtonCollapse }
            ];
            moduleInits.forEach(({ condition, init }) => { if (condition) init(); });
        }

        setTimeout(setupMenuTabs, 500);

        setInterval(() => {
            if (isXiaobaixEnabled) processExistingMessages();
        }, 30000);
    } catch (err) { }
});

export { executeSlashCommand };
