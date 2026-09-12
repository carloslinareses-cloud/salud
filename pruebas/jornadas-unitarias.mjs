/* Pruebas unitarias de la validación al registrar/corregir un renglón
   de Jornadas. Sin bibliotecas, sin navegador, sin red:
   se corre con  node pruebas/jornadas-unitarias.mjs

   Igual que con personas.js: jornadas.js es un IIFE de navegador, así
   que se EXTRAE el código real de "Jornadas.prototype.valida" del
   archivo (nunca se retipea) y se corre tal cual. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\n' + '='.repeat(60));
console.log(`Pasaron ${ok} de ${ok + mal} pruebas.`);
if (mal) {
  console.log('\nFallos:');
  fallos.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
