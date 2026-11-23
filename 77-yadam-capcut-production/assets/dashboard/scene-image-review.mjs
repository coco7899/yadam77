import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const affectedStages = [8, 9, 10];
const productionStages = [6, 7, ...affectedStages];
const sceneImageName = /^(SC\d{3})(?=[_.-])[^/]*\.(?:jpe?g|png|webp)$/i;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function existingDirectory(directory) {
    try {
        const stat = fs.lstatSync(directory);
        return stat.isDirectory() && !stat.isSymbolicLink();
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
        throw error;
    }
}

function originalHashes(sceneDirectory, topic) {
    const plans = path.join(sceneDirectory, '제작자료');
    if (!existingDirectory(plans)) return null;
    const available = fs.readdirSync(plans, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.endsWith('_이미지연결표.json'));
    const selected = available.find(entry => entry.name === `${topic}_이미지연결표.json`)
        ?? (available.length === 1 ? available[0] : null);
    if (!selected) return null;
    const {scenes} = readJson(path.join(plans, selected.name));
    if (!Array.isArray(scenes)) return null;
    const hashes = {};
    for (const scene of scenes) {
        if (/^SC\d{3}$/.test(scene.scene) && /^[a-f\d]{64}$/i.test(scene.sha256)) {
            (hashes[scene.scene] ??= []).push(scene.sha256.toLowerCase());
        }
    }
    return Object.keys(hashes).length ? hashes : null;
}

function saveRecord(file, record) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
        fs.renameSync(temp, file);
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

function isImage(bytes) {
    return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
}

export function createSceneImageReview({allowedRoot}) {
    let cachedDirectory;
    const cache = new Map();

    function scan(directory) {
        if (cachedDirectory !== directory) {
            cache.clear();
            cachedDirectory = directory;
        }
        const hashes = {};
        const scanned = new Set();
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const match = sceneImageName.exec(entry.name);
            if (!entry.isFile() || !match) continue;
            const file = path.join(directory, entry.name);
            try {
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.size === 0) continue;
                scanned.add(entry.name);
                const stamp = [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
                let result = cache.get(entry.name);
                if (result?.stamp !== stamp) {
                    const bytes = fs.readFileSync(file);
                    const after = fs.lstatSync(file);
                    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) continue;
                    result = {stamp, hash: isImage(bytes) ? createHash('sha256').update(bytes).digest('hex') : null};
                    cache.set(entry.name, result);
                }
                if (result.hash) (hashes[match[1].toUpperCase()] ??= new Set()).add(result.hash);
            } catch (error) {
                if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
            }
        }
        for (const name of cache.keys()) if (!scanned.has(name)) cache.delete(name);
        return hashes;
    }

    return function review(stateDirectory, current, steps, choice) {
        if (!current.projectPath || !existingDirectory(allowedRoot)) return {};
        const requested = path.resolve(current.projectPath);
        const allowed = fs.realpathSync(allowedRoot);
        if (!isInside(allowed, requested) || !existingDirectory(requested)) return {};
        const project = fs.realpathSync(requested);
        if (!isInside(allowed, project) || path.relative(requested, project) !== '') return {};
        const imageDirectory = path.join(project, '이미지폴더');
        const sceneDirectory = path.join(imageDirectory, '장면');
        if (!existingDirectory(imageDirectory) || !existingDirectory(sceneDirectory)) return {};
        const recordFile = path.join(stateDirectory, 'scene-image-review.json');
        let record;
        try {
            record = readJson(recordFile);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (record?.project !== project) record = null;
        const trackedStages = affectedStages.filter(stage => steps[stage]?.state === 'completed' || steps[stage]?.reviewedImageRevision);
        if (!record && !trackedStages.length) return {};

        const active = record?.active ?? null;
        const reviewing = active && affectedStages.some(stage => steps[stage]?.reviewedImageRevision !== active.revision);
        const readyForDecision = !reviewing && productionStages.every(stage => steps[stage]?.state === 'completed');
        const observed = scan(sceneDirectory);
        const known = record?.known ?? originalHashes(sceneDirectory, current.topic);
        const seen = {...known};
        const changedScenes = [];
        let inventoryChanged = false;
        for (const [scene, hashes] of Object.entries(observed)) {
            const prior = new Set(known?.[scene]);
            if (prior.size !== hashes.size || [...hashes].some(hash => !prior.has(hash))) inventoryChanged = true;
            if (known && [...hashes].some(hash => !prior.has(hash))) changedScenes.push(scene);
            seen[scene] = [...hashes].sort();
        }
        const linked = readyForDecision && changedScenes.length ? originalHashes(sceneDirectory, current.topic) : null;
        const promptScenes = readyForDecision ? changedScenes.filter(scene => {
            const prior = new Set(known?.[scene]);
            const matched = new Set(linked?.[scene]);
            return [...observed[scene]].some(hash => !prior.has(hash) && !matched.has(hash));
        }) : [];
        if (promptScenes.length) {
            record = {
                project,
                known: seen,
                revision: randomUUID(),
                receivedAt: new Date().toISOString(),
                changedScenes: [...new Set([
                    ...(record?.revision && !record.decision ? record.changedScenes : []),
                    ...promptScenes
                ])].sort(),
                decision: null,
                active: record?.active ?? null
            };
            saveRecord(recordFile, record);
        } else if (reviewing && changedScenes.length) {
            record = {...record, known: seen, active: {
                revision: randomUUID(),
                receivedAt: new Date().toISOString(),
                scenes: [...new Set([...active.scenes, ...changedScenes])].sort()
            }};
            saveRecord(recordFile, record);
        } else if (!record || inventoryChanged || (!readyForDecision && record.revision && !record.decision)) {
            record = {project, revision: null, receivedAt: null, changedScenes: [], ...record, known: seen};
            if (!readyForDecision && !record.decision) {
                record.revision = null;
                record.receivedAt = null;
                record.changedScenes = [];
            }
            saveRecord(recordFile, record);
        }
        if (!record.revision) return {};
        if (choice) {
            if (choice.revision !== record.revision) throw new Error('새 장면 이미지가 추가됐어요. 최신 안내에서 다시 선택해 주세요.');
            if (!['restart', 'keep'].includes(choice.decision)) throw new Error('다시 진행 또는 기존 결과 유지를 선택해 주세요.');
            if (record.decision && record.decision !== choice.decision) throw new Error('이미 이 변경에 대한 선택을 저장했어요.');
            if (!record.decision) {
                if (!readyForDecision) throw new Error('본편 이미지 작업이 진행 중이에요.');
                record.decision = choice.decision;
                if (choice.decision === 'restart') {
                    const pendingPrior = record.active && affectedStages.some(stage => steps[stage]?.reviewedImageRevision !== record.active.revision);
                    record.active = {
                        revision: record.revision,
                        receivedAt: record.receivedAt,
                        scenes: [...new Set([...(pendingPrior ? record.active.scenes : []), ...record.changedScenes])].sort()
                    };
                }
                saveRecord(recordFile, record);
            }
        }
        const selected = record.active;
        return {
            revision: selected?.revision,
            receivedAt: selected?.receivedAt,
            scenes: selected?.scenes,
            required: selected ? affectedStages.filter(stage => steps[stage]?.reviewedImageRevision !== selected.revision) : [],
            pending: !readyForDecision || record.decision ? null : {revision: record.revision, scenes: record.changedScenes},
            decision: record.decision
        };
    };
}
