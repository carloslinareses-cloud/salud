/* JORNADAS: las jornadas de salud y la ruta materna, como EVENTOS.

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

  var CONJUNTOS = { jornadas: 'Jornada de salud', ruta_materna: 'Ruta materna' };

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

  /* Los tres totales de una jornada, calculados a partir de su gente
     -nunca escritos a mano-. Es lógica pura (sin DOM, sin red) para
     poder probarla con datos inventados: recibe la lista de personas
     ya cargadas y la FARM real, y devuelve pacientes/récipes/el
     detalle de medicamentos, ordenado de más a menos. */
  function calcularCifrasEvento(FARM, personas) {
    var totalMeds = 0, recipes = 0, meds = {}, ordenMeds = [];
    (personas || []).forEach(function (p) {
      if (p.recipe) recipes++;
      piezasDeUno(FARM, p.tratamiento).forEach(function (m) {
        if (!(m in meds)) { meds[m] = 0; ordenMeds.push(m); }
        meds[m]++; totalMeds++;
      });
    });
    ordenMeds.sort(function (a, b) { return meds[b] - meds[a]; });
    return { pacientes: (personas || []).length, totalMedicamentos: totalMeds, recipes: recipes,
             meds: meds, ordenMeds: ordenMeds };
  }

  var CAMPOS = 'id,evento_id,conjunto,hoja_origen,item,fecha,nombre,edad_texto,sexo,cedula,' +
               'telefono,direccion,tratamiento,recipe,estado,motivo_revision';
  var CAMPOS_EVENTO = 'id,tipo,fecha,lugar,parroquia,dietista,autoridad_salud,trabajador_social,' +
                      'firmas,creado_por_nombre,creado_en';
  var CAMPOS_EVENTO_LISTA = CAMPOS_EVENTO + ',pacientes,recipes';

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
      '<div class="filtros">' +
        '<input id="' + i('EvBusca') + '" type="search" placeholder="Buscar por lugar o parroquia…" ' +
          'value="' + esc(t.buscaEv) + '">' +
        '<select id="' + i('EvTipoF') + '">' +
          '<option value="todos">Todos los tipos</option>' +
          '<option value="jornadas"' + (t.tipoEv === 'jornadas' ? ' selected' : '') + '>Jornada de salud</option>' +
          '<option value="ruta_materna"' + (t.tipoEv === 'ruta_materna' ? ' selected' : '') + '>Ruta materna</option>' +
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

    var qy = t.sb.from('v_jornadas_eventos').select(CAMPOS_EVENTO_LISTA, { count: 'exact' });
    if (t.buscaEv) {
      var b = t.buscaEv.replace(/[%_]/g, '\\$&');
      qy = qy.or('lugar.ilike.%' + b + '%,parroquia.ilike.%' + b + '%');
    }
    if (t.tipoEv !== 'todos') qy = qy.eq('tipo', t.tipoEv);
    qy = qy.order('fecha', { ascending: false }).range(t.paginaEv * POR_PAGINA, t.paginaEv * POR_PAGINA + POR_PAGINA - 1);

    qy.then(function (r) {
      if (pedido !== t.pedidoEv || !t.q('EvRes')) return;
      if (r.error) { z.innerHTML = '<div class="aviso bad">No se pudo buscar: ' + esc(r.error.message) + '</div>'; return; }
      t.eventos = r.data || []; t.totalEv = r.count || 0;
      t.pintarEventosLista();
    });
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
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('EvFecha') + '">Fecha</label>' +
          '<input id="' + i('EvFecha') + '" type="date" value="' + esc(hoyEs()) + '"></div>' +
        '<div><label for="' + i('EvParroquia') + '">Parroquia <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('EvParroquia') + '" type="text" autocomplete="off"></div>' +
      '</div>' +

      '<label for="' + i('EvLugar') + '">Lugar <span class="opc">(CDI, ambulatorio, comunidad…)</span></label>' +
      '<input id="' + i('EvLugar') + '" type="text" autocomplete="off" placeholder="Ej: CDI de Las Brisas">' +

      '<h3 class="sub-t">Equipo responsable <span class="opc">(opcional)</span></h3>' +
      '<label for="' + i('EvDietista') + '">Dietista</label>' +
      '<input id="' + i('EvDietista') + '" type="text" autocomplete="off">' +
      '<label for="' + i('EvAutoridad') + '">Autoridad Única de Salud</label>' +
      '<input id="' + i('EvAutoridad') + '" type="text" autocomplete="off">' +
      '<label for="' + i('EvTrabajador') + '">Trabajador Social</label>' +
      '<input id="' + i('EvTrabajador') + '" type="text" autocomplete="off">' +

      '<h3 class="sub-t">Quiénes firmaron <span class="opc">(opcional)</span></h3>' +
      '<div class="dos-columnas">' +
        '<input id="' + i('EvFirmaTxt') + '" type="text" autocomplete="off" placeholder="Nombre de quien firmó">' +
        '<button type="button" class="secundario" id="' + i('EvFirmaAgregar') + '">Agregar</button>' +
      '</div>' +
      '<div class="chips" id="' + i('EvFirmas') + '"></div>' +

      '<div class="pie-form">' +
        '<button type="button" class="principal" id="' + i('EvGuardar') + '">Crear la jornada</button>' +
      '</div>';

    t.q('EvFTipo').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.q('EvFTipo').querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
        b.classList.add('on');
      });
    });

    t.pintarFirmasForm();
    t.q('EvFirmaAgregar').addEventListener('click', function () { t.agregarFirmaForm(); });
    t.q('EvFirmaTxt').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); t.agregarFirmaForm(); }
    });

    t.q('EvVolver').addEventListener('click', function () { t.modoEv = 'lista'; t.pintar(); });
    t.q('EvGuardar').addEventListener('click', function () { t.guardarEvento(); });
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
      parroquia: t.q('EvParroquia').value.trim() || null,
      dietista: t.q('EvDietista').value.trim() || null,
      autoridad_salud: t.q('EvAutoridad').value.trim() || null,
      trabajador_social: t.q('EvTrabajador').value.trim() || null,
      firmas: t.firmasForm.slice()
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

    t.sb.from('jornadas_registros')
      .select('id,nombre,cedula,edad_texto,sexo,telefono,tratamiento,recipe,item')
      .eq('evento_id', ev.id)
      .order('nombre')
      .then(function (r) {
        if (!t.q('Zona')) return;
        if (r.error) {
          z.innerHTML = '<div class="aviso bad">No se pudo cargar: ' + esc(r.error.message) + '</div>';
          return;
        }
        var personas = r.data || [];
        t.personasEvento = personas;

        var cifras = calcularCifrasEvento(window.FARM, personas);
        var totalMeds = cifras.totalMedicamentos, recipes = cifras.recipes,
            meds = cifras.meds, ordenMeds = cifras.ordenMeds;

        var equipo = [];
        if (ev.dietista) equipo.push({ rotulo: 'Dietista', nombre: ev.dietista });
        if (ev.autoridad_salud) equipo.push({ rotulo: 'Autoridad Única de Salud', nombre: ev.autoridad_salud });
        if (ev.trabajador_social) equipo.push({ rotulo: 'Trabajador Social', nombre: ev.trabajador_social });

        z.innerHTML =
          '<button type="button" class="volver" id="' + i('DetVolver') + '">← Volver a las jornadas</button>' +
          '<div class="cabecera-prod">' +
            '<h2>' + esc(ev.lugar) + '</h2>' +
            '<button type="button" class="principal" id="' + i('DetAgregar') + '">+ Agregar persona</button>' +
          '</div>' +
          '<p class="sub">' + [corta(ev.fecha), CONJUNTOS[ev.tipo] || ev.tipo,
            ev.parroquia ? 'Parroquia ' + ev.parroquia : null].filter(Boolean).map(esc).join(' · ') + '</p>' +

          (equipo.length ? '<div class="renglones">' + equipo.map(function (q) {
            return '<div class="renglon"><div class="que"><b>' + esc(q.rotulo) + '</b>' +
              '<span>' + esc(q.nombre) + '</span></div></div>';
          }).join('') + '</div>' : '') +
          (ev.firmas && ev.firmas.length
            ? '<p class="sub chico">Firmaron: ' + ev.firmas.map(esc).join(', ') + '</p>' : '') +

          '<div class="cifras">' +
            cif(personas.length, personas.length === 1 ? 'paciente atendido' : 'pacientes atendidos') +
            cif(totalMeds, totalMeds === 1 ? 'medicamento entregado' : 'medicamentos entregados') +
            cif(recipes, recipes === 1 ? 'con récipe' : 'con récipes') +
          '</div>' +

          (ordenMeds.length
            ? '<p class="sub chico">Detalle de lo entregado</p>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Medicamento</th><th class="der">Veces</th></tr></thead><tbody>' +
              ordenMeds.map(function (m) { return '<tr><td>' + esc(m) + '</td><td class="der num">' + meds[m] + '</td></tr>'; }).join('') +
              '</tbody></table></div>'
            : '') +

          '<h2 class="sub-t">Personas atendidas</h2>' +
          (personas.length
            ? '<div class="fichas">' + personas.map(function (p) {
                var datos = [];
                datos.push(p.cedula ? 'C.I. ' + p.cedula : 'Sin cédula');
                if (p.edad_texto) datos.push(p.edad_texto);
                if (p.sexo) datos.push(p.sexo === 'F' ? 'Femenino' : 'Masculino');
                return '<button type="button" class="ficha" data-id="' + esc(p.id) + '">' +
                  '<div class="ficha-nom"><b>' + esc(p.nombre) + '</b>' +
                    '<span class="ficha-pres">' + esc(datos.join(' · ')) + '</span>' +
                  '</div>' +
                  '<div class="ficha-datos">' +
                    '<span class="ficha-lotes">' + esc(p.tratamiento || 'Sin tratamiento anotado') + '</span>' +
                    (p.recipe ? '<span class="ficha-vence">Con récipe</span>' : '') +
                  '</div>' +
                '</button>';
              }).join('') + '</div>'
            : '<div class="vacio">Todavía no has cargado a nadie en esta jornada.</div>');

        t.q('DetVolver').addEventListener('click', function () { t.modoEv = 'lista'; t.pintar(); });
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
        'item.ilike.%' + b + '%'
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
        quien.push(f.cedula ? 'C.I. ' + f.cedula : 'Sin cédula');
        if (f.edad_texto) quien.push(f.edad_texto);
        if (f.sexo) quien.push(f.sexo === 'F' ? 'Femenino' : 'Masculino');

        var contacto = [];
        if (f.telefono) contacto.push(f.telefono);
        if (f.direccion) contacto.push(f.direccion);

        var cuando = [corta(f.fecha), CONJUNTOS[f.conjunto] || f.conjunto];
        if (f.hoja_origen) cuando.push(HOJAS_TXT[f.hoja_origen] || f.hoja_origen);

        return '<button type="button" class="ficha" data-id="' + esc(f.id) + '">' +
          '<div class="ficha-nom">' +
            '<b>' + esc(f.nombre) + '</b>' +
            '<span class="ficha-pres">' + esc(quien.join(' · ')) + '</span>' +
            (contacto.length ? '<span class="ficha-pres">' + esc(contacto.join(' · ')) + '</span>' : '') +
            (f.item ? '<span class="ficha-pres">' + esc(f.item) + '</span>' : '') +
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
  Jornadas.prototype.verFormularioPersona = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    x = x || {};
    var enEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    var conj = enEvento ? t.eventoActual.tipo : (x.conjunto || 'jornadas');

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

      '<label for="' + i('Tratamiento') + '">Tratamiento <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Tratamiento') + '" type="text" autocomplete="off" value="' + esc(x.tratamiento || '') + '">' +

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
  };

  Jornadas.prototype.elegido = function (g) {
    var z = this.q(g);
    var b = z && z.querySelector('button.on');
    return b ? b.dataset.v : '';
  };

  Jornadas.prototype.leerCamposPersona = function () {
    var t = this;
    var enEvento = t.origenPersona && t.origenPersona.tipo === 'evento';
    var recipeV = t.elegido('Recipe');
    return {
      conjunto: enEvento ? t.eventoActual.tipo : (t.elegido('Conjunto') || 'jornadas'),
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
    if (d.cedula && !/^\d{6,9}$/.test(d.cedula)) return 'La cédula debe tener entre 6 y 9 números.';
    if (d.fecha && d.fecha > hoyEs()) return 'La fecha no puede ser futura.';
    return null;
  };

  Jornadas.prototype.guardarPersona = function (idExistente) {
    var t = this;
    var d = t.leerCamposPersona();
    var mal = t.valida(d);
    if (mal) { t.aviso('warn', mal); return; }

    var motivos = [];
    if (!d.cedula) motivos.push('cedula vacia');
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

  window.PANTALLA_JORNADAS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Jornadas(cliente, contenedor, o.prefijo || 'jo');
    t.pintar();
    return t;
  };
})();
