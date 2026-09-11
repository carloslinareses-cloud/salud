/* Pruebas unitarias del CONTROL DE ASISTENCIA (Dirección de Salud).
   Sin bibliotecas: se corre con   node pruebas/asistencia-unitarias.mjs

   Qué se prueba: las funciones que viven DENTRO de asistencia.js, más la
   coherencia entre esa pantalla y el archivo sql/25-asistencia.sql, que es
   donde de verdad están los candados.

   CÓMO SE LLEGA A LAS FUNCIONES. asistencia.js es un IIFE: por fuera solo
   asoma window.PANTALLA_ASISTENCIA, nada más. Así que se saca del archivo
   el TEXTO de cada función y se evalúa. Es la técnica que ya usa el resto
   del proyecto (CLAUDE.md, sección 6) y es la única honesta: si alguien
   rompe la función original, estas pruebas se caen. Pegar aquí una copia
   de la función haría que las pruebas siguieran pasando con el código roto,
   o sea que mentirían.

   Si a una función le cambian el nombre, la extracción revienta con un
   mensaje claro en vez de quedarse callada.

   LO QUE NO ESTÁ AQUÍ (y por qué): se pidió probar también la conversión
   de minutos a hora legible (420 -> 7:00 a. m.) y una fórmula de recuadro
   de coordenadas. NINGUNA DE LAS DOS EXISTE en este sistema: las ventanas
   de horario se guardan como `time` de Postgres y se editan con
   <input type="time"> (texto 'HH:MM', nunca minutos), y el candado de sitio
   no usa recuadro: compara distancia real con la fórmula haversine de
   farmacia.distancia_metros. Inventarlas aquí sería probar código que no
   se ejecuta en ningún lado. Lo que sí se puede comprobar sin base de datos
   —que la regla del candado no se afloje y que la pantalla no diga números
   distintos a los de la base— está en los dos últimos apartados. */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const F = require('../comunes.js');

const RUTA_ASISTENCIA = fileURLToPath(new URL('../asistencia.js', import.meta.url));
const RUTA_SQL        = fileURLToPath(new URL('../sql/25-asistencia.sql', import.meta.url));
const RUTA_INDEX      = fileURLToPath(new URL('../index.html', import.meta.url));
const RUTA_COMUNES    = fileURLToPath(new URL('../comunes.js', import.meta.url));

const FUENTE = fs.readFileSync(RUTA_ASISTENCIA, 'utf-8');
const SQL    = fs.readFileSync(RUTA_SQL, 'utf-8');
const INDEX  = fs.readFileSync(RUTA_INDEX, 'utf-8');

let ok = 0, mal = 0;
const fallos = [];

function prueba(nombre, real, esperado) {
  const iguales = JSON.stringify(real) === JSON.stringify(esperado);
  if (iguales) { ok++; }
  else { mal++; fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`); }
}
function grupo(t) { console.log('\n' + t); }

/* ================================================================
   SACAR LAS FUNCIONES DE asistencia.js
================================================================ */

/* Toma el texto de  function nombre(...) { ... }  contando llaves.
   Antes de devolverlo lo compila: si la extracción salió cortada, se
   entera aquí y no diez pruebas más abajo. */
function extraeFuncion(fuente, nombre) {
  const inicio = fuente.indexOf('function ' + nombre + '(');
  if (inicio < 0) {
    throw new Error('No encontré  function ' + nombre + '()  en asistencia.js. ' +
                    '¿Le cambiaron el nombre? Las pruebas hay que actualizarlas.');
  }
  let i = fuente.indexOf('{', inicio), nivel = 0, fin = -1;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}') { nivel--; if (nivel === 0) { fin = i + 1; break; } }
  }
  if (fin < 0) throw new Error('La extracción de ' + nombre + '() quedó cortada.');
  const texto = fuente.slice(inicio, fin);
  new Function('return (' + texto + ')');   // si no compila, revienta ya
  return texto;
}

const NOMBRES = ['esc', 'enCristiano', 'claveSugerida', 'hoyVzla', 'horaCorta',
                 'metros', 'pillDentro', 'marca', 'porTandas'];
const CODIGO = NOMBRES.map(n => extraeFuncion(FUENTE, n)).join('\n\n');

/* Se arma una copia de la pantalla con un `window` de mentira, el mismo
   que tendría en el navegador: FARM (comunes.js) y crypto. */
function armar(ventana) {
  const fabrica = new Function('window', '"use strict";\n' + CODIGO +
                               '\nreturn { ' + NOMBRES.join(', ') + ' };');
  return fabrica(ventana);
}

const A = armar({ FARM: F, crypto: webcrypto });

/* Horas de verdad del sistema: la entrada se marca de 7:00 a 8:45 y la
   salida de 4:30 a 6:30. Venezuela es UTC-4 todo el año. */
const ENTRADA = '2026-09-09T11:58:00Z';   // 7:58 a. m. en Charallave
const SALIDA  = '2026-09-09T22:30:00Z';   // 6:30 p. m. en Charallave
const NOCHE   = '2026-09-10T01:30:00Z';   // 9:30 p. m. del día 9 aquí, día 10 en UTC

/* Nada de lo que se pinta puede llevar estas palabras: son las que salen
   cuando una cuenta se hizo con un dato que no era número. `null` está en la
   lista porque faltaba y se coló: al probar a romper marca() a propósito, la
   pantalla pasó a decir "a null m del sitio" y las pruebas siguieron todas en
   verde. Un hueco así deja pasar exactamente lo que este bloque promete
   impedir. */
function sinBasura(t) { return !/NaN|undefined|null|Invalid Date/.test(String(t)); }

/* ================================================================
   LA ÚNICA BARRERA ANTES DEL innerHTML

   asistencia.js pinta 43 trozos de pantalla con innerHTML: nombres del
   personal, cédulas, y los mensajes que devuelve la base. Todo eso pasa
   antes por esc(). Ojo: NO es la esc() de comunes.js, es una copia propia
   que vive dentro de asistencia.js, así que si alguien la toca ahí, las
   pruebas de comunes.js no se enteran de nada.

   El apellido O'BRIEN es el caso que ya rompió una pantalla en este mismo
   sistema: la comilla simple cerraba el atributo.
================================================================ */
grupo('Lo que se pinta va limpio (esc de asistencia.js)');
prueba('una etiqueta se desarma',   A.esc('<script>'), '&lt;script&gt;');
prueba('la comilla doble también',  A.esc('a"b'),      'a&quot;b');
prueba('un apellido con apóstrofo no rompe el atributo', A.esc("O'BRIEN"), 'O&#39;BRIEN');
prueba('el ampersand',              A.esc('Salud & Vida'), 'Salud &amp; Vida');
prueba('nulo no escribe "null"',    A.esc(null), '');
prueba('sin definir tampoco',       A.esc(undefined), '');
prueba('el cero sí es un dato',     A.esc(0), '0');
prueba('el ataque entero queda inofensivo',
  A.esc('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;');
/* Y el mensaje de error de la base también pasa por ahí: es texto que viene
   de afuera y acaba en un innerHTML. */
prueba('un error con etiquetas dentro sale desarmado',
  /<b>/.test(A.esc(A.enCristiano({ message: 'fallo <b>raro</b>' }))), false);

/* ================================================================
   LOS ERRORES, EN CRISTIANO

   Lo que devuelve Supabase viene en inglés y hablando de tablas y
   políticas. La persona que usa esto es la administradora de la farmacia:
   tiene que poder leer QUÉ PASÓ y QUÉ HACER, no un volcado técnico.

   El caso más importante es el primero: mientras el SQL no esté aplicado,
   TODA la pantalla falla. Sin esta traducción el mensaje era
   "Could not find the table 'farmacia.asistencia_personal' in the schema
   cache", que no le dice a nadie que lo que falta es correr un archivo.
================================================================ */
grupo('Los errores, en cristiano');

prueba('falta aplicar el SQL (schema cache)',
  /no está instalado/.test(A.enCristiano({ message: "Could not find the table 'farmacia.asistencia_personal' in the schema cache" })), true);
prueba('y dice qué archivo hay que aplicar',
  /25-asistencia\.sql/.test(A.enCristiano({ message: 'Could not find the function farmacia.asis_login in the schema cache' })), true);
prueba('la tabla no existe',
  /no está instalado/.test(A.enCristiano({ message: 'relation "farmacia.asistencia_registros" does not exist' })), true);

prueba('sin permiso',
  /permiso/.test(A.enCristiano({ message: 'permission denied for table asistencia_personal' })), true);
prueba('la política de seguridad también es falta de permiso',
  /permiso/.test(A.enCristiano({ message: 'new row violates row-level security policy for table "sedes"' })), true);

prueba('cédula repetida',
  A.enCristiano({ message: 'duplicate key value violates unique constraint "asistencia_personal_pkey"' }),
  'Esa cédula ya está cargada.');

prueba('cédula con formato malo',
  /solo números/.test(A.enCristiano({ message: 'new row for relation "asistencia_personal" violates check constraint "asis_personal_cedula_formato"' })), true);

prueba('sin internet',
  /conexión/.test(A.enCristiano({ message: 'Failed to fetch' })), true);
prueba('sin internet, la otra forma de decirlo',
  /conexión/.test(A.enCristiano({ message: 'NetworkError when attempting to fetch resource.' })), true);

/* ESTO ES LO QUE NO SE PUEDE PERDER. El candado de sitio y el de horario
   ya mandan el mensaje escrito en español desde la base. Si enCristiano se
   pusiera a "mejorarlo", la persona dejaría de saber a cuántos metros
   estaba o a qué hora se le cerró la ventana. */
grupo('Un error que ya viene claro se muestra tal cual');
prueba('el de estar fuera del sitio, palabra por palabra',
  A.enCristiano({ message: 'Estás a 412 metros de la Dirección de Salud. Solo se puede marcar la entrada dentro del sitio.' }),
  'Estás a 412 metros de la Dirección de Salud. Solo se puede marcar la entrada dentro del sitio.');
prueba('el de fuera de horario, palabra por palabra',
  A.enCristiano({ message: 'Fuera del horario permitido para marcar la entrada (de 07:00 AM a 08:45 AM).' }),
  'Fuera del horario permitido para marcar la entrada (de 07:00 AM a 08:45 AM).');
prueba('un error que nadie previó no se esconde',
  A.enCristiano({ message: 'algo rarísimo pasó en el servidor' }),
  'algo rarísimo pasó en el servidor');
prueba('si viene solo el hint, se usa el hint',
  A.enCristiano({ hint: 'Revisa la cédula.' }), 'Revisa la cédula.');
prueba('si viene solo el detalle, se usa el detalle',
  A.enCristiano({ details: 'La fila no existe.' }), 'La fila no existe.');
prueba('un error que llegó como texto suelto tampoco se esconde',
  A.enCristiano('Ya marcaste tu entrada hoy, a las 07:58 AM.'),
  'Ya marcaste tu entrada hoy, a las 07:58 AM.');
prueba('sin error, algo hay que decir',
  A.enCristiano(null), 'Error desconocido');
prueba('un objeto vacío tampoco deja la pantalla muda',
  A.enCristiano({}), 'Error desconocido');

/* ================================================================
   LA CLAVE QUE SE LE SUGIERE A CADA PERSONA

   Este repositorio es PÚBLICO. Una clave inicial escrita en el código la
   sabría cualquiera que abra el archivo en GitHub, y con ella entraría a
   marcar por otro. Por eso se saca al azar en el momento.
================================================================ */
grupo('La clave sugerida');

const CLAVES = [];
for (let i = 0; i < 300; i++) CLAVES.push(A.claveSugerida());
const DISTINTAS = new Set(CLAVES).size;

prueba('dos llamadas seguidas NO dan la misma clave',
  A.claveSugerida() === A.claveSugerida(), false);
prueba('en 300 llamadas salen muchísimas distintas (no es fija)',
  DISTINTAS > 150, true);
prueba('todas tienen la forma Salud + 4 cifras',
  CLAVES.every(c => /^Salud\d{4}$/.test(c)), true);
prueba('ninguna se queda pegada en el mínimo o el máximo',
  CLAVES.every(c => { const n = +c.slice(5); return n >= 1000 && n <= 9999; }), true);

/* Al azar de verdad: getRandomValues, no Math.random ni un contador. */
prueba('se saca del generador criptográfico del navegador',
  /getRandomValues/.test(extraeFuncion(FUENTE, 'claveSugerida')), true);

/* La clave inicial se arma por partes a propósito: este repositorio es
   PÚBLICO, y escribirla entera aquí sería justo lo que esta prueba
   prohíbe hacer en el código. */
const CLAVE_PROHIBIDA = 'Sal' + 'ud' + '20' + '26';
prueba('no hay ninguna clave escrita a mano en la función',
  new RegExp('Math\\.random|' + CLAVE_PROHIBIDA).test(extraeFuncion(FUENTE, 'claveSugerida')), false);

/* El largo mínimo lo pone la base (asis_admin_crear / asis_cambiar_clave).
   Se lee del SQL de verdad: si un día lo suben a 12, esta prueba avisa
   que la clave sugerida dejó de servir, en vez de que se entere la
   administradora con un error al crear a alguien. */
const MINIMO_CLAVE = (() => {
  const m = SQL.match(/length\(p_clave_inicial\)\s*<\s*(\d+)/);
  if (!m) throw new Error('No encontré en el SQL el largo mínimo de la clave inicial.');
  return +m[1];
})();
prueba('la clave sugerida cumple el largo que exige la base',
  CLAVES.every(c => c.length >= MINIMO_CLAVE), true);

/* ================================================================
   LOS METROS DEL GPS

   Es el dato que se audita: "marcó a 8 m" se lee muy distinto de
   "marcó a 400 m". Si llega vacío o con algo que no es número, hay que
   callar — NO escribir "a NaN m del sitio", que además de feo hace
   pensar que el GPS falló cuando lo que falta es el dato.
================================================================ */
grupo('Los metros del GPS');
prueba('un número se redondea',        A.metros(8.4), 8);
prueba('redondea hacia arriba',        A.metros(8.6), 9);
prueba('el texto de un número vale',   A.metros('412.7'), 413);
prueba('CERO metros es un dato, no un vacío', A.metros(0), 0);
prueba('nulo',                         A.metros(null), null);
prueba('sin definir',                  A.metros(undefined), null);
prueba('cadena vacía',                 A.metros(''), null);
prueba('solo espacios',                A.metros('   '), null);
prueba('un texto que no es número',    A.metros('no se pudo'), null);
prueba('NaN',                          A.metros(NaN), null);

/* ================================================================
   LA LÍNEA QUE SE LEE EN PANTALLA

   marca() arma "7:58 a. m. [dentro del sitio] a 8 m del sitio · el GPS
   acertaba a ±12 m". Todo esto se mete con innerHTML en el tablero.
================================================================ */
grupo('La línea de cada marcaje');

prueba('sin marcar',
  A.marca(null, null, null, null), '<em class="ojo">sin marcar</em>');
prueba('la hora sale en la de Venezuela',
  A.marca(ENTRADA, true, 8, 12).startsWith('7:58 a. m.'), true);
prueba('dice a cuántos metros y con cuánto margen',
  /a 8 m del sitio · el GPS acertaba a ±12 m/.test(A.marca(ENTRADA, true, 8, 12)), true);
prueba('si no se sabe el margen, no se inventa',
  /±/.test(A.marca(ENTRADA, true, 8, null)), false);
prueba('cero metros SÍ se muestra (marcó justo en el punto)',
  /a 0 m del sitio/.test(A.marca(ENTRADA, true, 0, 5)), true);

/* Los tres estados del marcaje. `dentro` es null cuando no se pudo
   comparar (sin GPS o sin sedes activas): eso NO es "fuera", y decir
   "fuera del sitio" sería acusar a alguien de algo que no se sabe. */
prueba('dentro',        /dentro del sitio/.test(A.pillDentro(true)), true);
prueba('fuera',         /fuera del sitio/.test(A.pillDentro(false)), true);
prueba('sin GPS',       /sin GPS/.test(A.pillDentro(null)), true);
prueba('sin definir es sin GPS, no "dentro"',
  /sin GPS/.test(A.pillDentro(undefined)), true);
prueba('un 0 no cuela como "dentro"',
  /dentro del sitio/.test(A.pillDentro(0)), false);
prueba('el texto "false" tampoco cuela como "dentro"',
  /dentro del sitio/.test(A.pillDentro('false')), false);

/* NADA DE NaN EN PANTALLA. Estos cuatro casos son los que llegan de
   verdad cuando el teléfono no pudo dar ubicación: la base guarda nulos. */
grupo('Nunca se imprime NaN');
prueba('sin distancia ni precisión',   sinBasura(A.marca(ENTRADA, null, null, null)), true);
prueba('distancia vacía',              sinBasura(A.marca(ENTRADA, true, '', '')), true);
prueba('distancia con texto',          sinBasura(A.marca(ENTRADA, false, 'no se pudo', 'tampoco')), true);
prueba('marcaje de salida sin GPS',    sinBasura(A.marca(SALIDA, null, undefined, undefined)), true);
/* Ojo al escribir esta prueba: la etiqueta ya dice "dentro del sitio", así
   que buscar "del sitio" a secas la da por buena siempre. Se busca la
   frase de los metros completa. */
prueba('y sin distancia no se escribe la frase de los metros',
  /a \d+ m del sitio/.test(A.marca(ENTRADA, true, null, 12)), false);
/* Y la de arriba tampoco basta sola: buscando "a 8 m" se da por buena aunque
   en pantalla salga "a null m del sitio", que fue justo lo que pasó al romper
   marca() a propósito. Lo que hay que exigir es que sin distancia NO SE PINTE
   el recuadro de los metros, ni vacío ni con basura dentro. */
prueba('sin distancia no aparece siquiera el recuadro de los metros',
  /class="cuando"/.test(A.marca(ENTRADA, true, null, 12)), false);
prueba('y con distancia sí aparece',
  /class="cuando"/.test(A.marca(ENTRADA, true, 8, 12)), true);

/* Todo esto va a innerHTML. Los metros pasan por metros(), que devuelve
   número o nada, así que no hay por dónde meter etiquetas; se comprueba
   porque el día que alguien "simplifique" metros() esto avisa. */
prueba('no se puede colar una etiqueta por la distancia',
  /<img/.test(A.marca(ENTRADA, true, '<img src=x onerror=alert(1)>', null)), false);

/* ================================================================
   LOS REPORTES TIENEN QUE TRAERLO TODO

   Supabase no manda más de MIL filas por consulta, y lo hace sin avisar:
   devuelve mil y se queda tan tranquilo. Si porTandas() dejara de pedir la
   siguiente tanda, el reporte saldría con las primeras mil y nadie notaría
   que faltan las demás — que es la peor clase de error, porque el número
   sale bonito y está mal.

   El caso que más se escapa es el de las MIL EXACTAS: ahí hay que volver a
   preguntar aunque no quede nada, porque desde fuera no se puede saber si
   son mil o mil una.
================================================================ */
grupo('Los reportes se traen todas las filas, no las primeras mil');

/* Servidor de mentira: devuelve `total` filas repartidas de mil en mil y
   apunta desde dónde se le pidió cada tanda. */
function servidorConFilas(total) {
  const pedidos = [];
  return {
    pedidos,
    consulta: (desde) => {
      pedidos.push(desde);
      const filas = [];
      for (let i = desde; i < Math.min(desde + 1000, total); i++) filas.push({ n: i });
      return Promise.resolve({ data: filas });
    }
  };
}

const CORTO = servidorConFilas(120);
prueba('con pocas filas, una sola consulta',
  (await A.porTandas(CORTO.consulta)).length, 120);
prueba('y no se pide una segunda tanda de balde', CORTO.pedidos, [0]);

const LARGO = servidorConFilas(2500);
prueba('con 2500 filas se traen las 2500',
  (await A.porTandas(LARGO.consulta)).length, 2500);
prueba('pidiéndolas de mil en mil', LARGO.pedidos, [0, 1000, 2000]);

/* MIL EXACTAS: la trampa. */
const JUSTAS = servidorConFilas(1000);
prueba('con mil exactas igual se vuelve a preguntar',
  (await A.porTandas(JUSTAS.consulta)).length, 1000);
prueba('y esa segunda pregunta se hizo de verdad', JUSTAS.pedidos, [0, 1000]);

/* El tope existe para no colgar el navegador con un filtro demasiado
   ancho, pero tiene que ser un tope ALTO, no un recorte disimulado. */
const TOPE = servidorConFilas(100000);
prueba('el tope corta, no se pide para siempre',
  (await A.porTandas(TOPE.consulta, 1500)).length, 2000);
prueba('el tope por defecto deja pasar veinte mil filas',
  +saca(extraeFuncion(FUENTE, 'porTandas'), /tope \|\| (\d+)/, 'el tope por defecto'), 20000);

/* Un error a mitad de camino NO puede acabar en media lista dada por buena:
   un reporte incompleto que no se anuncia es peor que uno que no sale. */
let reventoComoDebe = false;
try {
  await A.porTandas((desde) => desde === 0
    ? Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ n: i })) })
    : Promise.resolve({ error: { message: 'Failed to fetch' } }));
} catch (e) { reventoComoDebe = /Failed to fetch/.test(e.message); }
prueba('si la base falla a mitad, se avisa en vez de entregar media lista',
  reventoComoDebe, true);

prueba('si no viene nada, una lista vacía, no un reventón',
  await A.porTandas(() => Promise.resolve({ data: null })), []);

/* ================================================================
   LA HORA ES LA DE VENEZUELA, NO LA DEL COMPUTADOR

   La base guarda en UTC. Si la pantalla usara la zona horaria de la
   máquina que la abre, "marcó a las 7:58" se convertiría en otra hora
   distinta según quién mire el reporte. Venezuela es UTC-4 todo el año,
   sin horario de verano.

   Todas estas pruebas van con una fecha FIJA pasada por parámetro. Con la
   hora actual, la prueba pasaría o fallaría según el momento del día en
   que se corra, que es el error clásico de este tipo de pruebas.
================================================================ */
grupo('La hora es la de Venezuela');
prueba('una entrada de las 7:58 de la mañana', A.horaCorta(ENTRADA), '7:58 a. m.');
prueba('una salida de las 6:30 de la tarde',   A.horaCorta(SALIDA),  '6:30 p. m.');
prueba('las 9:30 de la noche, que en UTC ya es el día siguiente',
  A.horaCorta(NOCHE), '9:30 p. m.');
prueba('sin hora no hay hora',  A.horaCorta(null), null);
prueba('cadena vacía',          A.horaCorta(''),   null);

/* Y el DÍA también. El tablero "Hoy" se arma con hoyVzla(): a las 9:30 de
   la noche de Charallave, en UTC ya es mañana, así que un tablero que
   usara la fecha del computador saldría vacío justo cuando el
   administrador revisa el día que acaba de terminar. */
prueba('a las 9:30 de la noche sigue siendo el mismo día',
  F.hoyCaracas(NOCHE), '2026-09-09');
prueba('pasada la medianoche de aquí ya es el siguiente',
  F.hoyCaracas('2026-09-10T04:30:00Z'), '2026-09-10');

/* Que la pantalla PREGUNTE por la hora de Venezuela en vez de resolverla
   por su cuenta: se le pone un FARM de mentira y se comprueba que es su
   respuesta la que sale. Si alguien cambiara horaCorta por un
   toLocaleTimeString suelto, esto se cae. */
grupo('La pantalla pregunta la hora, no la calcula por su cuenta');
const ESPIA = armar({
  FARM: { horaCaracas: () => 'HORA-DE-FARM', hoyCaracas: () => 'DIA-DE-FARM' },
  crypto: webcrypto
});
prueba('la hora sale de FARM.horaCaracas', ESPIA.horaCorta(ENTRADA), 'HORA-DE-FARM');
prueba('el día sale de FARM.hoyCaracas',   ESPIA.hoyVzla(), 'DIA-DE-FARM');

/* Y que FARM esté cargado ANTES en la página: si un día alguien mueve el
   <script>, asistencia.js se cae a su respaldo, que SÍ usa la zona del
   computador, y nadie se daría cuenta mirando la pantalla. */
prueba('comunes.js se carga antes que asistencia.js',
  INDEX.indexOf('comunes.js') < INDEX.indexOf('asistencia.js'), true);
/* Lo mismo con reportes.js: sin él, las fechas saldrían como 2026-09-09
   en vez de "miércoles 9 de septiembre de 2026". */
prueba('reportes.js se carga antes que asistencia.js',
  INDEX.indexOf('reportes.js') < INDEX.indexOf('asistencia.js'), true);

/* UTC-4 A MANO. Un navegador viejo sin Intl se va por el camino de
   respaldo de comunes.js, que resta 4 horas fijas. Se comprueba cargando
   comunes.js otra vez, pero sin Intl, para que ese camino se ejecute de
   verdad. */
grupo('Sin Intl (navegador viejo) sigue siendo UTC-4');
const SIN_INTL = (() => {
  const fuente = fs.readFileSync(RUTA_COMUNES, 'utf-8');
  const modulo = { exports: {} };
  new Function('window', 'Intl', 'module', fuente)({}, undefined, modulo);
  return modulo.exports;
})();
prueba('la entrada de las 7:58',  SIN_INTL.horaCaracas(ENTRADA), '7:58 a. m.');
prueba('la salida de las 6:30',   SIN_INTL.horaCaracas(SALIDA),  '6:30 p. m.');
prueba('las 9:30 de la noche',    SIN_INTL.horaCaracas(NOCHE),   '9:30 p. m.');
prueba('el día, de noche, no se adelanta', SIN_INTL.hoyCaracas(NOCHE), '2026-09-09');
prueba('el mediodía no es la medianoche',
  SIN_INTL.horaCaracas('2026-09-09T16:00:00Z'), '12:00 p. m.');
prueba('y da lo mismo que con Intl',
  SIN_INTL.horaCaracas(NOCHE) === F.horaCaracas(NOCHE), true);

/* LA PRUEBA DEFINITIVA: la misma cuenta, en una máquina configurada en
   otro país. Se corre en otro proceso con la zona horaria de Tokio. Si el
   sistema usara la zona del computador, daría las 9:30 de la mañana. */
grupo('En una computadora con otra zona horaria da igual');
const OTRA_ZONA = (() => {
  const guion =
    'const F = require(' + JSON.stringify(RUTA_COMUNES) + ');' +
    'console.log(JSON.stringify({' +
    '  venezuela: F.horaCaracas(' + JSON.stringify(NOCHE) + '),' +
    '  dia: F.hoyCaracas(' + JSON.stringify(NOCHE) + '),' +
    '  delComputador: new Date(' + JSON.stringify(NOCHE) + ').getHours() + ":" + new Date(' + JSON.stringify(NOCHE) + ').getMinutes()' +
    '}));';
  const r = spawnSync(process.execPath, ['-e', guion],
                      { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('No se pudo correr la prueba en otra zona horaria: ' + (r.stderr || ''));
  return JSON.parse(r.stdout);
})();
prueba('en Tokio, la hora de Venezuela sigue siendo la de Venezuela',
  OTRA_ZONA.venezuela, '9:30 p. m.');
prueba('y el día también',
  OTRA_ZONA.dia, '2026-09-09');
/* Esto confirma que la prueba de arriba no es de adorno: la zona del
   proceso SÍ era otra, y por ahí habría salido una hora equivocada. */
prueba('la del computador era distinta, así que había algo que equivocar',
  OTRA_ZONA.delComputador !== '21:30', true);

/* ================================================================
   EL CANDADO DE SITIO VIVE EN LA BASE

   No se puede ejecutar aquí (es PL/pgSQL y hace falta la base), pero sí se
   puede vigilar que la regla no se afloje sin que nadie se entere. La regla
   es: se acepta si  distancia - gracia <= radio, donde la gracia es el
   error que el propio teléfono declara, RECORTADO a la tolerancia. Ese
   recorte es lo que impide que un teléfono que declare 900 m de error se
   convierta en barra libre para marcar desde la casa.
================================================================ */
grupo('La regla del candado de sitio (sql/25-asistencia.sql)');
const SQL1 = SQL.replace(/\s+/g, ' ');
prueba('la gracia sigue recortada a la tolerancia',
  SQL1.includes('v_gracia := least(coalesce(p_precision, 0), coalesce(v_config.tolerancia_gps_metros, 0));'), true);
prueba('la comparación sigue siendo distancia - gracia <= radio',
  SQL1.includes('o_dentro := (o_distancia - v_gracia) <= v_radio;'), true);
prueba('se rechaza al teléfono que declara demasiado error',
  SQL1.includes('p_precision > v_config.precision_maxima_metros'), true);
prueba('la distancia se mide con haversine, sobre la Tierra redonda',
  SQL1.includes('6371000 * acos('), true);

/* Los números: con el radio de la sede sembrada (15 m) y la tolerancia de
   la base (35 m), lo MÁS lejos que el candado puede llegar a aceptar son
   50 m del punto, y solo si el teléfono declara ese error. Los dos números
   se leen de los archivos de verdad. */
function saca(texto, expresion, que) {
  const m = texto.match(expresion);
  if (!m) throw new Error('No encontré ' + que + '. Si cambió el archivo, hay que actualizar la prueba.');
  return m[1];
}
const RADIO_SEDE  = +saca(SQL, /'Direcci[^']*',\s*-?[\d.]+,\s*-?[\d.]+,\s*(\d+),\s*true/, 'el radio de la sede sembrada');
const TOLERANCIA  = +saca(SQL, /tolerancia_gps_metros\s+integer not null default (\d+)/, 'la tolerancia por defecto');
const PRECISION   = +saca(SQL, /precision_maxima_metros integer not null default (\d+)/, 'el error máximo aceptado');

prueba('el radio de la sede es de 15 m',       RADIO_SEDE, 15);
prueba('la tolerancia es de 35 m',             TOLERANCIA, 35);
prueba('nunca se acepta a más de 50 m del punto', RADIO_SEDE + TOLERANCIA, 50);
prueba('un teléfono que se equivoca más de 100 m no vale', PRECISION, 100);

/* ================================================================
   LA PANTALLA NO PUEDE DECIR NÚMEROS DISTINTOS A LOS DE LA BASE

   asistencia.js lleva los mismos valores escritos, para poder pintar algo
   mientras carga o si la fila de configuración todavía no existe. Si un
   día se cambia el SQL y no la pantalla, la administradora leería un
   horario y la base aplicaría otro — y el reclamo llegaría del personal,
   no de un error.
================================================================ */
grupo('Pantalla y base dicen lo mismo');
const V = {
  entrada_desde: [/c\.entrada_desde \|\| '([\d:]+)'/, /entrada_desde\s+time not null default '([\d:]+)'/],
  entrada_hasta: [/c\.entrada_hasta \|\| '([\d:]+)'/, /entrada_hasta\s+time not null default '([\d:]+)'/],
  salida_desde:  [/c\.salida_desde \|\| '([\d:]+)'/,  /salida_desde\s+time not null default '([\d:]+)'/],
  salida_hasta:  [/c\.salida_hasta \|\| '([\d:]+)'/,  /salida_hasta\s+time not null default '([\d:]+)'/]
};
for (const campo of Object.keys(V)) {
  prueba('el horario de ' + campo.replace('_', ' '),
    saca(FUENTE, V[campo][0], 'el ' + campo + ' de la pantalla'),
    saca(SQL,    V[campo][1], 'el ' + campo + ' de la base'));
}
prueba('la tolerancia que muestra la pantalla',
  +saca(FUENTE, /c\.tolerancia_gps_metros == null \? (\d+)/, 'la tolerancia de la pantalla'), TOLERANCIA);
prueba('el error máximo que muestra la pantalla',
  +saca(FUENTE, /c\.precision_maxima_metros == null \? (\d+)/, 'el error máximo de la pantalla'), PRECISION);

/* El texto explicativo también tiene que cuadrar: ahí van números sueltos
   dentro de frases, que es justo donde se quedan viejos. Se le quitan los
   empalmes de cadenas ('...' + '...') para poder leer la frase entera. */
const TEXTO = FUENTE.replace(/'\s*\+\s*'/g, '');
const EJEMPLO = TEXTO.match(/radio de (\d+) m y un teléfono que dice acertar a ±(\d+) m, deja marcar hasta (\d+) m/);
if (!EJEMPLO) throw new Error('No encontré el ejemplo de la tolerancia en la pantalla de Sedes.');
const [, EJ_RADIO, EJ_ERROR, EJ_TOPE] = EJEMPLO.map(Number);
prueba('el ejemplo usa el radio que trae el formulario',
  EJ_RADIO, +saca(FUENTE, /asSedeRadio"[^>]*value="(\d+)"/, 'el radio sugerido del formulario'));
prueba('el ejemplo da la cuenta que hace la base',
  EJ_RADIO + Math.min(EJ_ERROR, TOLERANCIA), EJ_TOPE);
prueba('el texto de ayuda del radio repite el mismo número',
  +saca(TEXTO, /Con (\d+) m alcanza para un edificio pequeño/, 'el texto de ayuda del radio'), EJ_RADIO);

/* El mensaje de la cédula tiene que decir lo que la base de verdad exige:
   la regla está escrita una sola vez, en el check de la tabla. */
grupo('El mensaje de la cédula no miente');
const LIMITES = SQL.match(/cedula ~ '\^\[0-9\]\{(\d+),(\d+)\}\$'/);
if (!LIMITES) throw new Error('No encontré el check del formato de la cédula en el SQL.');
const MENSAJE_CEDULA = A.enCristiano({ message: 'violates check constraint "asis_personal_cedula_formato"' });
prueba('dice el mínimo que exige la base',
  MENSAJE_CEDULA.includes(LIMITES[1]), true);
prueba('dice el máximo que exige la base',
  MENSAJE_CEDULA.includes(LIMITES[2]), true);
/* Y que esos límites dejen entrar a las cédulas de verdad: las de seis
   cifras son de gente nacida antes de 1950, y dejarlas fuera es dejar
   fuera a personas que trabajan. Cédulas inventadas: el repo es público. */
const FORMATO = new RegExp('^[0-9]{' + LIMITES[1] + ',' + LIMITES[2] + '}$');
prueba('entra una cédula de 8 cifras',  FORMATO.test('12345678'), true);
prueba('entra una de 6 cifras',         FORMATO.test('123456'), true);
prueba('no entra una de 5',             FORMATO.test('12345'), false);
prueba('no entra con la V delante',     FORMATO.test('V12345678'), false);
prueba('no entra con puntos',           FORMATO.test('12.345.678'), false);

/* ================================================================ */
console.log('\n' + '='.repeat(58));
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}\n`);
  fallos.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
} else {
  console.log(`Pasaron las ${ok} pruebas.`);
}
