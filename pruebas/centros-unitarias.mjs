/* Pruebas unitarias del análisis de lo entregado a los centros
   (calcularAnalisisCentros). Sin navegador, sin red:
   node pruebas/centros-unitarias.mjs

   centros.js es un IIFE de navegador, así que se EXTRAE el cuerpo
   entero del módulo (nunca se retipea) y se corre contra un `window`
   de mentira. FARM sí es la real: comunes.js está pensado para
   correr en Node. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FARM = require(path.join(AQUI, '..', 'comunes.js'));
const FUENTE = fs.readFileSync(path.join(AQUI, '..', 'centros.js'), 'utf8');

function extraerModulo(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en centros.js -- ¿cambió el código?');
  let profundidad = 0, j = FUENTE.indexOf('{', i);
  for (; j < FUENTE.length; j++) {
    if (FUENTE[j] === '{') profundidad++;
    else if (FUENTE[j] === '}') { profundidad--; if (profundidad === 0) break; }
  }
  return FUENTE.slice(i, j + 1);
}
const cuerpoIIFE = extraerModulo('(function () {') + ')';
const ventana = {};
new Function('window', 'return ' + cuerpoIIFE)(ventana)();
const calcularAnalisisCentros = ventana.CENTROS_CALCULAR_ANALISIS;
if (typeof calcularAnalisisCentros !== 'function') {
  throw new Error('centros.js no dejó "CENTROS_CALCULAR_ANALISIS" en window -- ¿cambió el nombre?');
}

let ok = 0, mal = 0;
const fallos = [];
function prueba(nombre, real, esperado) {
  const iguales = JSON.stringify(real) === JSON.stringify(esperado);
  if (iguales) ok++;
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

/* Miércoles 16 de septiembre de 2026: semana del 14 al 20, mes completo. */
const HOY = '2026-09-16';

const renglones = [
  // Una entrega HOY con dos renglones (misma visita, cuenta 1 entrega).
  { entrega_id: 'e1', fecha: '2026-09-16', cantidad: 30, anulada: false },
  { entrega_id: 'e1', fecha: '2026-09-16', cantidad: 5, anulada: false },
  // Esta semana, no hoy.
  { entrega_id: 'e2', fecha: '2026-09-14', cantidad: 20, anulada: false },
  // Semana pasada (antes del lunes 14): NO debe contar en "semana".
  { entrega_id: 'e3', fecha: '2026-09-07', cantidad: 50, anulada: false },
  // Anulada: no debe contar en NADA, ni siquiera como visita.
  { entrega_id: 'e4', fecha: '2026-09-16', cantidad: 999, anulada: true },
  // Del cuaderno viejo, sin cantidad: cuenta como entrega, no como unidad.
  { entrega_id: 'e5', fecha: '2026-09-10', cantidad: null, anulada: false }
];

const a = calcularAnalisisCentros(FARM, renglones, 'dia', HOY);

grupo('Lo anulado no cuenta, ni como visita ni como unidad');
prueba('total de entregas (4 visitas reales: e1,e2,e3,e5 -e4 está anulada-)', a.total, 4);
prueba('entregas hoy (e1, una sola visita aunque tenga 2 renglones)', a.hoy, 1);
prueba('entregas esta semana (e1 + e2, e3 es de la semana pasada)', a.semana, 2);
prueba('entregas este mes (las 4 visitas reales, todas de septiembre)', a.mes, 4);
prueba('unidades en total (30+5+20+50 -e4 anulada y e5 sin cantidad no suman-)', a.unidadesTotal, 105);
prueba('unidades hoy (30+5, la anulada de hoy NO suma)', a.unidadesHoy, 35);
prueba('unidades esta semana (35+20)', a.unidadesSemana, 55);

grupo('La tendencia cambia de tamaño según la vista');
prueba('por día trae 14 renglones', calcularAnalisisCentros(FARM, renglones, 'dia', HOY).tendencia.length, 14);
prueba('por semana trae 8 renglones', calcularAnalisisCentros(FARM, renglones, 'semana', HOY).tendencia.length, 8);
prueba('por mes trae 6 renglones', calcularAnalisisCentros(FARM, renglones, 'mes', HOY).tendencia.length, 6);

const porDia = calcularAnalisisCentros(FARM, renglones, 'dia', HOY).tendencia;
prueba('el último renglón (hoy) trae 1 entrega y 35 unidades',
  [porDia[porDia.length - 1].entregas, porDia[porDia.length - 1].unidades], [1, 35]);

console.log('\n' + '='.repeat(64));
console.log(`Pasaron ${ok} de ${ok + mal} pruebas.`);
if (mal) {
  console.log('\nFallos:');
  fallos.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
