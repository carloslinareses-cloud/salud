/* Pruebas unitarias de las funciones compartidas.
   Sin bibliotecas: se corre con  node pruebas/unitarias.mjs

   Cada prueba de aquí existe porque el caso APARECIÓ DE VERDAD en los
   Excel de la farmacia, no porque quede bonito tener pruebas. */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../comunes.js');

let ok = 0, mal = 0;
const fallos = [];

function prueba(nombre, real, esperado) {
  const iguales = JSON.stringify(real) === JSON.stringify(esperado);
  if (iguales) { ok++; }
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

/* ================================================================
   FECHAS — me equivoqué DOS VECES aquí durante la migración.
   La primera rechacé 30/03/1975 y marqué 562 pacientes de más.
   La segunda rechacé 19/01/26 y perdí 492 fechas.
================================================================ */
grupo('Fechas');
prueba('ISO normal',            F.leeFecha('2026-01-19'), '2026-01-19');
prueba('ISO con un dígito',     F.leeFecha('2026-1-9'),   '2026-01-09');
prueba('día/mes/año 4 cifras',  F.leeFecha('30/03/1975'), '1975-03-30');
prueba('día/mes/año 1 dígito',  F.leeFecha('3/5/1981'),   '1981-05-03');
prueba('AÑO DE DOS CIFRAS',     F.leeFecha('19/01/26'),   '2026-01-19');
prueba('con guiones',           F.leeFecha('21-8-1999'),  '1999-08-21');
prueba('con espacios',          F.leeFecha(' 04 / 08/2000 '), '2000-08-04');
prueba('objeto vacío',          F.leeFecha(''),           null);
prueba('nulo',                  F.leeFecha(null),         null);

// Lo que NO se debe arreglar solo
prueba('año imposible 19633',   F.leeFecha('3/4/19633'),  null);
prueba('mes 110',               F.leeFecha('11/110/1986'), null);
prueba('día 260',               F.leeFecha('260/8/1983'), null);
prueba('año 2626 (el del Excel)', F.leeFecha('2626-05-11'), null);
prueba('31 de febrero',         F.leeFecha('31/02/2026'), null);
prueba('mes 13',                F.leeFecha('01/13/2026'), null);
prueba('texto suelto',          F.leeFecha('CTLR+F+^'),   null);

prueba('mostrar fecha',         F.muestraFecha('2026-01-19'), '19/01/2026');
prueba('mostrar sin fecha',     F.muestraFecha(null),         'sin fecha');

/* ================================================================
   CÉDULAS — las de 6 dígitos son de personas nacidas entre 1930 y
   1949. Si el sistema exige 7, deja fuera a 16 abuelos del padrón.
================================================================ */
grupo('Cédulas');
prueba('8 dígitos',        F.leeCedula('12402507'),  { nacionalidad: 'V', numero: '12402507', digitoRif: null });
prueba('7 dígitos',        F.leeCedula('4976612'),   { nacionalidad: 'V', numero: '4976612', digitoRif: null });
prueba('SEIS dígitos',     F.leeCedula('338301'),    { nacionalidad: 'V', numero: '338301', digitoRif: null });
prueba('extranjero E',     F.leeCedula('E83242558'), { nacionalidad: 'E', numero: '83242558', digitoRif: null });
prueba('E con guion',      F.leeCedula('E-84585577'), { nacionalidad: 'E', numero: '84585577', digitoRif: null });
prueba('E con espacios',   F.leeCedula('E - 81342714'), { nacionalidad: 'E', numero: '81342714', digitoRif: null });
prueba('con puntos',       F.leeCedula('12.402.507'), { nacionalidad: 'V', numero: '12402507', digitoRif: null });
prueba('minúscula v',      F.leeCedula('v12402507'), { nacionalidad: 'V', numero: '12402507', digitoRif: null });

// Lo que venía en la columna de cédula y NO es una cédula
prueba('un nombre',        F.leeCedula('DIXONORTIZ'), null);
prueba('nombre con espacio', F.leeCedula('NATHALI ORTIZ'), null);
prueba('la letra F',       F.leeCedula('F'),          null);
prueba('un medicamento',   F.leeCedula('ENALAPRIL 20 MG'), null);
prueba('5 dígitos',        F.leeCedula('46844'),      null);
prueba('10 dígitos siguen sin valer', F.leeCedula('4190419011'), null);

// El RIF de una persona natural es la cedula + un digito verificador.
// Aparece escrito de tres formas distintas en los Excel, y las tres
// significan lo mismo. Antes se guardaban pegadas y se corrompia la cedula.
prueba('RIF con guion',    F.leeCedula('17685436-2'),
  { nacionalidad: 'V', numero: '17685436', digitoRif: '2' });
prueba('RIF con puntos',   F.leeCedula('17.114.309.2'),
  { nacionalidad: 'V', numero: '17114309', digitoRif: '2' });
prueba('RIF todo pegado',  F.leeCedula('199322086'),
  { nacionalidad: 'V', numero: '19932208', digitoRif: '6' });
prueba('RIF con la V',     F.leeCedula('V-17685436-2'),
  { nacionalidad: 'V', numero: '17685436', digitoRif: '2' });
prueba('cedula sola no inventa digito',
  F.leeCedula('12402507').digitoRif, null);
prueba('armar el RIF',     F.muestraRif('V', '17685436', '2'), 'V-17685436-2');
prueba('sin digito no hay RIF', F.muestraRif('V', '12402507', null), null);
prueba('vacío',            F.leeCedula(''),           null);

prueba('mostrar cédula',   F.muestraCedula('V', '12402507'), 'V-12402507');
prueba('mostrar sin cédula', F.muestraCedula(null, null, 'DIXONORTIZ'), 'DIXONORTIZ');

/* ================================================================
   NOMBRES — se unifica lo cosmético (acentos, mayúsculas, espacios).
   NUNCA la dosis ni la presentación.
================================================================ */
grupo('Nombres de medicamentos');
prueba('acentos iguales',
  F.sinAcentos('ÁCIDO VALPROÍCO 500mg') === F.sinAcentos('ACIDO VALPROICO 500mg'), true);
prueba('doble espacio igual',
  F.sinAcentos('AMIODARONA  200mg') === F.sinAcentos('AMIODARONA 200mg'), true);
prueba('mayúsculas iguales',
  F.sinAcentos('Losartan 50mg') === F.sinAcentos('LOSARTAN 50MG'), true);

// LO QUE NO SE DEBE UNIR JAMÁS
prueba('200mg NO es 500mg',
  F.sinAcentos('ALBENDAZOL 200mg') === F.sinAcentos('ALBENDAZOL 500mg'), false);
prueba('jarabe NO es tableta',
  F.sinAcentos('ALBENDAZOL JARABE') === F.sinAcentos('ALBENDAZOL TABLETA'), false);
prueba('0,25 NO es 0,5',
  F.sinAcentos('DIGOXINA 0,25mg') === F.sinAcentos('DIGOXINA 0,5mg'), false);
prueba('gasa 3x3 NO es 5x5',
  F.sinAcentos('GASA 3X3') === F.sinAcentos('GASA 5X5'), false);

/* ================================================================
   LIMPIEZA — el registro diario traía 1.516 filas con un espacio
   de ancho cero en la columna Sexo.
================================================================ */
grupo('Limpieza de texto');
prueba('espacio de ancho cero', F.limpia('​'),          null);
prueba('F con invisible',       F.limpia('F​'),         'F');
prueba('espacio duro',          F.limpia('JUAN PEREZ'), 'JUAN PEREZ');
prueba('espacios de más',       F.limpia('  JUAN   PEREZ '), 'JUAN PEREZ');
prueba('vacío da nulo',         F.limpia('   '),             null);

/* ================================================================
   VENCIMIENTOS — el candado más importante del sistema.
================================================================ */
grupo('Situación de un lote');
const HOY = '2026-09-03';
prueba('vencido ayer',      F.situacionLote('2026-09-02', HOY), 'vencido');
prueba('vencido en 2022',   F.situacionLote('2022-08-01', HOY), 'vencido');
prueba('vence hoy',         F.situacionLote('2026-09-03', HOY), 'por_vencer_30');
prueba('vence en 10 días',  F.situacionLote('2026-09-13', HOY), 'por_vencer_30');
prueba('vence en 60 días',  F.situacionLote('2026-11-02', HOY), 'por_vencer_90');
prueba('vence en 2 años',   F.situacionLote('2028-09-03', HOY), 'vigente');
prueba('sin fecha',         F.situacionLote(null, HOY),         'sin_fecha');

/* ================================================================
   CONTRASEÑAS
================================================================ */
grupo('Contraseñas');
prueba('buena',            F.revisaClave('Charallave2026'), null);
prueba('muy corta',        typeof F.revisaClave('abc123') === 'string', true);
prueba('sin números',      typeof F.revisaClave('solamenteletras') === 'string', true);
prueba('sin letras',       typeof F.revisaClave('12345678') === 'string', true);
prueba('empieza por 123',  typeof F.revisaClave('123456789a') === 'string', true);
prueba('la del sistema',   typeof F.revisaClave('farmacia123') === 'string', true);

/* ================================================================
   MENSAJES DE ERROR — que la gente entienda qué pasó.
================================================================ */
grupo('Errores en cristiano');
prueba('lote vencido',
  F.traduceError({ message: 'Ese lote venció el 01/08/2025.' }).includes('vencido'), true);
prueba('sin internet NO dice guardado',
  /NO se guardó/.test(F.traduceError({ message: 'Failed to fetch' })), true);
prueba('sin permiso',
  F.traduceError({ message: 'new row violates row-level security policy' }).includes('permiso'), true);
prueba('clave mala',
  F.traduceError({ message: 'Invalid login credentials' }).includes('contraseña'), true);

/* ================================================================
   PERÍODOS DEL TABLERO DE ENTREGAS

   El día que cuenta es el de VENEZUELA. El servidor de la base corre en
   UTC y el aparato puede estar en cualquier zona: a las 8 de la noche de
   Charallave, en UTC ya es mañana. Un reporte "de hoy" hecho de noche
   salía vacío.
================================================================ */
grupo('El día de hoy en Venezuela');
// 2026-09-07 a las 23:30 de Charallave = 2026-09-08 03:30 UTC
prueba('de noche sigue siendo el mismo día',
  F.hoyCaracas(Date.UTC(2026, 8, 8, 3, 30)), '2026-09-07');
prueba('pasada la medianoche ya es el siguiente',
  F.hoyCaracas(Date.UTC(2026, 8, 8, 4, 30)), '2026-09-08');
prueba('a mediodía, lo obvio',
  F.hoyCaracas(Date.UTC(2026, 8, 7, 16, 0)), '2026-09-07');
prueba('fin de año de madrugada',
  F.hoyCaracas(Date.UTC(2027, 0, 1, 2, 0)), '2026-12-31');

grupo('La semana empieza el lunes');
prueba('un lunes',    F.periodo('semana', '2026-09-07'), { desde: '2026-09-07', hasta: '2026-09-13' });
prueba('un miércoles', F.periodo('semana', '2026-09-09'), { desde: '2026-09-07', hasta: '2026-09-13' });
prueba('un domingo (cierra la semana, no la abre)',
  F.periodo('semana', '2026-09-13'), { desde: '2026-09-07', hasta: '2026-09-13' });
prueba('semana a caballo entre dos meses',
  F.periodo('semana', '2026-10-01'), { desde: '2026-09-28', hasta: '2026-10-04' });
prueba('semana a caballo entre dos años',
  F.periodo('semana', '2027-01-01'), { desde: '2026-12-28', hasta: '2027-01-03' });

grupo('El mes, entero');
prueba('septiembre tiene 30',  F.periodo('mes', '2026-09-07'), { desde: '2026-09-01', hasta: '2026-09-30' });
prueba('diciembre tiene 31',   F.periodo('mes', '2026-12-24'), { desde: '2026-12-01', hasta: '2026-12-31' });
prueba('febrero normal',       F.periodo('mes', '2026-02-10'), { desde: '2026-02-01', hasta: '2026-02-28' });
prueba('febrero bisiesto',     F.periodo('mes', '2028-02-10'), { desde: '2028-02-01', hasta: '2028-02-29' });
prueba('el primero del mes',   F.periodo('mes', '2026-11-01'), { desde: '2026-11-01', hasta: '2026-11-30' });

grupo('Hoy');
prueba('un solo día', F.periodo('hoy', '2026-09-07'), { desde: '2026-09-07', hasta: '2026-09-07' });

grupo('Cómo se lee el período');
prueba('el día de hoy se dice "hoy"',
  F.rotuloPeriodo('2026-09-07', '2026-09-07', '2026-09-07'),
  'Hoy, lunes 7 de septiembre de 2026');
prueba('otro día NO dice hoy',
  F.rotuloPeriodo('2026-09-05', '2026-09-05', '2026-09-07'),
  'sábado 5 de septiembre de 2026');
prueba('una semana',
  F.rotuloPeriodo('2026-09-07', '2026-09-13', '2026-09-07'),
  'Del lunes 7 al domingo 13 de septiembre de 2026');
prueba('un mes completo se dice por su nombre',
  F.rotuloPeriodo('2026-09-01', '2026-09-30', '2026-09-07'),
  'Septiembre de 2026 completo');
prueba('un rango que cruza dos meses los nombra los dos',
  F.rotuloPeriodo('2026-08-28', '2026-09-03', '2026-09-07'),
  'Del viernes 28 de agosto de 2026 al jueves 3 de septiembre de 2026');
prueba('sin fechas no revienta', F.rotuloPeriodo(null, null, '2026-09-07'), '');

grupo('Sumar días');
prueba('cruza el fin de mes', F.sumaDias('2026-08-31', 1), '2026-09-01');
prueba('hacia atrás',         F.sumaDias('2026-09-01', -1), '2026-08-31');
prueba('cruza el bisiesto',   F.sumaDias('2028-02-28', 1), '2028-02-29');

/* ================================================================
   ESCAPADO — datos de pacientes reales van a la pantalla.
================================================================ */
grupo('Escapado');
prueba('etiqueta',    F.esc('<script>'), '&lt;script&gt;');
prueba('comillas',    F.esc('a"b\'c'),   'a&quot;b&#39;c');
prueba('ampersand',   F.esc('A & B'),    'A &amp; B');
prueba('nulo',        F.esc(null),       '');
prueba('nombre real', F.esc("O'BRIEN"),  'O&#39;BRIEN');

/* ================================================================ */
console.log('\n' + '='.repeat(58));
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}\n`);
  fallos.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
} else {
  console.log(`Pasaron las ${ok} pruebas.`);
}
