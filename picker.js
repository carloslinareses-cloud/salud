/* BUSCADORES COMPARTIDOS: medicinas y patologías.

   Los usan dos pantallas —Entregar y Personas— y por eso viven aquí y no
   dentro de una de ellas.

   Los dos funcionan igual: se escribe, sale una lista para tocar, y
   SIEMPRE se puede anotar lo escrito a mano aunque no esté en la lista.
   Eso último importa: el catálogo se está cargando a mano y que un
   medicamento todavía no esté no significa que la persona no lo necesite.

   Con las patologías el problema es el contrario y también está resuelto
   aquí: si se dejara escribir libre y ya, la misma cosa entraría como
   "HIPERTENSION", "HTA" y "TENSION ALTA", y luego no hay forma de contar
   cuántos hipertensos hay. Por eso primero se ofrecen las más comunes ya
   escritas, y las que alguien escribió antes salen las primeras. */
(function () {
  'use strict';

  var P = {};

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sinAcentos(t) {
    return window.FARM && window.FARM.sinAcentos
      ? window.FARM.sinAcentos(t)
      : String(t == null ? '' : t).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }

  /* Las que se ven de entrada, sin escribir nada. Son las que más aparecen
     en el registro de la farmacia. NO son un diagnóstico ni una sugerencia
     médica: es una lista de palabras ya escritas para no tener que
     teclearlas y para que todos las escriban igual. */
  P.PATOLOGIAS_COMUNES = [
    'HIPERTENSIÓN ARTERIAL', 'DIABETES TIPO 2', 'ASMA', 'ARTRITIS', 'ARTROSIS',
    'HIPOTIROIDISMO', 'EPILEPSIA', 'GASTRITIS', 'INSUFICIENCIA RENAL',
    'CARDIOPATÍA', 'DISLIPIDEMIA (COLESTEROL ALTO)', 'ANEMIA', 'MIGRAÑA',
    'DEPRESIÓN', 'ANSIEDAD', 'EPOC', 'OSTEOPOROSIS', 'PRÓSTATA',
    'GLAUCOMA', 'ALERGIA', 'DIABETES TIPO 1', 'HIPERTIROIDISMO',
    'INSUFICIENCIA CARDÍACA', 'ÚLCERA GÁSTRICA', 'PARKINSON', 'ALZHEIMER',
    'LUPUS', 'TRASTORNO BIPOLAR', 'ESQUIZOFRENIA', 'HEPATITIS',
    'TUBERCULOSIS', 'VIH', 'CÁNCER', 'ACV (DERRAME)', 'DERMATITIS',
    'OBESIDAD', 'DESNUTRICIÓN', 'EMBARAZO'
  ];

  /* ================================================================
     La caja: el rótulo, la casilla y el sitio de los resultados.
     `pfx` hace únicos los identificadores: la misma caja puede estar
     montada dos veces en la página a la vez.
  ================================================================ */
  P.caja = function (pfx, rotulo, marcador, valor) {
    return '<div class="picker-med" id="' + pfx + 'Caja">' +
      '<label for="' + pfx + 'Busca">' + esc(rotulo) + '</label>' +
      '<input id="' + pfx + 'Busca" type="search" autocomplete="off" ' +
        'placeholder="' + esc(marcador) + '" value="' + esc(valor || '') + '">' +
      '<div id="' + pfx + 'Res"></div>' +
    '</div>';
  };

  /* Cada buscador lleva su número de petición: con internet lento salían
     dos en vuelo a la vez y la que tardaba más pintaba encima de la nueva. */
  var pedidos = {};

  function engancha(pfx, buscar) {
    var caja = document.getElementById(pfx + 'Busca');
    if (!caja) return;
    /* En cuanto se toca una tecla, lo que hay abajo deja de valer: es de
       lo que se escribió ANTES. Se apaga ya, sin esperar al retardo, para
       que no se pueda tocar el botón de "anotar tal cual" con el texto
       viejo y quede anotada otra cosa. */
    caja.addEventListener('input', function () {
      var z = document.getElementById(pfx + 'Res');
      if (z) z.innerHTML = '<div class="cargando">Buscando…</div>';
    });
    caja.addEventListener('input', retardo(function () {
      buscar(caja.value.trim());
    }, 280));
    caja.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') ev.preventDefault();
    });
    buscar(caja.value.trim());
  }

  function pinta(pfx, html) {
    var z = document.getElementById(pfx + 'Res');
    if (z) z.innerHTML = html;
    return z;
  }

  /* El botón de "esto va tal como lo escribí". Siempre disponible a partir
     de tres letras: ni el catálogo ni la lista de patologías lo tienen
     todo, y el dato de la persona no se puede perder por eso. */
  function botonAMano(pfx, q, texto, pie) {
    if (q.length < 3) return '';
    return '<button type="button" class="ficha ficha-mano" id="' + pfx + 'AMano">' +
      '<div class="ficha-nom"><b>' + esc(texto) + '</b>' +
      '<span class="ficha-pres">' + esc(pie) + '</span></div></button>';
  }

  /* ================================================================
     MEDICINAS — se busca en el catálogo, no en lo que hay disponible:
     una persona puede necesitar algo que hoy está agotado, y eso es
     justo lo que hay que dejar anotado.
  ================================================================ */
  P.medicinas = function (sb, pfx, alElegir) {
    engancha(pfx, function (q) {
      var mio = (pedidos[pfx] = (pedidos[pfx] || 0) + 1);
      var p = sb.from('v_catalogo')
        .select('producto_id,producto,dosificacion,presentacion,disponible,situacion',
                { count: 'exact' });
      if (q.length >= 2) p = p.ilike('producto', '*' + q.replace(/[%,()]/g, '') + '*');

      p.order('producto').limit(20).then(function (r) {
        if (mio !== pedidos[pfx]) return;
        if (r.error) { pinta(pfx, '<div class="aviso bad">' + esc(r.error.message) + '</div>'); return; }
        var f = r.data || [];
        var aMano = botonAMano(pfx, q, 'Anotar «' + q + '» tal como lo escribí',
                               'No hace falta que esté en el catálogo.');

        if (!f.length) {
          pinta(pfx, aMano
            ? '<div class="fichas">' + aMano + '</div>'
            : '<div class="vacio"><b>' +
              (q ? 'No hay «' + esc(q) + '» en el catálogo.' : 'El catálogo todavía está vacío.') +
              '</b><span>Escribe al menos tres letras y se puede anotar igual, ' +
              'tal como lo dice la receta.</span></div>');
        } else {
          var total = r.count == null ? f.length : r.count;
          pinta(pfx,
            '<p class="conteo">' + (total > f.length
              ? 'Los ' + f.length + ' primeros de ' + total + '. Escribe más letras para acotar.'
              : total + (total === 1 ? ' medicamento' : ' medicamentos')) + '</p>' +
            '<div class="fichas">' + f.map(function (x, i) {
              var hay = Math.round(Number(x.disponible) || 0);
              return '<button type="button" class="ficha" data-i="' + i + '">' +
                '<div class="ficha-nom"><b>' + esc(x.producto) + '</b>' +
                  '<span class="ficha-pres">' +
                  esc([x.dosificacion, x.presentacion].filter(Boolean).join(' · ') || 'sin presentación') +
                  '</span></div>' +
                '<div class="ficha-datos"><span class="ficha-cant' + (hay ? '' : ' cero') + '">' +
                  hay + '<em>' + (hay === 1 ? 'disponible' : 'disponibles') + '</em></span></div>' +
              '</button>';
            }).join('') + aMano + '</div>');
        }

        var z = document.getElementById(pfx + 'Res');
        if (!z) return;
        z.querySelectorAll('[data-i]').forEach(function (b) {
          b.addEventListener('click', function () {
            var x = f[+b.dataset.i];
            alElegir({ producto_id: x.producto_id, producto: x.producto,
                       dosificacion: x.dosificacion, presentacion: x.presentacion });
          });
        });
        var m = document.getElementById(pfx + 'AMano');
        if (m) m.addEventListener('click', function () {
          alElegir({ producto_id: null, texto_original: q, producto: q });
        });
      });
    });
  };

  /* ================================================================
     PATOLOGÍAS — primero las que ya escribió alguien (para que se
     escriban todas igual), y después las comunes que faltan.
  ================================================================ */
  P.patologias = function (sb, pfx, alElegir) {
    engancha(pfx, function (q) {
      var mio = (pedidos[pfx] = (pedidos[pfx] || 0) + 1);
      var busca = sinAcentos(q);

      sb.from('v_patologias').select('patologia,personas').order('personas', { ascending: false })
        .limit(200).then(function (r) {
          if (mio !== pedidos[pfx]) return;
          var usadas = (r.error ? [] : (r.data || []));

          /* Lo ya usado primero, con cuánta gente lo tiene: así se elige
             la forma que ya está escrita en vez de inventar otra. */
          var lista = usadas
            .filter(function (x) { return !busca || sinAcentos(x.patologia).indexOf(busca) >= 0; })
            .map(function (x) { return { txt: x.patologia, personas: x.personas }; });

          var yaEsta = {};
          lista.forEach(function (x) { yaEsta[sinAcentos(x.txt)] = 1; });

          P.PATOLOGIAS_COMUNES.forEach(function (c) {
            if (yaEsta[sinAcentos(c)]) return;
            if (busca && sinAcentos(c).indexOf(busca) < 0) return;
            lista.push({ txt: c, personas: 0 });
          });

          var cortada = lista.slice(0, 24);
          var exacta = lista.some(function (x) { return sinAcentos(x.txt) === busca; });
          var aMano = exacta ? '' : botonAMano(pfx, q, 'Anotar «' + q + '» tal como lo escribí',
            'Solo si de verdad no está en la lista: escribir lo mismo de dos formas ' +
            'impide contarlo después.');

          if (!cortada.length && !aMano) {
            pinta(pfx, '<div class="vacio"><b>Nada con «' + esc(q) + '»</b>' +
              '<span>Escribe al menos tres letras para anotarlo tal cual.</span></div>');
            return;
          }

          pinta(pfx,
            (cortada.length
              ? '<p class="conteo">' + (lista.length > cortada.length
                  ? 'Las ' + cortada.length + ' primeras de ' + lista.length + '. Escribe para acotar.'
                  : cortada.length + (cortada.length === 1 ? ' patología' : ' patologías')) + '</p>' +
                '<div class="chips patologias">' + cortada.map(function (x, i) {
                  return '<button type="button" data-i="' + i + '">' + esc(x.txt) +
                    (x.personas ? '<em>' + x.personas + '</em>' : '') + '</button>';
                }).join('') + '</div>'
              : '') +
            (aMano ? '<div class="fichas">' + aMano + '</div>' : ''));

          var z = document.getElementById(pfx + 'Res');
          if (!z) return;
          z.querySelectorAll('[data-i]').forEach(function (b) {
            b.addEventListener('click', function () {
              alElegir({ patologia: cortada[+b.dataset.i].txt });
            });
          });
          var m = document.getElementById(pfx + 'AMano');
          if (m) m.addEventListener('click', function () {
            alElegir({ patologia: q.toUpperCase() });
          });
        });
    });
  };

  /* ================================================================
     LO QUE HA RETIRADO ANTES

     El cuaderno anotaba el tratamiento en la misma casilla de cada
     entrega. Al migrar eso quedó como el texto de la entrega —que es lo
     que era—, así que la ficha de mucha gente sale vacía aunque el dato
     esté justo al lado.

     Aquí se saca a la vista, partido en medicamentos, para poder pasarlo
     a su tratamiento con un toque. NO se pasa solo: lo que alguien
     retiró una vez no es forzosamente lo que toma siempre, y eso lo
     decide quien atiende, no el programa.
  ================================================================ */
  P.piezasDe = function (entradas, yaTiene) {
    var textos = (entradas || []).map(function (x) {
      return typeof x === 'string' ? x : (x && x.texto);
    });
    var piezas = (window.FARM && window.FARM.piezasTratamiento)
      ? window.FARM.piezasTratamiento(textos) : [];
    if (!yaTiene || !yaTiene.length) return piezas;
    return piezas.filter(function (x) {
      return !yaTiene.some(function (t) {
        return P.mismo(t.producto || t.texto_original, x);
      });
    });
  };

  function fechaCorta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }

  /* El bloque va DENTRO del recuadro del tratamiento, no en una caja
     aparte: para quien atiende, esto ES el tratamiento de la persona y
     tiene que leerse de una, sin tocar nada. Lo que sigue distinguiendo
     una cosa de la otra es el rótulo y el botón de pasarlo a su ficha. */
  P.bloqueCuaderno = function (pfx, piezas, entradas) {
    var filas = (entradas || []).filter(function (x) {
      return x && (typeof x === 'string' ? x : x.texto);
    });
    if (!filas.length) return '';

    return '<div class="cuaderno" id="' + pfx + 'Caja">' +
      '<span class="cu-lbl">Lo que dice el cuaderno</span>' +
      '<div class="cu-lista">' + filas.slice(0, 12).map(function (x) {
        var t = typeof x === 'string' ? x : x.texto;
        var f = typeof x === 'string' ? '' : x.fecha;
        return '<div class="cu-fila">' +
          (f ? '<span class="cu-fecha">' + esc(fechaCorta(f)) + '</span>' : '') +
          '<span class="cu-txt">' + esc(t) + '</span></div>';
      }).join('') +
      (filas.length > 12
        ? '<p class="sub chico">Y ' + (filas.length - 12) + ' entregas más antiguas.</p>'
        : '') +
      '</div>' +

      (piezas && piezas.length
        ? '<p class="cu-pasa">Toca para pasarlo a su tratamiento:</p>' +
          '<div class="trat-lista">' + piezas.map(function (x, i) {
            return '<button type="button" class="pieza" data-pieza="' + i + '">' +
                   esc(x) + '</button>';
          }).join('') + '</div>' +
          (piezas.length > 1
            ? '<button type="button" class="trat-mas" id="' + pfx + 'Todas">' +
              'Pasarlas todas (' + piezas.length + ')</button>'
            : '')
        : '<p class="sub chico">Todo lo del cuaderno ya está en su tratamiento.</p>') +
    '</div>';
  };

  P.engancharRetirado = function (raiz, pfx, piezas, alElegir, alElegirTodas) {
    var z = raiz || document;
    z.querySelectorAll('#' + pfx + 'Caja [data-pieza], [data-pieza]').forEach(function (b) {
      if (b.dataset.enganchado) return;
      b.dataset.enganchado = '1';
      b.addEventListener('click', function () { alElegir(piezas[+b.dataset.pieza]); });
    });
    var t = z.querySelector('#' + pfx + 'Todas');
    if (t && alElegirTodas) t.addEventListener('click', function () {
      t.disabled = true; t.textContent = 'Pasando…';
      alElegirTodas(piezas);
    });
  };

  /* Compara dos cosas anotadas sin que estorben acentos ni mayúsculas, y
     CRUZADO: lo escrito a mano contra el nombre del catálogo y al revés.
     Sin esto, anotar "losartan" a mano cuando ya tenía LOSARTAN del
     catálogo lo dejaba dos veces. */
  P.mismo = function (a, b) {
    if (a == null || b == null) return false;
    var x = sinAcentos(a), y = sinAcentos(b);
    return !!x && x === y;
  };

  window.FARMPICK = P;
})();
