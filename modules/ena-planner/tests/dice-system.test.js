import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    DICE_PROMPT_BLOCK_ID,
    DICE_PROMPT_BLOCK_NAME,
    buildDiceTurnContext,
    buildFinalInputWithDiceFallback,
    createDefaultDicePromptBlock,
    ensureDicePromptModule,
    normalizeDiceSystemSettings,
} from '../ena-planner-dice.js';

test('dice settings are independently disabled unless explicitly enabled', () => {
    assert.deepEqual(normalizeDiceSystemSettings(undefined), { enabled: false });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: 1 }), { enabled: false });
});

test('default protected block retains approved colon roll macros and identity', () => {
    const block = createDefaultDicePromptBlock();
    assert.equal(block.id, DICE_PROMPT_BLOCK_ID);
    assert.equal(block.name, DICE_PROMPT_BLOCK_NAME);
    assert.equal(block.role, 'system');
    assert.equal((block.content.match(/{{roll:1d20}}/g) || []).length, 10);
});

test('normalization inserts exactly one protected block and preserves edited content/order', () => {
    const migrated = ensureDicePromptModule(
        [{ id: 'system', role: 'system', name: 'Base', content: 'base' }],
        [
            { kind: 'promptBlock', blockId: 'system', enabled: true },
            { kind: 'builtin', key: 'charCard', enabled: true },
        ],
    );
    assert.equal(migrated.moduleChain[1].blockId, DICE_PROMPT_BLOCK_ID);

    const edited = ensureDicePromptModule(
        [{ id: DICE_PROMPT_BLOCK_ID, role: 'user', name: 'changed', content: 'edited' }],
        [{ kind: 'promptBlock', blockId: DICE_PROMPT_BLOCK_ID, enabled: false }],
    );
    assert.deepEqual(edited.promptBlocks, [{
        id: DICE_PROMPT_BLOCK_ID,
        role: 'system',
        name: DICE_PROMPT_BLOCK_NAME,
        content: 'edited',
    }]);
    assert.equal(edited.moduleChain[0].enabled, true);
});

test('disabled dice skip render while enabled dice render once and share the resolved pool', async () => {
    let renderCalls = 0;
    const render = async source => {
        renderCalls += 1;
        return source.replace(/{{roll:1d20}}/g, '17');
    };
    assert.deepEqual(
        await buildDiceTurnContext({ enabled: false }, '{{roll:1d20}}', render),
        { plannerPrompt: '', fallbackPrompt: '' },
    );
    const context = await buildDiceTurnContext(
        { enabled: true },
        'D20: [{{roll:1d20}}]',
        render,
    );
    assert.equal(renderCalls, 1);
    assert.match(context.plannerPrompt, /D20: \[17\]/);
    assert.match(context.fallbackPrompt, /D20: \[17\]/);
    assert.doesNotMatch(context.fallbackPrompt, /{{roll:/);
});

test('final input appends cached dice only when planning output is unusable', () => {
    const fallback = '<dice>D20: [17]</dice>';
    assert.equal(
        buildFinalInputWithDiceFallback('attack', '<plot>hit</plot>', fallback),
        'attack\n\n<plot>hit</plot>',
    );
    assert.equal(
        buildFinalInputWithDiceFallback('attack', ' \n ', fallback),
        'attack\n\n<dice>D20: [17]</dice>',
    );
    assert.equal(buildFinalInputWithDiceFallback('attack', '', ''), 'attack');
});

test('default presets and runtime normalize the protected dice module and independent switch', async () => {
    const presets = await readFile(new URL('../ena-planner-presets.js', import.meta.url), 'utf8');
    const runtime = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');

    assert.match(presets, /createDefaultDicePromptBlock/);
    assert.match(presets, /DEFAULT_PROMPT_BLOCKS[\s\S]*createDefaultDicePromptBlock\(\)/);
    assert.match(runtime, /normalizeDiceSystemSettings/);
    assert.match(runtime, /diceSystem:\s*\{\s*enabled:\s*false,?\s*\}/);
    assert.match(runtime, /ensureDicePromptModule/);
    assert.match(runtime, /s\.promptTemplates\s*=\s*normalizePromptTemplates/);
});

test('planner runtime resolves dice while visiting module order and keeps cached fallback through API failure', async () => {
    const source = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');
    const builderStart = source.indexOf('async function buildPlannerMessages');
    const chainLoop = source.indexOf('for (const module of s.moduleChain || [])', builderStart);
    const diceBuild = source.indexOf('buildDiceTurnContext(', builderStart);

    assert.ok(builderStart >= 0);
    assert.ok(diceBuild > chainLoop, 'dice must resolve only at its module-chain position');
    assert.match(source, /meta:\s*\{[\s\S]*diceFallbackPrompt/);
    assert.match(source, /allowDiceFallbackOnError/);
    assert.match(source, /buildFinalInputWithDiceFallback\(\s*raw,\s*filtered,\s*diceFallbackPrompt\s*\)/s);
});

test('an unavailable planner output reuses its previously resolved pool without a second render', async () => {
    let renderCalls = 0;
    const context = await buildDiceTurnContext(
        { enabled: true },
        'D20: [{{roll:1d20}}]',
        async source => {
            renderCalls += 1;
            return source.replace('{{roll:1d20}}', '4');
        },
    );
    const releasedInput = buildFinalInputWithDiceFallback('attack', '', context.fallbackPrompt);
    assert.equal(renderCalls, 1);
    assert.match(releasedInput, /D20: \[4\]/);
    assert.doesNotMatch(releasedInput, /{{roll:/);
});

test('settings UI exposes the master switch and protects the dice prompt editor', async () => {
    const html = await readFile(new URL('../ena-planner.html', import.meta.url), 'utf8');
    assert.match(html, /id="ep_dice_system_enabled"/);
    assert.match(html, /DICE_PROMPT_BLOCK_ID\s*=\s*'ena-dice-system-001'/);
    assert.match(html, /isDicePromptBlock/);
    assert.match(html, /由基本设置中的骰子系统开关控制/);
    assert.match(html, /p\.diceSystem\s*=\s*\{\s*enabled:/);
    assert.match(html, /预览.*生成独立骰池/);
});

test('api-bound jailbreak prompts save two texts and wrap the module chain', async () => {
    const runtime = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');
    const html = await readFile(new URL('../ena-planner.html', import.meta.url), 'utf8');

    assert.match(runtime, /jailbreakPrompts:\s*\{\}/);
    assert.match(runtime, /jailbreakPromptName:\s*''/);
    assert.match(runtime, /topText/);
    assert.match(runtime, /bottomText/);

    const builderStart = runtime.indexOf('async function buildPlannerMessages');
    const topInsert = runtime.indexOf("messages.push({ role: 'system', content: jailbreakTop });", builderStart);
    const chainLoop = runtime.indexOf('for (const module of s.moduleChain || [])', builderStart);
    const bottomInsert = runtime.indexOf("messages.push({ role: 'system', content: jailbreakBottom });", builderStart);

    assert.ok(builderStart >= 0);
    assert.ok(topInsert > builderStart && topInsert < chainLoop, 'top jailbreak text must be before module-chain messages');
    assert.ok(bottomInsert > chainLoop, 'bottom jailbreak text must be after module-chain messages');

    assert.match(html, /id="ep_api_jailbreak_select"/);
    assert.match(html, /id="ep_jailbreak_top"/);
    assert.match(html, /id="ep_jailbreak_bottom"/);
    assert.match(html, /p\.jailbreakPrompts\s*=/);
    assert.match(html, /jailbreakPromptName:\s*\$\('ep_api_jailbreak_select'\)/);
});
