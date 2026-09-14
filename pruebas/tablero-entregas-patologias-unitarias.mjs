/* Pruebas unitarias del dashboard "Por patología" del Tablero de Entregas.
   Sin navegador, sin red: node pruebas/tablero-entregas-patologias-unitarias.mjs

   tablero-entregas.js es un IIFE de navegador: se EXTRAE el cuerpo entero
   (nunca se retipea) y se corre con un `window` de mentira para recoger
   lo que expone. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = fs.readFileSync(path.join(AQUI, '..', 'tablero-entregas.js'), 'utf8');

function extraerModulo(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en tablero-entregas.js -- ¿cambió el código?');
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

const calcularPatologias = ventana.TABLERO_CALCULAR_PATOLOGIAS;
const edadDeFecha = ventana.TABLERO_EDAD_DE_FECHA;
const edadDeTexto = ventana.TABLERO_EDAD_DE_TEXTO;
if (typeof calcularPatologias !== 'function') throw new Error('No dejó TABLERO_CALCULAR_PATOLOGIAS en window.');
if (typeof edadDeFecha !== 'function') throw new Error('No dejó TABLERO_EDAD_DE_FECHA en window.');
if (typeof edadDeTexto !== 'function') throw new Error('No dejó TABLERO_EDAD_DE_TEXTO en window.');

let ok = 0, mal = 0;
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n); }
  else { mal++; console.log('  FALLA ' + n + '   ' + d); }
};

console.log('='.repeat(64));
console.log('EDAD, A PARTIR DE LA FECHA DE NACIMIENTO Y DEL TEXTO LIBRE');
console.log('='.repeat(64));

prueba('cumple justo hoy: la edad ya sube', edadDeFecha('2010-06-14', '2026-06-14') === 16);
prueba('un día antes del cumpleaños: todavía no sube', edadDeFecha('2010-06-15', '2026-06-14') === 15);
prueba('recién nacido, mismo día', edadDeFecha('2026-09-14', '2026-09-14') === 0);
prueba('sin fecha, no inventa nada', edadDeFecha(null, '2026-09-14') === null);
prueba('fecha basura, no inventa nada', edadDeFecha('no-es-fecha', '2026-09-14') === null);

prueba('texto "8 años" da 8', edadDeTexto('8 años') === 8);
prueba('texto "45" da 45', edadDeTexto('45') === 45);
prueba('texto sin número no inventa nada', edadDeTexto('adulto mayor') === null);
prueba('texto vacío no inventa nada', edadDeTexto('') === null);
prueba('un número absurdo (999) se descarta', edadDeTexto('999') === null);

console.log('\n' + '='.repeat(64));
console.log('POR PATOLOGÍA: NIÑOS, ADULTOS Y SIN EDAD');
console.log('='.repeat(64));

function fila(pid, producto, cantidad, extra) {
  return Object.assign({
    paciente_id: pid, cantidad: cantidad, producto: producto, producto_id: producto,
    dosificacion: null, unidad: 'unidades'
  }, extra || {});
}

// --- caso 1: un niño y un adulto con la MISMA patología ---
{
  const filas = [
    fila('nino-1', 'LOSARTAN', 10),
    fila('adulto-1', 'LOSARTAN', 20),
  ];
  const pats = { 'nino-1': ['HIPERTENSIÓN'], 'adulto-1': ['HIPERTENSIÓN'] };
  const edades = { 'nino-1': 10, 'adulto-1': 40 };
  const r = calcularPatologias(filas, pats, edades);
  prueba('una sola patología en el resumen', r.resumen.length === 1);
  const p = r.resumen[0];
  prueba('el niño cuenta aparte del adulto (unidades)', p.ninosUnidades === 10 && p.adultosUnidades === 20);
  prueba('el niño cuenta aparte del adulto (personas)', p.ninosPersonas === 1 && p.adultosPersonas === 1);
  prueba('el total suma niño + adulto', p.totalUnidades === 30 && p.totalPersonas === 2);
}

// --- caso 2: paciente sin ninguna patología registrada -> no entra al resumen ---
{
  const filas = [fila('sin-pat-1', 'PARACETAMOL', 5)];
  const r = calcularPatologias(filas, {}, { 'sin-pat-1': 30 });
  prueba('sin patología no aparece en el resumen', r.resumen.length === 0);
  prueba('sin patología se cuenta aparte, no se pierde', r.sinPatologia.unidades === 5 && r.sinPatologia.personas === 1);
}

// --- caso 3: paciente con DOS patologías -> lo entregado cuenta en las dos ---
{
  const filas = [fila('doble-1', 'INSULINA', 7)];
  const pats = { 'doble-1': ['DIABETES', 'HIPERTENSIÓN'] };
  const edades = { 'doble-1': 50 };
  const r = calcularPatologias(filas, pats, edades);
  prueba('aparecen las dos patologías', r.resumen.length === 2);
  const totales = r.resumen.map(p => p.totalUnidades).sort();
  prueba('las 7 unidades se cuentan en cada una de las dos (no se reparten)', totales[0] === 7 && totales[1] === 7);
  prueba('se marca que esa persona tiene varias patologías', r.variasPatologias === 1);
}

// --- caso 4: edad desconocida (no vino en el mapa) -> "sin edad", nunca adulto por defecto ---
{
  const filas = [fila('sin-edad-1', 'IBUPROFENO', 3)];
  const pats = { 'sin-edad-1': ['ASMA'] };
  const r = calcularPatologias(filas, pats, {}); // el paciente ni siquiera aparece en el mapa de edades
  const p = r.resumen[0];
  prueba('sin edad conocida no se cuenta como adulto', p.adultosUnidades === 0);
  prueba('sin edad conocida no se cuenta como niño', p.ninosUnidades === 0);
  prueba('sin edad conocida se cuenta en su propio grupo', p.sinEdadUnidades === 3 && p.sinEdadPersonas === 1);
}

// --- caso 5: renglones que NO deben contarse ---
{
  const filas = [
    fila('x1', 'AMOXICILINA', null),                 // sin cantidad anotada (viene del cuaderno)
    { paciente_id: null, cantidad: 8, producto: 'X' }, // entrega a un centro, no a una persona
  ];
  const r = calcularPatologias(filas, { x1: ['GASTRITIS'] }, { x1: 20 });
  prueba('sin cantidad anotada no se cuenta en ningún lado', r.resumen.length === 0 && r.sinPatologia.unidades === 0);
}

// --- caso 6: el detalle junta patología + grupo + medicamento, sumando cantidades repetidas ---
{
  const filas = [
    fila('a', 'LOSARTAN', 10, {}),
    fila('b', 'LOSARTAN', 5, {}),   // mismo medicamento, otro adulto con la misma patología
    fila('a', 'ATORVASTATINA', 2, {}),
  ];
  const pats = { a: ['HIPERTENSIÓN'], b: ['HIPERTENSIÓN'] };
  const edades = { a: 40, b: 50 };
  const r = calcularPatologias(filas, pats, edades);
  const losartanAdultos = r.detalle.find(d => d.producto === 'LOSARTAN' && /Adultos/.test(d.grupo));
  prueba('el detalle SUMA el mismo medicamento entre las dos personas del mismo grupo', losartanAdultos.unidades === 15);
  prueba('el detalle cuenta 2 personas distintas para ese renglón', losartanAdultos.personas === 2);
  prueba('un medicamento distinto queda en su propia fila', r.detalle.some(d => d.producto === 'ATORVASTATINA'));
}

console.log('\n' + '='.repeat(64));
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`);
  process.exit(1);
} else {
  console.log(`Pasaron las ${ok} pruebas.`);
}
