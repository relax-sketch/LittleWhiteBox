import { hydrateSettingsFromState } from './settingsPanel.js';

export function createSettingsStateView(deps = {}) {
    const {
        AppState,
        handleUseTavernApiChange,
        handleProviderChange,
        renderMessageChainUI,
        renderPromptEditor,
    } = deps;

    function updateSettingsUI() {
        hydrateSettingsFromState({
            AppState,
            handleUseTavernApiChange,
            handleProviderChange,
            renderMessageChainUI,
        });
        if (typeof renderPromptEditor === 'function') {
            renderPromptEditor();
        }
    }

    function updateChapterRegexUI() {
        const regexInput = document.getElementById('ttw-chapter-regex');
        if (regexInput) {
            regexInput.value = AppState.config.chapterRegex.pattern;
        }
    }

    return {
        updateSettingsUI,
        updateChapterRegexUI,
    };
}
