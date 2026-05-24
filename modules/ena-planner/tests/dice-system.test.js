import test from 'node:test';
import assert from 'node:assert/strict';

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
