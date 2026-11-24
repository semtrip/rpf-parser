const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const entry = path.resolve(__dirname, '../bin/index.js');
const cli = fs.readFileSync(entry, 'utf8');
const requireFromCli = createRequire(entry);

function runCli(directory, execSync) {
  vm.runInNewContext(cli, {
    __dirname: directory,
    exports: {},
    process,
    console: { info() {}, error() {} },
    require(id) {
      return id === 'child_process' ? { execSync } : requireFromCli(id);
    },
  }, { filename: entry });
}

test('a failed package cannot leak staging files into a later build', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rpf-staging-test-'));
  try {
    const props = path.join(workspace, 'input', 'sample', 'props');
    fs.mkdirSync(props, { recursive: true });
    const oldAsset = path.join(props, 'old.ymap');
    fs.writeFileSync(oldAsset, 'old asset');

    let failedStaging;
    assert.throws(() => runCli(workspace, (command) => {
      const [, archiveInput] = /--input "([^"]+)"/.exec(command);
      failedStaging = path.dirname(archiveInput);
      assert.ok(fs.existsSync(path.join(failedStaging, 'map_meta', 'old.ymap')));
      throw new Error('GTAUtil interrupted');
    }), /GTAUtil interrupted/);
    assert.equal(fs.existsSync(failedStaging), false);

    // A process killed before finally can leave its own staging folder behind.
    const abandonedStaging = fs.mkdtempSync(path.join(workspace, 'temp-'));
    fs.writeFileSync(path.join(abandonedStaging, 'abandoned.rpf'), 'stale archive');
    fs.unlinkSync(oldAsset);
    fs.writeFileSync(path.join(props, 'fresh.ymap'), 'fresh asset');

    let retryStaging;
    runCli(workspace, (command) => {
      const [, source, destination, name] =
        /--input "([^"]+)" --output "([^"]+)" --name (\w+)$/.exec(command);
      if (name === 'map_meta') {
        retryStaging = path.dirname(source);
        assert.notEqual(retryStaging, failedStaging);
        assert.notEqual(retryStaging, abandonedStaging);
        assert.deepEqual(fs.readdirSync(source), ['fresh.ymap']);
      }
      if (name === 'dlc') {
        assert.equal(source, retryStaging);
        assert.equal(fs.existsSync(path.join(source, 'abandoned.rpf')), false);
        assert.ok(fs.existsSync(path.join(source, 'content.xml')));
        assert.ok(fs.existsSync(path.join(source, 'setup2.xml')));
      }
      fs.writeFileSync(path.join(destination, name + '.rpf'), 'mock archive');
    });

    assert.ok(retryStaging);
    assert.equal(fs.existsSync(retryStaging), false);
    assert.ok(fs.existsSync(path.join(workspace, 'output', 'sample', 'dlc.rpf')));
  } finally {
    assert.equal(path.dirname(workspace), path.resolve(os.tmpdir()));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
