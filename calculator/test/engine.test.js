/* Тесты ядра программируемого калькулятора. Запуск: node calculator/test/engine.test.js */
'use strict';

const assert = require('assert');
const PC = require('../js/engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}

const EXAMPLES = require('../js/examples.js');
const C = () => new PC.Calculator();
const EX = key => EXAMPLES[key];

console.log('Стек и арифметика');

test('2 + 3 = 5', () => {
  const c = C();
  c.enter(2).enter(3).op('add');
  assert.strictEqual(c.x(), 5);
});

test('10 − 4 = 6 (порядок Y − X)', () => {
  const c = C();
  c.enter(10).enter(4).op('sub');
  assert.strictEqual(c.x(), 6);
});

test('6 × 7 = 42', () => {
  const c = C();
  c.enter(6).enter(7).op('mul');
  assert.strictEqual(c.x(), 42);
});

test('9 ÷ 3 = 3', () => {
  const c = C();
  c.enter(9).enter(3).op('div');
  assert.strictEqual(c.x(), 3);
});

test('деление на ноль — ошибка', () => {
  const c = C();
  c.enter(1).enter(0);
  assert.throws(() => c.op('div'), e => e.code === 'DIV0');
});

test('2 ^ 10 = 1024', () => {
  const c = C();
  c.enter(2).enter(10).op('pow');
  assert.strictEqual(c.x(), 1024);
});

test('бинарная операция не дырявит стек: 3 4 5 × = 20, дальше + 3 = 23', () => {
  const c = C();
  [3, 4, 5].forEach(v => c.enter(v));
  c.op('mul');
  assert.deepStrictEqual(c.stack, [20, 3, 0, 0]);
  c.op('add');
  assert.deepStrictEqual(c.stack, [23, 0, 0, 0]);
});

test('при делении на ноль стек остаётся целым', () => {
  const c = C();
  c.enter(8).enter(0);
  assert.throws(() => c.op('div'), e => e.code === 'DIV0');
  assert.deepStrictEqual(c.stack, [0, 8, 0, 0]);
});

test('стек сдвигается: T не теряется', () => {
  const c = C();
  [1, 2, 3, 4, 5].forEach(v => c.enter(v));
  assert.deepStrictEqual(c.stack, [5, 4, 3, 2]);
});

test('dup, swap, drop', () => {
  const c = C();
  c.enter(7).op('dup');
  assert.deepStrictEqual(c.stack.slice(0, 2), [7, 7]);
  c.enter(3).op('swap');
  assert.strictEqual(c.x(), 7);
  c.op('drop');
  assert.strictEqual(c.x(), 3);
});

console.log('\nФункции и углы');

test('√16 = 4, 5! = 120', () => {
  const c = C();
  c.enter(16).op('sqrt');
  assert.strictEqual(c.x(), 4);
  c.enter(5).op('fact');
  assert.strictEqual(c.x(), 120);
});

test('sin(30°) = 0.5 в режиме DEG', () => {
  const c = C();
  c.angleMode = 'DEG';
  c.enter(30).op('sin');
  assert.ok(Math.abs(c.x() - 0.5) < 1e-12);
});

test('sin(π/2) = 1 в режиме RAD', () => {
  const c = C();
  c.angleMode = 'RAD';
  c.enter(Math.PI / 2).op('sin');
  assert.ok(Math.abs(c.x() - 1) < 1e-12);
});

test('asin(0.5) = 30° с учётом режима', () => {
  const c = C();
  c.angleMode = 'DEG';
  c.enter(0.5).op('asin');
  assert.ok(Math.abs(c.x() - 30) < 1e-12);
});

test('ln(e) = 1, lg(1000) = 3, 10^x = 100', () => {
  const c = C();
  c.op('e').op('ln');
  assert.ok(Math.abs(c.x() - 1) < 1e-12);
  c.enter(1000).op('lg');
  assert.ok(Math.abs(c.x() - 3) < 1e-12);
  c.enter(2).op('pow10');
  assert.strictEqual(c.x(), 100);
});

test('π и e — константы', () => {
  const c = C();
  c.op('pi');
  assert.strictEqual(c.x(), Math.PI);
  c.op('e');
  assert.strictEqual(c.x(), Math.E);
});

console.log('\nРегистры и флаги');

test('store / recall R5', () => {
  const c = C();
  c.enter(42).store('5');
  c.stack = [0, 0, 0, 0];
  c.recall('5');
  assert.strictEqual(c.x(), 42);
});

test('R+ и R− накапливают', () => {
  const c = C();
  c.enter(10).store('A');
  c.enter(5).addStore('A', 1);
  assert.strictEqual(c.regs[c.regIndex('A')], 15);
  c.enter(3).addStore('A', -1);
  assert.strictEqual(c.regs[c.regIndex('A')], 12);
});

test('реестр A-F работает наравне с 0-9', () => {
  const c = C();
  c.enter(7).store('F');
  assert.strictEqual(c.regs[15], 7);
});

test('неверный регистр — ошибка', () => {
  const c = C();
  assert.throws(() => c.recall('Q'), e => e.code === 'BAD_REG');
});

test('флаги ставятся и сбрасываются', () => {
  const c = C();
  c.setFlag(2, true);
  assert.strictEqual(c.flags[2], 1);
  c.setFlag(2, false);
  assert.strictEqual(c.flags[2], 0);
});

console.log('\nПрограммы');

test('программа: (2+3)×4 = 20', () => {
  const c = C();
  c.setProgram([
    { lit: 2 }, { lit: 3 }, { op: 'add' }, { lit: 4 }, { op: 'mul' }, { stop: true }
  ]);
  c.run();
  assert.strictEqual(c.x(), 20);
  assert.strictEqual(c.stepsExecuted, 6);
});

test('условный переход по метке', () => {
  const c = C();
  c.setProgram([
    { lit: -5 },
    { cond: 'x<0', jmp: 'L1' },
    { lit: 100 },
    { stop: true },
    { label: 'L1' },
    { op: 'abs' },
    { stop: true }
  ]);
  c.run();
  assert.strictEqual(c.x(), 5);
});

test('ветка «иначе» (els)', () => {
  const c = C();
  c.setProgram([
    { lit: 3 },
    { cond: 'x>10', jmp: 'L1', els: 'L2' },
    { label: 'L1' }, { lit: 111 }, { stop: true },
    { label: 'L2' }, { lit: 222 }, { stop: true }
  ]);
  c.run();
  assert.strictEqual(c.x(), 222);
});

test('счётчик цикла R−1: сумма 1..10 = 55', () => {
  const c = C();
  c.setProgram(EX('sum').program);
  c.enter(10);
  c.run();
  assert.strictEqual(c.x(), 55);
});

test('факториал 6 = 720', () => {
  const c = C();
  c.setProgram(EX('fact').program);
  c.enter(6);
  c.run();
  assert.strictEqual(c.x(), 720);
});

test('фибоначчи F(10) = 55', () => {
  const c = C();
  c.setProgram(EX('fib').program);
  c.enter(10);
  c.run();
  assert.strictEqual(c.x(), 55);
});

test('корень Ньютона: √2 ≈ 1.41421356', () => {
  const c = C();
  c.setProgram(EX('sqrt').program);
  c.enter(2);
  c.run();
  assert.ok(Math.abs(c.x() - Math.SQRT2) < 1e-12, 'получено ' + c.x());
});

test('подпрограмма CALL/RET: 2^8 = 256', () => {
  const c = C();
  c.setProgram(EX('sub').program);
  c.enter(8);
  c.run();
  assert.strictEqual(c.x(), 256);
});

test('квадратное уравнение: x² − 5x + 6 → корни 3 и 2', () => {
  const c = C();
  c.setProgram(EX('quad').program);
  c.regs[c.regIndex('1')] = 1;   // a
  c.regs[c.regIndex('2')] = -5;  // b
  c.regs[c.regIndex('3')] = 6;   // c
  c.run();
  assert.strictEqual(c.x(), 3);              // x1 в X
  assert.strictEqual(c.regs[c.regIndex('7')], 2); // x2 в R7
  assert.strictEqual(c.regs[c.regIndex('4')], 1); // D в R4
});

test('условия с произвольной константой: x>10, x=-3.5, x≤0.25', () => {
  const c = C();
  c.enter(15);
  assert.strictEqual(PC.checkCond('x>10', c), true);
  assert.strictEqual(PC.checkCond('x > 100', c), false);
  assert.strictEqual(PC.checkCond('x>=15', c), true);
  c.stack[0] = -3.5;
  assert.strictEqual(PC.checkCond('x=-3.5', c), true);
  assert.strictEqual(PC.checkCond('x≤0.25', c), true);
  assert.throws(() => PC.checkCond('x~3', c), e => e.code === 'BAD_COND');
  PC.validateStep({ cond: 'x>10', jmp: 'L0' }); // не бросает
});

test('переход по номеру шага', () => {
  const c = C();
  c.setProgram([{ lit: 1 }, { jmp: 3 }, { lit: 99 }, { lit: 5 }, { stop: true }]);
  c.run();
  assert.strictEqual(c.x(), 5);
});

test('бесконечный цикл прерывается по лимиту', () => {
  const c = C();
  c.setProgram([{ label: 'L0' }, { jmp: 'L0' }]);
  assert.throws(() => c.run({ limit: 100 }), e => e.code === 'LOOP');
  assert.strictEqual(c.halted, true);
});

test('отсутствующая метка — ошибка NO_LABEL', () => {
  const c = C();
  c.setProgram([{ lit: 1 }]);
  c.run();
  assert.strictEqual(c.x(), 1);
  c.setProgram([{ jmp: 'L7' }]);
  assert.throws(() => c.run(), e => e.code === 'NO_LABEL');
});

test('пошаговое выполнение (step)', () => {
  const c = C();
  c.setProgram([{ lit: 2 }, { lit: 3 }, { op: 'add' }, { stop: true }]);
  c.halted = false;
  c.step(); c.step();
  assert.strictEqual(c.x(), 3);
  assert.deepStrictEqual(c.stack.slice(0, 2), [3, 2]);
  c.step();
  assert.strictEqual(c.x(), 5);
});

test('insertStep / removeStep', () => {
  const c = C();
  c.setProgram([{ lit: 1 }, { lit: 3 }]);
  c.insertStep(1, { lit: 2 });
  assert.strictEqual(c.program.length, 3);
  assert.strictEqual(c.program[1].lit, 2);
  c.removeStep(0);
  assert.strictEqual(c.program[0].lit, 2);
});

test('валидация шага: неизвестная операция', () => {
  assert.throws(() => PC.validateStep({ op: 'nope' }), e => e.code === 'UNKNOWN_OP');
  assert.throws(() => PC.validateStep({ cond: 'nope' }), e => e.code === 'BAD_COND');
  assert.throws(() => PC.validateStep({ lit: 'x' }), e => e.code === 'BAD_LIT');
});

console.log('\nСериализация и форматирование');

test('serialize → load сохраняет программу и состояние', () => {
  const c = C();
  c.angleMode = 'RAD';
  c.enter(11).store('3');
  c.setProgram([{ lit: 5 }, { stop: true }]);
  const dump = JSON.parse(JSON.stringify(c.serialize()));

  const c2 = C().load(dump);
  assert.strictEqual(c2.angleMode, 'RAD');
  assert.strictEqual(c2.regs[3], 11);
  assert.strictEqual(c2.program.length, 2);
  c2.run();
  assert.strictEqual(c2.x(), 5);
});

test('формат auto: обычные и очень большие числа', () => {
  const c = C();
  assert.strictEqual(c.formatNumber(0), '0');
  assert.strictEqual(c.formatNumber(2.5), '2.5');
  assert.ok(/e/.test(c.formatNumber(1e20)));
  assert.ok(/e/.test(c.formatNumber(1e-15)));
  assert.strictEqual(c.formatNumber(NaN), 'НЕ ОПР.');
  assert.strictEqual(c.formatNumber(Infinity), '∞');
  assert.strictEqual(c.formatNumber(-Infinity), '−∞');
});

test('формат fix / sci / eng', () => {
  assert.strictEqual(PC.formatNumber(3.14159, { mode: 'fix', digits: 3 }), '3.142');
  assert.ok(/^3\.14/.test(PC.formatNumber(3.14159, { mode: 'sci', digits: 3 })));
  assert.ok(/e/.test(PC.formatNumber(12345, { mode: 'eng', digits: 4 })));
});

test('stepToString даёт читаемый листинг', () => {
  assert.strictEqual(PC.stepToString({ op: 'add' }), '+');
  assert.strictEqual(PC.stepToString({ label: 'L1' }), 'L1:');
  assert.strictEqual(PC.stepToString({ stop: true }), 'СТОП');
  assert.strictEqual(PC.stepToString({ reg: '2', act: 'store' }), '→ R2');
  assert.strictEqual(PC.stepToString({ reg: '1', act: 'loop', jmp: 'L0' }), 'R1−1 → ≠0: L0');
  assert.ok(PC.stepToString({ cond: 'x<0', jmp: 'L1' }).indexOf('ЕСЛИ x<0') === 0);
  assert.strictEqual(PC.stepToString({ cmt: 'привет' }), '// привет');
});

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
