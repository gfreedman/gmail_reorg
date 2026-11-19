/**
 * Static check: catch undefined names and duplicate declarations across .gs files.
 *
 * Apps Script loads every .gs file into one global scope, so a function called
 * in one file but defined in none (or a constant declared twice in different
 * files) only fails at run time, and only on the path that reaches it. This
 * joins the files into one script, runs ESLint on it, and maps each problem
 * back to its original file and line.
 *
 * Run with:  node test/lint.js     (needs network once for npx to fetch ESLint)
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESLINT = 'eslint@10.14.0';

/**
 * List the .gs files to check, with the private config or its stubs first.
 *
 * @return {Array<{name: string, text: string}>} Files in load order
 */
function sources()
{
  const files = fs.readdirSync(ROOT).filter(function(f)
  {
    return f.endsWith('.gs') && f !== '_private_data.gs';
  }).sort();
  const privPath = path.join(ROOT, '_private_data.gs');
  const priv = fs.existsSync(privPath) ?
    {name: '_private_data.gs', text: fs.readFileSync(privPath, 'utf8')} :
    {name: 'test/private_stubs.js', text: require('./private_stubs.js')};
  return [priv].concat(files.map(function(f)
  {
    return {name: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8')};
  }));
}

/**
 * Join the files and record where each one starts, for mapping lines back.
 *
 * @param {Array<{name: string, text: string}>} files - Files in load order
 * @return {{text: string, starts: Array<{name: string, line: number}>}} Joined script
 */
function join(files)
{
  const starts = [];
  let line = 1;
  const parts = files.map(function(f)
  {
    starts.push({name: f.name, line: line});
    const text = f.text.endsWith('\n') ? f.text : f.text + '\n';
    line += text.split('\n').length - 1;
    return text;
  });
  return {text: parts.join(''), starts: starts};
}

/**
 * Translate a line in the joined script back to file:line.
 *
 * @param {Array<{name: string, line: number}>} starts - Start line of each file
 * @param {number} line - Line in the joined script
 * @return {string} "file:line"
 */
function locate(starts, line)
{
  let hit = starts[0];
  for (let i = 0; i < starts.length; i++)
  {
    if (starts[i].line <= line)
    {
      hit = starts[i];
    }
  }
  return hit.name + ':' + (line - hit.line + 1);
}

const joined = join(sources());
const tmpDir = path.join(__dirname, '.lint-tmp');
fs.mkdirSync(tmpDir, {recursive: true});
const tmpFile = path.join(tmpDir, 'all.js');
fs.writeFileSync(tmpFile, joined.text);

const run = childProcess.spawnSync('npx', ['--yes', ESLINT, '--no-warn-ignored',
  '--config', path.join(__dirname, 'eslint.config.js'), '--format', 'json', tmpFile],
  {cwd: ROOT, encoding: 'utf8'});
fs.rmSync(tmpDir, {recursive: true, force: true});

let report;
try
{
  report = JSON.parse(run.stdout);
}
catch (e)
{
  console.error('ESLint did not produce a report:\n' + run.stdout + run.stderr);
  process.exit(2);
}

const problems = report[0] ? report[0].messages : [];
problems.forEach(function(m)
{
  console.log(locate(joined.starts, m.line) + '  ' + (m.ruleId || 'parse') + '  ' + m.message);
});
console.log(problems.length + ' problem(s)');
process.exit(problems.length ? 1 : 0);
