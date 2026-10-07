import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../public/assets/js/ui/csv.js';

test('CSV: BOM, separador ponto-e-vírgula, aspas escapadas e proteção contra fórmulas', () => {
  const out = toCsv(['Time', 'Obs'], [['Águias "FC"', 'a;b'], ['=SOMA(A1)', '+55 11'], ['normal', null]]);
  assert.ok(out.startsWith('﻿'));
  const lines = out.slice(1).split('\r\n');
  assert.equal(lines[0], 'Time;Obs');
  assert.equal(lines[1], '"Águias ""FC""";"a;b"');
  assert.equal(lines[2], "'=SOMA(A1);'+55 11");
  assert.equal(lines[3], 'normal;');
});
