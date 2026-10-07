/*
 * Smoke-тест интерфейса: запускает js/app.js на минимальном DOM-шимме и
 * проверяет, что панель строится, кнопки работают, программа выполняется.
 * Запуск: node calculator/test/app.smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// Мини-DOM
// ---------------------------------------------------------------------------
let idSeq = 0;

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) { if (on === undefined) on = !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
  toString() { return Array.from(this.set).join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._id = ++idSeq;
    this._attrs = {};
    this.classList = new ClassList(this);
    this._text = '';
  }
  get className() { return this.classList.toString(); }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() { return this._attrs.id || ''; }
  set id(v) { this._attrs.id = v; registry['#' + v] = this; }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
  get value() { return this._value !== undefined ? this._value : (this._attrs.value || ''); }
  set value(v) { this._value = v; }
  get files() { return this._files || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(c => c !== child); return child; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn);
  }
  dispatch(type, ev) {
    (this.listeners[type] || []).forEach(fn => fn.call(this, ev || { preventDefault() {}, target: this }));
  }
  click() { this.dispatch('click', { preventDefault() {}, stopPropagation() {}, target: this }); }
  scrollIntoView() {}
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  querySelectorAll() { return collect(this); }
}

// --- селекторы: поддерживаем '#id' и простые '#id .class' / 'tag.class' -----
const registry = {};

function collect(node) {
  const out = [];
  (function walk(n) {
    n.children.forEach(c => { out.push(c); walk(c); });
  })(node);
  return out;
}

function matchesSimple(node, part) {
  if (part.startsWith('#')) return node.id === part.slice(1);
  const [tag, cls] = part.split('.');
  if (tag && tag !== '*' && node.tagName !== tag.toUpperCase()) return false;
  if (cls && !node.classList.contains(cls)) return false;
  return true;
}

// поддержка селекторов потомка: '#keypad .key', '#programmer .ins-btn'
function matches(node, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!matchesSimple(node, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let p = node.parentNode;
  while (i >= 0 && p) {
    if (matchesSimple(p, parts[i])) i--;
    p = p.parentNode;
  }
  return i < 0;
}

const documentShim = {
  readyState: 'complete',
  createElement(tag) { return new Node(tag); },
  getElementById(id) { return registry['#' + id] || null; },
  querySelector(sel) {
    if (sel.startsWith('#') && !sel.includes(' ')) {
      const id = sel.slice(1);
      const found = collect(documentShim.body).find(n => n.id === id);
      return found || registry[sel] || null;
    }
    const all = collect(documentShim.body);
    return all.find(n => matches(n, sel)) || null;
  },
  querySelectorAll(sel) {
    const all = collect(documentShim.body);
    return all.filter(n => matches(n, sel));
  },
  addEventListener(type, fn) { (this._l = this._l || {})[type] = fn; },
  key(type, ev) { if (this._l && this._l[type]) this._l[type](ev); },
  body: new Node('body')
};

// --- собираем элементы, объявленные в index.html ---------------------------
function buildFromHtml() {
  const ids = [...HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => {
    const isSelect = new RegExp('<select[^>]*id="' + id + '"').test(HTML);
    const isInput = new RegExp('<input[^>]*id="' + id + '"').test(HTML);
    const node = new Node(isSelect ? 'select' : isInput ? 'input' : 'div');
    node.id = id;
    documentShim.body.appendChild(node);
  });
}

// кнопки конструктора объявлены в HTML без id — создаём их по data-insert
function buildInsertButtons() {
  const prog = documentShim.getElementById('programmer');
  const names = [...HTML.matchAll(/data-insert="([^"]+)"/g)].map(m => m[1]);
  names.forEach(name => {
    const btn = new Node('button');
    btn.className = 'key ins-btn';
    btn.dataset.insert = name;
    prog.appendChild(btn);
  });
  return names;
}

// --- остальные браузерные API ----------------------------------------------
class OptionShim extends Node {
  constructor(text, value) { super('option'); this._text = text; this.value = value; }
}

const store = {};
const warnings = [];
const sandboxConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: (...args) => warnings.push(args.map(String).join(' '))
};

const sandbox = {
  document: documentShim,
  window: null,
  console: sandboxConsole,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {},
  prompt: () => null,
  confirm: () => true,
  alert: () => {},
  Option: OptionShim,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: function () {},
  Math, JSON, Number, String, Array, Object, Date, isFinite, parseFloat, parseInt
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

// ---------------------------------------------------------------------------
// Загрузка скриптов приложения
// ---------------------------------------------------------------------------
function load(file) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

buildFromHtml();
const INSERT_BUTTONS = buildInsertButtons();
load('engine.js');
load('examples.js');
load('app.js');

const calc = sandbox.calc;

console.log('Инициализация интерфейса');

test('движок и примеры доступны в window', () => {
  assert.ok(sandbox.ProgCalc && sandbox.ProgCalc.Calculator);
  assert.ok(sandbox.ProgCalcExamples.sum);
  assert.ok(calc, 'window.calc не создан');
});

test('клавиатура построена (54 кнопки)', () => {
  const keys = documentShim.querySelectorAll('#keypad .key');
  assert.ok(keys.length >= 50, 'кнопок: ' + keys.length);
});

test('стартовая программа-пример загружена', () => {
  assert.ok(calc.program.length > 5, 'шагов: ' + calc.program.length);
});

test('листинг программы отрисован', () => {
  const rows = documentShim.querySelectorAll('#program-list .prog-row');
  assert.strictEqual(rows.length, calc.program.length);
});

test('регистры памяти отрисованы (16 штук)', () => {
  const regs = documentShim.querySelectorAll('#registers .reg');
  assert.strictEqual(regs.length, 16);
});

test('кнопки вставки шагов связаны с обработчиками', () => {
  const btns = documentShim.querySelectorAll('#programmer .ins-btn');
  assert.strictEqual(btns.length, INSERT_BUTTONS.length);
  assert.ok(btns.every(b => (b.listeners.click || []).length === 1),
    'не у всех кнопок есть обработчик click');
});

test('селекторы конструктора заполнены', () => {
  assert.ok(documentShim.getElementById('ins-op').children.length > 30);
  assert.ok(documentShim.getElementById('ins-cond').children.length > 10);
  assert.ok(documentShim.getElementById('ins-reg').children.length === 16);
});

console.log('\nВзаимодействие');

/** Режим ПРГ остаётся включённым после тестов вставки — возвращаем АВТ. */
function ensureAutoMode() {
  const st = documentShim.getElementById('st-mode');
  if (st.textContent === 'ПРГ') documentShim.getElementById('btn-progmode').click();
}

function keyByLabel(label) {
  const keys = documentShim.querySelectorAll('#keypad .key');
  return keys.find(k => k.textContent === label);
}

test('набор числа с клавиш: 7 8 → 78 в X', () => {
  calc.reset();
  keyByLabel('7').click();
  keyByLabel('8').click();
  assert.strictEqual(documentShim.getElementById('display').textContent, '78');
  keyByLabel('+').click();
  assert.strictEqual(calc.x(), 78);
});

test('арифметика кнопками (RPN): 6 В↑ 7 × = 42', () => {
  calc.reset();
  keyByLabel('6').click();
  keyByLabel('В↑').click();
  keyByLabel('7').click();
  keyByLabel('×').click();
  assert.strictEqual(calc.x(), 42);
  assert.strictEqual(documentShim.getElementById('display').textContent, '42');
});

test('цепочка операций: 2 В↑ 3 + 4 × = 20', () => {
  calc.reset();
  keyByLabel('2').click();
  keyByLabel('В↑').click();
  keyByLabel('3').click();
  keyByLabel('+').click();
  keyByLabel('4').click();
  keyByLabel('×').click();
  assert.strictEqual(calc.x(), 20);
});

test('В↑ без набора числа дублирует X', () => {
  calc.reset();
  calc.enter(9);
  keyByLabel('В↑').click();
  assert.strictEqual(calc.stack[0], 9);
  assert.strictEqual(calc.stack[1], 9);
});

test('клавиша «МЕТКА» добавляет шаг-метку', () => {
  calc.clearProgram();
  sandbox.prompt = () => 'L3';
  keyByLabel('МЕТКА').click();
  assert.strictEqual(calc.program[0].label, 'L3');
  assert.strictEqual(documentShim.getElementById('st-mode').textContent, 'ПРГ');
  sandbox.prompt = () => null;
});

test('недопустимая метка отклоняется', () => {
  const before = calc.program.length;
  sandbox.prompt = () => 'L42';
  keyByLabel('МЕТКА').click();
  assert.strictEqual(calc.program.length, before);
  assert.ok(calc.error && calc.error.code === 'BAD_LABEL');
  sandbox.prompt = () => null;
  ensureAutoMode();
});

test('кнопка ÷ на ноль показывает ошибку, а не падает', () => {
  ensureAutoMode();
  calc.reset();
  keyByLabel('5').click();
  keyByLabel('÷').click();
  keyByLabel('0').click();
  keyByLabel('÷').click();
  assert.ok(calc.error, 'ошибка не зарегистрирована');
  assert.strictEqual(calc.error.code, 'DIV0');
  assert.ok(warnings.some(w => /Error/.test(w)), 'ошибка не выведена в консоль');
  assert.strictEqual(documentShim.getElementById('display').classList.contains('is-error'), true);
});

test('запуск программы кнопкой: сумма 1..10 = 55', () => {
  calc.reset();
  const sel = documentShim.getElementById('examples');
  sel.value = 'sum';
  sel.dispatch('change');
  calc.enter(10);
  documentShim.getElementById('btn-run').click();
  assert.strictEqual(calc.x(), 55);
});

test('пошаговое выполнение кнопкой ШАГ', () => {
  calc.reset();
  calc.setProgram([{ lit: 2 }, { lit: 3 }, { op: 'add' }, { stop: true }]);
  const btn = documentShim.getElementById('btn-step');
  btn.click();
  assert.strictEqual(calc.x(), 2);
  btn.click();
  assert.strictEqual(calc.x(), 3);
  btn.click();
  assert.strictEqual(calc.x(), 5);
});

test('режим ПРГ записывает нажатия в программу', () => {
  ensureAutoMode();
  calc.reset();
  calc.clearProgram();
  documentShim.getElementById('btn-progmode').click();
  keyByLabel('+').click();
  keyByLabel('√x').click();
  assert.strictEqual(calc.program.length, 2);
  assert.strictEqual(calc.program[0].op, 'add');
  assert.strictEqual(calc.program[1].op, 'sqrt');
  documentShim.getElementById('btn-progmode').click(); // выключить
});

test('вставка шага через конструктор (условный переход)', () => {
  calc.reset();
  calc.clearProgram();
  documentShim.getElementById('ins-cond').value = 'x<0';
  documentShim.getElementById('ins-target').value = 'L1';
  const btn = documentShim.querySelectorAll('#programmer .ins-btn')
    .find(b => b.dataset.insert === 'cond');
  btn.click();
  assert.strictEqual(calc.program.length, 1);
  assert.strictEqual(calc.program[0].cond, 'x<0');
  assert.strictEqual(calc.program[0].jmp, 'L1');
});

test('удаление выбранного шага', () => {
  const before = calc.program.length;
  const row = documentShim.querySelector('#program-list .prog-row');
  row.click();
  documentShim.getElementById('btn-del-step').click();
  assert.strictEqual(calc.program.length, before - 1);
});

test('клавиша ПРГ на панели подсвечивается в режиме программирования', () => {
  ensureAutoMode();
  const key = documentShim.getElementById('progmode');
  assert.ok(key, 'клавиша ПРГ не найдена по id');
  assert.strictEqual(key.classList.contains('on'), false);
  key.click();
  assert.strictEqual(key.classList.contains('on'), true);
  assert.strictEqual(documentShim.getElementById('btn-progmode').classList.contains('on'), true);
  ensureAutoMode();
  assert.strictEqual(key.classList.contains('on'), false);
});

test('переключение DEG / RAD меняет результат sin', () => {
  calc.reset();
  documentShim.getElementById('mode-deg').click();
  calc.enter(30).op('sin');
  assert.ok(Math.abs(calc.x() - 0.5) < 1e-12);
  documentShim.getElementById('mode-rad').click();
  calc.stack = [0, 0, 0, 0];
  calc.enter(Math.PI / 2).op('sin');
  assert.ok(Math.abs(calc.x() - 1) < 1e-12);
});

test('формат вывода FIX применяется к дисплею', () => {
  calc.reset();
  documentShim.getElementById('format-mode').value = 'fix';
  documentShim.getElementById('format-mode').dispatch('change');
  documentShim.getElementById('format-digits').value = '3';
  documentShim.getElementById('format-digits').dispatch('change');
  calc.stack = [3.14159, 0, 0, 0];
  documentShim.getElementById('format-digits').value = '3';
  documentShim.getElementById('format-digits').dispatch('change');
  assert.strictEqual(documentShim.getElementById('display').textContent, '3.142');
  documentShim.getElementById('format-auto').click();
});

test('настройки сохраняются в localStorage', () => {
  assert.ok(store['progcalc.settings'], 'настройки не сохранены');
  const s = JSON.parse(store['progcalc.settings']);
  assert.ok(s.angleMode);
});

test('сохранение программы в библиотеку', () => {
  sandbox.prompt = () => 'Тест-программа';
  calc.setProgram([{ lit: 1 }, { stop: true }]);
  documentShim.getElementById('btn-save-program').click();
  const lib = JSON.parse(store['progcalc.programs']);
  assert.ok(lib['Тест-программа']);
  sandbox.prompt = () => null;
});

test('загрузка программы из библиотеки', () => {
  calc.clearProgram();
  const sel = documentShim.getElementById('program-library');
  sel.value = 'Тест-программа';
  documentShim.getElementById('btn-load-program').click();
  assert.strictEqual(calc.program.length, 2);
});

test('клавиатура: цифры и операторы через keydown', () => {
  calc.reset();
  const key = k => documentShim.key('keydown', { key: k, target: { tagName: 'BODY' }, preventDefault() {} });
  key('3'); key('Enter'); key('1'); key('2'); key('*');
  assert.strictEqual(calc.x(), 36, 'получено ' + calc.x());
  key('Escape');
  assert.strictEqual(calc.x(), 0);
});

test('очистка программы через кнопку (с подтверждением)', () => {
  calc.setProgram([{ lit: 1 }, { stop: true }]);
  documentShim.getElementById('btn-clear-program').click();
  assert.strictEqual(calc.program.length, 0);
});

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
