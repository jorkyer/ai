/*
 * Программируемый калькулятор — ядро (движок).
 *
 * Модель: стековый калькулятор с 4 регистрами стека (X, Y, Z, T),
 * 16 адресными регистрами (0-9, A-F), программой из пронумерованных шагов,
 * условными/безусловными переходами, метками, подпрограммами и флагами.
 *
 * Файл не зависит от DOM и может использоваться из Node.js (см. test/engine.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProgCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Константы
  // ---------------------------------------------------------------------------

  var REG_COUNT = 16;
  var REG_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'A', 'B', 'C', 'D', 'E', 'F'];
  var LABELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'];
  var MAX_PROGRAM_STEPS = 1000;
  var DEFAULT_STEP_LIMIT = 200000;

  // Описание всех операций калькулятора.
  // arity: сколько чисел берётся из стека; push: сколько кладётся обратно.
  var OPS = {
    add: { sym: '+', title: 'Сложение', fn: function (a, b) { return b + a; }, arity: 2 },
    sub: { sym: '−', title: 'Вычитание (Y − X)', fn: function (a, b) { return b - a; }, arity: 2 },
    mul: { sym: '×', title: 'Умножение', fn: function (a, b) { return b * a; }, arity: 2 },
    div: { sym: '÷', title: 'Деление (Y ÷ X)', fn: function (a, b) { return b / a; }, arity: 2 },
    pow: { sym: 'yˣ', title: 'Степень (Y^X)', fn: function (a, b) { return Math.pow(b, a); }, arity: 2 },
    root: { sym: 'ˣ√y', title: 'Корень степени X из Y', fn: function (a, b) { return Math.pow(b, 1 / a); }, arity: 2 },
    logyx: {
      sym: 'log_y x', title: 'Логарифм X по основанию Y', arity: 2,
      fn: function (a, b) { return Math.log(a) / Math.log(b); }
    },
    hyp: {
      sym: 'hyp', title: 'Гипотенуза √(X²+Y²)', arity: 2,
      fn: function (a, b) { return Math.sqrt(a * a + b * b); }
    },

    neg: { sym: '/−/', title: 'Смена знака X', fn: function (a) { return -a; }, arity: 1 },
    abs: { sym: '|x|', title: 'Модуль X', fn: function (a) { return Math.abs(a); }, arity: 1 },
    inv: { sym: '1/x', title: 'Обратная величина', fn: function (a) { return 1 / a; }, arity: 1 },
    sqr: { sym: 'x²', title: 'Квадрат', fn: function (a) { return a * a; }, arity: 1 },
    sqrt: { sym: '√x', title: 'Квадратный корень', fn: function (a) { return Math.sqrt(a); }, arity: 1 },
    cbrt: { sym: '∛x', title: 'Кубический корень', fn: function (a) { return Math.cbrt(a); }, arity: 1 },
    exp: { sym: 'eˣ', title: 'Экспонента', fn: function (a) { return Math.exp(a); }, arity: 1 },
    pow10: { sym: '10ˣ', title: 'Десять в степени X', fn: function (a) { return Math.pow(10, a); }, arity: 1 },
    ln: { sym: 'ln', title: 'Натуральный логарифм', fn: function (a) { return Math.log(a); }, arity: 1 },
    lg: { sym: 'lg', title: 'Десятичный логарифм', fn: function (a) { return Math.log10(a); }, arity: 1 },
    fact: { sym: 'x!', title: 'Факториал', fn: function (a) { return factorial(a); }, arity: 1 },
    frac: { sym: '{x}', title: 'Дробная часть', fn: function (a) { return a - Math.trunc(a); }, arity: 1 },
    floor: { sym: '⌊x⌋', title: 'Округление вниз', fn: function (a) { return Math.floor(a); }, arity: 1 },
    ceil: { sym: '⌈x⌉', title: 'Округление вверх', fn: function (a) { return Math.ceil(a); }, arity: 1 },
    round: { sym: 'round', title: 'Округление до целого', fn: function (a) { return Math.round(a); }, arity: 1 },
    int: { sym: 'int', title: 'Целая часть', fn: function (a) { return Math.trunc(a); }, arity: 1 },
    rand: { sym: 'rnd', title: 'Случайное число [0;1)', fn: function () { return Math.random(); }, arity: 0 },

    sin: { sym: 'sin', title: 'Синус', arity: 1, fn: function (a, c) { return Math.sin(c.toRad(a)); }, angle: true },
    cos: { sym: 'cos', title: 'Косинус', arity: 1, fn: function (a, c) { return Math.cos(c.toRad(a)); }, angle: true },
    tan: { sym: 'tan', title: 'Тангенс', arity: 1, fn: function (a, c) { return Math.tan(c.toRad(a)); }, angle: true },
    asin: {
      sym: 'sin⁻¹', title: 'Арксинус', arity: 1, angle: true,
      fn: function (a, c) { return c.fromRad(Math.asin(a)); }
    },
    acos: {
      sym: 'cos⁻¹', title: 'Арккосинус', arity: 1, angle: true,
      fn: function (a, c) { return c.fromRad(Math.acos(a)); }
    },
    atan: {
      sym: 'tan⁻¹', title: 'Арктангенс', arity: 1, angle: true,
      fn: function (a, c) { return c.fromRad(Math.atan(a)); }
    },
    sinh: { sym: 'sh', title: 'Гиперболический синус', arity: 1, fn: function (a) { return Math.sinh(a); } },
    cosh: { sym: 'ch', title: 'Гиперболический косинус', arity: 1, fn: function (a) { return Math.cosh(a); } },
    tanh: { sym: 'th', title: 'Гиперболический тангенс', arity: 1, fn: function (a) { return Math.tanh(a); } },

    pi: { sym: 'π', title: 'Число π', arity: 0, value: Math.PI },
    e: { sym: 'e', title: 'Число e', arity: 0, value: Math.E },
    deg: { sym: '→°', title: 'Радианы в градусы', arity: 1, fn: function (a) { return a * 180 / Math.PI; } },
    rad: { sym: '→rad', title: 'Градусы в радианы', arity: 1, fn: function (a) { return a * Math.PI / 180; } },

    dup: { sym: 'x²→x', title: 'Дублировать X (копия в стек)', arity: 1, stack: 'dup' },
    swap: { sym: 'XY', title: 'Обмен X и Y', arity: 2, stack: 'swap' },
    rot: { sym: 'R↓', title: 'Прокрутка стека вниз', arity: 0, stack: 'rot' },
    drop: { sym: '←', title: 'Вытолкнуть X (стек сдвигается вверх)', arity: 0, stack: 'drop' },
    clr: { sym: 'C', title: 'Очистка: X=0, стек обнулён', arity: 0, stack: 'clear' }
  };

  // Операции, влияющие на результат сравнения / переходы.
  var CMP_OPS = {
    'x=0': function (x) { return x === 0; },
    'x≠0': function (x) { return x !== 0; },
    'x>0': function (x) { return x > 0; },
    'x≥0': function (x) { return x >= 0; },
    'x<0': function (x) { return x < 0; },
    'x≤0': function (x) { return x <= 0; },
    'x=1': function (x) { return x === 1; },
    'x≠1': function (x) { return x !== 1; },
    'x>1': function (x) { return x > 1; },
    'x≥1': function (x) { return x >= 1; },
    'x<1': function (x) { return x < 1; },
    'x≤1': function (x) { return x <= 1; },
    '0<x<1': function (x) { return x > 0 && x < 1; },
    'x=π': function (x) { return x === Math.PI; },
    'F0': function (x, c) { return c.flags[0] === 1; },
    'F1': function (x, c) { return c.flags[1] === 1; },
    'F2': function (x, c) { return c.flags[2] === 1; },
    'F3': function (x, c) { return c.flags[3] === 1; }
  };

  // Условия вида «x <знак> <число>», например x>10, x=-3.5, x≥0.25
  function parseCond(name) {
    var m = /^x\s*(≥|≤|≠|>=|<=|!=|<>|=|==|>|<)\s*(-?\d*\.?\d+(?:e-?\d+)?)$/i.exec(String(name).trim());
    if (!m) return null;
    var sign = m[1];
    var k = parseFloat(m[2]);
    var test = {
      '=': function (x) { return x === k; },
      '≠': function (x) { return x !== k; },
      '>': function (x) { return x > k; },
      '<': function (x) { return x < k; },
      '≥': function (x) { return x >= k; },
      '≤': function (x) { return x <= k; }
    }[{'==': '=', '!=': '≠', '<>': '≠', '>=': '≥', '<=': '≤'}[sign] || sign];
    return test || null;
  }

  /** Проверить условие перехода для текущего X. */
  function checkCond(name, calc) {
    if (CMP_OPS[name]) return CMP_OPS[name](calc.stack[0], calc);
    var parsed = parseCond(name);
    if (!parsed) throw CalcError('BAD_COND', 'Неизвестное условие: ' + name);
    return parsed(calc.stack[0], calc);
  }

  /** Все доступные условия (именованные + подсказка о форме «x>число»). */
  function condList() {
    return Object.keys(CMP_OPS).concat(['x>10', 'x≤-1', '… (любое «x знак число»)']);
  }

  function factorial(n) {
    if (n < 0 || n !== Math.floor(n)) {
      // Гамма-функция для нецелых (аппроксимация Ланцоша)
      return gamma(n + 1);
    }
    if (n > 170) return Infinity;
    var r = 1;
    for (var i = 2; i <= n; i++) r *= i;
    return r;
  }

  function gamma(z) {
    var g = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) {
      return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    var x = 0.99999999999980993;
    for (var i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
    var t = z + g.length - 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  // ---------------------------------------------------------------------------
  // Ошибки
  // ---------------------------------------------------------------------------

  function CalcError(code, message) {
    var err = new Error(message);
    err.name = 'CalcError';
    err.code = code;
    return err;
  }

  // ---------------------------------------------------------------------------
  // Калькулятор
  // ---------------------------------------------------------------------------

  function Calculator() {
    this.reset();
  }

  Calculator.prototype.reset = function () {
    this.stack = [0, 0, 0, 0];      // [X, Y, Z, T]
    this.regs = new Array(REG_COUNT).fill(0);
    this.flags = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.angleMode = 'DEG';          // DEG | RAD | GRAD
    this.format = { mode: 'auto', digits: 8 }; // auto | fix | sci | eng
    this.error = null;

    // программная часть
    this.program = [];
    this.pc = 0;
    this.running = false;
    this.returnStack = [];
    this.stepLimit = DEFAULT_STEP_LIMIT;
    this.stepsExecuted = 0;
    this.halted = false;
    return this;
  };

  // --- стек ------------------------------------------------------------------

  Calculator.prototype.x = function () { return this.stack[0]; };
  Calculator.prototype.y = function () { return this.stack[1]; };
  Calculator.prototype.z = function () { return this.stack[2]; };
  Calculator.prototype.t = function () { return this.stack[3]; };

  Calculator.prototype.push = function (v) {
    this.guard(v);
    this.stack[3] = this.stack[2];
    this.stack[2] = this.stack[1];
    this.stack[1] = this.stack[0];
    this.stack[0] = v;
    return this;
  };

  Calculator.prototype.pop = function () {
    var v = this.stack[0];
    this.stack[0] = this.stack[1];
    this.stack[1] = this.stack[2];
    this.stack[2] = this.stack[3];
    return v;
  };

  Calculator.prototype.guard = function (v) {
    if (typeof v !== 'number') throw CalcError('BAD_VALUE', 'Не числовое значение: ' + v);
    if (Number.isNaN(v)) throw CalcError('NAN', 'Результат не определён (NaN)');
    return v;
  };

  // --- углы ------------------------------------------------------------------

  Calculator.prototype.toRad = function (v) {
    switch (this.angleMode) {
      case 'RAD': return v;
      case 'GRAD': return v * Math.PI / 200;
      default: return v * Math.PI / 180;
    }
  };

  Calculator.prototype.fromRad = function (v) {
    switch (this.angleMode) {
      case 'RAD': return v;
      case 'GRAD': return v * 200 / Math.PI;
      default: return v * 180 / Math.PI;
    }
  };

  // --- операции --------------------------------------------------------------

  /**
   * Выполнить операцию калькулятора.
   * @param {string} op ключ из OPS
   * @param {number} [arg] необязательный аргумент (константа из программы)
   */
  Calculator.prototype.op = function (op, arg) {
    var spec = OPS[op];
    if (!spec) throw CalcError('UNKNOWN_OP', 'Неизвестная операция: ' + op);

    var result;

    if (spec.stack === 'dup') {
      // копия X pushed наверх: [X,Y,Z,T] -> [X,X,Y,Z]
      this.push(this.stack[0]);
    } else if (spec.stack === 'swap') {
      var tmp = this.stack[0];
      this.stack[0] = this.stack[1];
      this.stack[1] = tmp;
    } else if (spec.stack === 'rot') {
      // прокрутка стека «вниз»: X уходит наверх, остальные сдвигаются
      var x = this.stack[0], y = this.stack[1], z = this.stack[2], t = this.stack[3];
      this.stack[0] = y; this.stack[1] = z; this.stack[2] = t; this.stack[3] = x;
    } else if (spec.stack === 'drop') {
      // вытолкнуть X: [X,Y,Z,T] -> [Y,Z,T,0]
      this.pop();
      this.stack[3] = 0;
    } else if (spec.stack === 'clear') {
      this.stack = [0, 0, 0, 0];
    } else if (typeof spec.value === 'number') {
      this.push(spec.value);
    } else if (spec.arity === 2) {
      // результат кладётся на место Y, X снимается: [X,Y,Z,T] -> [f(Y,X),Z,T,0]
      var a = this.stack[0], b = this.stack[1];
      if (op === 'div' && a === 0) throw CalcError('DIV0', 'Деление на ноль');
      result = spec.fn(a, b, this);
      this.guard(result);
      this.pop();             // Y становится X
      this.stack[0] = result; // X заменяется результатом
    } else if (spec.arity === 1) {
      result = spec.fn(this.stack[0], this);
      this.guard(result);
      this.stack[0] = result;
    } else {
      result = spec.fn(arg, this);
      this.guard(result);
      this.push(result);
    }

    this.error = null;
    return this;
  };

  /** Ввести число в X, сдвинув стек (как набор числа с клавиатуры). */
  Calculator.prototype.enter = function (value) {
    this.guard(value);
    this.push(value);
    return this;
  };

  // --- регистры --------------------------------------------------------------

  Calculator.prototype.regIndex = function (name) {
    var i = REG_NAMES.indexOf(String(name).toUpperCase());
    if (i < 0) throw CalcError('BAD_REG', 'Нет такого регистра: ' + name);
    return i;
  };

  Calculator.prototype.recall = function (name) {
    return this.push(this.regs[this.regIndex(name)]);
  };

  Calculator.prototype.store = function (name) {
    this.regs[this.regIndex(name)] = this.stack[0];
    return this;
  };

  /** R±: прибавить X к регистру, X остаётся на месте (классическая R+). */
  Calculator.prototype.addStore = function (name, sign) {
    var i = this.regIndex(name);
    this.regs[i] += sign * this.stack[0];
    return this;
  };

  /**
   * Счётчик цикла: Rx = Rx − 1; переход по адресу step, если Rx ≠ 0.
   * @returns {boolean} true — переход выполнен
   */
  Calculator.prototype.loop = function (name, step) {
    var i = this.regIndex(name);
    this.regs[i] -= 1;
    if (this.regs[i] !== 0) {
      this.pc = step;
      return true;
    }
    return false;
  };

  Calculator.prototype.setFlag = function (n, v) { this.flags[n] = v ? 1 : 0; return this; };

  // ---------------------------------------------------------------------------
  // Программы
  // ---------------------------------------------------------------------------

  /**
   * Шаг программы. Допустимые виды:
   *   {op:'add'}                      — операция калькулятора
   *   {op:'add', arg:5}               — операция с константой (для arity 0)
   *   {label:'L3'}                    — метка (ничего не делает)
   *   {jmp:'L3'}                      — безусловный переход
   *   {jmp:12}                        — безусловный переход на шаг №12
   *   {cond:'x=0', jmp:'L3'}          — условный переход
   *   {cond:'x=0', jmp:12, els:20}    — условный переход с веткой «иначе»
   *   {reg:'1', act:'store'}          — работа с регистром: store|recall|add|sub|loop
   *   {reg:'1', act:'loop', jmp:'L0'}  — счётчик цикла
   *   {lit:3.14}                      — ввести константу в X
   *   {call:'L1'}                     — вызов подпрограммы
   *   {ret:true}                      — возврат из подпрограммы
   *   {stop:true}                     — останов программы
   *   {flg:3, act:'set'|'clear'}      — флаг
   *   {cmt:'текст'}                   — комментарий
   */
  Calculator.prototype.addStep = function (step) {
    if (this.program.length >= MAX_PROGRAM_STEPS) {
      throw CalcError('PROG_FULL', 'Программа слишком длинная (макс. ' + MAX_PROGRAM_STEPS + ' шагов)');
    }
    validateStep(step);
    this.program.push(step);
    return this.program.length - 1;
  };

  Calculator.prototype.insertStep = function (index, step) {
    validateStep(step);
    index = Math.max(0, Math.min(index, this.program.length));
    this.program.splice(index, 0, step);
    return index;
  };

  Calculator.prototype.removeStep = function (index) {
    if (index < 0 || index >= this.program.length) return null;
    return this.program.splice(index, 1)[0];
  };

  Calculator.prototype.clearProgram = function () {
    this.program = [];
    this.pc = 0;
    this.running = false;
    this.halted = false;
    this.returnStack = [];
    return this;
  };

  Calculator.prototype.setProgram = function (steps) {
    this.clearProgram();
    (steps || []).forEach(function (s) { this.addStep(s); }, this);
    return this;
  };

  /** Номер шага, на который указывает цель (метка или номер). */
  Calculator.prototype.resolve = function (target) {
    if (typeof target === 'number') {
      if (target < 0 || target > this.program.length) {
        throw CalcError('BAD_ADDR', 'Неверный адрес перехода: ' + target);
      }
      return target;
    }
    var name = String(target).toUpperCase();
    for (var i = 0; i < this.program.length; i++) {
      if (this.program[i].label && this.program[i].label.toUpperCase() === name) return i;
    }
    throw CalcError('NO_LABEL', 'Метка не найдена: ' + target);
  };

  function validateStep(step) {
    if (!step || typeof step !== 'object') throw CalcError('BAD_STEP', 'Шаг должен быть объектом');
    if (step.op && !OPS[step.op]) throw CalcError('UNKNOWN_OP', 'Неизвестная операция: ' + step.op);
    if (step.cond && !CMP_OPS[step.cond] && !parseCond(step.cond)) {
      throw CalcError('BAD_COND', 'Неизвестное условие: ' + step.cond);
    }
    if (step.reg && REG_NAMES.indexOf(String(step.reg).toUpperCase()) < 0) {
      throw CalcError('BAD_REG', 'Нет такого регистра: ' + step.reg);
    }
    if (step.lit !== undefined && (typeof step.lit !== 'number' || Number.isNaN(step.lit))) {
      throw CalcError('BAD_LIT', 'Константа должна быть числом');
    }
  }

  /** Выполнить один шаг программы. Возвращает true, если программа ещё идёт. */
  Calculator.prototype.step = function () {
    if (this.halted) return false;
    if (this.pc >= this.program.length) {
      this.halted = true;
      this.running = false;
      return false;
    }
    var s = this.program[this.pc];
    this.pc += 1;
    this.stepsExecuted += 1;
    this.execStep(s);
    return !this.halted;
  };

  Calculator.prototype.execStep = function (s) {
    if (s.label || s.cmt) return;                     // метки и комментарии ничего не делают

    if (s.stop) { this.halted = true; this.running = false; return; }

    if (s.lit !== undefined) { this.push(s.lit); return; }

    if (s.op) {
      var spec = OPS[s.op];
      if (s.arg !== undefined && spec && spec.arity === 0) this.push(s.arg);
      this.op(s.op);
      return;
    }

    if (s.reg) {
      var act = s.act || 'recall';
      if (act === 'loop') {
        var target = this.resolve(s.jmp);
        this.loop(s.reg, target);
      } else if (act === 'store') {
        this.store(s.reg);
      } else if (act === 'add') {
        this.addStore(s.reg, 1);
      } else if (act === 'sub') {
        this.addStore(s.reg, -1);
      } else {
        this.recall(s.reg);
      }
      return;
    }

    if (s.flg !== undefined) {
      this.setFlag(s.flg, s.act === 'clear' ? 0 : 1);
      return;
    }

    if (s.call) {
      this.returnStack.push(this.pc);
      this.pc = this.resolve(s.call);
      return;
    }

    if (s.ret) {
      if (!this.returnStack.length) throw CalcError('RET', 'Возврат без вызова подпрограммы');
      this.pc = this.returnStack.pop();
      return;
    }

    if (s.cond) {
      var ok = checkCond(s.cond, this);
      if (ok) { this.pc = this.resolve(s.jmp); }
      else if (s.els !== undefined) { this.pc = this.resolve(s.els); }
      return;
    }

    if (s.jmp !== undefined) { this.pc = this.resolve(s.jmp); return; }

    throw CalcError('BAD_STEP', 'Пустой или неверный шаг программы');
  };

  /** Запустить программу до остановки. */
  Calculator.prototype.run = function (opts) {
    opts = opts || {};
    var limit = opts.limit || this.stepLimit;
    this.running = true;
    this.halted = false;
    this.error = null;
    this.stepsExecuted = 0;
    this.returnStack = [];
    if (opts.fromStart !== false) this.pc = 0;

    var count = 0;
    try {
      while (!this.halted && this.pc < this.program.length) {
        this.step();
        if (++count > limit) {
          this.halted = true;
          this.running = false;
          throw CalcError('LOOP', 'Превышен лимит шагов (' + limit + '). Программа остановлена.');
        }
      }
    } catch (e) {
      this.running = false;
      this.halted = true;
      this.error = e;
      throw e;
    }
    this.running = false;
    return this;
  };

  // ---------------------------------------------------------------------------
  // Форматирование числа
  // ---------------------------------------------------------------------------

  Calculator.prototype.formatNumber = function (v) {
    return formatNumber(v, this.format);
  };

  function formatNumber(v, fmt) {
    fmt = fmt || { mode: 'auto', digits: 8 };
    if (typeof v !== 'number' || Number.isNaN(v)) return 'НЕ ОПР.';
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (v === 0) return fmt.mode === 'fix' ? (0).toFixed(fmt.digits) : '0';

    var abs = Math.abs(v);
    var digits = fmt.digits == null ? 8 : fmt.digits;

    if (fmt.mode === 'fix') {
      if (abs >= 1e12 || (abs < 1e-9 && abs > 0)) return toSci(v, digits);
      var s = v.toFixed(digits);
      return trimZeros(s);
    }
    if (fmt.mode === 'sci') return toSci(v, digits);
    if (fmt.mode === 'eng') return toEng(v, digits);

    // auto
    if (abs >= 1e12 || abs < 1e-9) return toSci(v, digits);
    var out = String(Math.round(v * 1e10) / 1e10);
    if (out.replace(/[-.]/g, '').length > 12) out = toSci(v, digits);
    return out;
  }

  function trimZeros(s) {
    if (s.indexOf('.') < 0) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }

  function toSci(v, digits) {
    var exp = Math.floor(Math.log10(Math.abs(v)));
    var m = v / Math.pow(10, exp);
    var ms = m.toFixed(Math.max(0, digits - 1)).replace(/0+$/, '').replace(/\.$/, '');
    return ms + 'e' + (exp < 0 ? '−' : '') + Math.abs(exp);
  }

  function toEng(v, digits) {
    var exp = Math.floor(Math.log10(Math.abs(v)));
    var e3 = Math.floor(exp / 3) * 3;
    var m = v / Math.pow(10, e3);
    var ms = m.toFixed(Math.max(0, digits - 1)).replace(/0+$/, '').replace(/\.$/, '');
    return ms + 'e' + (e3 < 0 ? '−' : '') + Math.abs(e3);
  }

  // ---------------------------------------------------------------------------
  // Человекочитаемое представление шага (для листинга и отладки)
  // ---------------------------------------------------------------------------

  function stepToString(s) {
    if (s.cmt) return '// ' + s.cmt;
    if (s.label) return s.label + ':';
    if (s.stop) return 'СТОП';
    if (s.lit !== undefined) return '→X ' + s.lit;
    if (s.op) {
      var spec = OPS[s.op];
      return (spec ? spec.sym : s.op) + (s.arg !== undefined ? ' ' + s.arg : '');
    }
    if (s.reg) {
      var act = s.act || 'recall';
      var r = 'R' + s.reg;
      if (act === 'loop') return r + '−1 → ≠0: ' + s.jmp;
      if (act === 'store') return '→ ' + r;
      if (act === 'add') return r + ' + X → ' + r;
      if (act === 'sub') return r + ' − X → ' + r;
      return r + ' → X';
    }
    if (s.flg !== undefined) return (s.act === 'clear' ? 'СБРОС F' : 'УСТ F') + s.flg;
    if (s.call) return 'ВЫЗОВ ' + s.call;
    if (s.ret) return 'ВОЗВРАТ';
    if (s.cond) {
      return 'ЕСЛИ ' + s.cond + ' → ' + s.jmp + (s.els !== undefined ? ' ИНАЧЕ ' + s.els : '');
    }
    if (s.jmp !== undefined) return 'ПЕРЕХОД ' + s.jmp;
    return '???';
  }

  // ---------------------------------------------------------------------------
  // Сериализация
  // ---------------------------------------------------------------------------

  Calculator.prototype.serialize = function () {
    return {
      version: 1,
      angleMode: this.angleMode,
      format: this.format,
      regs: this.regs.slice(),
      flags: this.flags.slice(),
      stack: this.stack.slice(),
      program: JSON.parse(JSON.stringify(this.program))
    };
  };

  Calculator.prototype.load = function (data) {
    if (!data || typeof data !== 'object') throw CalcError('BAD_STATE', 'Неверный формат состояния');
    this.reset();
    if (data.angleMode) this.angleMode = data.angleMode;
    if (data.format) this.format = data.format;
    // программа задаётся первой: setProgram() очищает состояние выполнения
    if (Array.isArray(data.program)) this.setProgram(data.program);
    if (Array.isArray(data.regs)) this.regs = data.regs.slice(0, REG_COUNT);
    if (Array.isArray(data.flags)) this.flags = data.flags.slice(0, 10);
    if (Array.isArray(data.stack)) this.stack = data.stack.slice(0, 4);
    return this;
  };

  // ---------------------------------------------------------------------------
  // Публичный API модуля
  // ---------------------------------------------------------------------------

  return {
    Calculator: Calculator,
    OPS: OPS,
    CMP_OPS: CMP_OPS,
    REG_NAMES: REG_NAMES,
    LABELS: LABELS,
    MAX_PROGRAM_STEPS: MAX_PROGRAM_STEPS,
    formatNumber: formatNumber,
    stepToString: stepToString,
    CalcError: CalcError,
    validateStep: validateStep,
    checkCond: checkCond,
    parseCond: parseCond,
    condList: condList
  };
});
