import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const deletedPaths = [
    'modules/assistant',
    'modules/scheduled-tasks',
    'modules/message-preview.js',
    'modules/immersive-mode.js',
    'modules/template-editor',
    'modules/fourth-wall',
    'modules/control-audio.js',
    'modules/novel-draw',
    'modules/tts',
    'modules/variables/variables-panel.js',
    'modules/variables/varevent-editor.js',
    'modules/variables/state2',
    'modules/variables/variables-core.js',
    'scripts/build-assistant-file-manifest.mjs',
    'scripts/build-assistant-jsapi-manifest.mjs',
    'scripts/build-assistant-jsapi-runtime.mjs',
    'vite.assistant.config.mjs',
];

test('non-kept modules and assistant build files are absent', () => {
    for (const relativePath of deletedPaths) {
        assert.equal(
            fs.existsSync(path.resolve(relativePath)),
            false,
            `expected ${relativePath} to be removed`,
        );
    }
});

test('package.json no longer exposes assistant build or test scripts', () => {
    const source = fs.readFileSync(path.resolve('package.json'), 'utf8');
    const disallowedSnippets = [
        'build:assistant',
        'build:assistant:manifest',
        'build:assistant:jsapi-manifest',
        'build:assistant:jsapi-runtime',
        'build:assistant:app',
        'test:assistant:workspace',
    ];

    for (const snippet of disallowedSnippets) {
        assert.equal(source.includes(snippet), false, `expected package.json to drop ${snippet}`);
    }
});

test('style.css and wrapper-inline.js no longer mention removed module names', () => {
    const styleSource = fs.readFileSync(path.resolve('style.css'), 'utf8');
    const wrapperInlineSource = fs.readFileSync(path.resolve('core/wrapper-inline.js'), 'utf8');

    for (const snippet of ['scheduled-tasks', 'message-preview', 'immersive-mode']) {
        assert.equal(styleSource.includes(snippet), false, `expected style.css to drop ${snippet}`);
    }

    assert.equal(
        wrapperInlineSource.includes('template-editor'),
        false,
        'expected wrapper-inline.js to drop template-editor note',
    );
});
