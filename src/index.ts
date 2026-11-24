/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable max-len */
import { execSync } from 'child_process';
import { copyFileSync, Dirent, existsSync, mkdirSync, mkdtempSync, readdirSync, removeSync, writeFileSync } from 'fs-extra';
import { dirname, join, resolve } from 'path';
import { generateContentXml, generateSetupXml } from './utils';

interface IFoundFile {
  filePath: string;
  fileName: string;
}

const getDirectories = (path: string): { path: string; name: string }[] =>
  readdirSync(path, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => ({ path: join(path, entry.name), name: entry.name }));

const getFiles = (path: string): IFoundFile[] =>
  readdirSync(path, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isFile())
    .map((entry: Dirent) => ({ filePath: join(path, entry.name), fileName: entry.name }));

const makeDir = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

const packageRpf = (gtaVUtilExe: string, inputFolderPath: string, outputFolderPath: string, rpfName: string) => {
  call(`${gtaVUtilExe} createarchive --input "${inputFolderPath}" --output "${outputFolderPath}" --name ${rpfName}`);
};

const call = (command: string) => execSync(command, { maxBuffer: 1024 * 2000000000, stdio: 'inherit' });

const packageDirectory = (directoryName: string, gtaVUtilExe: string, path: string, name: string) => {
  const stagingPath = mkdtempSync(join(directoryName, 'temp-'));
  try {
    makeDir(resolve(stagingPath, 'int_meta')); // ybn, interior-placement ymap, interior ytyp, _manifest
    makeDir(resolve(stagingPath, 'int_props')); // ydr, ytd, ydd, yft
    makeDir(resolve(stagingPath, 'map_meta')); // ybn, ymap, _manifest
    makeDir(resolve(stagingPath, 'map_props')); // ydr, ytyp, ytd, ydd, yft
    makeDir(resolve(stagingPath, 'x64', 'levels', 'gta5', 'interiors')); // int_meta.rpf, int_props.rpf
    makeDir(resolve(stagingPath, 'x64', 'levels', 'gta5', 'props')); // map_meta.rpf, map_props.rpf

    // For int_meta > _manifest:
    //   In _manifest must be all required entries for ymap/ytyp conection - use CodeWalker to generate it.
    //   Missing entries will make interior dont work.

    // Move the files into a temp replacement folder
    const subdirectories = getDirectories(path);
    for (const { path: subdirectoryPath, name: subdirectoryName } of subdirectories) {
      if (subdirectoryName.toLocaleLowerCase().startsWith('int')) {
        // ? Interior files (MLOs)
        const files = getFiles(subdirectoryPath);
        console.info(`Copying ${files.length} interior files to correct temporary directory...`);
        for (const { filePath, fileName } of files) {
          const fileType = fileName.split('.').pop()?.toLocaleLowerCase();
          const isMetaFileType = fileName === '_manifest' || (fileType && ['ybn', 'ymap'].includes(fileType));
          const isPropsFileType = fileType && ['ydr', 'ytyp', 'ytd', 'ydd', 'yft'].includes(fileType);
          if (isMetaFileType) {
            // Copy to int_meta
            copyFileSync(filePath, resolve(stagingPath, 'int_meta', fileName));
          } else if (isPropsFileType) {
            // Copy to int_props
            copyFileSync(filePath, resolve(stagingPath, 'int_props', fileName));
          }
        }
        continue;
      }
      if (subdirectoryName.toLocaleLowerCase().startsWith('prop')) {
        const files = getFiles(subdirectoryPath);
        console.info(`Copying ${files.length} prop files to correct temporary directory...`);
        for (const { filePath, fileName } of files) {
          const fileType = fileName.split('.').pop()?.toLocaleLowerCase();
          const isMetaFileType = fileName === '_manifest' || (fileType && ['ybn', 'ymap'].includes(fileType));
          const isPropsFileType = fileType && ['ydr', 'ytyp', 'ytd', 'ydd', 'yft'].includes(fileType);
          if (isMetaFileType) {
            // Copy to map_meta
            copyFileSync(filePath, resolve(stagingPath, 'map_meta', fileName));
          } else if (isPropsFileType) {
            // Copy to map_props
            copyFileSync(filePath, resolve(stagingPath, 'map_props', fileName));
          }
        }
        continue;
      }
      console.error(`Found directory ${subdirectoryName} that does not start with "int" or "prop". Skipping...`);
    }

    const interiorsPath = resolve(stagingPath, 'x64', 'levels', 'gta5', 'interiors');
    const propsPath = resolve(stagingPath, 'x64', 'levels', 'gta5', 'props');

    // Package temp/int_meta directory into int_meta.rpf
    console.info('Creating int_meta.rpf');
    packageRpf(gtaVUtilExe, resolve(stagingPath, 'int_meta'), interiorsPath, 'int_meta');
    // Package temp/int_props directory into int_props.rpf
    console.info('Creating int_props.rpf');
    packageRpf(gtaVUtilExe, resolve(stagingPath, 'int_props'), interiorsPath, 'int_props');
    // Package temp/map_meta directory into map_meta.rpf
    console.info('Creating map_meta.rpf');
    packageRpf(gtaVUtilExe, resolve(stagingPath, 'map_meta'), propsPath, 'map_meta');
    // Package temp/map_props directory into map_props.rpf
    console.info('Creating map_props.rpf');
    packageRpf(gtaVUtilExe, resolve(stagingPath, 'map_props'), propsPath, 'map_props');

    console.info('Removing unpacked staging directories');
    removeSync(resolve(stagingPath, 'int_props'));
    removeSync(resolve(stagingPath, 'int_meta'));
    removeSync(resolve(stagingPath, 'map_props'));
    removeSync(resolve(stagingPath, 'map_meta'));

    // Write to temp folder the XML files for setup2 and content
    console.info('Generating content.xml and setup2.xml');
    writeFileSync(resolve(stagingPath, 'content.xml'), generateContentXml(name));
    writeFileSync(resolve(stagingPath, 'setup2.xml'), generateSetupXml(name));

    console.info(`Creating dlc.rpf for ${name}`);
    const outputPath = resolve(directoryName, 'output', name);
    makeDir(outputPath);
    packageRpf(gtaVUtilExe, stagingPath, outputPath, 'dlc');
  } finally {
    removeSync(stagingPath);
  }
};

(() => {
  const isPackaged = __dirname.includes('snapshot');
  const directoryName = isPackaged ? dirname(process.execPath) : __dirname;
  makeDir(resolve(directoryName, 'input'));
  const gtaVUtilExe = `"${resolve(directoryName, 'utils', 'GTAUtil.exe')}"`;
  const directories = getDirectories(resolve(directoryName, 'input'));
  console.info(`Creating Replacement RPF files from ${directories.length} directories...`);
  makeDir(resolve(directoryName, 'output'));
  for (const { path, name } of directories) {
    console.info(`Creating Replacement RPF file for ${name}`);
    packageDirectory(directoryName, gtaVUtilExe, path, name);
  }
  console.info('Finished!');
})();
