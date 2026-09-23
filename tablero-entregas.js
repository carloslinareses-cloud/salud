/* TABLERO DE ENTREGAS: qué salió de la farmacia y cuándo.

   Contesta cuatro preguntas con un toque —qué se entregó hoy, esta
   semana, este mes, o entre dos fechas cualesquiera— y lo saca en
   Excel y en PDF tal como se ve.

   Vive en dos sitios: en Mercancía y en el panel del administrador. Es
   el mismo módulo montado dos veces, así que NO usa `getElementById`:
   las dos copias existen a la vez en la página (las áreas se esconden,
   no se destruyen) y buscar por id encontraría la del otro lado. Todo
   se busca dentro de su propia caja y con su propio prefijo.

   Lo importante de entender:

     La farmacia tiene DOS clases de entrega y no se pueden sumar juntas.
     Las que se registran aquí traen renglones con la cantidad exacta.
     Las 4.999 que vinieron de los Excel solo dicen a quién y, en texto
     libre, qué se le dio: el 99,9 % no anotaba cuánto. Se cuentan como
     entregas, se listan, pero nunca entran en el total de unidades.
     Mezclarlas sería inventar números. */
(function () {
  'use strict';

  var POR_PAGINA = 50;
  var TOPE = 1000;          // lo que devuelve la API de una vez
  var TECHO = 20000;        // hasta donde se trae un periodo de golpe

  var PERIODOS = [
    { id: 'hoy',    txt: 'Hoy' },
    { id: 'semana', txt: 'Esta semana' },
    { id: 'mes',    txt: 'Este mes' },
    { id: 'rango',  txt: 'Entre dos fechas' }
  ];

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-VE'); }
  function corta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }
  function sinAcentos(t) {
    return window.FARM && window.FARM.sinAcentos
      ? window.FARM.sinAcentos(t)
      : String(t == null ? '' : t).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }
  function hoyEs() {
    return window.FARM && window.FARM.hoyCaracas
      ? window.FARM.hoyCaracas()
      : new Date().toISOString().slice(0, 10);
  }
  function rangoDe(cual) {
    if (window.FARM && window.FARM.periodo) return window.FARM.periodo(cual, hoyEs());
    var h = hoyEs(); return { desde: h, hasta: h };
  }
  function rotulo(d, h) {
    return window.FARM && window.FARM.rotuloPeriodo
      ? window.FARM.rotuloPeriodo(d, h, hoyEs())
      : corta(d) + ' — ' + corta(h);
  }

  /* ---------------------------------------------------------------- edad y patologías

     La edad y la patología son datos DEL PACIENTE, no del renglón de la
     entrega: no vienen en v_entregas_renglon (traerlas ahí duplicaría
     filas por cada patología y rompería las cuentas de unidades que ya
     existen). Se traen aparte, una sola vez, y se cruzan aquí. */
  function edadDeFecha(fechaNac, hoyISO) {
    if (!fechaNac || !hoyISO) return null;
    var n = new Date(fechaNac + 'T00:00:00');
    var h = new Date(hoyISO + 'T00:00:00');
    if (isNaN(n.getTime()) || isNaN(h.getTime())) return null;
    var edad = h.getFullYear() - n.getFullYear();
    var m = h.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && h.getDate() < n.getDate())) edad--;
    return edad >= 0 && edad <= 120 ? edad : null;
  }
  function edadDeTexto(t) {
    var m = /(\d{1,3})/.exec(String(t || ''));
    if (!m) return null;
    var n = Number(m[1]);
    return n >= 0 && n <= 120 ? n : null;
  }
  var GRUPO_TXT = { ninos: 'Niños (menores de 18)', adultos: 'Adultos (18 o más)', sinEdad: 'Edad no registrada' };

  /* Función pura: de los renglones ya filtrados (mismo período y misma
     búsqueda que ve la pantalla) arma el resumen por patología, separado
     en niños y adultos, y el detalle de qué medicamento se le entregó a
     cada grupo. Si el paciente no tiene ninguna patología registrada, o
     no tiene edad registrada, se cuenta aparte -nunca se inventa-. */
  function calcularPatologias(filas, patPorPaciente, edadPorPaciente) {
    var porPatologia = {};
    var sinPatologia = { personas: {}, unidades: 0 };
    var variasPatologias = {};
    var detalle = {};

    filas.forEach(function (x) {
      if (x.cantidad == null || !x.paciente_id) return;
      var c = Number(x.cantidad) || 0;
      var pid = x.paciente_id;
      var edad = edadPorPaciente[pid];
      var grupo = edad == null ? 'sinEdad' : (edad < 18 ? 'ninos' : 'adultos');
      var pats = patPorPaciente[pid] || [];

      if (!pats.length) {
        sinPatologia.personas[pid] = 1;
        sinPatologia.unidades += c;
        return;
      }
      if (pats.length > 1) variasPatologias[pid] = 1;

      pats.forEach(function (pat) {
        var p = porPatologia[pat] || (porPatologia[pat] = {
          patologia: pat,
          ninos: { personas: {}, unidades: 0 },
          adultos: { personas: {}, unidades: 0 },
          sinEdad: { personas: {}, unidades: 0 }
        });
        p[grupo].personas[pid] = 1;
        p[grupo].unidades += c;

        var kd = pat + '|' + grupo + '|' + (x.producto_id || x.producto);
        var d = detalle[kd] || (detalle[kd] = {
          patologia: pat, grupo: grupo, producto: x.producto, dosificacion: x.dosificacion,
          unidad: x.unidad, unidades: 0, personas: {}
        });
        d.unidades += c;
        d.personas[pid] = 1;
      });
    });

    var contar = function (o) { return Object.keys(o).length; };

    var resumen = Object.keys(porPatologia).map(function (k) {
      var p = porPatologia[k];
      var personasTot = {};
      ['ninos', 'adultos', 'sinEdad'].forEach(function (g) {
        Object.keys(p[g].personas).forEach(function (id) { personasTot[id] = 1; });
      });
      return {
        patologia: p.patologia,
        ninosPersonas: contar(p.ninos.personas), ninosUnidades: p.ninos.unidades,
        adultosPersonas: contar(p.adultos.personas), adultosUnidades: p.adultos.unidades,
        sinEdadPersonas: contar(p.sinEdad.personas), sinEdadUnidades: p.sinEdad.unidades,
        totalUnidades: p.ninos.unidades + p.adultos.unidades + p.sinEdad.unidades,
        totalPersonas: contar(personasTot)
      };
    }).sort(function (a, b) { return b.totalUnidades - a.totalUnidades; });

    var detalleLista = Object.keys(detalle).map(function (k) {
      var d = detalle[k];
      return {
        patologia: d.patologia, grupo: GRUPO_TXT[d.grupo], producto: d.producto,
        dosificacion: d.dosificacion, unidad: d.unidad, unidades: d.unidades, personas: contar(d.personas)
      };
    }).sort(function (a, b) {
      if (a.patologia !== b.patologia) return a.patologia < b.patologia ? -1 : 1;
      return b.unidades - a.unidades;
    });

    return {
      resumen: resumen,
      detalle: detalleLista,
      sinPatologia: { personas: contar(sinPatologia.personas), unidades: sinPatologia.unidades },
      variasPatologias: contar(variasPatologias)
    };
  }

  /* ================================================================
     Una instancia del tablero
  ================================================================ */
  function Tablero(sb, raiz, pfx) {
    this.sb = sb;
    this.raiz = raiz;
    this.pfx = pfx;
    var r = rangoDe('hoy');
    this.periodo = 'hoy';
    this.desde = r.desde;
    this.hasta = r.hasta;
    this.busca = '';
    this.pagina = 0;
    this.filas = [];          // renglones crudos del período
    this.cargando = false;
    this.pedido = 0;          // para descartar respuestas que llegan tarde
    this.espera = null;       // el retardo del buscador
    this.recortado = false;   // el periodo no cupo entero
    this.patPorPaciente = {}; // paciente_id -> [patologia, ...] (se carga una sola vez)
    this.edadPorPaciente = {};// paciente_id -> edad en años, o null si no se sabe
  }

  Tablero.prototype.id = function (n) { return this.pfx + n; };
  Tablero.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };

  /* ---------------------------------------------------------------- armazón */
  Tablero.prototype.pintar = function () {
    var t = this;
    var i = function (n) { return t.id(n); };

    t.raiz.innerHTML =
      '<h2 class="sub-t">Lo que se entregó</h2>' +
      '<p class="sub">Elige el período y abajo sale todo lo que salió de la farmacia, ' +
      'contado y listo para descargar en Excel o en PDF.</p>' +

      '<div class="chips" id="' + i('Per') + '">' +
        PERIODOS.map(function (p) {
          return '<button type="button" data-per="' + p.id + '"' +
                 (p.id === t.periodo ? ' class="on"' : '') + '>' + p.txt + '</button>';
        }).join('') +
      '</div>' +

      '<div class="rango-fechas" id="' + i('Rango') + '"' + (t.periodo === 'rango' ? '' : ' hidden') + '>' +
        '<div class="rf-campo"><label for="' + i('Desde') + '">Desde</label>' +
          '<input id="' + i('Desde') + '" type="date" value="' + esc(t.desde) + '"></div>' +
        '<div class="rf-campo"><label for="' + i('Hasta') + '">Hasta</label>' +
          '<input id="' + i('Hasta') + '" type="date" value="' + esc(t.hasta) + '"></div>' +
        '<button type="button" class="suave" id="' + i('Ver') + '">Ver el período</button>' +
      '</div>' +

      '<p class="periodo-t" id="' + i('Rotulo') + '"></p>' +
      '<div id="' + i('Cuerpo') + '"><div class="cargando">Contando las entregas…</div></div>';

    t.raiz.querySelectorAll('#' + i('Per') + ' button').forEach(function (b) {
      b.addEventListener('click', function () { t.cambiaPeriodo(b.dataset.per); });
    });
    t.q('Ver').addEventListener('click', function () { t.aplicaRango(); });
    ['Desde', 'Hasta'].forEach(function (c) {
      t.q(c).addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); t.aplicaRango(); }
      });
    });

    t.cargar();
    t.cargarPatologias();
  };

  /* Edad y patología son del paciente, no del período: se traen una
     sola vez (no en cada cambio de fecha) y si ya llegaron cuando el
     cuerpo esté pintado, se repinta para que aparezcan. */
  Tablero.prototype.cargarPatologias = function () {
    var t = this;
    var hoy = hoyEs();

    function traeTodo(tabla, campos) {
      var todo = [];
      function pag(desde) {
        return t.sb.from(tabla).select(campos).range(desde, desde + TOPE - 1).then(function (r) {
          if (r.error) throw r.error;
          var f = r.data || [];
          todo = todo.concat(f);
          if (f.length === TOPE) return pag(desde + TOPE);
          return todo;
        });
      }
      return pag(0);
    }

    Promise.all([
      traeTodo('patologias_paciente', 'paciente_id,patologia,activo'),
      traeTodo('pacientes', 'id,fecha_nac,edad_texto')
    ]).then(function (r) {
      var patologias = r[0], pacientes = r[1];
      var patPorPaciente = {};
      patologias.forEach(function (x) {
        if (!x.activo || !x.paciente_id || !x.patologia) return;
        var pat = String(x.patologia).trim().toUpperCase();
        if (!pat) return;
        (patPorPaciente[x.paciente_id] || (patPorPaciente[x.paciente_id] = [])).push(pat);
      });
      var edadPorPaciente = {};
      pacientes.forEach(function (p) {
        var e = edadDeFecha(p.fecha_nac, hoy);
        if (e == null) e = edadDeTexto(p.edad_texto);
        edadPorPaciente[p.id] = e;
      });
      t.patPorPaciente = patPorPaciente;
      t.edadPorPaciente = edadPorPaciente;
      if (!t.cargando && t.q('Cuerpo') && t.filas.length) t.pintarCuerpo();
    }).catch(function (e) {
      console.warn('[tablero-entregas] No se pudieron cargar patologías/edades:', e);
    });
  };

  Tablero.prototype.cambiaPeriodo = function (cual) {
    var t = this;
    t.periodo = cual;
    t.raiz.querySelectorAll('#' + t.id('Per') + ' button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.per === cual);
    });
    t.q('Rango').hidden = cual !== 'rango';

    if (cual === 'rango') {
      // Se queda con lo que ya se está viendo, para no borrar la pantalla
      // antes de que la persona elija las fechas.
      t.q('Desde').focus();
      return;
    }
    var r = rangoDe(cual);
    t.desde = r.desde; t.hasta = r.hasta;
    t.pagina = 0;
    t.cargar();
  };

  Tablero.prototype.aplicaRango = function () {
    var t = this;
    var d = t.q('Desde').value, h = t.q('Hasta').value;
    if (!d || !h) { t.avisoCuerpo('warn', 'Faltan las dos fechas.'); return; }
    if (d > h) { var x = d; d = h; h = x; t.q('Desde').value = d; t.q('Hasta').value = h; }
    t.desde = d; t.hasta = h; t.pagina = 0;
    t.cargar();
  };

  Tablero.prototype.avisoCuerpo = function (clase, txt) {
    var z = this.q('Cuerpo');
    if (z) z.innerHTML = '<div class="aviso ' + clase + '">' + esc(txt) + '</div>';
  };

  /* ---------------------------------------------------------------- datos */
  Tablero.prototype.cargar = function () {
    var t = this;
    var mio = ++t.pedido;
    var z = t.q('Cuerpo');
    if (!z) return;
    /* El retardo del buscador puede seguir vivo de la pantalla anterior:
       si se dispara despues, repinta con el texto que ya no esta. */
    clearTimeout(t.espera);
    t.q('Rotulo').textContent = rotulo(t.desde, t.hasta);
    /* Que las casillas digan siempre el periodo que se esta viendo: al
       pasar a "entre dos fechas" se parte de ahi y no de lo de hoy. */
    var cd = t.q('Desde'), ch = t.q('Hasta');
    if (cd) cd.value = t.desde;
    if (ch) ch.value = t.hasta;
    z.innerHTML = '<div class="cargando">Contando las entregas…</div>';
    t.cargando = true;
    t.recortado = false;

    var todo = [];
    function trae(desde) {
      return t.sb.from('v_entregas_renglon')
        .select('entrega_id,fecha,origen,anulada,lo_entregado,entregado_por,' +
                'tipo_destinatario,paciente_id,institucion_id,destinatario,centro_tipo,' +
                'nacionalidad,cedula,recibe_nombre,' +
                'renglon_id,cantidad,producto_id,producto,dosificacion,presentacion,' +
                'categoria,unidad,empaque,unidades_por_empaque,en_cajas,lote,vence')
        .gte('fecha', t.desde).lte('fecha', t.hasta)
        .order('fecha', { ascending: false, nullsFirst: false })
        .order('entrega_id')
        .order('renglon_id', { nullsFirst: false })
        .range(desde, desde + TOPE - 1)
        .then(function (r) {
          if (r.error) throw r.error;
          var f = r.data || [];
          todo = todo.concat(f);
          if (f.length === TOPE) {
            if (todo.length >= TECHO) { t.recortado = true; return; }
            return trae(desde + TOPE);
          }
        });
    }

    trae(0).then(function () {
      if (mio !== t.pedido || !t.q('Cuerpo')) return;   // llegó tarde: ya hay otro período
      t.filas = todo;
      t.cargando = false;
      t.pintarCuerpo();
    }).catch(function (e) {
      if (mio !== t.pedido) return;
      t.cargando = false;
      t.avisoCuerpo('bad', 'No se pudo cargar: ' + (e.message || e));
    });
  };

  /* ---------------------------------------------------------------- cuentas

     Todo lo que muestra el tablero sale de aquí, y de aquí sale también
     lo que se descarga: así el Excel dice exactamente lo mismo que la
     pantalla, sin volver a pedirle nada al servidor. */
  Tablero.prototype.cuentas = function () {
    var t = this;
    var q = sinAcentos(t.busca);

    var vivas = t.filas.filter(function (x) { return !x.anulada; });
    var anuladas = {};
    t.filas.forEach(function (x) { if (x.anulada) anuladas[x.entrega_id] = 1; });

    /* El filtro de búsqueda se aplica al renglón: por medicamento, por
       persona, por centro, por lote o por quién despachó. */
    var f = !q ? vivas : vivas.filter(function (x) {
      return sinAcentos([x.producto, x.destinatario, x.cedula, x.lote,
                         x.entregado_por, x.lo_entregado].join(' ')).indexOf(q) >= 0;
    });

    var conCant = f.filter(function (x) { return x.cantidad != null; });
    var sinCant = f.filter(function (x) { return x.cantidad == null; });
    /* Sin cantidad hay de dos clases, y no significan lo mismo. */
    var delExcel = sinCant.filter(function (x) { return x.origen !== 'sistema'; });
    var aMedias = sinCant.filter(function (x) { return x.origen === 'sistema'; });

    var entregas = {}, personas = {}, centros = {}, unidades = 0;
    var porMed = {}, porDia = {}, porQuien = {};

    f.forEach(function (x) {
      entregas[x.entrega_id] = 1;
      if (x.paciente_id) personas[x.paciente_id] = 1;
      if (x.institucion_id) centros[x.institucion_id] = 1;

      var d = porDia[x.fecha] || (porDia[x.fecha] = { fecha: x.fecha, entregas: {}, unidades: 0, sin: 0 });
      d.entregas[x.entrega_id] = 1;

      var qn = x.entregado_por || 'No consta';
      var w = porQuien[qn] || (porQuien[qn] = { quien: qn, entregas: {}, unidades: 0 });
      w.entregas[x.entrega_id] = 1;

      if (x.cantidad == null) { d.sin++; return; }

      var c = Number(x.cantidad) || 0;
      unidades += c;
      d.unidades += c;
      w.unidades += c;

      var k = x.producto_id || ('t:' + x.producto);
      var m = porMed[k] || (porMed[k] = {
        producto: x.producto, dosificacion: x.dosificacion, presentacion: x.presentacion,
        categoria: x.categoria, unidad: x.unidad, unidades: 0, renglones: 0,
        entregas: {}, personas: {}, empaque: x.empaque, porEmpaque: x.unidades_por_empaque
      });
      m.unidades += c; m.renglones++;
      m.entregas[x.entrega_id] = 1;
      if (x.paciente_id) m.personas[x.paciente_id] = 1;
    });

    var lista = function (o, orden) {
      return Object.keys(o).map(function (k) { return o[k]; }).sort(orden);
    };
    var cuantas = function (o) { return Object.keys(o).length; };

    return {
      filas: f,
      conCantidad: conCant,
      sinCantidad: sinCant,
      delExcel: delExcel,
      aMedias: aMedias,
      entregas: cuantas(entregas),
      anuladas: cuantas(anuladas),
      personas: cuantas(personas),
      centros: cuantas(centros),
      unidades: unidades,
      medicamentos: Object.keys(porMed).length,
      porMed: lista(porMed, function (a, b) { return b.unidades - a.unidades; })
                .map(function (m) {
                  m.nEntregas = cuantas(m.entregas); m.nPersonas = cuantas(m.personas); return m;
                }),
      porDia: lista(porDia, function (a, b) { return a.fecha < b.fecha ? 1 : -1; })
                .map(function (d) { d.nEntregas = cuantas(d.entregas); return d; }),
      porQuien: lista(porQuien, function (a, b) { return cuantas(b.entregas) - cuantas(a.entregas); })
                .map(function (w) { w.nEntregas = cuantas(w.entregas); return w; }),
      patologia: calcularPatologias(f, t.patPorPaciente, t.edadPorPaciente)
    };
  };

  /* ---------------------------------------------------------------- pantalla */
  Tablero.prototype.pintarCuerpo = function () {
    var t = this;
    var i = function (n) { return t.id(n); };
    var c = t.cuentas();
    var z = t.q('Cuerpo');
    if (!z) return;

    var hayAlgo = t.filas.length > 0;
    /* Se descarga lo que se esta viendo. Si el filtro no deja nada, no hay
       nada que descargar: el boton se apaga en vez de sacar un PDF que
       diga "no hubo entregas", que no seria verdad. */
    var hayQueBajar = c.filas.length > 0;
    var puedeGestionar = ['admin', 'inventario'].indexOf(
      window.FARMACIA_PERFIL && window.FARMACIA_PERFIL.rol) >= 0;

    z.innerHTML =
      '<div class="cifras-linea">' +
        cifra(num(c.entregas), c.entregas === 1 ? 'entrega' : 'entregas', '') +
        cifra(num(c.personas), c.personas === 1 ? 'persona atendida' : 'personas atendidas', '') +
        cifra(num(c.centros), c.centros === 1 ? 'centro de salud' : 'centros de salud', '') +
        cifra(num(c.medicamentos), c.medicamentos === 1 ? 'medicamento' : 'medicamentos distintos', '') +
        cifra(num(c.unidades), 'unidades entregadas', c.unidades ? 'ok' : 'gris') +
      '</div>' +

      (c.delExcel.length
        ? '<div class="aviso warn"><b>' + num(c.delExcel.length) + ' de esas entregas vienen de los Excel</b>' +
          'Dicen a quién y qué, pero no cuántas unidades: el papel no lo anotaba. Se cuentan ' +
          'como entregas y se listan abajo, pero <b style="display:inline">no</b> entran en el ' +
          'total de unidades. Sumarlas sería inventar números.</div>'
        : '') +
      /* Una entrega registrada aquí SIN renglones no viene del papel: se
         quedó a medias (se cayó el internet entre la cabecera y el
         detalle). Decir que "viene del Excel" sería falso, y esto hay que
         ir a mirarlo. */
      (c.aMedias.length
        ? '<div class="aviso bad"><b>' + num(c.aMedias.length) +
          (c.aMedias.length === 1 ? ' entrega registrada aquí se quedó sin renglones'
                                  : ' entregas registradas aquí se quedaron sin renglones') + '</b>' +
          'No vienen del papel: se registró a quién, pero no llegó a guardarse qué se le dio. ' +
          'Salen listadas abajo para que se revisen.</div>'
        : '') +
      (t.recortado
        ? '<div class="aviso warn"><b>El período es demasiado grande</b>' +
          'Solo se trajeron los primeros ' + num(TECHO) + ' renglones, así que las cifras ' +
          'de arriba están incompletas. Pide un período más corto.</div>'
        : '') +
      (c.anuladas
        ? '<p class="sub chico">' + c.anuladas + (c.anuladas === 1 ? ' entrega anulada' : ' entregas anuladas') +
          ' del período no se cuentan en ninguna cifra.</p>'
        : '') +

      '<div class="descargas">' +
        '<button type="button" id="' + i('Excel') + '"' + (hayQueBajar ? '' : ' disabled') + '>Descargar en Excel</button>' +
        '<button type="button" id="' + i('Pdf') + '"' + (hayQueBajar ? '' : ' disabled') + '>Descargar en PDF</button>' +
        (t.busca && hayQueBajar
          ? '<span class="descarga-nota">Se descarga solo lo de «' + esc(t.busca) + '»</span>'
          : '') +
      '</div>' +

      (puedeGestionar
        ? '<div class="descargas"><button type="button" id="' + i('Nueva') +
          '">+ Registrar entrega</button></div><div id="' + i('Gestion') + '"></div>'
        : '') +

      '<div class="herr-der">' +
        '<input id="' + i('Busca') + '" type="search" autocomplete="off" ' +
          'aria-label="Acotar dentro del período" ' +
          'placeholder="Acotar: medicamento, persona, centro, lote…" value="' + esc(t.busca) + '">' +
      '</div>' +

      (hayAlgo
        ? tablaMed(c) + tablaDia(c) + tablaQuien(c) + tablaPatologiaResumen(c) + tablaPatologiaDetalle(c) + t.tablaDetalle(c)
        : '<div class="vacio"><b>No hubo entregas en este período</b>' +
          '<span>Prueba con otra fecha, o con la semana o el mes.</span></div>');

    var b = t.q('Busca');
    if (b) {
      b.addEventListener('input', function () {
        clearTimeout(t.espera);
        t.espera = setTimeout(function () {
          t.busca = b.value.trim();
          t.pagina = 0;
          var foco = t.raiz.contains(document.activeElement) && document.activeElement === b;
          t.pintarCuerpo();
          if (foco) { var n = t.q('Busca'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
        }, 280);
      });
    }
    var e = t.q('Excel'); if (e) e.addEventListener('click', function () { t.bajar('excel'); });
    var p = t.q('Pdf');   if (p) p.addEventListener('click', function () { t.bajar('pdf'); });
    var n = t.q('Nueva'); if (n) n.addEventListener('click', function () {
      if (!window.FARMIR || !window.FARMIR('despacho')) t.avisoCuerpo('bad', 'No se pudo abrir Entregar.');
    });
    t.raiz.querySelectorAll('[data-gest]').forEach(function (boton) {
      boton.addEventListener('click', function () { t.abrirGestion(boton.dataset.gest); });
    });

    t.raiz.querySelectorAll('[data-pag]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        t.pagina += Number(btn.dataset.pag);
        t.pintarCuerpo();
        var c2 = t.raiz.querySelector('#' + t.id('Detalle'));
        if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  function cifra(n, txt, clase) {
    return '<div class="cifra-linea ' + (clase || '') + '">' +
           '<b>' + n + '</b><span>' + txt + '</span></div>';
  }

  function caja(titulo, nota, cabeceras, cuerpo, id) {
    return '<h3 class="sub-t"' + (id ? ' id="' + id + '"' : '') + '>' + titulo + '</h3>' +
      (nota ? '<p class="sub chico">' + nota + '</p>' : '') +
      '<div class="tabla-caja"><table class="tabla datos"><thead><tr>' +
        cabeceras.map(function (h) {
          return '<th' + (h.der ? ' class="der"' : '') + '>' + esc(h.t) + '</th>';
        }).join('') +
      '</tr></thead><tbody>' + cuerpo + '</tbody></table></div>';
  }

  function tablaMed(c) {
    if (!c.porMed.length) return '';
    var cuerpo = c.porMed.map(function (m) {
      return '<tr>' +
        '<td class="c-med" data-col="Medicamento"><b>' + esc(m.producto || 'Sin identificar') + '</b>' +
          (m.dosificacion ? '<span class="chico">' + esc(m.dosificacion) + '</span>' : '') + '</td>' +
        '<td data-col="Presentación">' + esc(m.presentacion || '') + '</td>' +
        '<td class="num der" data-col="Unidades"><b>' + num(m.unidades) + '</b>' +
          (m.unidad ? '<span class="chico">' + esc(m.unidad) + '</span>' : '') + '</td>' +
        '<td class="num der" data-col="Entregas">' + num(m.nEntregas) + '</td>' +
        '<td class="num der" data-col="Personas">' + num(m.nPersonas) + '</td>' +
      '</tr>';
    }).join('');
    return caja('Qué se entregó', 'Ordenado por lo que más salió.',
      [{ t: 'Medicamento' }, { t: 'Presentación' }, { t: 'Unidades', der: true },
       { t: 'Entregas', der: true }, { t: 'Personas', der: true }], cuerpo);
  }

  function tablaDia(c) {
    if (!c.porDia.length) return '';
    var cuerpo = c.porDia.map(function (d) {
      return '<tr>' +
        '<td data-col="Día"><b>' + corta(d.fecha) + '</b></td>' +
        '<td class="num der" data-col="Entregas">' + num(d.nEntregas) + '</td>' +
        '<td class="num der" data-col="Unidades">' + (d.unidades ? num(d.unidades) : '—') + '</td>' +
        '<td class="num der" data-col="Sin cantidad">' + (d.sin ? num(d.sin) : '') + '</td>' +
      '</tr>';
    }).join('');
    return caja('Día por día', '',
      [{ t: 'Día' }, { t: 'Entregas', der: true }, { t: 'Unidades', der: true },
       { t: 'Sin cantidad', der: true }], cuerpo);
  }

  function tablaQuien(c) {
    if (!c.porQuien.length) return '';
    var cuerpo = c.porQuien.map(function (w) {
      return '<tr>' +
        '<td data-col="Quién despachó"><b>' + esc(w.quien) + '</b></td>' +
        '<td class="num der" data-col="Entregas">' + num(w.nEntregas) + '</td>' +
        '<td class="num der" data-col="Unidades">' + (w.unidades ? num(w.unidades) : '—') + '</td>' +
      '</tr>';
    }).join('');
    return caja('Quién despachó', '',
      [{ t: 'Quién despachó' }, { t: 'Entregas', der: true }, { t: 'Unidades', der: true }], cuerpo);
  }

  function tablaPatologiaResumen(c) {
    var pt = c.patologia;
    if (!pt || !pt.resumen.length) return '';
    var cuerpo = pt.resumen.map(function (p) {
      return '<tr>' +
        '<td data-col="Patología"><b>' + esc(p.patologia) + '</b></td>' +
        '<td class="num der" data-col="Niños, personas">' + (p.ninosPersonas || '—') + '</td>' +
        '<td class="num der" data-col="Niños, unidades">' + (p.ninosUnidades ? num(p.ninosUnidades) : '—') + '</td>' +
        '<td class="num der" data-col="Adultos, personas">' + (p.adultosPersonas || '—') + '</td>' +
        '<td class="num der" data-col="Adultos, unidades">' + (p.adultosUnidades ? num(p.adultosUnidades) : '—') + '</td>' +
        '<td class="num der" data-col="Sin edad, unidades">' + (p.sinEdadUnidades ? num(p.sinEdadUnidades) : '—') + '</td>' +
        '<td class="num der" data-col="Total unidades"><b>' + num(p.totalUnidades) + '</b></td>' +
      '</tr>';
    }).join('');
    var notas = [];
    if (pt.variasPatologias) {
      notas.push(num(pt.variasPatologias) + (pt.variasPatologias === 1
        ? ' persona tiene más de una patología registrada: lo que se le entregó se cuenta en cada una de sus patologías.'
        : ' personas tienen más de una patología registrada: lo que se les entregó se cuenta en cada una de sus patologías.'));
    }
    if (pt.sinPatologia.unidades) {
      notas.push(num(pt.sinPatologia.unidades) + ' unidades entregadas a ' + num(pt.sinPatologia.personas) +
        (pt.sinPatologia.personas === 1 ? ' persona sin' : ' personas sin') +
        ' ninguna patología registrada no entran en esta tabla.');
    }
    return caja('Por patología, niños y adultos',
      notas.join(' ') || 'Solo cuenta lo que sí tiene cantidad anotada y paciente con patología registrada.',
      [{ t: 'Patología' }, { t: 'Niños, personas', der: true }, { t: 'Niños, unidades', der: true },
       { t: 'Adultos, personas', der: true }, { t: 'Adultos, unidades', der: true },
       { t: 'Sin edad, unidades', der: true }, { t: 'Total unidades', der: true }], cuerpo);
  }

  function tablaPatologiaDetalle(c) {
    var pt = c.patologia;
    if (!pt || !pt.detalle.length) return '';
    var cuerpo = pt.detalle.map(function (d) {
      return '<tr>' +
        '<td data-col="Patología"><b>' + esc(d.patologia) + '</b></td>' +
        '<td data-col="Grupo">' + esc(d.grupo) + '</td>' +
        '<td class="c-med" data-col="Medicamento">' + esc(d.producto || 'Sin identificar') +
          (d.dosificacion ? '<span class="chico">' + esc(d.dosificacion) + '</span>' : '') + '</td>' +
        '<td class="num der" data-col="Unidades"><b>' + num(d.unidades) + '</b>' +
          (d.unidad ? '<span class="chico">' + esc(d.unidad) + '</span>' : '') + '</td>' +
        '<td class="num der" data-col="Personas">' + num(d.personas) + '</td>' +
      '</tr>';
    }).join('');
    return caja('Qué se entregó, por patología',
      'Una fila por patología, grupo de edad y medicamento.',
      [{ t: 'Patología' }, { t: 'Grupo' }, { t: 'Medicamento' },
       { t: 'Unidades', der: true }, { t: 'Personas', der: true }], cuerpo);
  }

  Tablero.prototype.tablaDetalle = function (c) {
    var t = this;
    var f = c.filas;
    if (!f.length) {
      return t.busca
        ? '<div class="vacio"><b>Nada coincide con «' + esc(t.busca) + '»</b>' +
          '<span>Prueba con otra palabra, o borra la búsqueda para ver todo el período.</span></div>'
        : '<div class="vacio"><b>No queda nada que contar en este período</b>' +
          '<span>' + (c.anuladas
            ? 'Las ' + c.anuladas + ' entregas del período están anuladas.'
            : 'No hubo entregas.') + '</span></div>';
    }
    var paginas = Math.max(1, Math.ceil(f.length / POR_PAGINA));
    if (t.pagina >= paginas) t.pagina = paginas - 1;
    if (t.pagina < 0) t.pagina = 0;
    var trozo = f.slice(t.pagina * POR_PAGINA, t.pagina * POR_PAGINA + POR_PAGINA);
    var puedeGestionar = ['admin', 'inventario'].indexOf(
      window.FARMACIA_PERFIL && window.FARMACIA_PERFIL.rol) >= 0;
    var primera = {};

    var cuerpo = trozo.map(function (x) {
      var quien = x.tipo_destinatario === 'institucion'
        ? esc(x.destinatario || '') + (x.centro_tipo ? '<span class="chico">' + esc(x.centro_tipo) +
            (x.recibe_nombre ? ' · recibió ' + esc(x.recibe_nombre) : '') + '</span>' : '')
        : esc(x.destinatario || 'Sin registrar') +
          (x.cedula ? '<span class="chico">' + esc((x.nacionalidad || '') + x.cedula) + '</span>' : '');
      var que = x.cantidad != null
        ? '<b>' + esc(x.producto || '') + '</b>' +
          (x.dosificacion ? '<span class="chico">' + esc(x.dosificacion) + '</span>' : '')
        : '<span class="sin-cant">' + esc(x.lo_entregado || 'No dice qué se entregó') + '</span>';
      var accion = puedeGestionar && x.origen === 'sistema' && !primera[x.entrega_id]
        ? '<button type="button" class="suave" data-gest="' + esc(x.entrega_id) + '">Corregir o anular</button>' : '';
      primera[x.entrega_id] = true;
      return '<tr>' +
        '<td data-col="Día">' + corta(x.fecha) + '</td>' +
        '<td data-col="A quién">' + quien + '</td>' +
        '<td class="c-med" data-col="Qué">' + que + '</td>' +
        '<td data-col="Lote">' + esc(x.lote || (x.cantidad != null ? 'sin número' : '')) + '</td>' +
        '<td class="num der" data-col="Cantidad">' +
          (x.cantidad != null
            ? '<b>' + num(x.cantidad) + '</b>' +
              (x.en_cajas ? '<span class="chico">' + esc(x.en_cajas) + '</span>' : '')
            : '<span class="chico mal">sin anotar</span>') + '</td>' +
        '<td data-col="Despachó">' + esc(x.entregado_por || '') + '</td>' +
        (puedeGestionar ? '<td data-col="Acciones">' + accion + '</td>' : '') +
      '</tr>';
    }).join('');

    return caja('Renglón por renglón',
      num(f.length) + (f.length === 1 ? ' renglón' : ' renglones') +
      (paginas > 1 ? ' · página ' + (t.pagina + 1) + ' de ' + paginas : ''),
      [{ t: 'Día' }, { t: 'A quién' }, { t: 'Qué' }, { t: 'Lote' },
       { t: 'Cantidad', der: true }, { t: 'Despachó' }].concat(
        puedeGestionar ? [{ t: 'Acciones' }] : []), cuerpo, t.id('Detalle')) +
      (paginas > 1
        ? '<div class="paginador">' +
            '<button type="button" data-pag="-1"' + (t.pagina === 0 ? ' disabled' : '') + '>Anteriores</button>' +
            '<span>' + (t.pagina * POR_PAGINA + 1) + '–' +
              Math.min(f.length, (t.pagina + 1) * POR_PAGINA) + ' de ' + num(f.length) + '</span>' +
            '<button type="button" data-pag="1"' + (t.pagina >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
          '</div>'
        : '');
  };

  /* Administración e Inventario corrigen una entrega sin borrar su historia.
     La base anula la anterior, devuelve su stock y registra la nueva en
     una sola transacción. El formulario usa la entrega real, no el resumen. */
  Tablero.prototype.abrirGestion = async function (id) {
    var t = this, z = t.q('Gestion');
    if (!z) return;
    z.innerHTML = '<div class="cargando">Abriendo la entrega…</div>';
    var resultados = await Promise.all([
      t.sb.from('entregas').select('id,tipo_destinatario,paciente_id,institucion_id,' +
        'recibe_nombre,recibe_cedula,observacion,solicitud_id,anulada,origen').eq('id', id).single(),
      t.sb.from('entrega_detalle').select('id,lote_id,cantidad').eq('entrega_id', id),
      t.sb.from('v_existencia_lote').select('lote_id,producto,dosificacion,lote,vence,estado,situacion,existencia')
        .range(0, 999)
    ]);
    var fallo = resultados.filter(function (r) { return r.error; })[0];
    if (fallo) { z.innerHTML = '<div class="aviso bad">No se pudo abrir: ' + esc(fallo.error.message) + '</div>'; return; }
    var ent = resultados[0].data, det = resultados[1].data || [], lotes = resultados[2].data || [];
    if (!ent || ent.anulada || ent.origen !== 'sistema') {
      z.innerHTML = '<div class="aviso warn">La entrega ya no admite cambios.</div>'; return;
    }
    var recetas = [];
    if (ent.paciente_id) {
      var r = await t.sb.from('v_solicitudes')
        .select('solicitud_id,creado_en,indicado_por,activa')
        .eq('paciente_id', ent.paciente_id).eq('via', 'recipe').eq('activa', true)
        .order('creado_en', { ascending: false }).limit(50);
      if (r.error) { z.innerHTML = '<div class="aviso bad">No se pudieron consultar los récipes: ' + esc(r.error.message) + '</div>'; return; }
      recetas = r.data || [];
    }
    function opciones(elegido) {
      return '<option value="">Elige un lote</option>' + lotes.filter(function (l) {
        return l.lote_id === elegido ||
          (l.estado === 'disponible' && Number(l.existencia) > 0 &&
            ['vigente', 'por_vencer_30', 'por_vencer_90', 'sin_fecha'].indexOf(l.situacion) >= 0);
      }).map(function (l) {
        return '<option value="' + esc(l.lote_id) + '"' + (l.lote_id === elegido ? ' selected' : '') + '>' +
          esc(l.producto + (l.dosificacion ? ' · ' + l.dosificacion : '') +
            ' · lote ' + (l.lote || 'sin número') + ' · disponible ' + l.existencia +
            (l.vence ? ' · vence ' + corta(l.vence) : '')) + '</option>';
      }).join('');
    }
    function fila(lote, cantidad) {
      return '<div class="insumo-fila entrega-edit-fila" style="grid-template-columns:minmax(0,1fr) 90px 46px">' +
        '<select class="edit-lote" aria-label="Lote del medicamento">' + opciones(lote) + '</select>' +
        '<input class="edit-cantidad" type="number" min="1" step="1" inputmode="numeric"' +
          ' aria-label="Cantidad" value="' + esc(cantidad || 1) + '">' +
        '<button type="button" class="quitar edit-quitar" aria-label="Quitar medicamento">✕</button></div>';
    }
    z.innerHTML = '<div class="tarjeta" style="margin:16px 0" id="' + t.id('FormGestion') + '">' +
      '<h3>Corregir o anular esta entrega</h3>' +
      '<p class="sub">La entrega original y su autor quedan en la bitácora. Al corregir, se devuelve ' +
        'su existencia y se registra una entrega nueva. Para cambiar el destinatario, anula y ' +
        'registra una nueva desde Entregar.</p>' +
      (ent.paciente_id
        ? '<label for="' + t.id('RecipeEdit') + '">Récipe asociado</label><select id="' +
          t.id('RecipeEdit') + '"><option value="">Sin récipe asociado</option>' +
          recetas.map(function (r) { return '<option value="' + esc(r.solicitud_id) + '"' +
            (r.solicitud_id === ent.solicitud_id ? ' selected' : '') + '>Récipe del ' +
            corta(window.FARM && window.FARM.hoyCaracas
              ? window.FARM.hoyCaracas(r.creado_en) : r.creado_en) +
            (r.indicado_por ? ' · ' + esc(r.indicado_por) : '') + '</option>'; }).join('') + '</select>'
        : '') +
      '<label>Medicamentos y cantidades</label><div id="' + t.id('EditFilas') + '">' +
        det.map(function (d) { return fila(d.lote_id, d.cantidad); }).join('') + '</div>' +
      '<button type="button" class="secundario" id="' + t.id('EditAgregar') + '">+ Agregar medicamento</button>' +
      '<label for="' + t.id('EditMotivo') + '">Motivo de la corrección o anulación</label>' +
      '<input id="' + t.id('EditMotivo') + '" type="text" minlength="8" ' +
        'placeholder="Explica qué se corrigió o por qué se anuló">' +
      '<div class="descargas"><button type="button" id="' + t.id('EditGuardar') +
        '">Guardar corrección</button><button type="button" class="quitar" id="' +
        t.id('EditAnular') + '">Anular entrega</button><button type="button" class="suave" id="' +
        t.id('EditCerrar') + '">Cerrar</button></div><div id="' + t.id('EditAviso') + '"></div></div>';
    z.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var filas = t.q('EditFilas');
    function conectarQuitar() {
      filas.querySelectorAll('.edit-quitar').forEach(function (b) {
        b.onclick = function () { b.parentNode.remove(); };
      });
    }
    conectarQuitar();
    t.q('EditAgregar').onclick = function () {
      filas.insertAdjacentHTML('beforeend', fila(null, 1)); conectarQuitar();
    };
    t.q('EditCerrar').onclick = function () { z.innerHTML = ''; };
    function error(m) { t.q('EditAviso').innerHTML = '<div class="aviso bad">' + esc(m) + '</div>'; }
    function ocupado(si) {
      t.q('EditGuardar').disabled = si; t.q('EditAnular').disabled = si;
    }
    t.q('EditGuardar').onclick = async function () {
      var motivo = t.q('EditMotivo').value.trim();
      var items = Array.from(filas.querySelectorAll('.entrega-edit-fila')).map(function (f) {
        return { lote_id: f.querySelector('.edit-lote').value,
                 cantidad: Number(f.querySelector('.edit-cantidad').value) };
      });
      if (motivo.length < 8) { error('Explica la corrección con al menos 8 caracteres.'); return; }
      if (!items.length || items.some(function (x) { return !x.lote_id || !Number.isInteger(x.cantidad) || x.cantidad <= 0; })) {
        error('Cada medicamento necesita lote y cantidad entera positiva.'); return;
      }
      ocupado(true);
      var datos = { tipo_destinatario: ent.tipo_destinatario, paciente_id: ent.paciente_id,
        institucion_id: ent.institucion_id, recibe_nombre: ent.recibe_nombre,
        recibe_cedula: ent.recibe_cedula, observacion: ent.observacion,
        solicitud_id: t.q('RecipeEdit') ? t.q('RecipeEdit').value || null : null,
        motivo_correccion: motivo, items: items,
        clave_idempotencia: 'cor-' + id + '-' + Date.now() };
      var r = await t.sb.rpc('entrega_guardar', { p_id: id, p_datos: datos });
      ocupado(false);
      if (r.error) { error(r.error.message); return; }
      z.innerHTML = '<div class="aviso ok">Corrección registrada. Se actualizaron las existencias.</div>';
      t.cargar();
    };
    t.q('EditAnular').onclick = async function () {
      var motivo = t.q('EditMotivo').value.trim();
      if (motivo.length < 8) { error('Explica la anulación con al menos 8 caracteres.'); return; }
      ocupado(true);
      var r = await t.sb.rpc('entrega_anular', { p_id: id, p_motivo: motivo });
      ocupado(false);
      if (r.error) { error(r.error.message); return; }
      z.innerHTML = '<div class="aviso ok">Entrega anulada. Las cantidades se devolvieron al inventario.</div>';
      t.cargar();
    };
  };

  /* ---------------------------------------------------------------- descargas

     Salen de las mismas cuentas que se ven en pantalla. Si el filtro de
     búsqueda está puesto, el archivo trae lo filtrado y lo dice en el
     título: descargar otra cosa distinta de lo que se está mirando es la
     forma más fácil de entregar un reporte equivocado. */
  Tablero.prototype.bajar = function (formato) {
    var t = this;
    if (!window.FARMREP) return;
    var c = t.cuentas();
    var rot = rotulo(t.desde, t.hasta);
    var titulo = 'Entregas de la Farmacia Municipal';
    var sub = rot + (t.busca ? ' · solo «' + t.busca + '»' : '');
    var archivo = 'Entregas ' + t.desde + (t.hasta !== t.desde ? ' a ' + t.hasta : '') +
                  (t.busca ? ' - ' + t.busca : '');

    /* `n` es el numero de verdad y `v` como se lee. Al Excel va el numero,
       para poder sumarlo alli; al PDF y a la pantalla va el texto. */
    var resumen = [
      { k: c.entregas === 1 ? 'Entrega' : 'Entregas', n: c.entregas, v: num(c.entregas) },
      { k: 'Personas atendidas', n: c.personas, v: num(c.personas) },
      { k: 'Centros de salud', n: c.centros, v: num(c.centros) },
      { k: 'Medicamentos distintos', n: c.medicamentos, v: num(c.medicamentos) },
      { k: 'Unidades entregadas', n: Math.round(c.unidades), v: num(c.unidades) },
      { k: 'Entregas del Excel, sin cantidad', n: c.delExcel.length, v: num(c.delExcel.length) },
      { k: 'Entregas de aquí que quedaron sin renglones', n: c.aMedias.length, v: num(c.aMedias.length) }
    ];

    var encMed = ['Medicamento', 'Dosificación', 'Presentación', 'Qué es',
                  'Unidades', 'Eso es', 'Entregas', 'Personas'];
    var filMed = c.porMed.map(function (m) {
      return [m.producto || 'Sin identificar', m.dosificacion || '', m.presentacion || '',
              m.categoria || '', Math.round(m.unidades),
              enCajas(m.unidades, m.porEmpaque, m.empaque), m.nEntregas, m.nPersonas];
    });

    var encDia = ['Día', 'Entregas', 'Unidades', 'Renglones sin cantidad'];
    var filDia = c.porDia.map(function (d) {
      return [corta(d.fecha), d.nEntregas, Math.round(d.unidades), d.sin];
    });

    var encQuien = ['Quién despachó', 'Entregas', 'Unidades'];
    var filQuien = c.porQuien.map(function (w) {
      return [w.quien, w.nEntregas, Math.round(w.unidades)];
    });

    var encPatResumen = ['Patología', 'Niños, personas', 'Niños, unidades', 'Adultos, personas',
                         'Adultos, unidades', 'Sin edad, unidades', 'Total unidades'];
    var filPatResumen = c.patologia.resumen.map(function (p) {
      return [p.patologia, p.ninosPersonas, Math.round(p.ninosUnidades), p.adultosPersonas,
              Math.round(p.adultosUnidades), Math.round(p.sinEdadUnidades), Math.round(p.totalUnidades)];
    });

    var encPatDet = ['Patología', 'Grupo', 'Medicamento', 'Unidades', 'Personas'];
    var filPatDet = c.patologia.detalle.map(function (d) {
      return [d.patologia, d.grupo, d.producto || 'Sin identificar', Math.round(d.unidades), d.personas];
    });

    var encDet = ['Día', 'A quién', 'Tipo', 'Cédula', 'Medicamento', 'Dosificación',
                  'Lote', 'Vence', 'Cantidad', 'Eso es', 'Despachó', 'Origen'];
    var filDet = c.conCantidad.map(function (x) {
      return [corta(x.fecha), x.destinatario || '',
              x.tipo_destinatario === 'institucion' ? (x.centro_tipo || 'Centro') : 'Persona',
              (x.nacionalidad || '') + (x.cedula || ''),
              x.producto || '', x.dosificacion || '', x.lote || 'sin número',
              corta(x.vence), Math.round(Number(x.cantidad) || 0), x.en_cajas || '',
              x.entregado_por || '', x.origen === 'sistema' ? 'Sistema' : 'Excel'];
    });

    var encSin = ['Día', 'A quién', 'Cédula', 'Lo que dice el papel', 'Origen'];
    var filSin = c.sinCantidad.map(function (x) {
      return [x.fecha ? corta(x.fecha) : '', x.destinatario || '',
              (x.nacionalidad || '') + (x.cedula || ''),
              x.lo_entregado || '', x.origen === 'sistema' ? 'Sistema' : 'Excel'];
    });

    if (formato === 'excel') {
      var hojas = [{
        nombre: 'Resumen', titulo: titulo + ' · ' + sub,
        encabezados: ['Concepto', 'Cantidad'],
        filas: resumen.map(function (r) { return [r.k, r.n]; }),
        anchos: [34, 16]
      }];
      if (filMed.length) hojas.push({ nombre: 'Qué se entregó', titulo: 'Qué se entregó · ' + sub,
        encabezados: encMed, filas: filMed, anchos: [38, 16, 20, 14, 12, 22, 11, 11] });
      if (filDia.length) hojas.push({ nombre: 'Día por día', titulo: 'Día por día · ' + sub,
        encabezados: encDia, filas: filDia, anchos: [14, 11, 12, 20] });
      if (filQuien.length) hojas.push({ nombre: 'Quién despachó', titulo: 'Quién despachó · ' + sub,
        encabezados: encQuien, filas: filQuien, anchos: [34, 11, 12] });
      if (filPatResumen.length) hojas.push({ nombre: 'Por patología', titulo: 'Por patología, niños y adultos · ' + sub,
        encabezados: encPatResumen, filas: filPatResumen, anchos: [36, 14, 14, 14, 14, 15, 14] });
      if (filPatDet.length) hojas.push({ nombre: 'Patología y medicamento', titulo: 'Qué se entregó, por patología · ' + sub,
        encabezados: encPatDet, filas: filPatDet, anchos: [36, 22, 38, 12, 12] });
      if (filDet.length) hojas.push({ nombre: 'Detalle', titulo: 'Renglón por renglón · ' + sub,
        encabezados: encDet, filas: filDet,
        anchos: [12, 32, 12, 13, 34, 15, 16, 12, 11, 20, 24, 10] });
      if (filSin.length) hojas.push({ nombre: 'Sin cantidad', titulo: 'Entregas sin cantidad anotada · ' + sub,
        encabezados: encSin, filas: filSin, anchos: [12, 32, 13, 60, 10] });
      window.FARMREP.excel(archivo, hojas);
      return;
    }

    var bloques = [];
    if (filMed.length) bloques.push({
      titulo: 'Qué se entregó', nota: 'Ordenado por lo que más salió.',
      encabezados: encMed, filas: filMed,
      pie: ['TOTAL', '', '', '', Math.round(c.unidades), '', '', ''],
      columnas: { 0: { cellWidth: 60 }, 1: { cellWidth: 22 }, 2: { cellWidth: 28 },
                  3: { cellWidth: 20 }, 4: { cellWidth: 18, halign: 'right' },
                  5: { cellWidth: 34 }, 6: { cellWidth: 16, halign: 'right' },
                  7: { cellWidth: 16, halign: 'right' } }
    });
    if (filDia.length) bloques.push({
      titulo: 'Día por día', encabezados: encDia, filas: filDia,
      columnas: { 0: { cellWidth: 30 }, 1: { cellWidth: 26, halign: 'right' },
                  2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 40, halign: 'right' } }
    });
    if (filQuien.length) bloques.push({
      titulo: 'Quién despachó', encabezados: encQuien, filas: filQuien,
      columnas: { 0: { cellWidth: 90 }, 1: { cellWidth: 26, halign: 'right' },
                  2: { cellWidth: 26, halign: 'right' } }
    });
    if (filPatResumen.length) bloques.push({
      titulo: 'Por patología, niños y adultos',
      nota: 'Si una persona tiene más de una patología, lo entregado se cuenta en cada una.',
      encabezados: encPatResumen, filas: filPatResumen,
      columnas: { 0: { cellWidth: 60 }, 1: { cellWidth: 27, halign: 'right' },
                  2: { cellWidth: 27, halign: 'right' }, 3: { cellWidth: 27, halign: 'right' },
                  4: { cellWidth: 27, halign: 'right' }, 5: { cellWidth: 27, halign: 'right' },
                  6: { cellWidth: 30, halign: 'right' } }
    });
    if (filPatDet.length) bloques.push({
      titulo: 'Qué se entregó, por patología', encabezados: encPatDet, filas: filPatDet,
      columnas: { 0: { cellWidth: 55 }, 1: { cellWidth: 45 }, 2: { cellWidth: 70 },
                  3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 26, halign: 'right' } }
    });
    /* Los anchos suman 248 mm. En carta horizontal caben 251: si se pasan,
       autoTable no avisa, recorta o desborda la hoja. Hay que sumarlos a
       mano cada vez que se toque una columna. */
    if (filDet.length) bloques.push({
      titulo: 'Renglón por renglón', encabezados: encDet, filas: filDet,
      columnas: { 0: { cellWidth: 17 }, 1: { cellWidth: 38 }, 2: { cellWidth: 14 },
                  3: { cellWidth: 17 }, 4: { cellWidth: 36 }, 5: { cellWidth: 18 },
                  6: { cellWidth: 18 }, 7: { cellWidth: 16 },
                  8: { cellWidth: 16, halign: 'right' }, 9: { cellWidth: 20 },
                  10: { cellWidth: 24 }, 11: { cellWidth: 14 } }
    });
    if (filSin.length) bloques.push({
      titulo: 'Entregas sin cantidad anotada',
      nota: 'Vienen de los Excel: dicen a quién y qué, pero no cuántas unidades. No entran en el total.',
      encabezados: encSin, filas: filSin,
      columnas: { 0: { cellWidth: 18 }, 1: { cellWidth: 55 }, 2: { cellWidth: 20 },
                  3: { cellWidth: 122 }, 4: { cellWidth: 16 } }
    });

    window.FARMREP.pdfInforme({
      titulo: 'Entregas de la Farmacia Municipal',
      subtitulo: sub,
      resumen: resumen, bloques: bloques, horizontal: true, archivo: archivo,
      vacio: 'No hubo entregas en este período.'
    });
  };

  /* Repite en el navegador lo que la base hace con `en_cajas`, para el
     Excel: allí no hay una fila por lote sino el total del medicamento. */
  function enCajas(unidades, porEmpaque, empaque) {
    var u = Math.round(Number(unidades) || 0);
    var p = Number(porEmpaque) || 0;
    if (!p || p <= 1 || !u) return '';
    var cajas = Math.floor(u / p), sueltas = u % p;
    var nom = (empaque || 'caja').toLowerCase();
    var plural = nom + (/s$/.test(nom) ? '' : 's');
    var t = cajas ? cajas + ' ' + (cajas === 1 ? nom : plural) : '';
    if (sueltas) t += (t ? ' y ' : '') + sueltas + ' suelta' + (sueltas === 1 ? '' : 's');
    return t;
  }

  /* ---------------------------------------------------------------- entrada */
  window.TABLERO_CALCULAR_PATOLOGIAS = calcularPatologias;
  window.TABLERO_EDAD_DE_FECHA = edadDeFecha;
  window.TABLERO_EDAD_DE_TEXTO = edadDeTexto;

  window.TABLERO_ENTREGAS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Tablero(cliente, contenedor, o.prefijo || 'te');
    t.pintar();
    return t;
  };
})();
