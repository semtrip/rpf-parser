"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path_1 = require("path");
const readline_1 = require("readline");
const ask = (question) => new Promise((resolveAnswer) => {
    const rl = readline_1.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question(question, (answer) => {
        rl.close();
        resolveAnswer(answer.trim());
    });
});
const call = (command) => child_process_1.execSync(command, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 200 });
const getDirectoryEntries = (directoryPath) => fs_extra_1.readdirSync(directoryPath, { withFileTypes: true });
const parseArgs = () => {
    const args = process.argv.slice(2);
    let mode = 'all';
    let outDir = process.cwd();
    for (let i = 0; i < args.length; i += 1) {
        const currentArg = args[i];
        if (currentArg === '--mode' && args[i + 1]) {
            mode = args[i + 1].toLowerCase();
            i += 1;
            continue;
        }
        if (currentArg.startsWith('--mode=')) {
            mode = currentArg.split('=')[1].toLowerCase();
            continue;
        }
        if ((currentArg === '--out-dir' || currentArg === '--outDir') && args[i + 1]) {
            outDir = path_1.resolve(args[i + 1]);
            i += 1;
            continue;
        }
        if (currentArg.startsWith('--out-dir=')) {
            outDir = path_1.resolve(currentArg.split('=')[1]);
            continue;
        }
        if (currentArg.startsWith('--outDir=')) {
            outDir = path_1.resolve(currentArg.split('=')[1]);
        }
    }
    if (!['tree', 'stats', 'all'].includes(mode)) {
        throw new Error('Неверный --mode. Используйте: tree, stats или all.');
    }
    return { mode, outDir };
};
const findDlcRpfs = (rootDirectory) => {
    const found = [];
    const stack = [rootDirectory];
    while (stack.length > 0) {
        const currentDirectory = stack.pop();
        if (!currentDirectory) {
            continue;
        }
        const entries = getDirectoryEntries(currentDirectory);
        for (const entry of entries) {
            const fullPath = path_1.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.toLowerCase() === 'dlc.rpf') {
                found.push(fullPath);
            }
        }
    }
    return found;
};
const buildDirectoryTree = (directoryPath, prefix = '') => {
    const lines = [];
    const entries = getDirectoryEntries(directoryPath).sort((a, b) => a.name.localeCompare(b.name));
    entries.forEach((entry, index) => {
        const isLastEntry = index === entries.length - 1;
        const branch = isLastEntry ? '\\--' : '|--';
        const fullPath = path_1.join(directoryPath, entry.name);
        lines.push(`${prefix}${branch} ${entry.name}`);
        if (entry.isDirectory()) {
            const nextPrefix = `${prefix}${isLastEntry ? '   ' : '|  '}`;
            lines.push(...buildDirectoryTree(fullPath, nextPrefix));
        }
    });
    return lines;
};
const collectFileStats = (directoryPath) => {
    var _a;
    const statsMap = new Map();
    const stack = [directoryPath];
    while (stack.length > 0) {
        const currentDirectory = stack.pop();
        if (!currentDirectory) {
            continue;
        }
        const entries = getDirectoryEntries(currentDirectory);
        for (const entry of entries) {
            const fullPath = path_1.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            }
            else if (entry.isFile()) {
                const dotIndex = entry.name.lastIndexOf('.');
                const extension = dotIndex > -1 ? entry.name.substring(dotIndex + 1).toUpperCase() : 'NO_EXT';
                const currentCount = (_a = statsMap.get(extension)) !== null && _a !== void 0 ? _a : 0;
                statsMap.set(extension, currentCount + 1);
            }
        }
    }
    return statsMap;
};
const formatStats = (statsMap) => {
    const sortedStats = [...statsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sortedStats.map(([extension, count]) => `${extension}: ${count}`);
};
const buildTimestamp = () => {
    const now = new Date();
    const pad = (value) => value.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};
const getGtaUtilExePath = () => {
    const candidates = [
        path_1.resolve(__dirname, '..', 'utils', 'GTAUtil.exe'),
        path_1.resolve(__dirname, '..', '..', 'GTAUtil.exe'),
        path_1.resolve(process.cwd(), 'utils', 'GTAUtil.exe'),
        path_1.resolve(process.cwd(), '..', 'GTAUtil.exe')
    ];
    const found = candidates.find((candidatePath) => fs_extra_1.existsSync(candidatePath));
    if (!found) {
        throw new Error('GTAUtil.exe не найден. Убедитесь, что файл доступен рядом с проектом.');
    }
    return found;
};
(() => {
    (async () => {
        const config = parseArgs();
        const targetDirectory = await ask('Введите путь к каталогу, где искать dlc.rpf: ');
        if (!targetDirectory) {
            throw new Error('Путь к каталогу не может быть пустым.');
        }
        const absoluteTargetDirectory = path_1.resolve(targetDirectory);
        if (!fs_extra_1.existsSync(absoluteTargetDirectory)) {
            throw new Error(`Каталог не найден: ${absoluteTargetDirectory}`);
        }
        const dlcArchives = findDlcRpfs(absoluteTargetDirectory);
        if (dlcArchives.length === 0) {
            console.info('В указанном каталоге не найдено ни одного dlc.rpf.');
            return;
        }
        const gtaUtilExe = getGtaUtilExePath();
        console.info(`Найдено ${dlcArchives.length} архив(ов) dlc.rpf.`);
        const results = [];
        for (const archivePath of dlcArchives) {
            const tempExtractDirectory = fs_extra_1.mkdtempSync(path_1.join(os_1.tmpdir(), 'dlc-tree-'));
            try {
                console.info('');
                console.info(`Архив: ${archivePath}`);
                call(`"${gtaUtilExe}" extractarchive --input "${archivePath}" --output "${tempExtractDirectory}"`);
                const treeLines = [`\\-- ${path_1.basename(archivePath)}`, ...buildDirectoryTree(tempExtractDirectory, '   ')];
                const statsMap = collectFileStats(tempExtractDirectory);
                results.push({ archivePath, treeLines, statsMap });
            }
            finally {
                fs_extra_1.rmSync(tempExtractDirectory, { recursive: true, force: true });
            }
        }
        const treeReportLines = [];
        const statsReportLines = [];
        results.forEach((result, index) => {
            if (config.mode === 'tree' || config.mode === 'all') {
                treeReportLines.push(`Архив: ${result.archivePath}`);
                treeReportLines.push(...result.treeLines);
                if (index < results.length - 1) {
                    treeReportLines.push('');
                }
            }
            if (config.mode === 'stats' || config.mode === 'all') {
                statsReportLines.push(`Архив: ${result.archivePath}`);
                statsReportLines.push(...formatStats(result.statsMap));
                if (index < results.length - 1) {
                    statsReportLines.push('');
                }
            }
        });
        fs_extra_1.mkdirSync(config.outDir, { recursive: true });
        const timestamp = buildTimestamp();
        if (config.mode === 'tree' || config.mode === 'all') {
            const treeReport = treeReportLines.join('\n');
            const treeFilePath = path_1.join(config.outDir, `dlc-tree-${timestamp}.txt`);
            fs_extra_1.writeFileSync(treeFilePath, `${treeReport}\n`);
            console.info('');
            console.info('ДЕРЕВО РЕСУРСОВ:');
            console.info(treeReport);
            console.info(`Сохранено в файл: ${treeFilePath}`);
        }
        if (config.mode === 'stats' || config.mode === 'all') {
            const statsReport = statsReportLines.join('\n');
            const statsFilePath = path_1.join(config.outDir, `dlc-stats-${timestamp}.txt`);
            fs_extra_1.writeFileSync(statsFilePath, `${statsReport}\n`);
            console.info('');
            console.info('СТАТИСТИКА ПО ТИПАМ ФАЙЛОВ:');
            console.info(statsReport);
            console.info(`Сохранено в файл: ${statsFilePath}`);
        }
    })().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
})();
//# sourceMappingURL=listDlcTrees.js.map