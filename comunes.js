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
     Cédulas
  --------------------------------------------------------------- */

  /* Acepta de 6 a 9 dígitos. Las de 6 SON válidas: corresponden a
     personas nacidas entre 1930 y 1949. Exigir 7 dejaría fuera a 16
     abuelos que hoy están en el padrón.
     Devuelve {nacionalidad, numero} o null. Nunca adivina nada. */
  F.leeCedula = function (v) {
    if (v == null) return null;
    var t = String(v).replace(/[\s.\-]/g, '');
    var m = /^([VvEe])?(\d{6,9})$/.exec(t);
    if (!m) return null;
    return { nacionalidad: (m[1] || 'V').toUpperCase(), numero: m[2] };
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
