/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable arrow-parens */
import { execSync } from 'child_process';
import { Dirent, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs-extra';
import { tmpdir } from 'os';
import { basename, join, resolve } from 'path';
import { createInterface } from 'readline';

type OutputMode = 'tree' | 'stats' | 'all';

interface IConfig {
  mode: OutputMode;
  outDir: string;
}

interface IArchiveResult {
  archivePath: string;
  treeLines: string[];
  statsMap: Map<string, number>;
}

const ask = (question: string): Promise<string> =>
  new Promise((resolveAnswer) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer.trim());
    });
  });

const call = (command: string) => execSync(command, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 200 });

const getDirectoryEntries = (directoryPath: string): Dirent[] => readdirSync(directoryPath, { withFileTypes: true });

const parseArgs = (): IConfig => {
  const args = process.argv.slice(2);
  let mode: OutputMode = 'all';
  let outDir = process.cwd();

  for (let i = 0; i < args.length; i += 1) {
    const currentArg = args[i];
    if (currentArg === '--mode' && args[i + 1]) {
      mode = args[i + 1].toLowerCase() as OutputMode;
      i += 1;
      continue;
    }

    if (currentArg.startsWith('--mode=')) {
      mode = currentArg.split('=')[1].toLowerCase() as OutputMode;
      continue;
    }

    if ((currentArg === '--out-dir' || currentArg === '--outDir') && args[i + 1]) {
      outDir = resolve(args[i + 1]);
      i += 1;
      continue;
    }

    if (currentArg.startsWith('--out-dir=')) {
      outDir = resolve(currentArg.split('=')[1]);
      continue;
    }

    if (currentArg.startsWith('--outDir=')) {
      outDir = resolve(currentArg.split('=')[1]);
    }
  }

  if (!['tree', 'stats', 'all'].includes(mode)) {
    throw new Error('Неверный --mode. Используйте: tree, stats или all.');
  }

  return { mode, outDir };
};

const findDlcRpfs = (rootDirectory: string): string[] => {
  const found: string[] = [];
  const stack: string[] = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = getDirectoryEntries(currentDirectory);
    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);
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

const buildDirectoryTree = (directoryPath: string, prefix = ''): string[] => {
  const lines: string[] = [];
  const entries = getDirectoryEntries(directoryPath).sort((a, b) => a.name.localeCompare(b.name));

  entries.forEach((entry, index) => {
    const isLastEntry = index === entries.length - 1;
    const branch = isLastEntry ? '\\--' : '|--';
    const fullPath = join(directoryPath, entry.name);
    lines.push(`${prefix}${branch} ${entry.name}`);

    if (entry.isDirectory()) {
      const nextPrefix = `${prefix}${isLastEntry ? '   ' : '|  '}`;
      lines.push(...buildDirectoryTree(fullPath, nextPrefix));
    }
  });

  return lines;
};

const collectFileStats = (directoryPath: string): Map<string, number> => {
  const statsMap = new Map<string, number>();
  const stack: string[] = [directoryPath];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = getDirectoryEntries(currentDirectory);
    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const dotIndex = entry.name.lastIndexOf('.');
        const extension = dotIndex > -1 ? entry.name.substring(dotIndex + 1).toUpperCase() : 'NO_EXT';
        const currentCount = statsMap.get(extension) ?? 0;
        statsMap.set(extension, currentCount + 1);
      }
    }
  }

  return statsMap;
};

const formatStats = (statsMap: Map<string, number>): string[] => {
  const sortedStats = [...statsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sortedStats.map(([extension, count]) => `${extension}: ${count}`);
};

const buildTimestamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const getGtaUtilExePath = () => {
  const candidates = [
    resolve(__dirname, '..', 'utils', 'GTAUtil.exe'),
    resolve(__dirname, '..', '..', 'GTAUtil.exe'),
    resolve(process.cwd(), 'utils', 'GTAUtil.exe'),
    resolve(process.cwd(), '..', 'GTAUtil.exe')
  ];

  const found = candidates.find((candidatePath) => existsSync(candidatePath));
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

    const absoluteTargetDirectory = resolve(targetDirectory);
    if (!existsSync(absoluteTargetDirectory)) {
      throw new Error(`Каталог не найден: ${absoluteTargetDirectory}`);
    }

    const dlcArchives = findDlcRpfs(absoluteTargetDirectory);
    if (dlcArchives.length === 0) {
      console.info('В указанном каталоге не найдено ни одного dlc.rpf.');
      return;
    }

    const gtaUtilExe = getGtaUtilExePath();
    console.info(`Найдено ${dlcArchives.length} архив(ов) dlc.rpf.`);
    const results: IArchiveResult[] = [];

    for (const archivePath of dlcArchives) {
      const tempExtractDirectory = mkdtempSync(join(tmpdir(), 'dlc-tree-'));
      try {
        console.info('');
        console.info(`Архив: ${archivePath}`);
        call(`"${gtaUtilExe}" extractarchive --input "${archivePath}" --output "${tempExtractDirectory}"`);
        const treeLines = [`\\-- ${basename(archivePath)}`, ...buildDirectoryTree(tempExtractDirectory, '   ')];
        const statsMap = collectFileStats(tempExtractDirectory);
        results.push({ archivePath, treeLines, statsMap });
      } finally {
        rmSync(tempExtractDirectory, { recursive: true, force: true });
      }
    }

    const treeReportLines: string[] = [];
    const statsReportLines: string[] = [];

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

    mkdirSync(config.outDir, { recursive: true });
    const timestamp = buildTimestamp();

    if (config.mode === 'tree' || config.mode === 'all') {
      const treeReport = treeReportLines.join('\n');
      const treeFilePath = join(config.outDir, `dlc-tree-${timestamp}.txt`);
      writeFileSync(treeFilePath, `${treeReport}\n`);
      console.info('');
      console.info('ДЕРЕВО РЕСУРСОВ:');
      console.info(treeReport);
      console.info(`Сохранено в файл: ${treeFilePath}`);
    }

    if (config.mode === 'stats' || config.mode === 'all') {
      const statsReport = statsReportLines.join('\n');
      const statsFilePath = join(config.outDir, `dlc-stats-${timestamp}.txt`);
      writeFileSync(statsFilePath, `${statsReport}\n`);
      console.info('');
      console.info('СТАТИСТИКА ПО ТИПАМ ФАЙЛОВ:');
      console.info(statsReport);
      console.info(`Сохранено в файл: ${statsFilePath}`);
    }
  })().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
})();
