/* Pruebas unitarias de la validación al registrar/corregir un renglón
   de Jornadas. Sin bibliotecas, sin navegador, sin red:
   se corre con  node pruebas/jornadas-unitarias.mjs

   Igual que con personas.js: jornadas.js es un IIFE de navegador, así
   que se EXTRAE el código real de "Jornadas.prototype.valida" del
   archivo (nunca se retipea) y se corre tal cual. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = fs.readFileSync(path.join(AQUI, '..', 'jornadas.js'), 'utf8');

function extraer(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en jornadas.js -- ¿cambió el código?');
  let profundidad = 0, j = FUENTE.indexOf('{', i);
  for (; j < FUENTE.length; j++) {
    if (FUENTE[j] === '{') profundidad++;
    else if (FUENTE[j] === '}') { profundidad--; if (profundidad === 0) break; }
  }
  return FUENTE.slice(i, j + 1);
}

const codigoHoyEs = extraer('function hoyEs()');
const codigoValida = extraer('Jornadas.prototype.valida = function (d)');

global.window = {};
const hoyEs = new Function('return (' + codigoHoyEs + ')')();
const valida = new Function('hoyEs', 'return (' + codigoValida.replace('Jornadas.prototype.valida = ', '') + ')')(hoyEs);

let ok = 0, mal = 0;
const fallos = [];
function prueba(nombre, real, esperado) {
  if (real === esperado) ok++;
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

const base = () => ({ nombre: 'Carlos Perez', cedula: null, fecha: null });

grupo('Nombre (siempre obligatorio)');
prueba('nombre completo pasa', valida(base()), null);
prueba('nombre de 3 letras no pasa', valida({ ...base(), nombre: 'Ana' }), 'Escribe el nombre y el apellido completos.');
prueba('sin nombre no pasa', valida({ ...base(), nombre: '' }), 'Escribe el nombre y el apellido completos.');
prueba('nombre null no pasa', valida({ ...base(), nombre: null }), 'Escribe el nombre y el apellido completos.');

grupo('Cédula (opcional -- a diferencia de Personas, aquí puede faltar)');
prueba('sin cedula SI pasa (queda por_revisar, no rechazada)', valida({ ...base(), cedula: null }), null);
prueba('6 numeros pasa', valida({ ...base(), cedula: '123456' }), null);
prueba('9 numeros pasa', valida({ ...base(), cedula: '123456789' }), null);
prueba('5 numeros no pasa', valida({ ...base(), cedula: '12345' }), 'La cédula debe tener entre 6 y 9 números.');
prueba('10 numeros no pasa', valida({ ...base(), cedula: '1234567890' }), 'La cédula debe tener entre 6 y 9 números.');

grupo('Fecha (opcional, no puede ser futura)');
prueba('sin fecha pasa', valida({ ...base(), fecha: null }), null);
prueba('fecha pasada pasa', valida({ ...base(), fecha: '2020-01-01' }), null);
prueba('fecha futura no pasa', valida({ ...base(), fecha: '2999-01-01' }), 'La fecha no puede ser futura.');
prueba('fecha de hoy pasa', valida({ ...base(), fecha: hoyEs() }), null);

/* ================================================================
   Los totales de una jornada (calcularCifrasEvento): esta vez la
   función depende de otra privada del mismo archivo (piezasDeUno),
   así que en vez de sacar solo esa función se corre el módulo
   ENTERO -tal cual quedó escrito, nunca retipeado- contra un `window`
   de mentira, y se recoge lo que deja expuesto. FARM sí es la real:
   comunes.js está pensado para correr en Node.
================================================================ */
const require = createRequire(import.meta.url);
const FARM = require(path.join(AQUI, '..', 'comunes.js'));

function extraerModulo(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en jornadas.js -- ¿cambió el código?');
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
const calcularCifrasEvento = ventana.JORNADAS_CALCULAR_CIFRAS;
const prepararInformeEvento = ventana.JORNADAS_PREPARAR_INFORME;
const resumirTerritorioEventos = ventana.JORNADAS_RESUMIR_TERRITORIO;
if (typeof calcularCifrasEvento !== 'function') {
  throw new Error('jornadas.js no dejó "JORNADAS_CALCULAR_CIFRAS" en window -- ¿cambió el nombre?');
}
if (typeof prepararInformeEvento !== 'function') {
  throw new Error('jornadas.js no dejó "JORNADAS_PREPARAR_INFORME" en window -- ¿cambió el nombre?');
}
if (typeof resumirTerritorioEventos !== 'function') {
  throw new Error('jornadas.js no dejó "JORNADAS_RESUMIR_TERRITORIO" en window -- ¿cambió el nombre?');
}

grupo('Los totales de una jornada se cuentan solos, no se escriben a mano');

const sinNadie = calcularCifrasEvento(FARM, []);
prueba('sin personas, todo en cero', [sinNadie.pacientes, sinNadie.totalMedicamentos, sinNadie.recipes].join(','), '0,0,0');

const personas = [
  { tratamiento: 'SUERO ORAL X3 / ALBENDAZOL X2 / NUTAMIN X1', recipe: true },
  { tratamiento: 'NUTAMIN X4', recipe: false },
  { tratamiento: 'IBUPROFENO X2, ACETAMINOFEN', recipe: true },
  { tratamiento: null, recipe: null },          // se atendió pero no le dieron nada -no revienta-
  { tratamiento: '', recipe: false }
];
const cifras = calcularCifrasEvento(FARM, personas);
prueba('pacientes atendidos = cuántos se cargaron', cifras.pacientes, 5);
prueba('unidades entregadas = la suma de las cantidades escritas (3+2+1+4+2)', cifras.totalMedicamentos, 12);
prueba('récipes = solo los que dijeron que sí', cifras.recipes, 2);
prueba('NUTAMIN suma sus unidades entre personas (1+4)', cifras.meds.NUTAMIN, 5);
prueba('el detalle va ordenado del que más salió al que menos',
  cifras.ordenMeds[0], 'NUTAMIN');
prueba('un nombre sin cantidad no se inventa como una unidad', cifras.sinCantidad, 1);
prueba('el nombre sin cantidad queda visible para revisión', cifras.medsSinCantidad.ACETAMINOFEN, 1);
prueba('sin tratamiento anotado no rompe la cuenta ni suma nada',
  cifras.ordenMeds.join(',').includes('undefined'), false);

grupo('Informe completo de una jornada');
const informe = prepararInformeEvento(FARM, { lugar: 'LA MAGDALENA', fecha: '2026-09-18' }, personas);
prueba('cantidad de medicamentos o insumos distintos', informe.cifras.productosDistintos, 4);
prueba('renglones con cantidad comprobable', informe.cifras.renglonesConCantidad, 5);
prueba('personas que recibieron productos con cantidad', informe.cifras.personasConEntrega, 3);
prueba('el detalle conserva una fila por paciente y producto', informe.detalle.length, 5);
prueba('el resumen por producto dice unidades, personas y renglones', JSON.stringify(informe.productos[0]),
  JSON.stringify({ producto: 'NUTAMIN', unidades: 5, personas: 2, renglones: 2 }));
prueba('los nombres sin cantidad van a una lista separada y no se suman',
  JSON.stringify([informe.sinCantidad.length, informe.sinCantidad[0].producto]), JSON.stringify([1, 'ACETAMINOFEN']));
prueba('el Excel y el PDF podrán partir del listado completo de pacientes', informe.pacientes.length, 5);

grupo('Comunas y comunidades cubiertas por las jornadas');
const territorio = resumirTerritorioEventos(FARM, [
  { comuna: 'COMUNA A', comunidad: 'LA ESPERANZA' },
  { comuna: 'comuna a', comunidad: 'LOS OLIVOS' },
  { comuna: 'COMUNA B', comunidad: 'LA ESPERANZA' },
  { comuna: 'COMUNA B', comunidad: 'LA ESPERANZA' },
  { comuna: '', comunidad: '' }
]);
prueba('cuenta todas las jornadas, no solo una página', territorio.jornadas, 5);
prueba('la misma comuna con distintas mayúsculas cuenta una sola vez', territorio.totalComunas, 2);
prueba('una comunidad homónima en otra comuna se mantiene separada', territorio.totalComunidades, 3);
prueba('dice cuántas jornadas y comunidades tuvo cada comuna', JSON.stringify(territorio.comunas),
  JSON.stringify([
    { comuna: 'COMUNA A', jornadas: 2, comunidades: 2 },
    { comuna: 'COMUNA B', jornadas: 2, comunidades: 1 }
  ]));
prueba('agrupa las jornadas repetidas de la misma comunidad',
  territorio.comunidades.find(c => c.comuna === 'COMUNA B').jornadas, 2);
prueba('señala las jornadas cuyo territorio todavía no fue anotado',
  [territorio.sinComuna, territorio.sinComunidad].join(','), '1,1');

console.log('\n' + '='.repeat(60));
console.log(`Pasaron ${ok} de ${ok + mal} pruebas.`);
if (mal) {
  console.log('\nFallos:');
  fallos.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
