/* Pruebas unitarias de la cuenta del Dashboard (calcularInforme).
   Sin navegador, sin red: node pruebas/dashboard-unitarias.mjs

   dashboard.js es un IIFE de navegador, así que se EXTRAE el cuerpo
   entero del módulo (nunca se retipea) y se corre tal cual, con un
   `window` de mentira para recoger lo que expone. Las funciones de
   fecha (hoyCaracas, periodo, sumaDias) SÍ son las reales: comunes.js
   ya está pensado para correr en Node (dice "las pruebas corren en
   Node" en su propio comentario), así que se importa directo. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FARM = require(path.join(AQUI, '..', 'comunes.js'));

const FUENTE = fs.readFileSync(path.join(AQUI, '..', 'dashboard.js'), 'utf8');

function extraerModulo(inicioLiteral) {
  const i = FUENTE.indexOf(inicioLiteral);
  if (i < 0) throw new Error('No encontré "' + inicioLiteral + '" en dashboard.js -- ¿cambió el código?');
  let profundidad = 0, j = FUENTE.indexOf('{', i);
  for (; j < FUENTE.length; j++) {
    if (FUENTE[j] === '{') profundidad++;
    else if (FUENTE[j] === '}') { profundidad--; if (profundidad === 0) break; }
  }
  return FUENTE.slice(i, j + 1);
}

/* El contador de llaves para en la última "}" del cuerpo de la función,
   pero la ")" que la envuelve viene justo después en el archivo real
   ("})();"). Se le repone a mano para tener otra vez una expresión de
   función completa y válida: "(function () { ... })". */
const cuerpoIIFE = extraerModulo('(function () {') + ')';
const ventana = {};
new Function('window', 'return ' + cuerpoIIFE)(ventana)();
const calcularInforme = ventana.DASHBOARD_CALCULAR;
if (typeof calcularInforme !== 'function') {
  throw new Error('dashboard.js no dejó "DASHBOARD_CALCULAR" en window -- ¿cambió el nombre?');
}

let ok = 0, mal = 0;
const fallos = [];
function prueba(nombre, real, esperado) {
  const iguales = JSON.stringify(real) === JSON.stringify(esperado);
  if (iguales) ok++;
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------
   La fecha ancla: miércoles 16 de septiembre de 2026.
   Con la FARM real: la semana va del lunes 14 al domingo 20, y el mes
   es septiembre completo (01 al 30). Se comprueba una sola vez aquí
   para que las cuentas de abajo no dependan de calcular esto a mano.
--------------------------------------------------------------- */
const HOY = '2026-09-16';
const semana = FARM.periodo('semana', HOY);
const mes = FARM.periodo('mes', HOY);
grupo('La fecha ancla (con la FARM real, no inventada)');
prueba('la semana va de lunes a domingo', semana, { desde: '2026-09-14', hasta: '2026-09-20' });
prueba('el mes es septiembre completo', mes, { desde: '2026-09-01', hasta: '2026-09-30' });

/* ---------------------------------------------------------------
   Los datos de prueba
--------------------------------------------------------------- */
const datos = {
  personas: [
    { sexo: 'F', estado: 'activo', creado_en: '2026-09-16T15:00:00Z' },       // P1: hoy (11am Caracas)
    { sexo: 'M', estado: 'activo', creado_en: '2026-09-17T02:00:00Z' },       // P2: 2am UTC del 17 = 10pm Caracas del 16 -> SIGUE SIENDO HOY
    { sexo: 'F', estado: 'por_revisar', creado_en: '2026-09-07T12:00:00Z' },  // P3: semana pasada
    { sexo: null, estado: 'activo', creado_en: '2026-09-14T12:00:00Z' },      // P4: lunes de esta semana
    { sexo: 'M', estado: 'activo', creado_en: '2026-09-01T12:00:00Z' },       // P5: primer día del mes
    { sexo: 'F', estado: 'activo', creado_en: '2026-08-25T12:00:00Z' }        // P6: mes pasado
  ],
  jornadas: [
    { conjunto: 'jornadas', hoja_origen: 'JULIO A SEPTIEMBRE', estado: 'activo', creado_en: '2026-09-16T15:00:00Z' },
    { conjunto: 'ruta_materna', hoja_origen: 'RUTA MATERNA MES JULIO', estado: 'por_revisar', creado_en: '2026-09-14T12:00:00Z' }
  ],
  centros: [
    { tipo: 'CDI', activo: true, creado_en: '2026-09-16T15:00:00Z' },
    { tipo: 'Ambulatorio', activo: false, creado_en: '2026-08-25T12:00:00Z' }
  ],
  centrosFicha: [
    { id: 'c1', nombre: 'CDI Uno', tipo: 'CDI', activo: true, entregas: 3, insumos: 5, unidades_recibidas: 120 },
    { id: 'c2', nombre: 'Ambulatorio Dos', tipo: 'Ambulatorio', activo: false, entregas: 0, insumos: 2, unidades_recibidas: 0 }
  ],
  entregasRenglon: [
    { entrega_id: 'e1', fecha: '2026-09-16', tipo_destinatario: 'paciente', anulada: false, cantidad: 10, producto: 'LOSARTAN', destinatario: 'Juan Perez', entregado_por: 'Ana' },
    { entrega_id: 'e1', fecha: '2026-09-16', tipo_destinatario: 'paciente', anulada: false, cantidad: 5, producto: 'IBUPROFENO', destinatario: 'Juan Perez', entregado_por: 'Ana' },
    { entrega_id: 'e2', fecha: '2026-09-14', tipo_destinatario: 'institucion', anulada: false, cantidad: 50, producto: 'LOSARTAN', destinatario: 'CDI Uno', entregado_por: 'Carlos' },
    { entrega_id: 'e3', fecha: '2026-09-07', tipo_destinatario: 'paciente', anulada: false, cantidad: null, producto: null, destinatario: 'Maria Lopez', entregado_por: 'No consta (viene del Excel)' },
    { entrega_id: 'e4', fecha: '2026-09-16', tipo_destinatario: 'paciente', anulada: true, cantidad: 99, producto: 'DEBE IGNORARSE', destinatario: 'X', entregado_por: 'Ana' }
  ]
};

const inf = calcularInforme(FARM, datos, 'dia', HOY);

/* ---------------------------------------------------------------
   Personas
--------------------------------------------------------------- */
grupo('Personas: hoy cruza la medianoche UTC sin perder a nadie');
prueba('total histórico', inf.personas.total, 6);
prueba('nuevas hoy (incluye la de las 10pm Caracas, aunque en UTC ya era mañana)', inf.personas.hoy, 2);
prueba('nuevas esta semana', inf.personas.semana, 3);
prueba('nuevas este mes', inf.personas.mes, 5);
prueba('por revisar', inf.personas.porRevisar, 1);
prueba('por sexo: F, M y sin dato', inf.personas.porSexo.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
  [{ etiqueta: 'F', cantidad: 3 }, { etiqueta: 'M', cantidad: 2 }, { etiqueta: 'Sin dato', cantidad: 1 }]
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)));

/* ---------------------------------------------------------------
   Jornadas
--------------------------------------------------------------- */
grupo('Jornadas');
prueba('total', inf.jornadas.total, 2);
prueba('por revisar', inf.jornadas.porRevisar, 1);
prueba('por conjunto', inf.jornadas.porConjunto.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
  [{ etiqueta: 'Jornada de salud', cantidad: 1 }, { etiqueta: 'Ruta materna', cantidad: 1 }]
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)));

/* ---------------------------------------------------------------
   Centros
--------------------------------------------------------------- */
grupo('Centros');
prueba('total, activos e inactivos', [inf.centros.total, inf.centros.activos, inf.centros.inactivos], [2, 1, 1]);
prueba('insumos pedidos, sumados entre todos los centros', inf.centros.insumosPedidos, 7);
prueba('unidades recibidas en total', inf.centros.unidadesRecibidas, 120);
prueba('el ranking deja afuera al que no ha recibido nada',
  inf.centros.ranking, [{ etiqueta: 'CDI Uno', unidades: 120, veces: 3 }]);
prueba('las entregas a centros son solo las de tipo institución', inf.centros.entregasTotal, 1);

/* ---------------------------------------------------------------
   Lo entregado
--------------------------------------------------------------- */
grupo('Lo entregado: lo anulado no cuenta, lo sin detalle no suma unidades');
prueba('entregas en total (3 visitas reales -e4 está anulada-)', inf.entregado.total, 3);
prueba('entregas hoy (una sola visita, aunque tenga 2 renglones)', inf.entregado.hoy, 1);
prueba('entregas esta semana', inf.entregado.semana, 2);
prueba('entregas este mes', inf.entregado.mes, 3);
prueba('a personas y a centros', [inf.entregado.aPacientes, inf.entregado.aCentros], [2, 1]);
prueba('la migrada sin cantidad se cuenta como "sin detalle"', inf.entregado.sinDetalle, 1);
prueba('unidades en total (10+5+50; la anulada y la sin detalle no suman)', inf.entregado.unidadesTotal, 65);
prueba('unidades hoy (10+5 de la misma visita; la anulada de hoy NO suma)', inf.entregado.unidadesHoy, 15);
prueba('unidades esta semana (15+50)', inf.entregado.unidadesSemana, 65);
prueba('el top de medicamentos suma entre entregas distintas',
  inf.entregado.topMedicamentos, [
    { etiqueta: 'LOSARTAN', unidades: 60, veces: 2 },
    { etiqueta: 'IBUPROFENO', unidades: 5, veces: 1 }
  ]);
prueba('quién despachó, ordenado por unidades',
  inf.entregado.porDespachador, [
    { etiqueta: 'Carlos', unidades: 50, veces: 1 },
    { etiqueta: 'Ana', unidades: 15, veces: 2 }
  ]);

/* ---------------------------------------------------------------
   La tendencia cambia con la vista elegida
--------------------------------------------------------------- */
grupo('La tendencia por día, semana y mes trae ventanas de distinto tamaño');
prueba('por día: 14 renglones', calcularInforme(FARM, datos, 'dia', HOY).personas.tendencia.length, 14);
prueba('por semana: 8 renglones', calcularInforme(FARM, datos, 'semana', HOY).personas.tendencia.length, 8);
prueba('por mes: 6 renglones', calcularInforme(FARM, datos, 'mes', HOY).personas.tendencia.length, 6);

const porDia = calcularInforme(FARM, datos, 'dia', HOY).personas.tendencia;
const deHoy = porDia[porDia.length - 1];
prueba('el último renglón de la vista por día es hoy, con las 2 personas', deHoy.cantidad, 2);

console.log('\n' + '='.repeat(64));
console.log(`Pasaron ${ok} de ${ok + mal} pruebas.`);
if (mal) {
  console.log('\nFallos:');
  fallos.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
