import { defaults, templates, generate, bundle, taskFor } from './generator.js';

const $ = (id) => document.getElementById(id);
const fields = {
  scope: 'scope', template: 'template', name: 'name', location: 'location',
  language: 'language', body: 'body', asset: 'asset', inherits: 'inherits',
  buildDepends: 'build-depends', runtimeDepends: 'runtime-depends',
  after: 'after', before: 'before', dirs: 'dirs', taskDepends: 'task-depends',
  taskRdepends: 'task-rdepends', vardeps: 'vardeps', nostamp: 'nostamp',
};
let result;
let selected = 'class';
let variables = [];
let variableId = 0;

function config() {
  const c = defaults();
  for (const [key, id] of Object.entries(fields)) c[key] = key === 'nostamp' ? $(id).checked : $(id).value;
  c.variables = variables.map((id) => Object.fromEntries(['name', 'operator', 'override', 'value'].map((key) => [key, $(`variable-${id}-${key}`).value])));
  return c;
}

function currentFile() {
  if (!result.files) return { path: '', content: '' };
  const path = selected === 'class' ? result.classPath : selected === 'recipe' ? result.recipePath : 'README.md';
  return { path, content: result.files[path] };
}

function renderPreview() {
  const { path, content } = currentFile();
  $('filename').textContent = path || 'Resolve field errors to generate files';
  $('code').textContent = content || 'No metadata generated. Your inputs have been kept so you can correct them.';
  for (const id of ['copy', 'download', 'bundle']) $(id).disabled = !result.files;
}

function update() {
  const c = config();
  const recipe = c.scope === 'recipe';
  $('recipe-template').hidden = !recipe;
  $('task-section').hidden = !recipe;
  $('recipe-advanced').hidden = !recipe;
  $('custom-editor').hidden = c.template !== 'custom';
  $('asset-options').hidden = c.template !== 'asset';
  $('language').disabled = c.template === 'asset';
  $('runtime-depends').disabled = c.template !== 'asset';
  $('after').disabled = c.template === 'asset';
  $('before').disabled = c.template === 'asset';
  $('location').options[0].textContent = `classes-${c.scope} (recommended)`;
  $('template-description').textContent = templates[c.template].description;
  $('task-summary').textContent = `Generated task: ${taskFor(c)}. Defaults are stamped; unchanged work may be skipped. Inspect its log in \${T}.`;
  result = generate(c);
  const box = $('validation');
  box.replaceChildren();
  box.classList.toggle('invalid', result.errors.length > 0);
  document.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (result.errors.length) {
    const heading = document.createElement('strong');
    heading.textContent = `${result.errors.length} field issue${result.errors.length === 1 ? '' : 's'} · generation paused`;
    const list = document.createElement('ul');
    for (const error of result.errors) {
      const li = document.createElement('li');
      li.textContent = error.message;
      list.append(li);
      let field = $(error.field);
      const match = /^var-(\d+)-(.*)$/.exec(error.field);
      if (match) field = $(`variable-${variables[Number(match[1])]}-${match[2]}`);
      field?.setAttribute('aria-invalid', 'true');
    }
    box.append(heading, list);
  } else {
    box.textContent = result.custom
      ? 'Structured fields valid · custom code NOT parsed or safety-checked'
      : 'Structured fields valid · not a BitBake parse or build check';
  }
  $('action-status').textContent = '';
  renderPreview();
}

function addVariable() {
  if (variables.length >= 20) return;
  const id = variableId++;
  variables.push(id);
  const row = document.createElement('div');
  row.className = 'variable-row';
  const top = document.createElement('div');
  top.className = 'variable-top';
  const title = document.createElement('h4');
  title.textContent = 'Variable declaration';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove variable declaration ${id + 1}`);
  remove.addEventListener('click', () => {
    variables = variables.filter((n) => n !== id);
    row.remove();
    $('add-variable').disabled = false;
    $('add-variable').focus();
    update();
  });
  top.append(title, remove);
  row.append(top);
  for (const [key, label, placeholder] of [
    ['name', 'Variable name', 'e.g. MYCLASS_MESSAGE'],
    ['operator', 'Assignment operator', ''],
    ['override', 'Override condition (optional)', 'e.g. class-native'],
    ['value', 'Value (empty is allowed)', 'e.g. Hello ${PN}'],
  ]) {
    const el = document.createElement(key === 'operator' ? 'select' : 'input');
    el.id = `variable-${id}-${key}`;
    if (key === 'operator') {
      for (const [value, text] of [['?=', '?= · default if undefined'], ['??=', '??= · weak fallback'], ['=', '= · deferred expansion'], [':=', ':= · immediate expansion']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        el.append(option);
      }
    } else {
      el.placeholder = placeholder;
      el.spellcheck = false;
    }
    const lab = document.createElement('label');
    lab.htmlFor = el.id;
    lab.textContent = label;
    row.append(lab, el);
  }
  $('variables').append(row);
  $('add-variable').disabled = variables.length >= 20;
  $(`variable-${id}-name`).focus();
  update();
}

function selectTab(button) {
  selected = button.dataset.file;
  document.querySelectorAll('[role=tab]').forEach((tab) => {
    const active = tab === button;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $('preview').setAttribute('aria-labelledby', button.id);
  renderPreview();
}

function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('action-status').textContent = `Downloaded ${filename}. Review before using in BitBake.`;
}

$('config').addEventListener('submit', (e) => e.preventDefault());
$('config').addEventListener('input', update);
$('config').addEventListener('change', (event) => {
  if (event.target.id === 'template') {
    const t = templates[$('template').value];
    $('after').value = t.after;
    $('before').value = t.before;
    $('language').value = t.language;
    $('runtime-depends').value = '';
    $('body').value = defaults().body;
  }
  if (event.target.id === 'language' && $('template').value === 'custom') {
    $('body').value = $('language').value === 'shell' ? 'bbnote "Hello from ${PN}"' : defaults().body;
  }
  update();
});
$('add-variable').addEventListener('click', addVariable);
document.querySelectorAll('[role=tab]').forEach((tab, i, tabs) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
});
$('copy').addEventListener('click', async () => {
  if (!result.files) return;
  try {
    await navigator.clipboard.writeText(currentFile().content);
    $('action-status').textContent = 'Copied file to clipboard.';
  } catch (error) {
    $('action-status').textContent = `Clipboard unavailable (${error.name}). Select the preview text or download the file instead.`;
  }
});
$('download').addEventListener('click', () => {
  if (!result.files) return;
  const { path, content } = currentFile();
  download(content, path.split('/').at(-1), 'text/plain;charset=utf-8');
});
$('bundle').addEventListener('click', () => {
  if (!result.files) return;
  download(bundle(result), 'meta-classcraft.zip', 'application/zip');
});
update();
