import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPresetEntryPrompt,
    ensurePresetEntry,
    setPresetEntryContent,
    clearPresetEntryContent,
    getPresetEntryStatus,
} from './preset-entry-registry.js';

function createPromptManager() {
    const activeCharacter = { id: 'char-a' };
    const serviceSettings = {
        prompts: [{ identifier: 'chatHistory', name: 'Chat History' }],
        prompt_order: [{
            character_id: 'char-a',
            order: [{ identifier: 'chatHistory', enabled: true }],
        }],
    };
    return {
        activeCharacter,
        serviceSettings,
        getPromptOrderForCharacter(character) {
            return serviceSettings.prompt_order.find((entry) => entry.character_id === character.id)?.order || [];
        },
        getPromptOrderEntry(character, identifier) {
            return this.getPromptOrderForCharacter(character).find((entry) => entry.identifier === identifier) || null;
        },
    };
}

test('createPresetEntryPrompt creates an extension prompt entry', () => {
    const prompt = createPresetEntryPrompt({
        identifier: 'vectorsResults',
        name: 'Vectors Results',
        role: 'system',
        content: 'hello',
    });

    assert.equal(prompt.identifier, 'vectorsResults');
    assert.equal(prompt.name, 'Vectors Results');
    assert.equal(prompt.role, 'system');
    assert.equal(prompt.content, 'hello');
    assert.equal(prompt.extension, true);
    assert.equal(prompt.injection_position, 0);
});

test('ensurePresetEntry creates prompt and prompt_order reference after chatHistory', () => {
    const promptManager = createPromptManager();
    const result = ensurePresetEntry(promptManager, {
        identifier: 'vectorsResults',
        name: 'Vectors Results',
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(promptManager.serviceSettings.prompts.some((prompt) => prompt.identifier === 'vectorsResults'), true);
    assert.deepEqual(promptManager.serviceSettings.prompt_order[0].order.map((entry) => entry.identifier), [
        'chatHistory',
        'vectorsResults',
    ]);
});

test('ensurePresetEntry reuses an existing empty active order list', () => {
    const promptManager = createPromptManager();
    promptManager.serviceSettings.prompt_order = [{
        character_id: 'char-a',
        order: [],
    }];
    promptManager.getPromptOrderForCharacter = () => [];
    promptManager.getPromptOrderEntry = () => null;

    const result = ensurePresetEntry(promptManager, {
        identifier: 'vectorsResults',
        name: 'Vectors Results',
    });

    assert.equal(result.ok, true);
    assert.equal(promptManager.serviceSettings.prompt_order.length, 1);
    assert.deepEqual(promptManager.serviceSettings.prompt_order[0].order.map((entry) => entry.identifier), [
        'vectorsResults',
    ]);
});

test('setPresetEntryContent updates content without duplicating order entries', () => {
    const promptManager = createPromptManager();

    setPresetEntryContent(promptManager, 'first', {
        identifier: 'vectorsResults',
        name: 'Vectors Results',
    });
    const result = setPresetEntryContent(promptManager, 'second', {
        identifier: 'vectorsResults',
        name: 'Vectors Results',
    });

    const order = promptManager.serviceSettings.prompt_order[0].order;
    assert.equal(result.ok, true);
    assert.equal(result.contentLength, 'second'.length);
    assert.equal(promptManager.serviceSettings.prompts.find((prompt) => prompt.identifier === 'vectorsResults').content, 'second');
    assert.equal(order.filter((entry) => entry.identifier === 'vectorsResults').length, 1);
});

test('clearPresetEntryContent empties content and reports reason', () => {
    const promptManager = createPromptManager();
    setPresetEntryContent(promptManager, 'text', {
        identifier: 'westworldDirector',
        name: 'WestWorld Director',
    });

    const result = clearPresetEntryContent(promptManager, 'no-results', {
        identifier: 'westworldDirector',
        name: 'WestWorld Director',
    });

    assert.equal(result.ok, true);
    assert.equal(result.cleared, true);
    assert.equal(result.reason, 'no-results');
    assert.equal(promptManager.serviceSettings.prompts.find((prompt) => prompt.identifier === 'westworldDirector').content, '');
});

test('ensurePresetEntry repairs absolute injection fields on existing prompts', () => {
    const promptManager = createPromptManager();
    promptManager.serviceSettings.prompts.push({
        identifier: 'westworldDirector',
        name: 'WestWorld Director',
        role: 'system',
        content: 'existing',
        system_prompt: false,
        position: 0,
        injection_position: 1,
        injection_trigger: [],
        forbid_overrides: false,
        extension: true,
    });

    const result = ensurePresetEntry(promptManager, {
        identifier: 'westworldDirector',
        name: 'WestWorld Director',
        injectionPosition: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.prompt.injection_position, 1);
    assert.equal(result.prompt.injection_depth, 4);
    assert.equal(result.prompt.injection_order, 100);
});

test('getPresetEntryStatus reports missing and ready entries', () => {
    const promptManager = createPromptManager();

    assert.deepEqual(getPresetEntryStatus(promptManager, { identifier: 'vectorsResults' }), {
        ok: true,
        exists: false,
        activeEnabled: false,
        contentLength: 0,
        orderCount: 1,
    });

    setPresetEntryContent(promptManager, 'abc', {
        identifier: 'vectorsResults',
        name: 'Vectors Results',
    });

    assert.deepEqual(getPresetEntryStatus(promptManager, { identifier: 'vectorsResults' }), {
        ok: true,
        exists: true,
        activeEnabled: true,
        contentLength: 3,
        orderCount: 1,
    });
});
