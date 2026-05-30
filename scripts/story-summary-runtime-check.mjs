import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import 'fake-indexeddb/auto';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatId = `runtime-check-${Date.now()}`;
const runtimeCacheDir = path.join(rootDir, 'scripts', '.story-summary-runtime-cache');
const runtimeBundlePath = path.join(runtimeCacheDir, 'story-summary-runtime.bundle.mjs');

function float32ToBuffer(values) {
    const arr = new Float32Array(values);
    return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}

function runtimeAliasPlugin() {
    const replayDir = path.join(rootDir, 'scripts', 'story-summary-replay');
    const shimExtensions = path.join(replayDir, 'shims', 'extensions.js');
    const shimScript = path.join(replayDir, 'shims', 'script.js');
    const shimUtils = path.join(replayDir, 'shims', 'utils.js');

    return {
        name: 'story-summary-runtime-check-alias',
        setup(buildApi) {
            buildApi.onResolve({ filter: /extensions\.js$/ }, (args) => {
                if (!args.importer) return null;
                return { path: shimExtensions };
            });

            buildApi.onResolve({ filter: /script\.js$/ }, (args) => {
                if (!args.importer) return null;
                return { path: shimScript };
            });

            buildApi.onResolve({ filter: /utils\.js$/ }, (args) => {
                if (!args.importer.includes(`${path.sep}core${path.sep}server-storage.js`)) {
                    return null;
                }
                return { path: shimUtils };
            });
        },
    };
}

async function loadRuntimeModules() {
    await fs.mkdir(runtimeCacheDir, { recursive: true });

    await build({
        stdin: {
            contents: `
                export * from ${JSON.stringify(path.join(rootDir, 'modules', 'story-summary', 'data', 'db.js'))};
                export * from ${JSON.stringify(path.join(rootDir, 'modules', 'story-summary', 'vector', 'runtime', 'runtime.js'))};
            `,
            resolveDir: rootDir,
            sourcefile: 'story-summary-runtime-check-entry.mjs',
            loader: 'js',
        },
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: runtimeBundlePath,
        plugins: [runtimeAliasPlugin()],
    });

    return await import(`${pathToFileURL(runtimeBundlePath).href}?t=${Date.now()}`);
}

async function collectJsFiles(dir) {
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await collectJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

async function assertNoBusinessVectorCacheImports() {
    const files = await collectJsFiles(path.join(rootDir, 'modules', 'story-summary'));
    const offenders = [];
    for (const file of files) {
        if (file.endsWith(path.join('vector', 'storage', 'vector-cache.js'))) continue;
        const text = await fs.readFile(file, 'utf8');
        if (text.includes('vector-cache.js')) {
            offenders.push(path.relative(rootDir, file));
        }
    }
    return offenders;
}

async function main() {
    let clearRecallRuntime = null;
    let metaTable;
    let chunksTable;
    let chunkVectorsTable;
    let eventVectorsTable;
    let stateVectorsTable;
    let warmRecallRuntime;
    let scoreRecallRuntimeL1;
    let scoreRecallRuntimeAnchors;
    let scoreRecallRuntimeEvents;
    let getRecallRuntimeStats;

    try {
        ({
            metaTable,
            chunksTable,
            chunkVectorsTable,
            eventVectorsTable,
            stateVectorsTable,
            warmRecallRuntime,
            scoreRecallRuntimeL1,
            scoreRecallRuntimeAnchors,
            scoreRecallRuntimeEvents,
            getRecallRuntimeStats,
            clearRecallRuntime,
        } = await loadRuntimeModules());

        await Promise.all([
            metaTable.put({ chatId, fingerprint: 'runtime-check', lastChunkFloor: 2, updatedAt: Date.now() }),
            chunksTable.bulkPut([
                { chatId, chunkId: 'c-1-0', floor: 1, chunkIdx: 0, speaker: 'A', isUser: true, text: 'alpha memory', textHash: 'a' },
                { chatId, chunkId: 'c-1-1', floor: 1, chunkIdx: 1, speaker: 'B', isUser: false, text: 'beta memory', textHash: 'b' },
            ]),
            chunkVectorsTable.bulkPut([
                { chatId, chunkId: 'c-1-0', vector: float32ToBuffer([1, 0]), dims: 2, fingerprint: 'runtime-check' },
                { chatId, chunkId: 'c-1-1', vector: float32ToBuffer([0, 1]), dims: 2, fingerprint: 'runtime-check' },
            ]),
            eventVectorsTable.bulkPut([
                { chatId, eventId: 'evt-1', vector: float32ToBuffer([1, 0]), dims: 2, fingerprint: 'runtime-check' },
            ]),
            stateVectorsTable.bulkPut([
                { chatId, atomId: 'atom-1', floor: 1, vector: float32ToBuffer([1, 0]), rVector: float32ToBuffer([1, 0]), dims: 2, rDims: 2, fingerprint: 'runtime-check' },
            ]),
        ]);

        const warm = await warmRecallRuntime(chatId, { reason: 'runtime-check' });
        const l1 = await scoreRecallRuntimeL1(chatId, [1], [1, 0]);
        const anchors = await scoreRecallRuntimeAnchors(chatId, [1, 0]);
        const events = await scoreRecallRuntimeEvents(chatId, [1, 0]);
        const stats = getRecallRuntimeStats().find((item) => item.chatId === chatId) || getRecallRuntimeStats()[0] || {};
        const offenders = await assertNoBusinessVectorCacheImports();

        const l1Stats = l1._stats || {};
        const top = l1.get(1)?.[0] || null;

        const checks = [
            ['warm', !!warm?.ready],
            ['l1TopChunk', top?.chunkId === 'c-1-0'],
            ['l1DbFallback', Number(l1Stats.cacheFallbackDbTime || 0) === 0],
            ['anchorScore', anchors?.scores?.[0]?.atomId === 'atom-1'],
            ['eventScore', events?.scores?.[0]?.eventId === 'evt-1'],
            ['cacheOwner', ['worker', 'runtime-main'].includes(String(stats.owner || l1Stats.cacheOwner || ''))],
            ['noBusinessVectorCacheImports', offenders.length === 0],
        ];

        const failed = checks.filter(([, ok]) => !ok);
        const backend = stats.backend || l1Stats.backend || 'unknown';
        const cacheOwner = stats.owner || l1Stats.cacheOwner || 'unknown';
        const promptParity = top?.text === 'alpha memory' ? 'PASS' : 'FAIL';

        console.log('[story-summary-runtime]');
        console.log(`runtime backend=${backend}`);
        console.log(`warm result=${warm?.ready ? 'PASS' : 'FAIL'} status=${stats.status || 'unknown'}`);
        console.log(`L0/L1/L2 cache owner=${cacheOwner}`);
        console.log(`DB fallback count=${Number(l1Stats.cacheFallbackDbTime || 0) === 0 ? 0 : 1}`);
        console.log(`promptParity=${promptParity}`);
        console.log(`vectorCacheImports=${offenders.length ? `FAIL ${offenders.join(', ')}` : 'PASS'}`);
        console.log(`result=${failed.length ? 'FAIL' : 'PASS'}`);

        if (failed.length) {
            console.error('failed checks:');
            for (const [name] of failed) console.error(`- ${name}`);
            process.exitCode = 1;
        }
    } finally {
        if (clearRecallRuntime) {
            await clearRecallRuntime(chatId);
        }
        await fs.rm(runtimeCacheDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error('[story-summary-runtime] failed');
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
});
