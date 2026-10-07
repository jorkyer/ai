/*
 * Примеры программ для программируемого калькулятора.
 * Каждый пример — набор шагов, понятных движку (см. js/engine.js).
 * Используется и интерфейсом (js/app.js), и тестами (test/engine.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProgCalcExamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    sum: {
      name: 'Сумма 1..N (цикл)',
      desc: 'N вводится в X. Используется счётчик цикла R1 и переход по метке L0.',
      program: [
        { cmt: 'Сумма чисел от 1 до N. Наберите N и запустите.' },
        { op: 'round' },
        { reg: '1', act: 'store' },
        { lit: 0 },
        { reg: '2', act: 'store' },
        { label: 'L0' },
        { reg: '1', act: 'recall' },
        { reg: '2', act: 'add' },
        { reg: '1', act: 'loop', jmp: 'L0' },
        { reg: '2', act: 'recall' },
        { stop: true }
      ]
    },
    fact: {
      name: 'Факториал N!',
      desc: 'N в X → N! в X. Цикл с умножением в R2.',
      program: [
        { cmt: 'N! через цикл: R1 — счётчик, R2 — накопитель' },
        { op: 'round' },
        { op: 'dup' },
        { cond: 'x≤0', jmp: 'L9' },
        { reg: '1', act: 'store' },
        { lit: 1 },
        { reg: '2', act: 'store' },
        { label: 'L0' },
        { reg: '1', act: 'recall' },
        { reg: '2', act: 'recall' },
        { op: 'mul' },
        { reg: '2', act: 'store' },
        { reg: '1', act: 'loop', jmp: 'L0' },
        { reg: '2', act: 'recall' },
        { stop: true },
        { label: 'L9' },
        { lit: 1 },
        { stop: true }
      ]
    },
    fib: {
      name: 'Числа Фибоначчи F(N)',
      desc: 'N в X → F(N). Двойной регистровый цикл.',
      program: [
        { cmt: 'F(N): R0 — счётчик, R1 = a, R2 = b' },
        { op: 'round' },
        { reg: '0', act: 'store' },
        { lit: 0 },
        { reg: '1', act: 'store' },
        { lit: 1 },
        { reg: '2', act: 'store' },
        { label: 'L0' },
        { reg: '1', act: 'recall' },
        { reg: '2', act: 'recall' },
        { op: 'add' },
        { reg: '3', act: 'store' },
        { reg: '2', act: 'recall' },
        { reg: '1', act: 'store' },
        { reg: '3', act: 'recall' },
        { reg: '2', act: 'store' },
        { reg: '0', act: 'loop', jmp: 'L0' },
        { reg: '1', act: 'recall' },
        { stop: true }
      ]
    },
    sqrt: {
      name: '√x методом Ньютона',
      desc: 'Итерационное извлечение корня: S в X → √S. 20 итераций, R5 — приближение, R6 — счётчик.',
      program: [
        { cmt: 'x_{n+1} = (x_n + S/x_n) / 2.  S хранится в R9, приближение — в R5.' },
        { op: 'dup' },
        { reg: '9', act: 'store' },
        { cond: 'x=0', jmp: 'L9' },
        { op: 'abs' },
        { lit: 20 },
        { reg: '6', act: 'store' },
        { label: 'L0' },
        { op: 'dup' },
        { reg: '9', act: 'recall' },
        { op: 'swap' },
        { op: 'div' },
        { op: 'add' },
        { lit: 2 },
        { op: 'div' },
        { op: 'dup' },
        { reg: '5', act: 'store' },
        { reg: '6', act: 'loop', jmp: 'L0' },
        { stop: true },
        { label: 'L9' },
        { lit: 0 },
        { stop: true }
      ]
    },
    quad: {
      name: 'Квадратное уравнение',
      desc: 'a, b, c лежат в R1, R2, R3. Программа находит корни (вещественные).',
      program: [
        { cmt: 'a·x² + b·x + c = 0. Коэффициенты заранее положить в R1, R2, R3.' },
        { reg: '2', act: 'recall' },
        { op: 'sqr' },
        { lit: 4 },
        { reg: '1', act: 'recall' },
        { op: 'mul' },
        { reg: '3', act: 'recall' },
        { op: 'mul' },
        { op: 'sub' },
        { op: 'dup' },
        { reg: '4', act: 'store' },
        { cond: 'x<0', jmp: 'L8' },
        { op: 'sqrt' },
        { reg: '5', act: 'store' },
        { reg: '2', act: 'recall' },
        { op: 'neg' },
        { reg: '5', act: 'recall' },
        { op: 'add' },
        { lit: 2 },
        { reg: '1', act: 'recall' },
        { op: 'mul' },
        { op: 'div' },
        { reg: '6', act: 'store' },
        { reg: '2', act: 'recall' },
        { op: 'neg' },
        { reg: '5', act: 'recall' },
        { op: 'sub' },
        { lit: 2 },
        { reg: '1', act: 'recall' },
        { op: 'mul' },
        { op: 'div' },
        { reg: '7', act: 'store' },
        { reg: '6', act: 'recall' },
        { stop: true },
        { label: 'L8' },
        { cmt: 'Дискриминант < 0: в R4 лежит D, X = NaN-защита' },
        { lit: 0 },
        { stop: true }
      ]
    },
    sub: {
      name: 'Подпрограмма: возведение в степень',
      desc: 'Демонстрация CALL/RET: 2 в степени N, N вводится в X.',
      program: [
        { cmt: '2^N через подпрограмму умножения' },
        { op: 'round' },
        { reg: '1', act: 'store' },
        { lit: 1 },
        { reg: '2', act: 'store' },
        { label: 'L0' },
        { lit: 2 },
        { reg: '2', act: 'recall' },
        { call: 'L5' },
        { reg: '2', act: 'store' },
        { reg: '1', act: 'loop', jmp: 'L0' },
        { reg: '2', act: 'recall' },
        { stop: true },
        { label: 'L5' },
        { cmt: 'подпрограмма: перемножить X и Y' },
        { op: 'mul' },
        { ret: true }
      ]
    }
  };
});
