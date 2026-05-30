import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureExperienceState } from '../services/directorStateService.js';

const mainJsPath = path.resolve('modules/director/txtToWorldbook/main.js');

test('ensureExperienceState keeps the Task 7 director-owned experience slice', () => {
    const AppState = {
        experience: {
            chapterOutline: 'existing outline',
            chapterScript: { beats: [{ id: 'b1' }] },
            currentBeatIndex: 3,
        },
        settings: {
            directorMode: 'api',
        },
    };

    const experience = ensureExperienceState(AppState, 0);

    assert.equal(experience.chapterOutline, 'existing outline');
    assert.deepEqual(experience.chapterScript, { beats: [{ id: 'b1' }] });
    assert.equal(experience.currentBeatIndex, 3);
    assert.equal(AppState.settings.directorMode, 'api');
});

test('main.js still exposes director runtime entry points', () => {
    const source = fs.readFileSync(mainJsPath, 'utf8');
    const requiredNames = [
        'createDirectorService',
        'createDirectorTelemetryService',
        'createChapterExperienceView',
        'splitContentIntoMemory',
        'runDirectorBeforeGeneration',
        'prepareDirectorInjectionForGeneration',
        'getDirectorPromptForLittleWhiteBox',
        'getReadingProgressStatus',
    ];

    for (const name of requiredNames) {
        assert.equal(
            source.includes(name),
            true,
            `expected main.js to keep referencing ${name}`,
        );
    }
});

test('main.js no longer wires worldbook and dedup runtime features', () => {
    const source = fs.readFileSync(mainJsPath, 'utf8');
    const removedNames = [
        'createFeatureServices',
        'createFeatureServicesConfig',
        'createFeatureBindings',
        'createWorldbookViewRuntime',
    ];

    for (const name of removedNames) {
        assert.equal(
            source.includes(name),
            false,
            `expected main.js to stop referencing ${name}`,
        );
    }
});
