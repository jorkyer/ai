/*
 * Программируемый калькулятор — интерфейс.
 * Требует engine.js (ProgCalc).
 */
(function () {
  'use strict';

  var PC = window.ProgCalc;
  var calc = new PC.Calculator();

  // --- состояние ввода с клавиатуры -----------------------------------------
  var entry = null;          // строка набираемого числа или null
  var programMode = false;   // режим программирования
  var selectedIndex = -1;    // выбранный шаг в листинге
  var followCursor = true;

  var STORE = {
    programs: 'progcalc.programs',
    settings: 'progcalc.settings'
  };

  // ---------------------------------------------------------------------------
  // Утилиты DOM
  // ---------------------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }

  /** Как $, но не падает, если элемент ещё не построен. */
  function maybe(sel) { return document.querySelector(sel) || null; }
  function markOn(sel, on) { var n = maybe(sel); if (n) n.classList.toggle('on', !!on); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Индикация
  // ---------------------------------------------------------------------------
  function render() {
    renderDisplay();
    renderStack();
    renderStatus();
    renderProgram();
    renderRegisters();
  }

  function renderDisplay() {
    var d = $('#display');
    if (!d) return;
    var value = entry !== null ? entry : calc.formatNumber(calc.x());
    d.textContent = value;
    d.classList.toggle('is-error', !!calc.error);
    d.classList.toggle('is-entry', entry !== null);
    d.style.fontSize = fontSizeFor(value.length);
    $('#display-comment').textContent = calc.error ? String(calc.error.message) : hintText();
  }

  function fontSizeFor(len) {
    if (len > 22) return '20px';
    if (len > 16) return '26px';
    if (len > 11) return '34px';
    return '44px';
  }

  function hintText() {
    if (programMode) return 'РЕЖИМ ПРОГРАММИРОВАНИЯ — операции записываются в программу';
    if (calc.running) return 'ВЫПОЛНЕНИЕ ПРОГРАММЫ';
    if (calc.halted && calc.program.length) return 'Программа завершена, шагов выполнено: ' + calc.stepsExecuted;
    return 'Стековый калькулятор: сначала числа, потом операция (X, Y)';
  }

  function renderStack() {
    ['x', 'y', 'z', 't'].forEach(function (name, i) {
      var node = $('#stack-' + name);
      if (node) node.textContent = calc.formatNumber(calc.stack[i]);
    });
  }

  function renderStatus() {
    $('#st-angle').textContent = calc.angleMode;
    $('#st-format').textContent = calc.format.mode === 'auto' ? 'АВТО' :
      calc.format.mode.toUpperCase() + ' ' + calc.format.digits;
    $('#st-mode').textContent = programMode ? 'ПРГ' : 'АВТ';
    $('#st-mode').classList.toggle('on', programMode);
    $('#st-run').classList.toggle('on', calc.running);
    $('#st-run').textContent = calc.running ? '▶ ВЫПОЛНЕНИЕ' : '▶';
    $('#st-steps').textContent = calc.program.length ?
      ('ШАГ ' + Math.min(calc.pc, calc.program.length) + '/' + calc.program.length) : 'ПРОГРАММА ПУСТА';

    var flags = $('#st-flags');
    flags.innerHTML = '';
    for (var i = 0; i < 6; i++) {
      var f = el('span', 'flag' + (calc.flags[i] ? ' on' : ''), 'F' + i);
      flags.appendChild(f);
    }
    markOn('#st-inv', inverse);
    markOn('#progmode', programMode);
    markOn('#btn-progmode', programMode);
    markOn('#mode-deg', calc.angleMode === 'DEG');
    markOn('#mode-rad', calc.angleMode === 'RAD');
    markOn('#mode-grad', calc.angleMode === 'GRAD');
  }

  // --- листинг программы -----------------------------------------------------
  function renderProgram() {
    var list = $('#program-list');
    if (!list) return;
    var prevScroll = list.scrollTop;
    list.innerHTML = '';

    if (!calc.program.length) {
      var empty = el('div', 'prog-empty', 'Программа пуста. Включите «ПРГ» и нажимайте кнопки — шаги запишутся сюда.');
      list.appendChild(empty);
      return;
    }

    calc.program.forEach(function (step, i) {
      var row = el('div', 'prog-row');
      row.dataset.index = String(i);
      if (i === selectedIndex) row.classList.add('selected');
      if (i === calc.pc && (calc.running || calc.halted || programMode)) row.classList.add('cursor');

      var addr = el('span', 'prog-addr', pad(i));
      var code = el('span', 'prog-code', PC.stepToString(step));
      var del = el('button', 'prog-del', '✕');
      del.title = 'Удалить шаг ' + i;
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeStepAt(i);
      });

      row.appendChild(addr);
      row.appendChild(code);
      row.appendChild(del);
      row.addEventListener('click', function () {
        selectedIndex = i;
        renderProgram();
      });
      list.appendChild(row);
    });

    if (followCursor) {
      list.scrollTop = prevScroll;
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // --- регистры --------------------------------------------------------------
  function renderRegisters() {
    var box = $('#registers');
    if (!box) return;
    if (!box.dataset.built) {
      box.innerHTML = '';
      PC.REG_NAMES.forEach(function (name) {
        var cell = el('div', 'reg');
        var head = el('div', 'reg-head', 'R' + name);
        var val = el('div', 'reg-val', '0');
        val.id = 'reg-val-' + name;
        cell.appendChild(head);
        cell.appendChild(val);
        cell.title = 'Клик — вызвать R' + name + ' в X';
        cell.addEventListener('click', function () { doReg(name, 'recall'); });
        box.appendChild(cell);
      });
      box.dataset.built = '1';
    }
    PC.REG_NAMES.forEach(function (name) {
      var i = PC.REG_NAMES.indexOf(name);
      var node = document.getElementById('reg-val-' + name);
      if (node) node.textContent = calc.formatNumber(calc.regs[i]);
    });
  }

  // ---------------------------------------------------------------------------
  // Ввод чисел
  // ---------------------------------------------------------------------------
  var inverse = false;
  var pendingReg = null;   // выбран регистр для операции с памятью

  function startEntry(first) {
    entry = first;
    render();
  }

  function digit(d) {
    if (programMode) { promptConstant(); return; }
    if (entry === null) entry = d === '.' ? '0.' : d;
    else if (entry === '0' && d !== '.') entry = d;
    else entry += d;
    render();
  }

  function commitEntry() {
    if (entry !== null) {
      var v = parseFloat(entry);
      if (Number.isNaN(v)) v = 0;
      entry = null;
      calc.push(v);
    }
  }

  function backspace() {
    if (entry === null) { calc.op('drop'); render(); return; }
    entry = entry.slice(0, -1);
    if (entry === '' || entry === '-' || entry === '0') entry = null;
    render();
  }

  /** В режиме программирования цифра означает «вписать константу в программу». */
  function promptConstant() {
    var text = prompt('Константа для шага программы:', '0');
    if (text === null) return;
    var v = parseFloat(String(text).replace(',', '.'));
    if (Number.isNaN(v)) { fail(PC.CalcError('BAD_LIT', 'Не удалось разобрать число: ' + text)); render(); return; }
    record({ lit: v });
  }

  function negateEntry() {
    if (entry === null) { calc.op('neg'); }
    else entry = entry.charAt(0) === '-' ? entry.slice(1) : '-' + entry;
    render();
  }

  // ---------------------------------------------------------------------------
  // Операции
  // ---------------------------------------------------------------------------
  function doOp(name) {
    try {
      if (programMode) {
        record({ op: name });
        return;
      }
      commitEntry();
      calc.op(name);
      calc.error = null;
    } catch (e) {
      fail(e);
    }
    render();
  }

  function doReg(name, act, extra) {
    try {
      if (programMode) {
        var step = { reg: name, act: act };
        if (extra && extra.jmp !== undefined) step.jmp = extra.jmp;
        record(step);
        return;
      }
      commitEntry();
      if (act === 'store') calc.store(name);
      else if (act === 'add') calc.addStore(name, 1);
      else if (act === 'sub') calc.addStore(name, -1);
      else calc.recall(name);
    } catch (e) { fail(e); }
    render();
  }

  function fail(e) {
    calc.error = e;
    calc.running = false;
    entry = null;
    var d = $('#display');
    d.classList.add('flash');
    setTimeout(function () { d.classList.remove('flash'); }, 300);
    console.warn(e);
  }

  // ---------------------------------------------------------------------------
  // Программирование
  // ---------------------------------------------------------------------------
  function record(step) {
    try {
      PC.validateStep(step);
      if (selectedIndex >= 0 && selectedIndex < calc.program.length) {
        calc.insertStep(selectedIndex + 1, step);
        selectedIndex = selectedIndex + 1;
      } else {
        calc.addStep(step);
        selectedIndex = calc.program.length - 1;
      }
      calc.pc = selectedIndex + 1;
    } catch (e) { fail(e); }
    render();
  }

  function removeStepAt(i) {
    calc.removeStep(i);
    if (selectedIndex >= calc.program.length) selectedIndex = calc.program.length - 1;
    calc.pc = Math.max(0, selectedIndex + 1);
    render();
  }

  function toggleProgramMode() {
    programMode = !programMode;
    if (programMode) {
      commitEntry();
      selectedIndex = calc.program.length - 1;
      calc.pc = calc.program.length;
    } else {
      selectedIndex = -1;
      calc.pc = 0;
      calc.halted = false;
      calc.running = false;
    }
    render();
  }

  function runProgram(opts) {
    opts = opts || {};
    if (!calc.program.length) { fail(PC.CalcError('EMPTY', 'Программа пуста')); render(); return; }
    if (programMode) toggleProgramMode();
    commitEntry();
    calc.error = null;
    try {
      if (opts.stepOnce) {
        calc.halted = false;
        calc.running = true;
        if (opts.fromStart) { calc.pc = 0; calc.returnStack = []; }
        calc.step();
        calc.running = false;
      } else {
        calc.pc = 0;
        calc.run({ limit: calc.stepLimit });
      }
    } catch (e) { fail(e); }
    render();
    scrollCursorIntoView();
  }

  function scrollCursorIntoView() {
    var row = $('#program-list .cursor');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function stopProgram() {
    calc.running = false;
    calc.halted = false;
    calc.pc = 0;
    calc.returnStack = [];
    render();
  }

  // ---------------------------------------------------------------------------
  // Примеры программ
  // ---------------------------------------------------------------------------
  var EXAMPLES = window.ProgCalcExamples;

  function loadExample(key) {
    var ex = EXAMPLES[key];
    if (!ex) return;
    calc.clearProgram();
    calc.setProgram(ex.program);
    calc.pc = 0;
    selectedIndex = -1;
    $('#example-info').textContent = ex.name + ' — ' + ex.desc;
    render();
  }

  // ---------------------------------------------------------------------------
  // Сохранение / загрузка
  // ---------------------------------------------------------------------------
  function saveSettings() {
    try {
      localStorage.setItem(STORE.settings, JSON.stringify({
        angleMode: calc.angleMode,
        format: calc.format
      }));
    } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE.settings);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.angleMode) calc.angleMode = s.angleMode;
      if (s.format) calc.format = s.format;
    } catch (e) { /* ignore */ }
  }

  function saveProgramToLibrary() {
    var name = prompt('Название программы:', 'Моя программа');
    if (!name) return;
    var lib = readLibrary();
    lib[name] = calc.program;
    writeLibrary(lib);
    fillProgramLibrary();
  }

  function readLibrary() {
    try {
      var raw = localStorage.getItem(STORE.programs);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeLibrary(lib) {
    try { localStorage.setItem(STORE.programs, JSON.stringify(lib)); } catch (e) { /* ignore */ }
  }

  function fillProgramLibrary() {
    var sel = $('#program-library');
    var lib = readLibrary();
    sel.innerHTML = '';
    var keys = Object.keys(lib);
    if (!keys.length) {
      sel.appendChild(new Option('— сохранённых программ нет —', ''));
    } else {
      sel.appendChild(new Option('— выберите программу —', ''));
      keys.forEach(function (k) { sel.appendChild(new Option(k, k)); });
    }
  }

  function loadProgramFromLibrary() {
    var sel = $('#program-library');
    var lib = readLibrary();
    var prog = lib[sel.value];
    if (!prog) return;
    calc.clearProgram();
    calc.setProgram(prog);
    selectedIndex = -1;
    render();
  }

  function exportProgram() {
    var data = JSON.stringify(calc.serialize(), null, 2);

    // В APK скачивание blob-ссылок не работает — сохраняем через нативный мост
    // (см. MainActivity.AndroidBridge.saveText). В браузере — обычная загрузка.
    if (window.Android && typeof window.Android.saveText === 'function') {
      var path = window.Android.saveText('progcalc-program.json', data);
      var info = $('#example-info');
      if (info) {
        info.textContent = path ? 'Файл сохранён: ' + path : 'Не удалось сохранить файл';
      }
      return;
    }

    var blob = new Blob([data], { type: 'application/json' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'program.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importProgram() {
    var input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          calc.load(JSON.parse(String(r.result)));
          selectedIndex = -1;
          render();
        } catch (e) { fail(e); render(); }
      };
      r.readAsText(f);
    });
    input.click();
  }

  // ---------------------------------------------------------------------------
  // Настройки
  // ---------------------------------------------------------------------------
  function setAngleMode(mode) {
    calc.angleMode = mode;
    saveSettings();
    render();
  }

  function setFormat(mode) {
    calc.format.mode = mode;
    if (mode === 'fix') calc.format.digits = Number($('#format-digits').value) || 8;
    saveSettings();
    render();
  }

  // ---------------------------------------------------------------------------
  // Клавиатура
  // ---------------------------------------------------------------------------
  var KEYMAP = {
    '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '^': 'pow',
    's': 'sin', 'c': 'cos', 't': 'tan', 'l': 'ln', 'p': 'pi',
    'q': 'sqrt', '!': 'fact'
  };

  function onKey(ev) {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
    var k = ev.key;

    if (k >= '0' && k <= '9') { digit(k); ev.preventDefault(); return; }
    if (k === '.' || k === ',') { digit('.'); ev.preventDefault(); return; }
    if (k === 'Enter' || k === '=') {
      if (programMode) { record({ stop: true }); } else { commitEntry(); }
      ev.preventDefault(); render(); return;
    }
    if (k === 'Backspace') { backspace(); ev.preventDefault(); return; }
    if (k === 'Escape') { clearEntry(); ev.preventDefault(); return; }
    if (k === '_') { negateEntry(); ev.preventDefault(); return; }
    if (KEYMAP[k]) { doOp(KEYMAP[k]); ev.preventDefault(); return; }

    if (ev.ctrlKey || ev.metaKey) {
      if (k === 'r') { runProgram({}); ev.preventDefault(); return; }
      if (k === 's') { ev.preventDefault(); saveProgramToLibrary(); return; }
    }
    if (k === 'F5') { runProgram({ stepOnce: true, fromStart: false }); ev.preventDefault(); }
  }

  function clearEntry() {
    entry = null;
    calc.stack = [0, 0, 0, 0];
    calc.error = null;
    render();
  }

  // ---------------------------------------------------------------------------
  // Сборка кнопочной панели
  // ---------------------------------------------------------------------------
  var KEYPAD = [
    // ряд 1
    [{ id: 'deg', label: 'DEG', cls: 'mode', act: function () { setAngleMode('DEG'); } },
     { id: 'rad', label: 'RAD', cls: 'mode', act: function () { setAngleMode('RAD'); } },
     { id: 'grad', label: 'GRAD', cls: 'mode', act: function () { setAngleMode('GRAD'); } },
     { id: 'inv', label: 'INV', cls: 'mode', act: toggleInverse },
     { id: 'progmode', label: 'ПРГ', cls: 'mode accent', act: toggleProgramMode },
     { id: 'clear-all', label: 'C', cls: 'warn', act: function () { clearEntry(); calc.error = null; render(); } }],

    // ряд 2 — функции
    [{ label: 'sin', act: function () { doOp(inverse ? 'asin' : 'sin'); } },
     { label: 'cos', act: function () { doOp(inverse ? 'acos' : 'cos'); } },
     { label: 'tan', act: function () { doOp(inverse ? 'atan' : 'tan'); } },
     { label: 'ln', act: function () { doOp(inverse ? 'exp' : 'ln'); } },
     { label: 'lg', act: function () { doOp(inverse ? 'pow10' : 'lg'); } },
     { label: 'x²', act: function () { doOp(inverse ? 'sqrt' : 'sqr'); } }],

    // ряд 3
    [{ label: '√x', act: function () { doOp('sqrt'); } },
     { label: '∛x', act: function () { doOp('cbrt'); } },
     { label: 'yˣ', act: function () { doOp('pow'); } },
     { label: 'eˣ', act: function () { doOp('exp'); } },
     { label: '1/x', act: function () { doOp('inv'); } },
     { label: 'x!', act: function () { doOp('fact'); } }],

    // ряд 4
    [{ label: 'π', act: function () { doOp('pi'); } },
     { label: 'e', act: function () { doOp('e'); } },
     { label: '|x|', act: function () { doOp('abs'); } },
     { label: '/−/', act: negateEntry },
     { label: '⌫', cls: 'warn', act: backspace },
     { label: '↻ R', act: function () { doOp('rot'); } }],

    // ряд 5 — стек/память
    [{ label: 'XY', act: function () { doOp('swap'); } },
     { label: 'x↓', act: function () { doOp('drop'); } },
     { label: 'R+', cls: 'mem', act: function () { memOp('add'); } },
     { label: 'R−', cls: 'mem', act: function () { memOp('sub'); } },
     { label: 'RS', cls: 'mem', act: function () { memOp('store'); } },
     { label: 'RR', cls: 'mem', act: function () { memOp('recall'); } }],

    // ряд 6 — цифры и управление
    [{ label: '7', cls: 'num', act: function () { digit('7'); } },
     { label: '8', cls: 'num', act: function () { digit('8'); } },
     { label: '9', cls: 'num', act: function () { digit('9'); } },
     { label: '÷', cls: 'arith', act: function () { doOp('div'); } },
     { label: 'В↑', cls: 'enter', title: 'Ввести число в стек (Enter)', act: commitEntryKey },
     { label: 'СБРОС', cls: 'warn', title: 'Обнулить X и стек', act: function () { clearEntry(); render(); } }],

    // ряд 7
    [{ label: '4', cls: 'num', act: function () { digit('4'); } },
     { label: '5', cls: 'num', act: function () { digit('5'); } },
     { label: '6', cls: 'num', act: function () { digit('6'); } },
     { label: '×', cls: 'arith', act: function () { doOp('mul'); } },
     { label: 'ШАГ', cls: 'run', title: 'Выполнить один шаг программы', act: function () { runProgram({ stepOnce: true }); } },
     { label: 'СТОП', cls: 'warn', title: 'Остановить выполнение', act: stopProgram }],

    // ряд 8
    [{ label: '1', cls: 'num', act: function () { digit('1'); } },
     { label: '2', cls: 'num', act: function () { digit('2'); } },
     { label: '3', cls: 'num', act: function () { digit('3'); } },
     { label: '−', cls: 'arith', act: function () { doOp('sub'); } },
     { label: 'ПРГ', cls: 'mode accent', title: 'Режим программирования', act: toggleProgramMode },
     { label: 'МЕТКА', cls: 'prog', title: 'Вставить метку в программу', act: insertLabel }],

    // ряд 9
    [{ label: '0', cls: 'num', act: function () { digit('0'); } },
     { label: '.', cls: 'num', act: function () { digit('.'); } },
     { label: '+/−', cls: 'num', act: negateEntry },
     { label: '+', cls: 'arith', act: function () { doOp('add'); } },
     { label: '▶ ЗАПУСК', cls: 'run wide', title: 'Выполнить программу (Ctrl+R)', act: function () { runProgram({}); } }]
  ];

  /** «В↑»: зафиксировать набранное число и сдвинуть стек. */
  function commitEntryKey() {
    if (programMode) { record({ op: 'dup' }); return; }
    if (entry === null) calc.op('dup');
    else commitEntry();
    render();
  }

  /** Вставить метку L0-L9 в программу. */
  function insertLabel() {
    var name = prompt('Метка (L0…L9):', 'L0');
    if (name === null) return;
    name = String(name).toUpperCase().trim();
    if (PC.LABELS.indexOf(name) < 0) {
      fail(PC.CalcError('BAD_LABEL', 'Допустимы метки L0…L9'));
      render();
      return;
    }
    if (!programMode) toggleProgramMode();
    record({ label: name });
  }

  function toggleInverse() {
    inverse = !inverse;
    render();
  }

  function memOp(act) {
    if (pendingReg === null) {
      pendingReg = '0';
      var name = prompt('Регистр (0-9, A-F):', '0');
      if (name === null) return;
      pendingReg = String(name).toUpperCase().trim();
      if (PC.REG_NAMES.indexOf(pendingReg) < 0) {
        fail(PC.CalcError('BAD_REG', 'Нет такого регистра: ' + name));
        render();
        pendingReg = null;
        return;
      }
    }
    doReg(pendingReg, act);
    pendingReg = null;
  }

  function buildKeypad() {
    var pad = $('#keypad');
    pad.innerHTML = '';
    KEYPAD.forEach(function (row) {
      row.forEach(function (b) {
        var btn = el('button', 'key ' + (b.cls || ''), b.label);
        btn.type = 'button';
        if (b.id) btn.id = b.id;
        if (b.title) btn.title = b.title;
        btn.addEventListener('click', function () { b.act(); });
        pad.appendChild(btn);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Конструктор программ (панель справа)
  // ---------------------------------------------------------------------------
  function buildProgrammerPanel() {
    var ops = $('#ins-op');
    ops.innerHTML = '';
    Object.keys(PC.OPS).forEach(function (key) {
      ops.appendChild(new Option(PC.OPS[key].sym + ' — ' + PC.OPS[key].title, key));
    });

    var conds = $('#ins-cond');
    conds.innerHTML = '';
    PC.condList().forEach(function (key) {
      conds.appendChild(new Option(key, key));
    });
    conds.addEventListener('change', function () {
      if (this.value.indexOf('…') === 0) this.value = 'x>0';
    });

    var regs = $('#ins-reg');
    regs.innerHTML = '';
    PC.REG_NAMES.forEach(function (r) { regs.appendChild(new Option('R' + r, r)); });

    var labels = $('#ins-label');
    labels.innerHTML = '';
    PC.LABELS.forEach(function (l) { labels.appendChild(new Option(l, l)); });

    var target = $('#ins-target');
    target.innerHTML = '';
    PC.LABELS.forEach(function (l) { target.appendChild(new Option(l, l)); });
  }

  function onInsert(kind) {
    var at = selectedIndex >= 0 ? selectedIndex : calc.program.length - 1;
    var step;
    if (kind === 'op') step = { op: $('#ins-op').value };
    else if (kind === 'lit') {
      var v = parseFloat($('#ins-lit').value);
      if (Number.isNaN(v)) { fail(PC.CalcError('BAD_LIT', 'Введите число')); render(); return; }
      step = { lit: v };
    } else if (kind === 'jmp') step = { jmp: $('#ins-target').value };
    else if (kind === 'cond') {
      step = { cond: $('#ins-cond').value, jmp: $('#ins-target').value };
      var els = $('#ins-else').value.trim();
      if (els) step.els = isNaN(Number(els)) ? els : Number(els);
    } else if (kind === 'loop') step = { reg: $('#ins-reg').value, act: 'loop', jmp: $('#ins-target').value };
    else if (kind === 'reg') step = { reg: $('#ins-reg').value, act: $('#ins-regact').value };
    else if (kind === 'label') step = { label: $('#ins-label').value };
    else if (kind === 'call') step = { call: $('#ins-target').value };
    else if (kind === 'ret') step = { ret: true };
    else if (kind === 'stop') step = { stop: true };
    else if (kind === 'cmt') {
      var text = $('#ins-cmt').value.trim();
      if (!text) return;
      step = { cmt: text };
    } else return;

    try {
      PC.validateStep(step);
      calc.insertStep(at + 1, step);
      selectedIndex = at + 1;
      calc.pc = selectedIndex + 1;
    } catch (e) { fail(e); }
    render();
  }

  function onDeleteStep() {
    if (selectedIndex >= 0) removeStepAt(selectedIndex);
  }

  function onClearProgram() {
    if (!calc.program.length) return;
    if (confirm('Удалить всю программу?')) {
      calc.clearProgram();
      selectedIndex = -1;
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------------
  function init() {
    loadSettings();
    buildKeypad();
    buildProgrammerPanel();
    fillProgramLibrary();

    // режимы
    $('#mode-deg').addEventListener('click', function () { setAngleMode('DEG'); });
    $('#mode-rad').addEventListener('click', function () { setAngleMode('RAD'); });
    $('#mode-grad').addEventListener('click', function () { setAngleMode('GRAD'); });
    $('#format-auto').addEventListener('click', function () { $('#format-mode').value = 'auto'; setFormat('auto'); });
    $('#format-mode').addEventListener('change', function () { setFormat(this.value); });
    $('#format-digits').addEventListener('change', function () {
      calc.format.digits = Number(this.value) || 8;
      saveSettings(); render();
    });

    // программные кнопки
    $('#btn-run').addEventListener('click', function () { runProgram({}); });
    $('#btn-step').addEventListener('click', function () { runProgram({ stepOnce: true }); });
    $('#btn-reset-step').addEventListener('click', function () { runProgram({ stepOnce: true, fromStart: true }); });
    $('#btn-stop').addEventListener('click', stopProgram);
    $('#btn-progmode').addEventListener('click', toggleProgramMode);
    $('#btn-clear-program').addEventListener('click', onClearProgram);
    $('#btn-del-step').addEventListener('click', onDeleteStep);

    // конструктор
    $$('#programmer .ins-btn').forEach(function (b) {
      b.addEventListener('click', function () { onInsert(b.dataset.insert); });
    });

    // примеры и библиотека
    var exSel = $('#examples');
    Object.keys(EXAMPLES).forEach(function (k) { exSel.appendChild(new Option(EXAMPLES[k].name, k)); });
    exSel.addEventListener('change', function () { if (this.value) loadExample(this.value); });

    $('#btn-save-program').addEventListener('click', saveProgramToLibrary);
    $('#btn-load-program').addEventListener('click', loadProgramFromLibrary);
    $('#btn-export').addEventListener('click', exportProgram);
    $('#btn-import').addEventListener('click', importProgram);

    // ввод
    $('#display').addEventListener('click', function () {
      if (programMode) toggleProgramMode();
    });

    document.addEventListener('keydown', onKey);

    // стартовый пример
    loadExample('sum');
    $('#example-info').textContent = EXAMPLES.sum.name + ' — ' + EXAMPLES.sum.desc;
    calc.pc = 0;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // отладочный доступ из консоли
  window.calc = calc;
  window.ProgCalc = PC;
})();
