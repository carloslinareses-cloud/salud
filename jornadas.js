/* JORNADAS: jornadas de salud, ruta materna y Salud a la Escuela, como EVENTOS.

   Es una base APARTE de "Personas": no toca pacientes, ni tratamientos,
   ni patologías del sistema general.

   Dos pestañas:
     · Jornadas  — cada jornada es un evento: fecha, lugar, parroquia,
       el equipo que atendió y quién firmó. Se entra a cada una para
       cargarle la gente que se atendió ese día. Los tres totales
       -pacientes atendidos, medicamentos entregados y récipes- NO se
       escriben a mano: salen solos de contar lo que se cargó.
     · Registros — el listado completo de personas de todas las
       jornadas, tal como se cargó del Excel al principio, para buscar
       y corregir a cualquiera sin tener que saber en qué evento quedó. */
(function () {
  'use strict';

  var POR_PAGINA = 50;

  var CONJUNTOS = { jornadas: 'Jornada de salud', ruta_materna: 'Ruta materna',
                    salud_escuela: 'Salud a la Escuela' };

  /* Las hojas del Excel de donde salió cada registro migrado. */
  var HOJAS = [
    { v: 'JORNADAS 2026', t: 'Jornadas 2026' },
    { v: 'JULIO A SEPTIEMBRE', t: 'Julio a septiembre' },
    { v: 'OCTUBRE A DICIEMBRE', t: 'Octubre a diciembre' },
    { v: 'RUTA MATERNA MES JULIO', t: 'Ruta materna (julio)' }
  ];
  var HOJAS_TXT = {};
  HOJAS.forEach(function (h) { HOJAS_TXT[h.v] = h.t; });

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function corta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }
  function larga(f) {
    if (!f) return '';
    var d = new Date(String(f).slice(0, 10) + 'T12:00:00');
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return dias[d.getDay()] + ' ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear() +
      ' · ' + corta(f);
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function hoyEs() {
    return window.FARM && window.FARM.hoyCaracas
      ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10);
  }
  function estadoChip(e) {
    return e === 'por_revisar'
      ? '<span class="sit ojo">Por revisar</span>'
      : '<span class="sit ok">Activo</span>';
  }
  function cif(n, txt, clase) {
    return '<div class="cifra ' + (clase || '') + '"><b>' + n + '</b><span>' + esc(txt) + '</span></div>';
  }
  /* Separa el tratamiento de UNA persona en sus medicamentos, con la
     misma regla que ya usa el resto de la aplicación (la coma y la
     barra separan, salvo entre números: "0,5MG/ML" no se parte). Se
     llama una vez POR PERSONA -nunca con la lista completa junta-
     porque esa función quita repetidos, y aquí "LOSARTAN" dado a
     cincuenta personas debe contar cincuenta veces, no una. */
  function piezasDeUno(FARM, texto) {
    if (!texto) return [];
    return (FARM && FARM.piezasTratamiento) ? FARM.piezasTratamiento(texto) : [];
  }

  /* Los totales de una jornada, calculados a partir de su gente -nunca
     escritos a mano-. Las unidades solo se suman cuando la cantidad
     quedó anotada (por ejemplo, "SUERO X3"). Un nombre sin cantidad se
     muestra como pendiente, pero NO se convierte silenciosamente en una
     unidad: contar nombres no es lo mismo que contar lo entregado. */
  function calcularCifrasEvento(FARM, personas) {
    var totalMeds = 0, recipes = 0, meds = {}, ordenMeds = [];
    var sinCantidad = 0, medsSinCantidad = {}, ordenSinCantidad = [];
    (personas || []).forEach(function (p) {
      if (p.recipe) recipes++;
      var piezas = FARM && FARM.piezasTratamientoCant
        ? FARM.piezasTratamientoCant(p.tratamiento)
        : piezasDeUno(FARM, p.tratamiento).map(function (nombre) {
            return { nombre: nombre, cantidad: 1, anotada: false };
          });
      piezas.forEach(function (m) {
        var nombre = m.nombre || m;
        if (!m.anotada) {
          if (!(nombre in medsSinCantidad)) { medsSinCantidad[nombre] = 0; ordenSinCantidad.push(nombre); }
          medsSinCantidad[nombre]++;
          sinCantidad++;
          return;
        }
        var cantidad = Number(m.cantidad) || 0;
        if (!(nombre in meds)) { meds[nombre] = 0; ordenMeds.push(nombre); }
        meds[nombre] += cantidad;
        totalMeds += cantidad;
      });
    });
    ordenMeds.sort(function (a, b) { return meds[b] - meds[a]; });
    ordenSinCantidad.sort(function (a, b) { return medsSinCantidad[b] - medsSinCantidad[a]; });
    return { pacientes: (personas || []).length, totalMedicamentos: totalMeds, recipes: recipes,
             meds: meds, ordenMeds: ordenMeds, sinCantidad: sinCantidad,
             medsSinCantidad: medsSinCantidad, ordenSinCantidad: ordenSinCantidad };
  }

  /* Arma una sola fuente de verdad para la pantalla, el PDF y el Excel.
     Cada fila de `detalle` es un producto entregado a una persona; así el
     total general siempre sale de sumar esas mismas cantidades. */
  function prepararInformeEvento(FARM, evento, personas) {
    var lista = personas || [];
    var cifras = calcularCifrasEvento(FARM, lista);
    var detalle = [], sinCantidad = [], pacientes = [];
    var porProducto = {}, ordenProductos = [];

    lista.forEach(function (p, indice) {
      var piezas = FARM && FARM.piezasTratamientoCant
        ? FARM.piezasTratamientoCant(p.tratamiento) : [];
      var unidades = 0, renglones = 0, pendientes = 0;
      piezas.forEach(function (m) {
        var base = {
          numero: indice + 1, paciente: p.nombre || 'Sin nombre', cedula: p.cedula || '',
          sexo: p.sexo === 'F' ? 'Femenino' : (p.sexo === 'M' ? 'Masculino' : 'Sin dato'),
          edad: p.edad_texto || '', telefono: p.telefono || '', direccion: p.direccion || '',
          sector: p.item || '', producto: m.nombre || 'Sin identificar',
          recipe: p.recipe === true ? 'Sí' : (p.recipe === false ? 'No' : 'No consta')
        };
        if (!m.anotada || !(Number(m.cantidad) > 0)) {
          pendientes++;
          sinCantidad.push(base);
          return;
        }
        var cantidad = Number(m.cantidad);
        unidades += cantidad; renglones++;
        detalle.push(Object.assign({}, base, { cantidad: cantidad }));
        var claveProducto = FARM && FARM.sinAcentos ? FARM.sinAcentos(base.producto) : base.producto.toLowerCase();
        if (!porProducto[claveProducto]) {
          porProducto[claveProducto] = { producto: base.producto, unidades: 0, personas: 0, renglones: 0 };
          ordenProductos.push(claveProducto);
        }
        porProducto[claveProducto].unidades += cantidad;
        porProducto[claveProducto].personas++;
        porProducto[claveProducto].renglones++;
      });
      pacientes.push({
        numero: indice + 1, nombre: p.nombre || 'Sin nombre', cedula: p.cedula || '',
        sexo: p.sexo === 'F' ? 'Femenino' : (p.sexo === 'M' ? 'Masculino' : 'Sin dato'),
        edad: p.edad_texto || '', telefono: p.telefono || '', direccion: p.direccion || '',
        sector: p.item || '', tratamiento: p.tratamiento || '', recipe: p.recipe === true ? 'Sí' :
          (p.recipe === false ? 'No' : 'No consta'), estado: p.estado || '',
        unidades: unidades, renglones: renglones, pendientes: pendientes
      });
    });

    var productos = ordenProductos.map(function (clave) { return porProducto[clave]; })
      .sort(function (a, b) { return b.unidades - a.unidades || a.producto.localeCompare(b.producto); });
    cifras.productosDistintos = productos.length;
    cifras.renglonesConCantidad = detalle.length;
    cifras.personasConEntrega = pacientes.filter(function (p) { return p.unidades > 0; }).length;
    cifras.personasSinTratamiento = pacientes.filter(function (p) {
      return !p.tratamiento.trim();
    }).length;
    cifras.personasConCantidadPendiente = pacientes.filter(function (p) { return p.pendientes > 0; }).length;

    return { evento: evento || {}, cifras: cifras, productos: productos, detalle: detalle,
             pacientes: pacientes, sinCantidad: sinCantidad };
  }

  /* Cuenta el territorio cubierto por las jornadas sin depender de la
     página visible. Una comunidad se identifica junto con su comuna para
     no mezclar dos comunidades homónimas de sectores distintos. */
  function resumirTerritorioEventos(FARM, eventos) {
    var lista = eventos || [], porComuna = {}, ordenComunas = [];
    var porComunidad = {}, ordenComunidades = [];
    var sinComuna = 0, sinComunidad = 0;
    var clave = function (texto) {
      return FARM && FARM.sinAcentos ? FARM.sinAcentos(texto) :
        String(texto || '').trim().toLowerCase();
    };

    lista.forEach(function (ev) {
      var comuna = String(ev.comuna || '').trim();
      var comunidad = String(ev.comunidad || '').trim();
      var kComuna = clave(comuna);
      if (!kComuna) sinComuna++;
      else {
        if (!porComuna[kComuna]) {
          porComuna[kComuna] = { comuna: comuna, jornadas: 0, _comunidades: {} };
          ordenComunas.push(kComuna);
        }
        porComuna[kComuna].jornadas++;
      }

      if (!comunidad) { sinComunidad++; return; }
      var kComunidad = kComuna + '|' + clave(comunidad);
      if (!porComunidad[kComunidad]) {
        porComunidad[kComunidad] = {
          comuna: comuna || 'Sin comuna anotada', comunidad: comunidad, jornadas: 0
        };
        ordenComunidades.push(kComunidad);
      }
      porComunidad[kComunidad].jornadas++;
      if (kComuna) porComuna[kComuna]._comunidades[kComunidad] = true;
    });

    var comunas = ordenComunas.map(function (k) {
      var c = porComuna[k];
      return { comuna: c.comuna, jornadas: c.jornadas, comunidades: Object.keys(c._comunidades).length };
    }).sort(function (a, b) {
      return b.jornadas - a.jornadas || a.comuna.localeCompare(b.comuna);
    });
    var comunidades = ordenComunidades.map(function (k) { return porComunidad[k]; })
      .sort(function (a, b) {
        return b.jornadas - a.jornadas || a.comuna.localeCompare(b.comuna) ||
          a.comunidad.localeCompare(b.comunidad);
      });
    return {
      jornadas: lista.length, comunas: comunas, comunidades: comunidades,
      totalComunas: comunas.length, totalComunidades: comunidades.length,
      sinComuna: sinComuna, sinComunidad: sinComunidad
    };
  }

  var CAMPOS = 'id,evento_id,conjunto,hoja_origen,item,fecha,nombre,edad_texto,sexo,cedula,' +
               'telefono,direccion,tratamiento,recipe,estado,motivo_revision,' +
               'representante_nombre,representante_cedula,comuna,comunidad,plantel,seccion';
  var CAMPOS_EVENTO = 'id,tipo,fecha,lugar,parroquia,dietista,autoridad_salud,trabajador_social,' +
                      'comuna,comunidad,firmas,creado_por_nombre,creado_en';
  var CAMPOS_EVENTO_LISTA = CAMPOS_EVENTO + ',pacientes,recipes';

  function cargarEventosTerritorio(sb, filtros) {
    var todos = [], f = filtros || {};
    function pagina(desde) {
      var qy = sb.from('v_jornadas_eventos').select(CAMPOS_EVENTO);
      if (f.busca) {
        var b = f.busca.replace(/[%_]/g, '\\$&');
        qy = qy.or('lugar.ilike.%' + b + '%,parroquia.ilike.%' + b + '%');
      }
      if (f.tipo && f.tipo !== 'todos') qy = qy.eq('tipo', f.tipo);
      return qy.order('fecha', { ascending: false }).order('id').range(desde, desde + 999)
        .then(function (r) {
          if (r.error) return r;
          todos = todos.concat(r.data || []);
          return (r.data || []).length === 1000 ? pagina(desde + 1000) : { data: todos, error: null };
        });
    }
    return pagina(0);
  }

  /* Supabase entrega como máximo 1.000 filas por consulta. Una jornada
     grande tiene que cargar todas sus personas antes de calcular o exportar. */
  function cargarRegistrosEvento(sb, eventoId) {
    var todos = [];
    function pagina(desde) {
      return sb.from('jornadas_registros').select(CAMPOS).eq('evento_id', eventoId)
        .order('nombre').order('id').range(desde, desde + 999).then(function (r) {
          if (r.error) return r;
          todos = todos.concat(r.data || []);
          return (r.data || []).length === 1000 ? pagina(desde + 1000) : { data: todos, error: null };
        });
    }
    return pagina(0);
  }

  /* ================================================================ */
  function Jornadas(sb, raiz, pfx) {
    this.sb = sb; this.raiz = raiz; this.pfx = pfx;
    this.vista = 'eventos';        // eventos | registros

    /* --- Jornadas (eventos) --- */
    this.modoEv = 'lista';         // lista | nuevo | detalle
    this.buscaEv = ''; this.tipoEv = 'todos';
    this.paginaEv = 0; this.totalEv = 0; this.eventos = [];
    this.pedidoEv = 0;
    this.eventoActual = null;      // el evento abierto en "detalle"
    this.firmasForm = [];          // firmas mientras se llena el formulario de un evento nuevo

    /* --- Registros (el listado completo, sin distinguir evento) --- */
    this.modo = 'lista';           // lista | nuevo | ficha
    this.busca = '';
    this.conjunto = 'todos';
    this.hoja = 'todos';
    this.estado = 'todos';
    this.pagina = 0; this.total = 0; this.filas = [];
    this.pedido = 0;

    /* --- El formulario de UNA persona, que comparten Registros y el
       detalle de un evento. `origenPersona` dice a dónde volver. --- */
    this.quien = null;
    this.origenPersona = { tipo: 'registros' };   // { tipo: 'registros' } | { tipo: 'evento', id }
  }

  Jornadas.prototype.id = function (n) { return this.pfx + n; };
  Jornadas.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };
  Jornadas.prototype.aviso = function (clase, txt) {
    var z = this.q('Aviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  Jornadas.prototype.limpiaAviso = function () {
    var z = this.q('Aviso'); if (z) z.innerHTML = '';
  };

  Jornadas.prototype.pintar = function () {
    var t = this, i = function (n) { return t.id(n); };
    t.raiz.innerHTML =
      '<div class="chips" id="' + i('VistaTop') + '">' +
        '<button type="button" data-v="eventos"' + (t.vista === 'eventos' ? ' class="on"' : '') + '>Jornadas</button>' +
        '<button type="button" data-v="registros"' + (t.vista === 'registros' ? ' class="on"' : '') + '>Registros</button>' +
      '</div>' +
      '<div id="' + i('Zona') + '"></div><div id="' + i('Aviso') + '"></div>';

    t.q('VistaTop').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.v === t.vista) return;
        t.vista = b.dataset.v;
        t.pintar();
      });
    });

    if (t.vista === 'eventos') {
      if (t.modoEv === 'lista') t.verEventosLista();
      else if (t.modoEv === 'nuevo') t.verEventoForm();
      else t.verEventoDetalle();
    } else {
      if (t.modo === 'lista') t.verRegistros();
      else t.verFormularioPersona(t.modo === 'ficha' ? t.quien : null);
    }
  };

  /* ================================================================
     JORNADAS (EVENTOS) — lista
  ================================================================ */
  Jornadas.prototype.verEventosLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<h2>Jornadas</h2>' +
        '<button type="button" class="principal" id="' + i('EvNueva') + '">+ Nueva jornada</button>' +
      '</div>' +
      '<p class="sub">Cada jornada es un evento. Entra a una para cargarle la gente que se atendió: ' +
        'los totales se cuentan solos.</p>' +
      '<div id="' + i('EvTerritorio') + '"><p class="cargando">Contando comunas y comunidades…</p></div>' +
      '<div class="filtros">' +
        '<input id="' + i('EvBusca') + '" type="search" placeholder="Buscar por lugar o parroquia…" ' +
          'value="' + esc(t.buscaEv) + '">' +
        '<select id="' + i('EvTipoF') + '">' +
          '<option value="todos">Todos los tipos</option>' +
          '<option value="jornadas"' + (t.tipoEv === 'jornadas' ? ' selected' : '') + '>Jornada de salud</option>' +
          '<option value="ruta_materna"' + (t.tipoEv === 'ruta_materna' ? ' selected' : '') + '>Ruta materna</option>' +
          '<option value="salud_escuela"' + (t.tipoEv === 'salud_escuela' ? ' selected' : '') + '>Salud a la Escuela</option>' +
        '</select>' +
      '</div>' +
      '<div id="' + i('EvRes') + '"></div>' +
      '<div id="' + i('EvPag') + '" class="paginas"></div>';

    t.q('EvNueva').addEventListener('click', function () {
      t.firmasForm = []; t.modoEv = 'nuevo'; t.pintar();
    });
    t.q('EvBusca').addEventListener('input', retardo(function () {
      t.buscaEv = t.q('EvBusca').value.trim(); t.paginaEv = 0; t.buscarEventos();
    }, 350));
    t.q('EvTipoF').addEventListener('change', function () {
      t.tipoEv = t.q('EvTipoF').value; t.paginaEv = 0; t.buscarEventos();
    });

    t.buscarEventos();
  };

  Jornadas.prototype.buscarEventos = function () {
    var t = this;
    var z = t.q('EvRes');
    if (!z) return;
    z.innerHTML = '<p class="cargando">Buscando…</p>';
    var pedido = ++t.pedidoEv;
    var territorio = t.q('EvTerritorio');
    if (territorio) territorio.innerHTML = '<p class="cargando">Contando comunas y comunidades…</p>';

    var qy = t.sb.from('v_jornadas_eventos').select(CAMPOS_EVENTO_LISTA, { count: 'exact' });
    if (t.buscaEv) {
      var b = t.buscaEv.replace(/[%_]/g, '\\$&');
      qy = qy.or('lugar.ilike.%' + b + '%,parroquia.ilike.%' + b + '%');
    }
    if (t.tipoEv !== 'todos') qy = qy.eq('tipo', t.tipoEv);
    qy = qy.order('fecha', { ascending: false }).range(t.paginaEv * POR_PAGINA, t.paginaEv * POR_PAGINA + POR_PAGINA - 1);

    Promise.all([qy, cargarEventosTerritorio(t.sb, { busca: t.buscaEv, tipo: t.tipoEv })]).then(function (respuestas) {
      var r = respuestas[0], rt = respuestas[1];
      if (pedido !== t.pedidoEv || !t.q('EvRes')) return;
      if (r.error) { z.innerHTML = '<div class="aviso bad">No se pudo buscar: ' + esc(r.error.message) + '</div>'; return; }
      t.eventos = r.data || []; t.totalEv = r.count || 0;
      t.pintarEventosLista();
      t.pintarTerritorioEventos(rt);
    });
  };

  Jornadas.prototype.pintarTerritorioEventos = function (respuesta) {
    var t = this, z = t.q('EvTerritorio');
    if (!z) return;
    if (!respuesta || respuesta.error) {
      z.innerHTML = '<div class="aviso warn">No se pudo calcular el territorio cubierto' +
        (respuesta && respuesta.error ? ': ' + esc(respuesta.error.message) : '.') + '</div>';
      return;
    }
    var r = resumirTerritorioEventos(window.FARM, respuesta.data || []);
    if (!r.jornadas) {
      z.innerHTML = '<div class="vacio">Todavía no hay jornadas con este filtro para contar comunas y comunidades.</div>';
      return;
    }
    var faltantes = [];
    if (r.sinComuna) faltantes.push(r.sinComuna + (r.sinComuna === 1 ? ' jornada sin comuna anotada' : ' jornadas sin comuna anotada'));
    if (r.sinComunidad) faltantes.push(r.sinComunidad + (r.sinComunidad === 1 ? ' jornada sin comunidad anotada' : ' jornadas sin comunidad anotada'));
    z.innerHTML =
      '<h3 class="sub-t">Territorio cubierto</h3>' +
      '<p class="sub chico">Conteo completo según el filtro actual; no se limita a las jornadas de esta página.</p>' +
      '<div class="cifras">' +
        cif(r.jornadas, r.jornadas === 1 ? 'jornada registrada' : 'jornadas registradas') +
        cif(r.totalComunas, r.totalComunas === 1 ? 'comuna atendida' : 'comunas atendidas') +
        cif(r.totalComunidades, r.totalComunidades === 1 ? 'comunidad atendida' : 'comunidades atendidas') +
      '</div>' +
      (faltantes.length ? '<div class="aviso warn"><b>Datos por completar</b><span>' + esc(faltantes.join(' · ')) +
        '. No se deducen por el nombre del lugar.</span></div>' : '') +
      '<div class="dos-columnas territorio-grid">' +
        '<div><h3 class="sub-t">Jornadas por comuna</h3>' +
          (r.comunas.length ? '<div class="tabla-caja"><table class="tabla" id="' + t.id('TablaComunas') + '">' +
            '<thead><tr><th>Comuna</th><th class="der">Jornadas</th><th class="der">Comunidades</th></tr></thead><tbody>' +
            r.comunas.map(function (c) { return '<tr><td>' + esc(c.comuna) + '</td><td class="der num"><b>' +
              c.jornadas + '</b></td><td class="der num">' + c.comunidades + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<div class="vacio">No hay comunas anotadas.</div>') + '</div>' +
        '<div><h3 class="sub-t">Jornadas por comunidad</h3>' +
          (r.comunidades.length ? '<div class="tabla-caja"><table class="tabla" id="' + t.id('TablaComunidades') + '">' +
            '<thead><tr><th>Comuna</th><th>Comunidad</th><th class="der">Jornadas</th></tr></thead><tbody>' +
            r.comunidades.map(function (c) { return '<tr><td>' + esc(c.comuna) + '</td><td>' + esc(c.comunidad) +
              '</td><td class="der num"><b>' + c.jornadas + '</b></td></tr>'; }).join('') +
            '</tbody></table></div>' : '<div class="vacio">No hay comunidades anotadas.</div>') + '</div>' +
      '</div>';
  };

  Jornadas.prototype.pintarEventosLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('EvRes');
    if (!t.eventos.length) {
      z.innerHTML = '<div class="vacio">' +
        (t.buscaEv || t.tipoEv !== 'todos' ? 'Ninguna jornada coincide con lo que buscas.'
                                            : 'Todavía no has creado ninguna jornada.') +
        '</div>';
      t.q('EvPag').innerHTML = '';
      return;
    }
    z.innerHTML = '<div class="fichas">' + t.eventos.map(function (e) {
      var datos = [corta(e.fecha), CONJUNTOS[e.tipo] || e.tipo];
      if (e.parroquia) datos.push('Parroquia ' + e.parroquia);
      return '<button type="button" class="ficha" data-id="' + esc(e.id) + '">' +
        '<div class="ficha-nom"><b>' + esc(e.lugar) + '</b>' +
          '<span class="ficha-pres">' + esc(datos.join(' · ')) + '</span>' +
        '</div>' +
        '<div class="ficha-datos">' +
          '<span class="ficha-cant' + (e.pacientes ? '' : ' cero') + '">' + e.pacientes +
            '<em>' + (e.pacientes === 1 ? 'atendido' : 'atendidos') + '</em></span>' +
          '<span class="ficha-lotes">' + e.recipes + (e.recipes === 1 ? ' récipe' : ' récipes') + '</span>' +
        '</div>' +
      '</button>';
    }).join('') + '</div>';

    z.querySelectorAll('[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = t.eventos.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (e) { t.eventoActual = e; t.modoEv = 'detalle'; t.pintar(); }
      });
    });

    var paginas = Math.max(1, Math.ceil(t.totalEv / POR_PAGINA));
    var pz = t.q('EvPag');
    if (paginas <= 1) { pz.innerHTML = ''; return; }
    pz.innerHTML =
      '<div class="paginador">' +
        '<button type="button" id="' + i('EvAnt') + '"' + (t.paginaEv === 0 ? ' disabled' : '') + '>Anteriores</button>' +
        '<span>Página ' + (t.paginaEv + 1) + ' de ' + paginas + ' · ' + t.totalEv + ' en total</span>' +
        '<button type="button" id="' + i('EvSig') + '"' + (t.paginaEv >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
      '</div>';
    var ant = t.q('EvAnt'), sig = t.q('EvSig');
    if (ant) ant.addEventListener('click', function () { t.paginaEv--; t.buscarEventos(); });
    if (sig) sig.addEventListener('click', function () { t.paginaEv++; t.buscarEventos(); });
  };

  /* ================================================================
     JORNADAS (EVENTOS) — formulario de una nueva jornada
  ================================================================ */
  Jornadas.prototype.verEventoForm = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');

    z.innerHTML =
      '<button type="button" class="volver" id="' + i('EvVolver') + '">← Volver a las jornadas</button>' +
      '<h2>Nueva jornada</h2>' +
      '<p class="sub">Los datos del día. Cuántos se atendieron y qué se entregó se cuenta solo, ' +
        'después de cargar a la gente.</p>' +

      '<label>Tipo de jornada</label>' +
      '<div class="chips" id="' + i('EvFTipo') + '">' +
        '<button type="button" data-v="jornadas" class="on">Jornada de salud</button>' +
        '<button type="button" data-v="ruta_materna">Ruta materna</button>' +
        '<button type="button" data-v="salud_escuela">Salud a la Escuela</button>' +
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('EvFecha') + '">Fecha</label>' +
          '<input id="' + i('EvFecha') + '" type="date" value="' + esc(hoyEs()) + '"></div>' +
        '<div><label for="' + i('EvParroquia') + '">Parroquia <span class="opc">(opcional)</span></label>' +
          '<select id="' + i('EvParroquia') + '"></select></div>' +
      '</div>' +

      '<label for="' + i('EvLugar') + '">Lugar <span class="opc">(CDI, ambulatorio, comunidad…)</span></label>' +
      '<input id="' + i('EvLugar') + '" type="text" autocomplete="off" placeholder="Ej: CDI de Las Brisas">' +

      /* Un solo nombre: quien responde por la jornada. Se guarda en la
         misma columna de antes (dietista) para no tocar lo ya cargado. */
      '<div class="dos-columnas">' +
        '<div><label for="' + i('EvComuna') + '">Comuna <span class="opc">(opcional)</span></label>' +
          '<select id="' + i('EvComuna') + '"></select></div>' +
        '<div><label for="' + i('EvComunidad') + '">Comunidad <span class="opc">(opcional)</span></label>' +
          '<select id="' + i('EvComunidad') + '"></select></div>' +
      '</div>' +

      '<label for="' + i('EvDietista') + '">Responsable de la Jornada <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('EvDietista') + '" type="text" autocomplete="off" placeholder="Nombre y apellido">' +


      '<div class="pie-form">' +
        '<button type="button" class="principal" id="' + i('EvGuardar') + '">Crear la jornada</button>' +
      '</div>';

    t.q('EvFTipo').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.q('EvFTipo').querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
        b.classList.add('on');
      });
    });


    t.llenarTerritorio();
    t.q('EvVolver').addEventListener('click', function () { t.modoEv = 'lista'; t.pintar(); });
    t.q('EvGuardar').addEventListener('click', function () { t.guardarEvento(); });
  };

  /* El territorio del municipio (parroquias, comunas y comunidades) sale
     del mismo archivo que usa la Sala Situacional: así se elige de una
     lista ordenada y nadie lo escribe distinto cada vez. */
  Jornadas.prototype.llenarTerritorio = function () {
    var t = this;
    var T = window.TERRITORIO && window.TERRITORIO.comunidades;
    var selP = t.q('EvParroquia'), selCo = t.q('EvComuna'), selCd = t.q('EvComunidad');
    if (!selP || !selCo || !selCd) return;
    if (!T) {   // si el archivo no cargó, al menos no se rompe nada
      [selP, selCo, selCd].forEach(function (s) { s.innerHTML = '<option value="">(no se pudo cargar la lista)</option>'; });
      return;
    }
    var lista = Object.keys(T).map(function (k) { return T[k]; }).filter(function (c) { return c.activo !== false; });
    var opciones = function (sel, valores, vacio) {
      sel.innerHTML = '<option value="">' + vacio + '</option>' +
        valores.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    };
    var unicos = function (arr) { return arr.filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(); };

    opciones(selP, unicos(lista.map(function (c) { return c.parroquia; })), 'Elige la parroquia');
    var pintarComunas = function () {
      var p = selP.value;
      var dentro = lista.filter(function (c) { return !p || c.parroquia === p; });
      opciones(selCo, unicos(dentro.map(function (c) { return c.circuito_comunal; })), p ? 'Elige la comuna' : 'Elige primero la parroquia');
      pintarComunidades();
    };
    var pintarComunidades = function () {
      var p = selP.value, co = selCo.value;
      var dentro = lista.filter(function (c) { return (!p || c.parroquia === p) && (!co || c.circuito_comunal === co); });
      opciones(selCd, unicos(dentro.map(function (c) { return c.nombre; })), co ? 'Elige la comunidad' : 'Elige primero la comuna');
    };
    selP.addEventListener('change', pintarComunas);
    selCo.addEventListener('change', pintarComunidades);
    pintarComunas();
  };

  Jornadas.prototype.pintarFirmasForm = function () {
    var t = this;
    var z = t.q('EvFirmas');
    if (!z) return;
    z.innerHTML = t.firmasForm.map(function (n, idx) {
      return '<button type="button" class="on" data-quitar="' + idx + '">' + esc(n) + ' ✕</button>';
    }).join('');
    z.querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.firmasForm.splice(+b.dataset.quitar, 1);
        t.pintarFirmasForm();
      });
    });
  };

  Jornadas.prototype.agregarFirmaForm = function () {
    var t = this;
    var caja = t.q('EvFirmaTxt');
    var n = caja.value.trim().replace(/\s+/g, ' ');
    if (!n) return;
    t.firmasForm.push(n);
    caja.value = '';
    caja.focus();
    t.pintarFirmasForm();
  };

  Jornadas.prototype.guardarEvento = function () {
    var t = this;
    var tipo = t.elegido('EvFTipo') || 'jornadas';
    var fecha = t.q('EvFecha').value || null;
    var lugar = t.q('EvLugar').value.trim();

    if (!lugar || lugar.length < 3) { t.aviso('warn', 'Escribe el lugar donde fue la jornada.'); return; }
    if (!fecha) { t.aviso('warn', 'Falta la fecha.'); return; }
    if (fecha > hoyEs()) { t.aviso('warn', 'La fecha no puede ser futura.'); return; }

    var d = {
      tipo: tipo, fecha: fecha, lugar: lugar,
      parroquia: t.q('EvParroquia').value || null,
      comuna: t.q('EvComuna').value || null,
      comunidad: t.q('EvComunidad').value || null,
      dietista: t.q('EvDietista').value.trim() || null,   // Responsable de la Jornada
      firmas: []
    };

    var btn = t.q('EvGuardar');
    btn.disabled = true; btn.textContent = 'Creando…';

    t.sb.from('jornadas_eventos').insert(d).select().single().then(function (r) {
      btn.disabled = false; btn.textContent = 'Crear la jornada';
      if (r.error) { t.aviso('bad', 'No se pudo crear: ' + esc(r.error.message)); return; }
      t.eventoActual = Object.assign({ pacientes: 0, recipes: 0 }, r.data);
      t.modoEv = 'detalle';
      t.pintar();
      t.aviso('ok', 'La jornada en ' + d.lugar + ' quedó creada. Ahora carga a las personas que se atendieron.');
    });
  };

  /* ================================================================
     JORNADAS (EVENTOS) — el detalle: sus cifras y su gente
  ================================================================ */
  Jornadas.prototype.verEventoDetalle = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    var ev = t.eventoActual;
    if (!ev) { t.modoEv = 'lista'; t.pintar(); return; }

    z.innerHTML = '<div class="cargando">Cargando la jornada…</div>';

    cargarRegistrosEvento(t.sb, ev.id)
      .then(function (r) {
        if (!t.q('Zona')) return;
        if (r.error) {
          z.innerHTML = '<div class="aviso bad">No se pudo cargar: ' + esc(r.error.message) + '</div>';
          return;
        }
        var personas = r.data || [];
        t.personasEvento = personas;

        var informe = prepararInformeEvento(window.FARM, ev, personas);
        t.informeEvento = informe;
        var cifras = informe.cifras;
        var totalMeds = cifras.totalMedicamentos, recipes = cifras.recipes;

        var equipo = [];
        if (ev.dietista) equipo.push({ rotulo: 'Responsable de la Jornada', nombre: ev.dietista });
        if (ev.autoridad_salud) equipo.push({ rotulo: 'Autoridad Única de Salud', nombre: ev.autoridad_salud });
        if (ev.trabajador_social) equipo.push({ rotulo: 'Trabajador Social', nombre: ev.trabajador_social });

        z.innerHTML =
          '<button type="button" class="volver" id="' + i('DetVolver') + '">← Volver a las jornadas</button>' +
          '<div class="cabecera-prod">' +
            '<h2>' + esc(ev.lugar) + '</h2>' +
            '<button type="button" class="principal" id="' + i('DetAgregar') + '">+ Agregar persona</button>' +
          '</div>' +
          '<p class="sub">' + [larga(ev.fecha), CONJUNTOS[ev.tipo] || ev.tipo,
            ev.parroquia ? 'Parroquia ' + ev.parroquia : null,
            ev.comuna ? 'Comuna ' + ev.comuna : null,
            ev.comunidad ? 'Comunidad ' + ev.comunidad : null].filter(Boolean).map(esc).join(' · ') + '</p>' +
          '<div class="descargas">' +
            '<button type="button" id="' + i('DetExcel') + '">Descargar informe completo en Excel</button>' +
            '<button type="button" id="' + i('DetPdf') + '">Descargar informe completo en PDF</button>' +
          '</div>' +

          (equipo.length ? '<div class="renglones">' + equipo.map(function (q) {
            return '<div class="renglon"><div class="que"><b>' + esc(q.rotulo) + '</b>' +
              '<span>' + esc(q.nombre) + '</span></div></div>';
          }).join('') + '</div>' : '') +
          (ev.firmas && ev.firmas.length
            ? '<p class="sub chico">Firmaron: ' + ev.firmas.map(esc).join(', ') + '</p>' : '') +

          '<div class="cifras">' +
            cif(personas.length, personas.length === 1 ? 'paciente atendido' : 'pacientes atendidos') +
            cif(cifras.personasConEntrega, 'personas con productos y cantidad') +
            cif(totalMeds, totalMeds === 1 ? 'unidad realmente entregada' : 'unidades realmente entregadas') +
            cif(cifras.productosDistintos, cifras.productosDistintos === 1 ? 'medicamento o insumo distinto' : 'medicamentos o insumos distintos') +
            cif(cifras.renglonesConCantidad, cifras.renglonesConCantidad === 1 ? 'renglón de producto' : 'renglones de productos') +
            cif(recipes, recipes === 1 ? 'con récipe' : 'con récipes') +
          '</div>' +

          '<p class="sub chico">Las unidades salen de sumar las cantidades de los renglones detallados abajo. ' +
            'Un producto distinto indica cuántos nombres diferentes se entregaron; no es lo mismo que el total de unidades.</p>' +

          (cifras.sinCantidad
            ? '<div class="aviso warn"><b>' + cifras.sinCantidad + ' medicamento(s) sin cantidad anotada</b>' +
              '<span>Se muestran para revisión, pero no se suman como unidades entregadas.</span></div>' : '') +

          (informe.productos.length
            ? '<h2 class="sub-t">Totales por medicamento o insumo</h2>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Medicamento o insumo</th><th class="der">Unidades</th><th class="der">Personas</th><th class="der">Renglones</th></tr></thead><tbody>' +
              informe.productos.map(function (m) {
                return '<tr><td>' + esc(m.producto) + '</td><td class="der num"><b>' + m.unidades +
                  '</b></td><td class="der num">' + m.personas + '</td><td class="der num">' + m.renglones + '</td></tr>';
              }).join('') +
              '</tbody></table></div>'
            : '') +

          (informe.detalle.length
            ? '<h2 class="sub-t">Detalle por paciente y producto</h2>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr><th>#</th><th>Paciente</th><th>Cédula</th><th>Medicamento o insumo</th><th class="der">Cantidad</th><th>Récipe</th></tr></thead><tbody>' +
              informe.detalle.map(function (d) {
                return '<tr><td class="num">' + d.numero + '</td><td>' + esc(d.paciente) + '</td><td>' +
                  esc(d.cedula || 'Sin cédula') + '</td><td>' + esc(d.producto) + '</td><td class="der num"><b>' +
                  d.cantidad + '</b></td><td>' + esc(d.recipe) + '</td></tr>';
              }).join('') + '</tbody></table></div>' : '') +

          (cifras.ordenSinCantidad.length
            ? '<p class="sub chico">Nombres que todavía no tienen cantidad</p>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Medicamento</th><th class="der">Registros por revisar</th></tr></thead><tbody>' +
              cifras.ordenSinCantidad.map(function (m) { return '<tr><td>' + esc(m) + '</td><td class="der num">' + cifras.medsSinCantidad[m] + '</td></tr>'; }).join('') +
              '</tbody></table></div>'
            : '') +

          '<h2 class="sub-t">Personas atendidas</h2>' +
          (personas.length
            ? '<div class="fichas">' + personas.map(function (p) {
                var datos = [];
                if (p.conjunto !== 'salud_escuela') datos.push(p.cedula ? 'C.I. ' + p.cedula : 'Sin cédula');
                if (p.edad_texto) datos.push(p.edad_texto);
                if (p.sexo) datos.push(p.sexo === 'F' ? 'Femenino' : 'Masculino');
                if (p.telefono) datos.push(p.telefono);
                if (p.item) datos.push(p.item);
                if (p.direccion) datos.push(p.direccion);
                if (p.comuna) datos.push(p.comuna);
                if (p.comunidad) datos.push(p.comunidad);
                return '<button type="button" class="ficha" data-id="' + esc(p.id) + '">' +
                  '<div class="ficha-nom"><b>' + esc(p.nombre) + '</b>' +
                    '<span class="ficha-pres">' + esc(datos.join(' · ')) + '</span>' +
                    (p.representante_nombre ? '<span class="ficha-pres">Representante: ' +
                      esc(p.representante_nombre) + ' · C.I. ' + esc(p.representante_cedula || '') + '</span>' : '') +
                    (p.plantel ? '<span class="ficha-pres">' + esc(p.plantel) +
                      (p.seccion ? ' · Sección ' + esc(p.seccion) : '') + '</span>' : '') +
                  '</div>' +
                  '<div class="ficha-datos">' +
                    '<span class="ficha-lotes">' + esc(p.tratamiento || 'Sin tratamiento anotado') + '</span>' +
                    (p.recipe ? '<span class="ficha-vence">Con récipe</span>' : '') +
                  '</div>' +
                '</button>';
              }).join('') + '</div>'
            : '<div class="vacio">Todavía no has cargado a nadie en esta jornada.</div>');

        t.q('DetVolver').addEventListener('click', function () { t.modoEv = 'lista'; t.pintar(); });
        t.q('DetExcel').addEventListener('click', function () { t.descargarEvento('excel', this); });
        t.q('DetPdf').addEventListener('click', function () { t.descargarEvento('pdf', this); });
        t.q('DetAgregar').addEventListener('click', function () {
          t.origenPersona = { tipo: 'evento', id: ev.id };
          t.quien = null; t.modo = 'nuevo';
          t.verFormularioPersona(null);
        });
        z.querySelectorAll('[data-id]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = personas.filter(function (x) { return x.id === b.dataset.id; })[0];
            if (!p) return;
            t.origenPersona = { tipo: 'evento', id: ev.id };
            t.quien = p; t.modo = 'ficha';
            /* Se busca la ficha completa: la lista del evento solo trae
               lo que se muestra en la tarjeta, no todos los campos. */
            t.sb.from('jornadas_registros').select(CAMPOS).eq('id', p.id).single().then(function (rr) {
              if (rr.error) { t.aviso('bad', 'No se pudo abrir: ' + esc(rr.error.message)); return; }
              t.quien = rr.data;
              t.verFormularioPersona(t.quien);
            });
          });
        });
      });
  };

  Jornadas.prototype.descargarEvento = function (tipo, boton) {
    var t = this, R = window.FARMREP, ev = t.eventoActual;
    if (!R) { t.aviso('bad', 'Todavía se está cargando el generador de reportes. Inténtalo en unos segundos.'); return; }
    if (!ev) { t.aviso('bad', 'No hay una jornada abierta para preparar el informe.'); return; }
    var inf = t.informeEvento || prepararInformeEvento(window.FARM, ev, t.personasEvento || []);
    var c = inf.cifras;
    var nombre = (CONJUNTOS[ev.tipo] || 'Jornada de Salud') + ' - ' +
      (ev.lugar || 'Sin lugar') + ' - ' + corta(ev.fecha);
    var titulo = (CONJUNTOS[ev.tipo] || 'Jornada de Salud') + ' — ' + (ev.lugar || 'Sin lugar');
    var ubicacion = [ev.parroquia ? 'Parroquia ' + ev.parroquia : '', ev.comuna ? 'Comuna ' + ev.comuna : '',
                     ev.comunidad ? 'Comunidad ' + ev.comunidad : ''].filter(Boolean).join(' · ');
    var datosEvento = [
      ['Fecha', larga(ev.fecha)], ['Lugar', ev.lugar || 'Sin dato'], ['Tipo', CONJUNTOS[ev.tipo] || ev.tipo || 'Sin dato'],
      ['Ubicación', ubicacion || 'Sin dato'], ['Responsable de la Jornada', ev.dietista || 'No consta'],
      ['Autoridad Única de Salud', ev.autoridad_salud || 'No consta'],
      ['Trabajador Social', ev.trabajador_social || 'No consta'],
      ['Firmas', (ev.firmas || []).join(', ') || 'No constan']
    ];
    var resumen = [
      ['Pacientes atendidos', c.pacientes], ['Personas con productos y cantidad', c.personasConEntrega],
      ['Unidades realmente entregadas', c.totalMedicamentos], ['Medicamentos o insumos distintos', c.productosDistintos],
      ['Renglones de productos con cantidad', c.renglonesConCantidad], ['Personas con récipe', c.recipes],
      ['Renglones sin cantidad', c.sinCantidad], ['Personas sin tratamiento anotado', c.personasSinTratamiento]
    ];
    var productos = inf.productos.map(function (p) {
      return [p.producto, p.unidades, p.personas, p.renglones];
    });
    var detalle = inf.detalle.map(function (d) {
      return [d.numero, d.paciente, d.cedula || 'Sin cédula', d.sexo, d.edad, d.telefono, d.direccion,
              d.sector, d.producto, d.cantidad, d.recipe];
    });
    var pacientes = inf.pacientes.map(function (p) {
      return [p.numero, p.nombre, p.cedula || 'Sin cédula', p.sexo, p.edad, p.telefono, p.direccion, p.sector,
              p.tratamiento, p.renglones, p.unidades, p.pendientes, p.recipe, p.estado];
    });
    var pendientes = inf.sinCantidad.map(function (d) {
      return [d.numero, d.paciente, d.cedula || 'Sin cédula', d.producto, d.recipe];
    });
    var escolares = ev.tipo === 'salud_escuela' ? (t.personasEvento || []).map(function (p, n) {
      return [n + 1, p.nombre || '', p.sexo === 'F' ? 'Femenino' :
        (p.sexo === 'M' ? 'Masculino' : 'Sin dato'), p.edad_texto || '', p.tratamiento || '',
        p.representante_nombre || '', p.representante_cedula || '', p.telefono || '',
        p.direccion || '', p.comuna || '', p.comunidad || '', p.plantel || '', p.seccion || ''];
    }) : [];
    var textoBoton = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.textContent = 'Preparando…'; }

    setTimeout(function () {
      try {
        if (tipo === 'excel') {
          var hojas = [
            { nombre: 'Resumen', titulo: titulo + ' — resumen completo', encabezados: ['Indicador', 'Información'],
              filas: datosEvento.concat(resumen), anchos: [42, 72] },
            { nombre: 'Medicamentos', titulo: titulo + ' — totales por medicamento o insumo',
              encabezados: ['Medicamento o insumo', 'Unidades', 'Personas', 'Renglones'], filas: productos,
              anchos: [48, 14, 14, 14] },
            { nombre: 'Detalle por paciente', titulo: titulo + ' — cada producto entregado a cada paciente',
              encabezados: ['#', 'Paciente', 'Cédula', 'Sexo', 'Edad', 'Teléfono', 'Dirección', 'Comuna / sector',
                            'Medicamento o insumo', 'Cantidad', 'Récipe'],
              filas: detalle, anchos: [6, 32, 15, 12, 12, 17, 34, 24, 42, 12, 12] },
            { nombre: 'Pacientes', titulo: titulo + ' — listado completo de personas atendidas',
              encabezados: ['#', 'Nombre y apellido', 'Cédula', 'Sexo', 'Edad', 'Teléfono', 'Dirección', 'Comuna / sector',
                            'Tratamiento completo', 'Productos con cantidad', 'Unidades', 'Sin cantidad', 'Récipe', 'Estado'],
              filas: pacientes, anchos: [6, 32, 15, 12, 12, 17, 34, 24, 45, 18, 12, 14, 12, 14] }
          ];
          if (pendientes.length) hojas.push({
            nombre: 'Sin cantidad', titulo: titulo + ' — productos que requieren revisión',
            encabezados: ['#', 'Paciente', 'Cédula', 'Medicamento o insumo sin cantidad', 'Récipe'],
            filas: pendientes, anchos: [6, 34, 16, 48, 12]
          });
          if (ev.tipo === 'salud_escuela') hojas.push({
            nombre: 'Salud a la Escuela', titulo: titulo + ' — fichas completas de los niños y niñas',
            encabezados: ['#', 'Nombre y apellido del niño', 'Sexo', 'Edad', 'Tratamiento',
                          'Representante', 'Cédula del representante', 'Teléfono', 'Dirección',
                          'Comuna', 'Comunidad', 'Plantel', 'Sección'],
            filas: escolares, anchos: [6, 34, 12, 9, 43, 34, 20, 17, 40, 32, 32, 38, 15]
          });
          R.excel(nombre, hojas);
        } else {
          R.pdfInforme({
            titulo: titulo, subtitulo: 'Informe completo · ' + larga(ev.fecha) + (ubicacion ? ' · ' + ubicacion : ''),
            archivo: nombre, horizontal: true,
            resumen: [
              { k: 'Pacientes', v: c.pacientes }, { k: 'Unidades reales', v: c.totalMedicamentos },
              { k: 'Productos distintos', v: c.productosDistintos }, { k: 'Renglones', v: c.renglonesConCantidad },
              { k: 'Con récipe', v: c.recipes }, { k: 'Sin cantidad', v: c.sinCantidad }
            ],
            bloques: [
              { titulo: 'Datos de la jornada', encabezados: ['Dato', 'Información'], filas: datosEvento,
                columnas: { 0: { cellWidth: 48 }, 1: { cellWidth: 160 } } },
              { titulo: 'Totales por medicamento o insumo',
                nota: 'Las unidades corresponden a la suma de las cantidades anotadas; “personas” no sustituye a las unidades.',
                encabezados: ['Medicamento o insumo', 'Unidades', 'Personas', 'Renglones'], filas: productos,
                pie: ['TOTAL', c.totalMedicamentos, c.personasConEntrega + ' con entrega', c.renglonesConCantidad],
                columnas: { 0: { cellWidth: 118 }, 1: { cellWidth: 28, halign: 'right' },
                            2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' } } },
              { titulo: 'Detalle por paciente y producto',
                encabezados: ['#', 'Paciente', 'Cédula', 'Medicamento o insumo', 'Cantidad', 'Récipe'],
                filas: inf.detalle.map(function (d) {
                  return [d.numero, d.paciente, d.cedula || 'Sin cédula', d.producto, d.cantidad, d.recipe];
                }),
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 54 }, 2: { cellWidth: 27 },
                            3: { cellWidth: 94 }, 4: { cellWidth: 24, halign: 'right' }, 5: { cellWidth: 22 } } },
              { titulo: 'Datos completos de las personas atendidas',
                encabezados: ['#', 'Nombre y apellido', 'Cédula', 'Sexo', 'Edad', 'Teléfono', 'Comuna / sector', 'Dirección'],
                filas: inf.pacientes.map(function (p) {
                  return [p.numero, p.nombre, p.cedula || 'Sin cédula', p.sexo, p.edad, p.telefono, p.sector, p.direccion];
                }),
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 49 }, 2: { cellWidth: 26 },
                            3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 28 },
                            6: { cellWidth: 38 }, 7: { cellWidth: 55 } } },
              { titulo: 'Tratamiento completo por paciente',
                encabezados: ['#', 'Paciente', 'Cédula', 'Tratamiento anotado', 'Productos', 'Unidades', 'Récipe'],
                filas: inf.pacientes.map(function (p) {
                  return [p.numero, p.nombre, p.cedula || 'Sin cédula', p.tratamiento || 'Sin tratamiento anotado',
                          p.renglones, p.unidades, p.recipe];
                }),
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 50 }, 2: { cellWidth: 26 },
                            3: { cellWidth: 100 }, 4: { cellWidth: 22, halign: 'right' },
                            5: { cellWidth: 22, halign: 'right' }, 6: { cellWidth: 20 } } },
              { titulo: 'Productos sin cantidad anotada',
                nota: 'Se muestran para revisión y no se suman como unidades entregadas.',
                encabezados: ['#', 'Paciente', 'Cédula', 'Medicamento o insumo', 'Récipe'], filas: pendientes,
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 62 }, 2: { cellWidth: 28 },
                            3: { cellWidth: 105 }, 4: { cellWidth: 22 } } }
            ].concat(ev.tipo === 'salud_escuela' ? [
              { titulo: 'Salud a la Escuela — niños, tratamiento y plantel',
                encabezados: ['#', 'Niño o niña', 'Sexo', 'Edad', 'Tratamiento', 'Plantel', 'Sección'],
                filas: escolares.map(function (p) { return [p[0], p[1], p[2], p[3], p[4], p[11], p[12]]; }),
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 50 }, 2: { cellWidth: 20 },
                            3: { cellWidth: 15 }, 4: { cellWidth: 80 }, 5: { cellWidth: 52 },
                            6: { cellWidth: 22 } } },
              { titulo: 'Salud a la Escuela — representantes y direcciones',
                encabezados: ['#', 'Niño o niña', 'Representante', 'Cédula', 'Teléfono',
                              'Dirección', 'Comuna', 'Comunidad'],
                filas: escolares.map(function (p) {
                  return [p[0], p[1], p[5], p[6], p[7], p[8], p[9], p[10]];
                }),
                columnas: { 0: { cellWidth: 9 }, 1: { cellWidth: 42 }, 2: { cellWidth: 42 },
                            3: { cellWidth: 24 }, 4: { cellWidth: 25 }, 5: { cellWidth: 50 },
                            6: { cellWidth: 27 }, 7: { cellWidth: 32 } } }
            ] : [])
          });
        }
      } catch (e) {
        t.aviso('bad', 'No se pudo preparar el informe: ' + (e.message || e));
      } finally {
        if (boton && document.body.contains(boton)) { boton.disabled = false; boton.textContent = textoBoton; }
      }
    }, 20);
  };

  /* ================================================================
     REGISTROS — el listado completo (sin distinguir evento)
  ================================================================ */
  Jornadas.prototype.verRegistros = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    z.innerHTML =
      '<h2>Registros</h2>' +
      '<p class="sub">Todas las personas de todas las jornadas, para buscar y corregir sin tener que ' +
        'saber en qué jornada quedó. Para cargar gente nueva, entra a su jornada.</p>' +
      '<div class="filtros">' +
        '<input id="' + i('Busca') + '" type="search" ' +
          'placeholder="Buscar por nombre, cédula, teléfono, dirección, comuna o tratamiento…" ' +
          'value="' + esc(t.busca) + '">' +
        '<select id="' + i('Conj') + '">' +
          '<option value="todos">Todos los conjuntos</option>' +
          '<option value="jornadas"' + (t.conjunto === 'jornadas' ? ' selected' : '') + '>Jornada de salud</option>' +
          '<option value="ruta_materna"' + (t.conjunto === 'ruta_materna' ? ' selected' : '') + '>Ruta materna</option>' +
          '<option value="salud_escuela"' + (t.conjunto === 'salud_escuela' ? ' selected' : '') + '>Salud a la Escuela</option>' +
        '</select>' +
        '<select id="' + i('Hoja') + '">' +
          '<option value="todos">Todas las hojas</option>' +
          HOJAS.map(function (h) {
            return '<option value="' + esc(h.v) + '"' + (t.hoja === h.v ? ' selected' : '') + '>' + esc(h.t) + '</option>';
          }).join('') +
        '</select>' +
        '<select id="' + i('Est') + '">' +
          '<option value="todos">Todos los estados</option>' +
          '<option value="activo"' + (t.estado === 'activo' ? ' selected' : '') + '>Activos</option>' +
          '<option value="por_revisar"' + (t.estado === 'por_revisar' ? ' selected' : '') + '>Por revisar</option>' +
        '</select>' +
      '</div>' +
      '<div id="' + i('Res') + '"></div>' +
      '<div id="' + i('Pag') + '" class="paginas"></div>';

    t.q('Busca').addEventListener('input', retardo(function () {
      t.busca = t.q('Busca').value.trim(); t.pagina = 0; t.buscar();
    }, 350));
    t.q('Conj').addEventListener('change', function () { t.conjunto = t.q('Conj').value; t.pagina = 0; t.buscar(); });
    t.q('Hoja').addEventListener('change', function () { t.hoja = t.q('Hoja').value; t.pagina = 0; t.buscar(); });
    t.q('Est').addEventListener('change', function () { t.estado = t.q('Est').value; t.pagina = 0; t.buscar(); });

    t.buscar();
  };

  Jornadas.prototype.buscar = function () {
    var t = this;
    var z = t.q('Res');
    if (!z) return;
    z.innerHTML = '<p class="cargando">Buscando…</p>';
    var pedido = ++t.pedido;

    var qy = t.sb.from('jornadas_registros').select(CAMPOS, { count: 'exact' });
    if (t.busca) {
      var b = t.busca.replace(/[%_]/g, '\\$&');
      qy = qy.or(
        'nombre.ilike.%' + b + '%,' +
        'cedula.ilike.%' + b + '%,' +
        'telefono.ilike.%' + b + '%,' +
        'direccion.ilike.%' + b + '%,' +
        'tratamiento.ilike.%' + b + '%,' +
        'item.ilike.%' + b + '%,' +
        'representante_nombre.ilike.%' + b + '%,' +
        'representante_cedula.ilike.%' + b + '%,' +
        'plantel.ilike.%' + b + '%,' +
        'seccion.ilike.%' + b + '%,' +
        'comuna.ilike.%' + b + '%,' +
        'comunidad.ilike.%' + b + '%'
      );
    }
    if (t.conjunto !== 'todos') qy = qy.eq('conjunto', t.conjunto);
    if (t.hoja !== 'todos') qy = qy.eq('hoja_origen', t.hoja);
    if (t.estado !== 'todos') qy = qy.eq('estado', t.estado);
    qy = qy.order('nombre').range(t.pagina * POR_PAGINA, t.pagina * POR_PAGINA + POR_PAGINA - 1);

    qy.then(function (r) {
      if (pedido !== t.pedido || !t.q('Res')) return;
      if (r.error) { z.innerHTML = '<div class="aviso bad">No se pudo buscar: ' + esc(r.error.message) + '</div>'; return; }
      t.filas = r.data || []; t.total = r.count || 0;
      t.pintarLista();
    });
  };

  Jornadas.prototype.pintarLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Res');
    if (!t.filas.length) {
      z.innerHTML = '<div class="vacio">' +
        (t.busca || t.conjunto !== 'todos' || t.hoja !== 'todos' || t.estado !== 'todos'
          ? 'Nadie coincide con lo que buscas.' : 'Todavía no hay nada cargado.') +
        '</div>';
      t.q('Pag').innerHTML = '';
      return;
    }
    z.innerHTML =
      '<p class="conteo">' + t.total + (t.total === 1 ? ' registro' : ' registros') + '</p>' +
      '<div class="fichas">' + t.filas.map(function (f) {
        var quien = [];
        if (f.conjunto !== 'salud_escuela') quien.push(f.cedula ? 'C.I. ' + f.cedula : 'Sin cédula');
        if (f.edad_texto) quien.push(f.edad_texto);
        if (f.sexo) quien.push(f.sexo === 'F' ? 'Femenino' : 'Masculino');

        var contacto = [];
        if (f.telefono) contacto.push(f.telefono);
        if (f.direccion) contacto.push(f.direccion);
        if (f.representante_nombre) contacto.push('Representante: ' + f.representante_nombre);

        var cuando = [corta(f.fecha), CONJUNTOS[f.conjunto] || f.conjunto];
        if (f.hoja_origen) cuando.push(HOJAS_TXT[f.hoja_origen] || f.hoja_origen);

        return '<button type="button" class="ficha" data-id="' + esc(f.id) + '">' +
          '<div class="ficha-nom">' +
            '<b>' + esc(f.nombre) + '</b>' +
            '<span class="ficha-pres">' + esc(quien.join(' · ')) + '</span>' +
            (contacto.length ? '<span class="ficha-pres">' + esc(contacto.join(' · ')) + '</span>' : '') +
            (f.item ? '<span class="ficha-pres">' + esc(f.item) + '</span>' : '') +
            (f.plantel ? '<span class="ficha-pres">' + esc(f.plantel) +
              (f.seccion ? ' · Sección ' + esc(f.seccion) : '') + '</span>' : '') +
          '</div>' +
          '<div class="ficha-datos">' +
            '<span class="ficha-lotes">' + esc(f.tratamiento || 'Sin tratamiento anotado') + '</span>' +
            '<span class="ficha-vence">' + esc(cuando.filter(Boolean).join(' · ')) + (f.recipe ? ' · Con récipe' : '') + '</span>' +
          '</div>' +
          estadoChip(f.estado) +
        '</button>';
      }).join('') + '</div>';

    z.querySelectorAll('[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = t.filas.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (f) { t.origenPersona = { tipo: 'registros' }; t.modo = 'ficha'; t.quien = f; t.pintar(); }
      });
    });

    var paginas = Math.max(1, Math.ceil(t.total / POR_PAGINA));
    var pz = t.q('Pag');
    if (paginas <= 1) { pz.innerHTML = ''; return; }
    pz.innerHTML =
      '<div class="paginador">' +
        '<button type="button" id="' + i('Ant') + '"' + (t.pagina === 0 ? ' disabled' : '') + '>Anteriores</button>' +
        '<span>' + (t.pagina * POR_PAGINA + 1) + '–' + Math.min(t.total, (t.pagina + 1) * POR_PAGINA) +
          ' de ' + t.total + '</span>' +
        '<button type="button" id="' + i('Sig') + '"' + (t.pagina >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
      '</div>';
    var ant = t.q('Ant'), sig = t.q('Sig');
    if (ant) ant.addEventListener('click', function () { t.pagina--; t.buscar(); });
    if (sig) sig.addEventListener('click', function () { t.pagina++; t.buscar(); });
  };

  /* ================================================================
     FORMULARIO DE UNA PERSONA — lo comparten Registros y una jornada
  ================================================================ */
  Jornadas.prototype.verFormularioEscuela = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    var enEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    var z = t.q('Zona');
    z.innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← ' +
        (enEvento ? 'Volver a la jornada' : 'Volver a la lista') + '</button>' +
      '<h2>' + (t.modo === 'ficha' ? 'Corregir registro escolar' : 'Registrar niño o niña') + '</h2>' +
      (enEvento ? '<p class="sub chico">Salud a la Escuela: <b>' + esc(t.eventoActual.lugar) +
        '</b> · ' + corta(t.eventoActual.fecha) + '</p>' : '') +
      '<label for="' + i('Fecha') + '">Fecha de atención</label>' +
      '<input id="' + i('Fecha') + '" type="date" value="' +
        esc(x.fecha || (enEvento ? t.eventoActual.fecha : hoyEs())) + '">' +
      '<label for="' + i('Nombre') + '">Nombre y apellido del niño o niña</label>' +
      '<input id="' + i('Nombre') + '" type="text" autocomplete="off" value="' + esc(x.nombre || '') + '">' +
      '<div class="dos-columnas"><div><label>Sexo</label>' +
        '<div class="chips" id="' + i('Sexo') + '">' +
          '<button type="button" data-v="F"' + (x.sexo === 'F' ? ' class="on"' : '') + '>Femenino</button>' +
          '<button type="button" data-v="M"' + (x.sexo === 'M' ? ' class="on"' : '') + '>Masculino</button>' +
        '</div></div>' +
        '<div><label for="' + i('Edad') + '">Edad (años)</label>' +
          '<input id="' + i('Edad') + '" type="number" min="0" max="25" inputmode="numeric" value="' +
          esc(x.edad_texto || '') + '"></div></div>' +
      '<label for="' + i('Tratamiento') + '">Tratamiento <span class="opc">(si se indicó alguno)</span></label>' +
      '<input id="' + i('Tratamiento') + '" type="text" autocomplete="off" value="' +
        esc(x.tratamiento || '') + '" placeholder="Medicamento y cantidad, si se entregó">' +
      '<div class="trat-ayuda"><div class="trat-barra">' +
        '<button type="button" class="suave chico" id="' + i('TratBuscar') + '">Buscar en el inventario</button>' +
        '<span class="sub chico">Si se entregaron productos, anota la cantidad de cada uno. ' +
          '<b>Este registro no descuenta del inventario.</b></span></div>' +
        '<div id="' + i('TratPicker') + '" class="trat-picker" hidden></div>' +
        '<div id="' + i('TratChips') + '" class="trat-chips"></div>' +
        '<p id="' + i('TratTotal') + '" class="trat-total" aria-live="polite"></p></div>' +
      '<h3 class="sub-t">Representante</h3>' +
      '<label for="' + i('RepNombre') + '">Nombre completo del representante</label>' +
      '<input id="' + i('RepNombre') + '" type="text" autocomplete="off" value="' +
        esc(x.representante_nombre || '') + '">' +
      '<div class="dos-columnas">' +
        '<div><label for="' + i('RepCedula') + '">Cédula del representante</label>' +
          '<input id="' + i('RepCedula') + '" type="text" inputmode="numeric" autocomplete="off" value="' +
            esc(x.representante_cedula || '') + '"></div>' +
        '<div><label for="' + i('Telefono') + '">Teléfono del representante</label>' +
          '<input id="' + i('Telefono') + '" type="tel" inputmode="tel" autocomplete="off" value="' +
            esc(x.telefono || '') + '"></div></div>' +
      '<h3 class="sub-t">Dirección del niño o niña</h3>' +
      '<label for="' + i('Direccion') + '">Dirección</label>' +
      '<input id="' + i('Direccion') + '" type="text" autocomplete="off" value="' +
        esc(x.direccion || '') + '">' +
      '<div class="dos-columnas">' +
        '<div><label for="' + i('Comuna') + '">Comuna</label><select id="' + i('Comuna') + '"></select></div>' +
        '<div><label for="' + i('Comunidad') + '">Comunidad</label><select id="' + i('Comunidad') + '"></select></div>' +
      '</div>' +
      '<h3 class="sub-t">Colegio</h3>' +
      '<label for="' + i('Plantel') + '">Nombre del plantel</label>' +
      '<input id="' + i('Plantel') + '" type="text" autocomplete="off" value="' + esc(x.plantel || '') + '">' +
      '<label for="' + i('Seccion') + '">Sección</label>' +
      '<input id="' + i('Seccion') + '" type="text" autocomplete="off" value="' + esc(x.seccion || '') + '">' +
      '<div class="pie-form"><button type="button" class="principal" id="' + i('Guardar') + '">' +
        (t.modo === 'ficha' ? 'Guardar los cambios' : 'Registrar') + '</button>' +
        (t.modo === 'ficha' ? '<button type="button" class="suave" id="' + i('Borrar') +
          '">Borrar este registro</button>' : '') + '</div>';

    t.q('Sexo').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.q('Sexo').querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
        b.classList.add('on');
      });
    });
    t.llenarTerritorioEscuela(x);
    t.q('Volver').addEventListener('click', function () {
      t.modo = 'lista';
      if (enEvento) t.modoEv = 'detalle';
      t.quien = null; t.pintar();
    });
    t.q('Guardar').addEventListener('click', function () { t.guardarPersona(x.id || null); });
    var borrar = t.q('Borrar');
    if (borrar) borrar.addEventListener('click', function () { t.borrarPersona(x.id); });
    t.armarTratamiento();
  };

  Jornadas.prototype.llenarTerritorioEscuela = function (x) {
    var t = this, co = t.q('Comuna'), cd = t.q('Comunidad');
    var datos = window.TERRITORIO && window.TERRITORIO.comunidades;
    var lista = datos ? Object.keys(datos).map(function (k) { return datos[k]; })
      .filter(function (c) { return c.activo !== false; }) : [];
    var unicos = function (a) { return a.filter(Boolean).filter(function (v, n) {
      return a.indexOf(v) === n;
    }).sort(); };
    var opciones = function (sel, valores, vacio, previo) {
      sel.innerHTML = '<option value="">' + vacio + '</option>' + valores.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === previo ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    };
    opciones(co, unicos(lista.map(function (c) { return c.circuito_comunal; })), 'Elige la comuna', x.comuna);
    var pintarComunidades = function (previo) {
      opciones(cd, unicos(lista.filter(function (c) { return c.circuito_comunal === co.value; })
        .map(function (c) { return c.nombre; })), 'Elige la comunidad', previo);
    };
    co.addEventListener('change', function () { pintarComunidades(''); });
    pintarComunidades(x.comunidad);
  };

  Jornadas.prototype.verFormularioPersona = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    x = x || {};
    var enEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    var conj = enEvento ? t.eventoActual.tipo : (x.conjunto || 'jornadas');
    if (conj === 'salud_escuela') return t.verFormularioEscuela(x);

    z.innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← ' +
        (enEvento ? 'Volver a la jornada' : 'Volver a la lista') + '</button>' +
      '<h2>' + (t.modo === 'ficha' ? 'Corregir registro' : 'Registrar persona') + '</h2>' +

      (enEvento
        ? '<p class="sub chico">Jornada: <b>' + esc(t.eventoActual.lugar) + '</b> · ' + corta(t.eventoActual.fecha) + '</p>'
        : '<div>' +
            '<label>Conjunto</label>' +
            '<div class="chips" id="' + i('Conjunto') + '">' +
              '<button type="button" data-v="jornadas"' + (conj === 'jornadas' ? ' class="on"' : '') + '>Jornada de salud</button>' +
              '<button type="button" data-v="ruta_materna"' + (conj === 'ruta_materna' ? ' class="on"' : '') + '>Ruta materna</button>' +
            '</div>' +
          '</div>') +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Fecha') + '">Fecha</label>' +
          '<input id="' + i('Fecha') + '" type="date" value="' +
            esc(x.fecha ? String(x.fecha).slice(0, 10) : (enEvento ? String(t.eventoActual.fecha).slice(0, 10) : '')) + '"></div>' +
        '<div><label for="' + i('Item') + '">Comuna / sector <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Item') + '" type="text" autocomplete="off" value="' + esc(x.item || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Nombre') + '">Nombre y apellido</label>' +
      '<input id="' + i('Nombre') + '" type="text" autocomplete="off" value="' + esc(x.nombre || '') + '">' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Edad') + '">Edad <span class="opc">(tal como se anotó)</span></label>' +
          '<input id="' + i('Edad') + '" type="text" placeholder="Ej: 34, 2 AÑOS, 11 DIAS" ' +
          'value="' + esc(x.edad_texto || '') + '"></div>' +
        '<div><label>Sexo</label>' +
          '<div class="chips" id="' + i('Sexo') + '">' +
            '<button type="button" data-v="F"' + (x.sexo === 'F' ? ' class="on"' : '') + '>Femenino</button>' +
            '<button type="button" data-v="M"' + (x.sexo === 'M' ? ' class="on"' : '') + '>Masculino</button>' +
            '<button type="button" data-v=""' + (!x.sexo ? ' class="on"' : '') + '>No lo dice</button>' +
          '</div></div>' +
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Cedula') + '">Cédula <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Cedula') + '" type="text" inputmode="numeric" autocomplete="off" ' +
          'placeholder="Solo números" value="' + esc(x.cedula || '') + '"></div>' +
        '<div><label for="' + i('Telefono') + '">Teléfono <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Telefono') + '" type="tel" inputmode="tel" autocomplete="off" ' +
          'value="' + esc(x.telefono || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Direccion') + '">Dirección <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Direccion') + '" type="text" autocomplete="off" value="' + esc(x.direccion || '') + '">' +

      '<label for="' + i('Tratamiento') + '">Medicamentos o insumos entregados <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Tratamiento') + '" type="text" autocomplete="off" ' +
        'placeholder="Ej: ALCOHOL 2 unidades / DICLOFENAC 3 unidades" value="' + esc(x.tratamiento || '') + '">' +
      '<div class="trat-ayuda">' +
        '<div class="trat-barra">' +
          '<button type="button" class="suave chico" id="' + i('TratBuscar') + '">Buscar en el inventario</button>' +
          '<span class="sub chico">Cada producto debe tener su cantidad. Puedes escribirla o ajustarla abajo. ' +
            '<b>No descuenta del inventario.</b></span>' +
        '</div>' +
        '<div id="' + i('TratPicker') + '" class="trat-picker" hidden></div>' +
        '<div id="' + i('TratChips') + '" class="trat-chips"></div>' +
        '<p id="' + i('TratTotal') + '" class="trat-total" aria-live="polite"></p>' +
      '</div>' +

      '<label>¿Se entregó con récipe?</label>' +
      '<div class="chips" id="' + i('Recipe') + '">' +
        '<button type="button" data-v="si"' + (x.recipe === true ? ' class="on"' : '') + '>Sí</button>' +
        '<button type="button" data-v="no"' + (x.recipe === false ? ' class="on"' : '') + '>No</button>' +
        '<button type="button" data-v=""' + (x.recipe == null ? ' class="on"' : '') + '>No lo dice</button>' +
      '</div>' +

      (t.modo === 'ficha' && x.motivo_revision
        ? '<p class="sub chico ojo">Quedó marcado "por revisar" porque: ' + esc(x.motivo_revision) + '</p>' : '') +

      '<div class="pie-form">' +
        '<button type="button" class="principal" id="' + i('Guardar') + '">' +
          (t.modo === 'ficha' ? 'Guardar los cambios' : 'Registrar') + '</button>' +
        (t.modo === 'ficha'
          ? '<button type="button" class="suave" id="' + i('Borrar') + '">Borrar este registro</button>' : '') +
      '</div>';

    ['Conjunto', 'Sexo', 'Recipe'].forEach(function (g) {
      var zz = t.q(g);
      if (!zz) return;
      zz.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          zz.querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
          b.classList.add('on');
        });
      });
    });

    t.q('Volver').addEventListener('click', function () {
      /* El lado de "Registros" tiene que quedar listo para mostrar SU
         lista la próxima vez que se entre ahí, aunque se haya venido
         desde una jornada -si no, al cambiar de pestaña reaparece este
         mismo formulario, ya viejo, en vez del listado. */
      t.modo = 'lista';
      if (enEvento) t.modoEv = 'detalle';
      t.quien = null; t.pintar();
    });
    t.q('Guardar').addEventListener('click', function () { t.guardarPersona(x.id || null); });
    var btnBorrar = t.q('Borrar');
    if (btnBorrar) btnBorrar.addEventListener('click', function () { t.borrarPersona(x.id); });
    t.armarTratamiento();
  };

  /* ================================================================
     TRATAMIENTO: elegir del inventario y anotar cuántos se entregaron

     El campo sigue siendo el mismo texto de siempre -se puede escribir
     a mano, tal como está en el cuaderno-. Esto es solo una ayuda para
     no teclear el nombre completo y para dejar la cantidad anotada.

     IMPORTANTE: elegir aquí NO mueve el inventario. En las jornadas se
     reparte de lo que se lleva al sitio, y lo que se descuenta de
     verdad son las entregas de la farmacia.
  ================================================================ */
  Jornadas.prototype.armarTratamiento = function () {
    var t = this;
    var campo = t.q('Tratamiento'), chips = t.q('TratChips'), caja = t.q('TratPicker');
    var boton = t.q('TratBuscar'), total = t.q('TratTotal');
    if (!campo || !chips || !caja || !boton || !total) return;
    var F = window.FARM;
    if (!F || !F.piezasTratamientoCant) { boton.hidden = true; return; }

    /* El texto manda: los renglones se vuelven a leer de él cada vez, así
       lo escrito a mano nunca se pierde. */
    var leer = function () { return F.piezasTratamientoCant(campo.value); };
    var escribir = function (lista) {
      campo.value = lista.map(function (m) {
        return F.conCantidadTexto(m.nombre, m.cantidad > 1 || m.anotada ? m.cantidad : 0);
      }).join(' / ');
      pintar();
    };
    var pintar = function () {
      var lista = leer();
      chips.innerHTML = lista.length
        ? lista.map(function (m, k) {
            return '<span class="trat-chip">' +
              '<b>' + esc(m.nombre) + '</b>' +
              '<button type="button" class="trat-menos" data-k="' + k + '" aria-label="Uno menos">−</button>' +
              '<input class="trat-cantidad" data-k="' + k + '" type="number" min="1" max="9999" inputmode="numeric" ' +
                'aria-label="Cantidad de ' + esc(m.nombre) + '" placeholder="Cant." value="' +
                (m.anotada ? esc(m.cantidad) : '') + '">' +
              '<button type="button" class="trat-mas" data-k="' + k + '" aria-label="Uno más">+</button>' +
              '<button type="button" class="trat-quitar" data-k="' + k + '" aria-label="Quitar">✕</button>' +
            '</span>';
          }).join('')
        : '';
      var conCantidad = lista.filter(function (m) { return m.anotada && Number(m.cantidad) > 0; });
      var faltan = lista.length - conCantidad.length;
      var suma = conCantidad.reduce(function (s, m) { return s + Number(m.cantidad); }, 0);
      total.className = 'trat-total' + (faltan ? ' incompleto' : ' completo');
      total.textContent = lista.length
        ? 'Total real: ' + suma + (suma === 1 ? ' unidad' : ' unidades') +
          (faltan ? ' · Falta la cantidad de ' + faltan + (faltan === 1 ? ' producto' : ' productos') : ' · Cantidades completas')
        : 'Todavía no hay productos entregados.';
    };

    chips.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-k]');
      if (!b) return;
      var lista = leer(), k = +b.dataset.k, m = lista[k];
      if (!m) return;
      if (b.classList.contains('trat-quitar')) lista.splice(k, 1);
      else if (b.classList.contains('trat-mas')) { m.cantidad = m.anotada ? (m.cantidad || 1) + 1 : 1; m.anotada = true; }
      else if (b.classList.contains('trat-menos')) {
        m.cantidad = (m.cantidad || 1) - 1;
        m.anotada = true;
        if (m.cantidad < 1) lista.splice(k, 1);
      }
      escribir(lista);
    });
    chips.addEventListener('change', function (ev) {
      var entrada = ev.target.closest('input.trat-cantidad[data-k]');
      if (!entrada) return;
      var lista = leer(), k = +entrada.dataset.k, m = lista[k];
      if (!m) return;
      var cantidad = parseInt(entrada.value, 10);
      if (cantidad > 0 && cantidad <= 9999) { m.cantidad = cantidad; m.anotada = true; }
      else { m.cantidad = 1; m.anotada = false; }
      escribir(lista);
    });
    campo.addEventListener('input', pintar);
    campo.addEventListener('change', pintar);

    boton.addEventListener('click', function () {
      caja.hidden = !caja.hidden;
      boton.textContent = caja.hidden ? 'Buscar en el inventario' : 'Cerrar el buscador';
      if (caja.hidden || caja.dataset.listo) return;
      caja.dataset.listo = '1';
      caja.innerHTML = window.FARMPICK.caja(t.pfx + 'TratMed', 'Medicamento o insumo',
        'Escribe para buscar en lo que hay cargado…', '');
      window.FARMPICK.medicinas(t.sb, t.pfx + 'TratMed', function (x) { t.agregarAlTratamiento(x); });
    });

    pintar();
  };

  /* Al tocar uno de la lista: si ya estaba, suma uno; si no, entra con 1. */
  Jornadas.prototype.agregarAlTratamiento = function (x) {
    var t = this, F = window.FARM;
    var campo = t.q('Tratamiento');
    var nombre = String(x.producto || x.texto_original || '').trim();
    if (!nombre) return;
    var lista = F.piezasTratamientoCant(campo.value);
    var ya = null;
    lista.forEach(function (m) { if (window.FARMPICK.mismo(m.nombre, nombre)) ya = m; });
    if (ya) { ya.cantidad = (ya.cantidad || 1) + 1; ya.anotada = true; }
    else lista.push({ nombre: nombre, cantidad: 1, anotada: true });
    campo.value = lista.map(function (m) {
      return F.conCantidadTexto(m.nombre, m.cantidad > 1 || m.anotada ? m.cantidad : 0);
    }).join(' / ');
    campo.dispatchEvent(new Event('change'));
    var busca = document.getElementById(t.pfx + 'TratMedBusca');
    if (busca) { busca.value = ''; busca.focus(); busca.dispatchEvent(new Event('input')); }
  };

  Jornadas.prototype.elegido = function (g) {
    var z = this.q(g);
    var b = z && z.querySelector('button.on');
    return b ? b.dataset.v : '';
  };

  Jornadas.prototype.leerCamposPersona = function () {
    var t = this;
    var enEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    var conjunto = enEvento ? t.eventoActual.tipo :
      (t.quien && t.quien.conjunto === 'salud_escuela' ? 'salud_escuela' :
        (t.elegido('Conjunto') || 'jornadas'));
    if (conjunto === 'salud_escuela') return {
      conjunto: conjunto,
      evento_id: enEvento ? t.origenPersona.id : (t.quien ? t.quien.evento_id || null : null),
      fecha: t.q('Fecha').value || null,
      item: null,
      nombre: t.q('Nombre').value.trim().replace(/\s+/g, ' '),
      edad_texto: t.q('Edad').value.trim() || null,
      sexo: t.elegido('Sexo') || null,
      cedula: null,
      telefono: t.q('Telefono').value.trim() || null,
      direccion: t.q('Direccion').value.trim() || null,
      tratamiento: t.q('Tratamiento').value.trim() || null,
      recipe: null,
      representante_nombre: t.q('RepNombre').value.trim().replace(/\s+/g, ' ') || null,
      representante_cedula: t.q('RepCedula').value.replace(/\D/g, '') || null,
      comuna: t.q('Comuna').value || null,
      comunidad: t.q('Comunidad').value || null,
      plantel: t.q('Plantel').value.trim() || null,
      seccion: t.q('Seccion').value.trim() || null
    };
    var recipeV = t.elegido('Recipe');
    return {
      conjunto: conjunto,
      evento_id: enEvento ? t.origenPersona.id : (t.quien ? (t.quien.evento_id || null) : null),
      fecha: t.q('Fecha').value || null,
      item: t.q('Item').value.trim() || null,
      nombre: t.q('Nombre').value.trim().replace(/\s+/g, ' '),
      edad_texto: t.q('Edad').value.trim() || null,
      sexo: t.elegido('Sexo') || null,
      cedula: t.q('Cedula').value.replace(/\D/g, '') || null,
      telefono: t.q('Telefono').value.trim() || null,
      direccion: t.q('Direccion').value.trim() || null,
      tratamiento: t.q('Tratamiento').value.trim() || null,
      recipe: recipeV === 'si' ? true : (recipeV === 'no' ? false : null)
    };
  };

  Jornadas.prototype.valida = function (d) {
    if (!d.nombre || d.nombre.length < 4) return 'Escribe el nombre y el apellido completos.';
    if (d.conjunto === 'salud_escuela') {
      if (!d.sexo) return 'Selecciona el sexo del niño o niña.';
      if (!/^\d{1,2}$/.test(d.edad_texto || '') || Number(d.edad_texto) > 25)
        return 'Indica la edad en años, entre 0 y 25.';
      if (!d.representante_nombre || d.representante_nombre.length < 4)
        return 'Escribe el nombre completo del representante.';
      if (!/^\d{6,9}$/.test(d.representante_cedula || ''))
        return 'La cédula del representante debe tener entre 6 y 9 números.';
      if (!d.telefono || d.telefono.replace(/\D/g, '').length < 10)
        return 'Escribe el teléfono del representante con al menos 10 números.';
      if (!d.direccion || d.direccion.length < 5) return 'Escribe la dirección del niño o niña.';
      if (!d.comuna) return 'Selecciona la comuna.';
      if (!d.comunidad) return 'Selecciona la comunidad.';
      if (!d.plantel || d.plantel.length < 3) return 'Escribe el nombre del plantel.';
      if (!d.seccion) return 'Escribe la sección.';
    }
    if (d.cedula && !/^\d{6,9}$/.test(d.cedula)) return 'La cédula debe tener entre 6 y 9 números.';
    if (d.fecha && d.fecha > hoyEs()) return 'La fecha no puede ser futura.';
    return null;
  };

  Jornadas.prototype.guardarPersona = function (idExistente) {
    var t = this;
    var d = t.leerCamposPersona();
    var mal = t.valida(d);
    if (mal) { t.aviso('warn', mal); return; }
    var tratamiento = window.FARM && window.FARM.piezasTratamientoCant
      ? window.FARM.piezasTratamientoCant(d.tratamiento) : [];
    var sinCantidad = tratamiento.filter(function (m) { return !m.anotada || !(Number(m.cantidad) > 0); });
    var tratamientoCambio = !idExistente || !t.quien ||
      String(d.tratamiento || '') !== String(t.quien.tratamiento || '');
    if (sinCantidad.length && tratamientoCambio) {
      t.aviso('warn', 'Indica cuántas unidades se entregaron de cada producto. Falta la cantidad de: ' +
        sinCantidad.map(function (m) { return m.nombre; }).join(', ') + '.');
      return;
    }

    var motivos = [];
    if (!d.cedula && d.conjunto !== 'salud_escuela') motivos.push('cedula vacia');
    if (!d.sexo) motivos.push('sexo vacio');
    d.estado = motivos.length ? 'por_revisar' : 'activo';
    d.motivo_revision = motivos.length ? motivos.join(' | ') + ' (cargado desde la página, no del excel)' : null;

    var btn = t.q('Guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    var accion = idExistente
      ? t.sb.from('jornadas_registros').update(d).eq('id', idExistente).select().single()
      : t.sb.from('jornadas_registros').insert(d).select().single();

    accion.then(function (r) {
      if (t.q('Guardar')) { btn.disabled = false; btn.textContent = idExistente ? 'Guardar los cambios' : 'Registrar'; }
      if (r.error) { t.aviso('bad', 'No se pudo guardar: ' + esc(r.error.message)); return; }
      var msg = d.nombre + (idExistente ? ' quedó corregida.' : ' quedó registrada.');
      t.modo = 'lista';
      if (t.origenPersona && t.origenPersona.tipo === 'evento') t.modoEv = 'detalle';
      t.quien = null;
      t.pintar();
      t.aviso('ok', msg);
    });
  };

  Jornadas.prototype.borrarPersona = function (id) {
    var t = this;
    if (!window.confirm('¿Borrar este registro? No se puede deshacer.')) return;
    var volverAEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    t.sb.from('jornadas_registros').delete().eq('id', id).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo borrar: ' + esc(r.error.message)); return; }
      t.modo = 'lista';
      if (volverAEvento) t.modoEv = 'detalle';
      t.quien = null;
      t.pintar();
      t.aviso('ok', 'Se borró el registro.');
    });
  };

  // Se expone para las pruebas unitarias: es lógica pura, sin DOM.
  window.JORNADAS_CALCULAR_CIFRAS = calcularCifrasEvento;
  window.JORNADAS_PREPARAR_INFORME = prepararInformeEvento;
  window.JORNADAS_RESUMIR_TERRITORIO = resumirTerritorioEventos;

  window.PANTALLA_JORNADAS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Jornadas(cliente, contenedor, o.prefijo || 'jo');
    t.pintar();
    return t;
  };
})();
