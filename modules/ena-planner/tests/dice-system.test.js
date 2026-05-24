import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as diceSystem from '../ena-planner-dice.js';

const {
    DICE_PROMPT_BLOCK_ID,
    DICE_PROMPT_BLOCK_NAME,
    buildDiceTurnContext,
    buildFinalInputWithDiceFallback,
    createDefaultDicePromptBlock,
    ensureDicePromptModule,
    normalizeDiceSystemSettings,
} = diceSystem;

test('dice prompt module API is available for ordered editable prompts', () => {
    assert.equal(typeof DICE_PROMPT_BLOCK_ID, 'string');
    assert.equal(typeof createDefaultDicePromptBlock, 'function');
    assert.equal(typeof ensureDicePromptModule, 'function');
});

test('normalizeDiceSystemSettings defaults to disabled and normalizes enabled values', () => {
    assert.deepEqual(normalizeDiceSystemSettings(undefined), { enabled: false });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: 0 }), { enabled: false });
});

test('buildDiceTurnContext skips macro rendering when disabled or the module content is blank', async () => {
    let renderCalls = 0;
    const render = async () => {
        renderCalls += 1;
        return 'unexpected';
    };

    assert.deepEqual(
        await buildDiceTurnContext({ enabled: false }, '{{roll 1d20}}', render),
        { plannerPrompt: '', fallbackPrompt: '' },
    );
    assert.deepEqual(
        await buildDiceTurnContext({ enabled: true }, ' \n ', render),
        { plannerPrompt: '', fallbackPrompt: '' },
    );
    assert.equal(renderCalls, 0);
});

test('buildDiceTurnContext renders editable module content once and shares its result with fallback', async () => {
    let renderCalls = 0;
    let roll = 0;
    const context = await buildDiceTurnContext(
        { enabled: true },
        '<custom_rules>D20: [{{roll 1d20}}, {{roll 1d20}}]</custom_rules>',
        async (template) => {
            renderCalls += 1;
            assert.match(template, /custom_rules/);
            assert.match(template, /{{roll 1d20}}/);
            return template.replace(/{{roll 1d20}}/g, () => (++roll === 1 ? '13' : '7'));
        },
    );

    assert.equal(renderCalls, 1);
    assert.match(context.plannerPrompt, /<custom_rules>D20: \[13, 7\]<\/custom_rules>/);
    assert.match(context.fallbackPrompt, /<custom_rules>D20: \[13, 7\]<\/custom_rules>/);
    assert.doesNotMatch(context.fallbackPrompt, /{{roll /);
});

test('default dice prompt block contains portable roll macros and fixed module identity', () => {
    const block = createDefaultDicePromptBlock();

    assert.equal(block.id, DICE_PROMPT_BLOCK_ID);
    assert.equal(block.name, DICE_PROMPT_BLOCK_NAME);
    assert.equal(block.role, 'system');
    assert.match(block.content, /{{roll 1d20}}/);
    assert.doesNotMatch(block.content, /{{roll:/);
});

test('ensureDicePromptModule migrates a missing module before context and preserves edited content', () => {
    const migrated = ensureDicePromptModule(
        [{ id: 'system', role: 'system', name: 'system', content: 'base' }],
        [
            { kind: 'promptBlock', blockId: 'system', enabled: true },
            { kind: 'builtin', key: 'charCard', enabled: true },
        ],
    );

    assert.equal(migrated.promptBlocks.at(-1).id, DICE_PROMPT_BLOCK_ID);
    assert.equal(migrated.moduleChain[1].blockId, DICE_PROMPT_BLOCK_ID);

    const edited = ensureDicePromptModule(
        [{ id: DICE_PROMPT_BLOCK_ID, role: 'user', name: 'renamed', content: 'edited rules' }],
        [{ kind: 'promptBlock', blockId: DICE_PROMPT_BLOCK_ID, enabled: false }],
    );
    const repeated = ensureDicePromptModule(edited.promptBlocks, edited.moduleChain);

    assert.deepEqual(edited.promptBlocks, [{
        id: DICE_PROMPT_BLOCK_ID,
        role: 'system',
        name: DICE_PROMPT_BLOCK_NAME,
        content: 'edited rules',
    }]);
    assert.equal(edited.moduleChain[0].enabled, true);
    assert.equal(repeated.promptBlocks.filter(block => block.id === DICE_PROMPT_BLOCK_ID).length, 1);
    assert.equal(repeated.moduleChain.filter(module => module.blockId === DICE_PROMPT_BLOCK_ID).length, 1);
});

test('buildFinalInputWithDiceFallback only appends resolved fallback content for empty planning output', () => {
    const fallback = '<fallback>\nD20: [12]\n</fallback>';

    assert.equal(
        buildFinalInputWithDiceFallback('attack', '<plot>hit</plot>', fallback),
        'attack\n\n<plot>hit</plot>',
    );
    assert.equal(
        buildFinalInputWithDiceFallback('attack', ' \n ', fallback),
        'attack\n\n<fallback>\nD20: [12]\n</fallback>',
    );
    assert.equal(buildFinalInputWithDiceFallback('attack', '', ''), 'attack');
});

test('ena planner creates dice context while visiting its prompt module in the ordered chain', async () => {
    const source = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');

    assert.match(source, /DICE_PROMPT_BLOCK_ID/);
    assert.match(source, /ensureDicePromptModule/);
    assert.match(source, /block\.id === DICE_PROMPT_BLOCK_ID/);
    assert.match(source, /buildDiceTurnContext\(\s*s\.diceSystem,\s*block\.content/s);
    const builderStart = source.indexOf('async function buildPlannerMessages');
    const chainLoop = source.indexOf('for (const module of s.moduleChain || [])', builderStart);
    const diceBuild = source.indexOf('buildDiceTurnContext(', builderStart);
    assert.ok(diceBuild > chainLoop, 'dice context must be built while visiting the ordered module chain');
    assert.match(source, /buildFinalInputWithDiceFallback/);
});

test('ena planner UI exposes one master switch and protects the editable ordered dice module', async () => {
    const html = await readFile(new URL('../ena-planner.html', import.meta.url), 'utf8');

    assert.match(html, /id="ep_dice_system_enabled"/);
    assert.match(html, /DICE_PROMPT_BLOCK_ID/);
    assert.match(html, /由基本设置开关控制/);
    assert.match(html, /isDicePromptBlock/);
    assert.match(html, /空回/);
});
