/* Pruebas unitarias de la validación al registrar una persona nueva
   (Mercancía > Personas). Sin bibliotecas, sin navegador, sin red:
   se corre con  node pruebas/personas-unitarias.mjs

   personas.js es un IIFE de navegador (no exporta para Node, a
   diferencia de comunes.js), así que en vez de retipear la regla a
   mano -que podría quedar distinta a la real sin que nadie lo note-
   se EXTRAE el código exacto de "hoyEs" y "Personas.prototype.valida"
   del archivo real y se corre tal cual, con "window" simulado. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = fs.readFileSync(path.join(AQUI, '..', 'personas.js'), 'utf8');

function extraer(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en personas.js -- ¿cambió el código?');
  // cuenta llaves para hallar el cierre real de la función, no el primer "};" que aparezca.
  let profundidad = 0, j = FUENTE.indexOf('{', i);
  const inicioCuerpo = j;
  for (; j < FUENTE.length; j++) {
    if (FUENTE[j] === '{') profundidad++;
    else if (FUENTE[j] === '}') { profundidad--; if (profundidad === 0) break; }
  }
  return FUENTE.slice(i, j + 1);
}

const codigoHoyEs = extraer('function hoyEs()');
const codigoValida = extraer('Personas.prototype.valida = function (d)');

// "window" simulado: sin FARM, hoyEs cae en la rama de new Date() -- la
// misma que usa cualquier navegador que no tenga cargado comunes.js.
global.window = {};
const hoyEs = new Function('return (' + codigoHoyEs + ')')();
const valida = new Function('hoyEs', 'return (' + codigoValida.replace('Personas.prototype.valida = ', '') + ')')(hoyEs);

let ok = 0, mal = 0;
const fallos = [];
function prueba(nombre, real, esperado) {
  const iguales = real === esperado;
  if (iguales) ok++;
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

const base = () => ({ nombre: 'Carlos Perez', cedula: '12345678', fecha_nac: null });

grupo('Nombre');
prueba('nombre completo pasa', valida(base()), null);
prueba('nombre de 3 letras no pasa', valida({ ...base(), nombre: 'Ana' }), 'Escribe el nombre y el apellido completos.');
prueba('nombre vacio no pasa', valida({ ...base(), nombre: '' }), 'Escribe el nombre y el apellido completos.');
prueba('nombre de 4 letras SI pasa (limite)', valida({ ...base(), nombre: 'Jose' }), null);

grupo('Cédula');
prueba('6 numeros pasa (minimo)', valida({ ...base(), cedula: '123456' }), null);
prueba('9 numeros pasa (maximo)', valida({ ...base(), cedula: '123456789' }), null);
prueba('5 numeros no pasa', valida({ ...base(), cedula: '12345' }), 'La cédula debe tener entre 6 y 9 números.');
prueba('10 numeros no pasa', valida({ ...base(), cedula: '1234567890' }), 'La cédula debe tener entre 6 y 9 números.');
prueba('vacia no pasa', valida({ ...base(), cedula: '' }), 'La cédula debe tener entre 6 y 9 números.');
prueba('con letras no pasa', valida({ ...base(), cedula: '1234567A' }), 'La cédula debe tener entre 6 y 9 números.');

grupo('Fecha de nacimiento');
prueba('sin fecha pasa (es opcional)', valida({ ...base(), fecha_nac: null }), null);
prueba('fecha de ayer pasa', valida({ ...base(), fecha_nac: '2000-01-01' }), null);
prueba('fecha futura no pasa', valida({ ...base(), fecha_nac: '2999-01-01' }), 'La fecha de nacimiento no puede ser futura.');
prueba('fecha de hoy pasa (no es "futura")', valida({ ...base(), fecha_nac: hoyEs() }), null);

console.log('\n' + '='.repeat(60));
console.log(`Pasaron ${ok} de ${ok + mal} pruebas.`);
if (mal) {
  console.log('\nFallos:');
  fallos.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
