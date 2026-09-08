/* Funciones compartidas por todas las pantallas.
   Estan aqui, y no repetidas en cada archivo, para poder probarlas.
   Funciona igual en el navegador y en Node (las pruebas corren en Node). */
(function (raiz) {
  'use strict';

  var F = {};

  /* ---------------------------------------------------------------
     Texto
  --------------------------------------------------------------- */
  F.esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* Quita lo puramente cosmetico: acentos, mayusculas, espacios de mas.
     OJO: solo sirve para comparar. NUNCA para decidir que dos medicamentos
     son el mismo: 200mg y 500mg siguen siendo distintos. */
  F.sinAcentos = function (t) {
    return String(t == null ? '' : t)
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  };

  /* Limpia caracteres invisibles que traen los Excel (el registro diario
     tenia 1.516 filas con un espacio de ancho cero en la columna Sexo). */
  F.limpia = function (t) {
    if (t == null) return null;
    var s = String(t).replace(/[​‌‍﻿]/g, '').replace(/ /g, ' ');
    s = s.normalize('NFC').replace(/\s+/g, ' ').trim();
    return s || null;
  };

  /* ---------------------------------------------------------------
     Fechas
  --------------------------------------------------------------- */

  /* Lee una fecha en los formatos en que de verdad viene escrita:
       2026-01-19   ·   19/01/2026   ·   19/01/26   ·   19-1-2026
     Devuelve 'AAAA-MM-DD' o null si es imposible.
     Leer 19/01/26 como enero de 2026 NO es inventar: es el mismo dato
     en otro formato. Lo que no se arregla es lo imposible (11/110/1986). */
  F.leeFecha = function (v) {
    if (v == null || v === '') return null;
    var t = String(v).replace(/\s+/g, '');
    var a, me, d, m;

    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
      a = m[1]; me = m[2]; d = m[3];
    } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) {
      d = m[1]; me = m[2]; a = m[3];
    } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(t))) {
      d = m[1]; me = m[2]; a = '20' + m[3];
    } else {
      return null;
    }

    a = +a; me = +me; d = +d;
    if (me < 1 || me > 12 || d < 1 || d > 31) return null;
    if (a < 1900 || a > 2100) return null;

    var f = new Date(Date.UTC(a, me - 1, d));
    // rechaza el 31 de febrero y compania
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== me - 1 || f.getUTCDate() !== d) return null;

    return a + '-' + String(me).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  /* Muestra la fecha como la escribe la gente aqui: 19/01/2026 */
  F.muestraFecha = function (f) {
    if (!f) return 'sin fecha';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  };

  /* "hace 5 min", "ayer"… ahora se pasa aparte para poder probarlo. */
  F.hace = function (iso, ahora) {
    if (!iso) return '';
    var s = Math.floor(((ahora == null ? Date.now() : ahora) - new Date(iso).getTime()) / 1000);
    if (s < 0) return 'ahora mismo';
    if (s < 60) return 'hace un momento';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    var d = Math.floor(s / 86400);
    return d === 1 ? 'ayer' : 'hace ' + d + ' días';
  };

  /* ---------------------------------------------------------------
     Períodos: el día, la semana y el mes

     La farmacia está en Venezuela y el día que cuenta es el día de
     Venezuela. `new Date().toISOString()` da la fecha en UTC, y a las
     8 de la noche de Charallave en UTC ya es mañana: un reporte "de
     hoy" hecho de noche saldría vacío y las entregas caerían en el día
     siguiente. Por eso la fecha de hoy se pide siempre en la zona
     horaria de Caracas, no en la del aparato ni en UTC.
  --------------------------------------------------------------- */
  var ZONA = 'America/Caracas';

  F.hoyCaracas = function (ahora) {
    var d = ahora == null ? new Date() : new Date(ahora);
    try {
      // 'en-CA' da justo AAAA-MM-DD.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
    } catch (e) {
      // Sin Intl (navegador viejo): Venezuela es UTC-4 todo el año.
      var v = new Date(d.getTime() - 4 * 3600 * 1000);
      return v.getUTCFullYear() + '-' + dos(v.getUTCMonth() + 1) + '-' + dos(v.getUTCDate());
    }
  };

  function dos(n) { return String(n).padStart(2, '0'); }
  function aDia(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function deDia(d) {
    return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate());
  }
  function suma(iso, dias) {
    var d = aDia(iso); d.setUTCDate(d.getUTCDate() + dias); return deDia(d);
  }
  F.sumaDias = suma;

  /* La semana empieza el LUNES, como se cuenta aquí. */
  F.periodo = function (cual, hoy) {
    var h = hoy || F.hoyCaracas();
    if (cual === 'semana') {
      var d = aDia(h);
      var atras = (d.getUTCDay() + 6) % 7;          // lunes = 0
      var lun = suma(h, -atras);
      return { desde: lun, hasta: suma(lun, 6) };
    }
    if (cual === 'mes') {
      var p = h.split('-');
      var pri = p[0] + '-' + p[1] + '-01';
      var ult = new Date(Date.UTC(+p[0], +p[1], 0));  // día 0 del mes siguiente
      return { desde: pri, hasta: deDia(ult) };
    }
    return { desde: h, hasta: h };                    // 'hoy'
  };

  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  /* El rótulo que se lee arriba del tablero. Se escribe con letras
     porque "del 01/09 al 07/09" no dice de un vistazo qué semana es. */
  F.rotuloPeriodo = function (desde, hasta, hoy) {
    if (!desde || !hasta) return '';
    var a = aDia(desde), b = aDia(hasta);
    var dia = function (d) { return DIAS_L[d.getUTCDay()] + ' ' + d.getUTCDate(); };
    var mesAno = function (d) { return MESES_L[d.getUTCMonth()] + ' de ' + d.getUTCFullYear(); };

    if (desde === hasta) {
      return (hoy && desde === hoy ? 'Hoy, ' : '') + dia(a) + ' de ' + mesAno(a);
    }
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      var primero = a.getUTCDate() === 1;
      var ultimo = b.getUTCDate() === new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate();
      if (primero && ultimo) {
        return MESES_L[a.getUTCMonth()].charAt(0).toUpperCase() +
               MESES_L[a.getUTCMonth()].slice(1) + ' de ' + a.getUTCFullYear() + ' completo';
      }
      return 'Del ' + dia(a) + ' al ' + dia(b) + ' de ' + mesAno(b);
    }
    return 'Del ' + dia(a) + ' de ' + mesAno(a) + ' al ' + dia(b) + ' de ' + mesAno(b);
  };

  /* ---------------------------------------------------------------
     Partir en medicamentos lo que dice el cuaderno

     El cuaderno de la farmacia anotaba el tratamiento entero en una sola
     celda: "VALSARTAN 80MG,ENALAPRIL 10MG" o "CARBAMAZEPINA 200mg /
     CLONAZEPAN 20mg / RESPIRIDONA 2mg".

     Pero la coma y la barra TAMBIÉN van dentro de un nombre:
     "DESLORATADINA 0,5MG/ML", "AIRON 60/400 MG", "SOL 0.9/HIDRATANTE".
     Cortar a ciegas parte los nombres por la mitad.

     La regla: se corta por la coma o la barra SALVO cuando tiene números
     a los dos lados. Así 0,5 y 60/400 quedan enteros y el resto se
     separa. No adivina nada más: lo que sale son CANDIDATOS para que una
     persona los mire, no medicamentos dados por buenos.
  --------------------------------------------------------------- */
  var COMA = '\u0001', BARRA = '\u0002';

  F.piezasTratamiento = function (textos) {
    var lista = Array.isArray(textos) ? textos : [textos];
    var vistos = {}, salida = [];

    lista.forEach(function (t) {
      if (t == null || t === '') return;
      // Se esconden los separadores que NO separan nada:
      //   · entre números          -> "60/400 MG", "0,5"
      //   · entre dos unidades     -> "0,5MG/ML", "500 MG/5ML", "UI/ML"
      // Lo demás sí separa: en "SOL 0.9/HIDRATANTE" la barra sí corta.
      var s = String(t)
        .replace(/(\d)\s*,\s*(\d)/g, '$1' + COMA + '$2')
        .replace(/(\d)\s*\/\s*(\d)/g, '$1' + BARRA + '$2')
        .replace(/(\d\s*(?:MG|ML|MCG|UI|CC|GR?|L)\s*)\/(\s*\d*\s*(?:MG|ML|MCG|UI|CC|GR?|L)\b)/gi,
                 '$1' + BARRA + '$2');

      s.split(/[\/,;]+/).forEach(function (p) {
        var x = p.replace(new RegExp(COMA, 'g'), ',')
                 .replace(new RegExp(BARRA, 'g'), '/')
                 .replace(/\s+/g, ' ').trim();
        // Se quitan los adornos que no son nombre de nada.
        x = x.replace(/^[-+.*·•]+/, '').replace(/[-+.*·•]+$/, '').trim();
        if (x.length < 3) return;
        var clave = F.sinAcentos(x);
        if (vistos[clave]) return;
        vistos[clave] = 1;
        salida.push(x);
      });
    });
    return salida;
  };

  /* ---------------------------------------------------------------
     Cédulas
  --------------------------------------------------------------- */

  /* Lee una cédula o un RIF de persona natural.

     El RIF venezolano es la cédula MAS un dígito verificador al final:
       V-17685436-2   =   cédula 17685436  +  dígito 2
     Viene escrito de muchas formas: con guion, con puntos (17.114.309.2)
     o todo pegado (176854362). Los tres son lo mismo.

     Se aceptan de 6 a 8 dígitos de cédula. Las de SEIS son válidas:
     corresponden a personas nacidas entre 1930 y 1949. Exigir siete
     dejaría fuera a 16 abuelos que hoy están en el padrón.

     Devuelve {nacionalidad, numero, digitoRif} o null. Nunca adivina. */
  F.leeCedula = function (v) {
    if (v == null) return null;
    var t = String(v).trim();
    var nac = 'V', m;

    m = /^([VvEe])[\s.\-]*(.+)$/.exec(t);
    if (m) { nac = m[1].toUpperCase(); t = m[2]; }

    // Con separador antes del último dígito: es un RIF.
    m = /^(\d{6,8})[.\-](\d)$/.exec(t.replace(/\s/g, ''));
    if (m) return { nacionalidad: nac, numero: m[1].replace(/\D/g, ''), digitoRif: m[2] };

    var d = t.replace(/[\s.\-]/g, '');
    if (!/^\d+$/.test(d)) return null;

    // Nueve dígitos seguidos: cédula de ocho + dígito del RIF.
    if (d.length === 9) return { nacionalidad: nac, numero: d.slice(0, 8), digitoRif: d.slice(8) };
    if (d.length >= 6 && d.length <= 8) return { nacionalidad: nac, numero: d, digitoRif: null };
    return null;
  };

  /* Arma el RIF completo si se tiene el dígito verificador. */
  F.muestraRif = function (nac, num, dig) {
    if (!num || !dig) return null;
    return (nac || 'V') + '-' + num + '-' + dig;
  };

  F.muestraCedula = function (nac, num, cruda) {
    if (num) return (nac || 'V') + '-' + num;
    return cruda ? String(cruda) : 'sin cédula';
  };

  /* ---------------------------------------------------------------
     Situación de un lote
  --------------------------------------------------------------- */
  F.situacionLote = function (vence, hoy) {
    if (!vence) return 'sin_fecha';
    var h = hoy ? new Date(hoy + 'T00:00:00Z') : new Date();
    var v = new Date(String(vence).slice(0, 10) + 'T00:00:00Z');
    var dias = Math.floor((v - h) / 86400000);
    if (dias < 0) return 'vencido';
    if (dias <= 30) return 'por_vencer_30';
    if (dias <= 90) return 'por_vencer_90';
    return 'vigente';
  };

  /* ---------------------------------------------------------------
     Errores en cristiano
  --------------------------------------------------------------- */
  F.traduceError = function (err) {
    var m = (err && err.message ? err.message : String(err || ''));
    if (/venci|vencid/i.test(m)) return 'Ese lote está vencido: el sistema no permite entregarlo.';
    if (/No hay suficiente/i.test(m)) return m;
    if (/dado de baja/i.test(m)) return m;
    if (/invalid login/i.test(m)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(m)) return 'Falta confirmar el correo. Revisa tu bandeja.';
    if (/duplicate key|23505/i.test(m)) return 'Ese registro ya existe.';
    if (/too many/i.test(m)) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    if (/Failed to fetch|NetworkError|network/i.test(m))
      return 'Se cayó la conexión y NO se guardó. Vuelve a intentar cuando tengas internet.';
    if (/permission denied|42501|row-level security/i.test(m))
      return 'Tu usuario no tiene permiso para hacer eso.';
    return m || 'Ocurrió un error.';
  };

  /* ---------------------------------------------------------------
     Contraseñas
  --------------------------------------------------------------- */
  F.revisaClave = function (clave) {
    var c = String(clave || '');
    if (c.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[a-zA-Z]/.test(c)) return 'La contraseña debe llevar al menos una letra.';
    if (!/\d/.test(c)) return 'La contraseña debe llevar al menos un número.';
    if (/^(?:123|abc|clave|password|farmacia)/i.test(c)) return 'Esa contraseña es muy fácil de adivinar.';
    return null;   // null = está bien
  };

  /* Espera a que la persona deje de escribir antes de buscar. */
  F.retardo = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, s = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(s, a); }, ms);
    };
  };

  raiz.FARM = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : globalThis);
