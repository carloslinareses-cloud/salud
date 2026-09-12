/* PERSONAS: la ficha de cada quien, con sus patologías y sus medicinas.

   Está en Mercancía, al lado de lo demás que se carga a mano, porque es
   trabajo de la misma clase: sentarse a pasar la gente del cuaderno al
   sistema. Entregar sigue teniendo su atajo para registrar a alguien en
   el momento; esto es para hacerlo en serio, con todos los datos.

   Tres pantallas:
     · Lista   — buscar y ver a todo el mundo, con lo que tiene anotado.
     · Ficha   — abrir a una persona y corregirle todo: sus datos, sus
                 patologías y las medicinas que necesita.
     · Nueva   — registrarla desde cero, con la consulta al registro
                 electoral para no teclear el nombre.

   Dos reglas que se respetan aquí:

     · No se inventa nada de nadie. Del registro electoral se toman solo
       el nombre y la fecha de nacimiento. El sexo no se deduce del
       nombre: si no lo dice, dice "no lo dice".
     · Las patologías se eligen de una lista antes que escribirse libres,
       porque "HIPERTENSION", "HTA" y "TENSION ALTA" son lo mismo y
       escritas de tres formas no hay manera de contarlas. */
(function () {
  'use strict';

  var POR_PAGINA = 20;

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
  function hoyEs() {
    return window.FARM && window.FARM.hoyCaracas
      ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10);
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }

  var CAMPOS = 'id,nombre,nacionalidad,cedula,cedula_cruda,rif_digito,sexo,fecha_nac,edad,' +
               'telefono,direccion,estado,motivo_revision,medicamentos,entregas,ultima_entrega,' +
               'patologias,n_patologias';

  /* ================================================================ */
  function Personas(sb, raiz, pfx) {
    this.sb = sb; this.raiz = raiz; this.pfx = pfx;
    this.modo = 'lista';          // lista | ficha | nueva
    this.busca = '';
    this.pagina = 0;
    this.total = 0;
    this.filas = [];
    this.pedido = 0;
    this.espera = null;
    this.quien = null;            // la persona abierta
    this.patologias = [];         // sus patologías, con id
    this.tratamiento = [];        // sus medicinas, con id
    this.pendientes = { pat: [], med: [] };   // lo anotado a alguien que aún no existe
    this.abierto = null;          // 'pat' | 'med' | null
  }

  Personas.prototype.id = function (n) { return this.pfx + n; };
  Personas.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };
  Personas.prototype.aviso = function (clase, txt) {
    var z = this.q('Aviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  Personas.prototype.limpiaAviso = function () {
    var z = this.q('Aviso'); if (z) z.innerHTML = '';
  };

  Personas.prototype.pintar = function () {
    var t = this;
    t.raiz.innerHTML = '<div id="' + t.id('Zona') + '"></div><div id="' + t.id('Aviso') + '"></div>';
    if (t.modo === 'lista') t.verLista();
    else if (t.modo === 'nueva') t.verFormulario(null);
    else t.verFicha();
  };

  /* ================================================================
     LISTA
  ================================================================ */
  Personas.prototype.verLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    z.innerHTML =
      '<h2 class="sub-t">Personas</h2>' +
      '<p class="sub">Aquí se registra a la gente con todos sus datos: sus patologías y ' +
      'las medicinas que necesita. Lo que se anote sale solo cuando se le vaya a entregar.</p>' +
      '<div class="busca-fila">' +
        '<div class="busca-campo">' +
          '<label for="' + i('Busca') + '">Buscar</label>' +
          '<input id="' + i('Busca') + '" type="search" autocomplete="off" ' +
            'placeholder="Cédula, nombre o patología…" value="' + esc(t.busca) + '">' +
        '</div>' +
        '<button type="button" class="secundario" id="' + i('Nueva') + '">+ Registrar persona</button>' +
      '</div>' +
      '<div id="' + i('Res') + '"><div class="cargando">Cargando…</div></div>';

    var caja = t.q('Busca');
    caja.addEventListener('input', retardo(function () {
      t.busca = caja.value.trim(); t.pagina = 0; t.cargarLista();
    }, 300));
    t.q('Nueva').addEventListener('click', function () {
      t.modo = 'nueva'; t.pendientes = { pat: [], med: [] }; t.abierto = null; t.pintar();
    });
    t.cargarLista();
  };

  Personas.prototype.cargarLista = function () {
    var t = this;
    var mio = ++t.pedido;
    var z = t.q('Res');
    if (!z) return;
    z.innerHTML = '<div class="cargando">Cargando…</div>';

    var q = t.busca.replace(/[%,()]/g, '');
    var c = t.sb.from('v_pacientes_ficha').select(CAMPOS, { count: 'exact' });
    if (q) {
      var sinAc = window.FARM ? window.FARM.sinAcentos(q).toUpperCase() : q.toUpperCase();
      c = c.or('cedula.ilike.*' + q + '*,busqueda.ilike.*' + sinAc + '*,patologias.ilike.*' + sinAc + '*');
    }
    c.order('nombre').range(t.pagina * POR_PAGINA, t.pagina * POR_PAGINA + POR_PAGINA - 1)
      .then(function (r) {
        if (mio !== t.pedido || !t.q('Res')) return;
        if (r.error) {
          t.q('Res').innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>';
          return;
        }
        t.filas = r.data || [];
        t.total = r.count == null ? t.filas.length : r.count;
        t.pintarLista();
      });
  };

  Personas.prototype.pintarLista = function () {
    var t = this;
    var z = t.q('Res');
    if (!z) return;
    if (!t.filas.length) {
      z.innerHTML = '<div class="vacio"><b>' +
        (t.busca ? 'No hay nadie con «' + esc(t.busca) + '»' : 'Todavía no hay nadie registrado') +
        '</b><span>Se puede registrar con el botón de arriba.</span></div>';
      return;
    }
    var paginas = Math.max(1, Math.ceil(t.total / POR_PAGINA));
    z.innerHTML =
      '<p class="conteo">' + num(t.total) + (t.total === 1 ? ' persona' : ' personas') +
        (paginas > 1 ? ' · página ' + (t.pagina + 1) + ' de ' + paginas : '') + '</p>' +
      '<div class="fichas">' + t.filas.map(function (x, n) {
        var ced = x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula
                           : (x.cedula_cruda || 'sin cédula');
        var datos = [];
        if (x.edad != null) datos.push(x.edad + ' años');
        if (x.telefono) datos.push(x.telefono);
        return '<button type="button" class="ficha" data-p="' + n + '">' +
          '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
            '<span class="ficha-pres">' + esc(ced) + (datos.length ? ' · ' + esc(datos.join(' · ')) : '') + '</span>' +
            (x.patologias ? '<span class="ficha-pat">' + esc(x.patologias) + '</span>' : '') +
          '</div>' +
          '<div class="ficha-datos">' +
            '<span class="ficha-lotes">' + x.medicamentos +
              (x.medicamentos === 1 ? ' medicina' : ' medicinas') + '</span>' +
            '<span class="ficha-vence">' + x.entregas +
              (x.entregas === 1 ? ' entrega' : ' entregas') + '</span>' +
          '</div>' +
          (x.estado === 'por_revisar' ? '<span class="sit ojo">Por revisar</span>' : '') +
        '</button>';
      }).join('') + '</div>' +
      (paginas > 1
        ? '<div class="paginador">' +
            '<button type="button" data-pag="-1"' + (t.pagina === 0 ? ' disabled' : '') + '>Anteriores</button>' +
            '<span>' + (t.pagina * POR_PAGINA + 1) + '–' +
              Math.min(t.total, (t.pagina + 1) * POR_PAGINA) + ' de ' + num(t.total) + '</span>' +
            '<button type="button" data-pag="1"' + (t.pagina >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
          '</div>'
        : '');

    z.querySelectorAll('[data-p]').forEach(function (b) {
      b.addEventListener('click', function () { t.abrir(t.filas[+b.dataset.p]); });
    });
    z.querySelectorAll('[data-pag]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.pagina += Number(b.dataset.pag); t.cargarLista();
      });
    });
  };

  /* ================================================================
     FICHA DE UNA PERSONA
  ================================================================ */
  Personas.prototype.abrir = function (x) {
    var t = this;
    t.quien = x; t.modo = 'ficha'; t.abierto = null;
    t.patologias = null; t.tratamiento = null;   // nulo = todavía no se sabe
    t.historial = null; t.histTodo = false; t.falloHist = null;
    t.pintar();
    t.cargarAnexos();
  };

  Personas.prototype.cargarAnexos = function () {
    var t = this;
    var pid = t.quien.id;
    Promise.all([
      t.sb.from('patologias_paciente').select('id,patologia,nota')
        .eq('paciente_id', pid).eq('activo', true).order('patologia'),
      t.sb.from('v_tratamiento_paciente')
        .select('tratamiento_id,producto_id,producto,dosificacion,texto_original,' +
                'disponible,situacion,origen')
        .eq('paciente_id', pid),
      /* Lo que ya se le entregó, con día, hora y quién. Viene una fila
         por medicamento; se juntan por entrega más abajo. */
      t.sb.from('v_entregas_renglon')
        .select('entrega_id,fecha,creado_en,origen,anulada,anulada_motivo,' +
                'entregado_por,lo_entregado,renglon_id,producto,dosificacion,' +
                'presentacion,cantidad,en_cajas,lote,vence')
        .eq('paciente_id', pid)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false, nullsFirst: false })
        .order('entrega_id')
        .limit(HIST_TOPE)
    ]).then(function (r) {
      if (!t.quien || t.quien.id !== pid || t.modo !== 'ficha') return;
      /* Un error NO significa que la persona no tenga nada: significa que
         no se pudo preguntar. Sobre una ficha de salud la diferencia
         importa, así que se dice. */
      t.patologias = r[0].error ? null : (r[0].data || []);
      t.tratamiento = r[1].error ? null : (r[1].data || []);
      var fh = r[2].data || [];
      t.historial = r[2].error
        ? null
        : window.FARM.agrupaEntregas(fh, fh.length >= HIST_TOPE);
      /* El fallo del historial va aparte: si se mezclara con el de
         las patologías, corregir una medicina lo borraría y el bloque
         se quedaría diciendo "Buscando" para siempre. */
      t.falloHist = r[2].error ? r[2].error.message : null;
      t.falloAnexos = (r[0].error || r[1].error || {}).message || null;
      t.pintarFicha();
    });
  };

  Personas.prototype.verFicha = function () { this.pintarFicha(); };

  Personas.prototype.pintarFicha = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    if (!z) return;
    var x = t.quien;
    var ced = x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula
                       : (x.cedula_cruda || 'sin cédula');

    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
        '<div class="prod-nom"><b>' + esc(x.nombre) + '</b>' +
          '<span>' + esc(ced) + (x.edad != null ? ' · ' + x.edad + ' años' : '') + '</span></div>' +
        '<div class="prod-cifras">' +
          '<span><b>' + x.entregas + '</b> ' + (x.entregas === 1 ? 'entrega' : 'entregas') + '</span>' +
          (x.ultima_entrega ? '<span>última: <b>' + corta(x.ultima_entrega) + '</b></span>' : '') +
        '</div>' +
      '</div>' +

      t.bloquePatologias() +
      t.bloqueMedicinas() +
      t.bloqueHistorial() +

      '<h3 class="sub-t">Sus datos</h3>' +
      t.camposPersona(x) +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="' + i('Guardar') + '">Guardar los cambios</button>' +
      '</div>';

    t.q('Volver').addEventListener('click', function () {
      t.modo = 'lista'; t.quien = null; t.abierto = null; t.limpiaAviso(); t.pintar();
    });
    t.engancharCampos();
    t.q('Guardar').addEventListener('click', function () { t.guardarDatos(); });
    t.engancharAnexos();
  };

  /* ---------------------------------------------------------------- historial

     LO QUE YA SE LE ENTREGO, visita por visita.

     La misma informacion que sale en Entregar, pero aqui sin recortar:
     esta es la ficha, el sitio donde alguien se sienta a revisar el caso
     completo. Dia, hora, quien atendio y que se llevo.

     Las entregas viejas del cuaderno no tienen renglones ni hora: solo
     el texto de lo que se anoto. Salen igual y se dice de donde vienen,
     porque esconderlas seria dar por no atendida una visita que si paso.
  */
  var HIST_PRIMERAS = 5;
  /* Cuantos renglones se piden. Si se llega al tope, la ultima entrega
     puede venir a medias: agrupaEntregas la descarta. */
  var HIST_TOPE = 600;

  Personas.prototype.lineaHistorial = function (y) {
    var nom = [y.producto, y.dosificacion].filter(Boolean).join(' ');
    return '<li>' + esc(nom || 'sin nombre') +
      (y.cantidad == null
        ? ' <em>no consta la cantidad</em>'
        : ' <b>' + Math.round(y.cantidad) + '</b>' +
          (y.en_cajas ? ' <em>' + esc(y.en_cajas) + '</em>' : '')) +
      (y.lote ? ' <em>lote ' + esc(y.lote) + '</em>' : '') +
    '</li>';
  };

  Personas.prototype.tarjetaHistorial = function (e) {
    var t = this;
    var hora = window.FARM.horaCaracas(e.creado_en);
    /* Las del cuaderno traen la hora en que se CARGARON, no en la que se
       entregaron: mostrarla seria inventar un dato. */
    var conHora = e.origen === 'sistema' && hora;

    return '<li class="hist-item' + (e.anulada ? ' hist-anulada' : '') + '">' +
      '<div class="hist-cab">' +
        '<b>' + corta(e.fecha) + (conHora ? ' · ' + esc(hora) : '') + '</b>' +
        (e.anulada ? '<span class="sit mal">ANULADA</span>' : '') +
      '</div>' +
      '<span class="hist-quien">Entregó: ' + esc(e.entregado_por || 'no consta') +
        (e.origen === 'sistema' ? '' : ' · viene del cuaderno') + '</span>' +
      (e.renglones.length
        ? '<ul class="hist-meds">' + e.renglones.map(function (y) {
            return t.lineaHistorial(y);
          }).join('') + '</ul>'
        : (e.lo_entregado
            ? '<p class="hist-texto">' + esc(e.lo_entregado) + '</p>' +
              '<span class="hist-nota">Del cuaderno: no anotaba la cantidad.</span>'
            : '<span class="hist-nota">No quedó anotado qué se entregó.</span>')) +
      (e.anulada && e.anulada_motivo
        ? '<span class="hist-nota">Motivo de la anulación: ' + esc(e.anulada_motivo) + '</span>'
        : '') +
    '</li>';
  };

  Personas.prototype.bloqueHistorial = function () {
    var t = this, i = function (n) { return t.id(n); };
    var h = t.historial;
    var TIT = '<h3 class="sub-t">Lo que ya se le ha entregado</h3>';

    if (h === null && !t.falloHist) return TIT + '<div class="cargando">Buscando…</div>';
    if (h === null) return TIT +
      '<div class="aviso bad">No se pudo leer su historial. No quiere decir que no se le ' +
      'haya entregado nada. Vuelve a abrir su ficha.</div>';
    if (!h.length) return TIT +
      '<p class="sub chico">No hay ninguna entrega registrada todavía.</p>';

    var ver = t.histTodo ? h : h.slice(0, HIST_PRIMERAS);
    var quedan = h.length - ver.length;
    /* Las anuladas se ven, pero contarlas junto a las buenas diría que
       se le entregó algo que no se le entregó. Van dichas aparte. */
    var anul = h.filter(function (e) { return e.anulada; }).length;

    return TIT +
      '<p class="sub">' + h.length + (h.length === 1 ? ' entrega' : ' entregas') +
        (anul ? ', ' + anul + (anul === 1 ? ' anulada' : ' anuladas') : '') +
        ', de la más reciente a la más vieja.</p>' +
      '<ul class="hist">' + ver.map(function (e) { return t.tarjetaHistorial(e); }).join('') + '</ul>' +
      (quedan > 0
        ? '<button type="button" class="trat-mas" id="' + i('HistMas') + '">' +
          (quedan === 1 ? 'Ver la anterior' : 'Ver las ' + quedan + ' anteriores') +
          '</button>'
        : (t.histTodo && h.length > HIST_PRIMERAS
            ? '<button type="button" class="trat-mas" id="' + i('HistMas') +
              '">Ver solo las últimas ' + HIST_PRIMERAS + '</button>'
            : ''));
  };

  /* ---------------------------------------------------------------- patologías */
  Personas.prototype.bloquePatologias = function () {
    var t = this, i = function (n) { return t.id(n); };
    var p = t.patologias;

    if (p === undefined || p === null && !t.falloAnexos) {
      return '<div class="trat"><span class="lbl">Sus patologías</span>' +
             '<span class="sub chico">Buscando…</span></div>';
    }
    if (p === null) {
      return '<div class="trat"><span class="lbl">Sus patologías</span>' +
        '<div class="aviso bad">No se pudieron leer' +
        (t.falloAnexos ? ': ' + esc(t.falloAnexos) : '') +
        '. No quiere decir que no tenga ninguna. Vuelve a abrir su ficha.</div></div>';
    }

    return '<div class="trat">' +
      '<span class="lbl">' + (p.length
        ? 'Sus patologías · ' + p.length
        : 'Sus patologías') + '</span>' +
      (p.length
        ? '<div class="trat-lista">' + p.map(function (d) {
            return '<span class="trat-par">' +
              '<span class="trat-texto del-catalogo">' + esc(d.patologia) + '</span>' +
              '<button type="button" class="trat-quita" data-quitapat="' + esc(d.id) + '" ' +
              'aria-label="Quitar ' + esc(d.patologia) + '">&#10005;</button></span>';
          }).join('') + '</div>'
        : '<span class="sub chico">Todavía no tiene ninguna anotada.</span>') +
      (t.abierto === 'pat'
        ? window.FARMPICK.caja(i('Pat'), 'Buscar la patología',
            'Escribe para buscar o para anotarla tal cual…', '')
        : '<button type="button" class="trat-mas" id="' + i('MasPat') + '">+ Anotar una patología</button>') +
    '</div>';
  };

  /* ---------------------------------------------------------------- medicinas */
  Personas.prototype.bloqueMedicinas = function () {
    var t = this, i = function (n) { return t.id(n); };
    var m = t.tratamiento;

    if (m === undefined || m === null && !t.falloAnexos) {
      return '<div class="trat"><span class="lbl">Medicinas que necesita</span>' +
             '<span class="sub chico">Buscando…</span></div>';
    }
    if (m === null) {
      return '<div class="trat"><span class="lbl">Medicinas que necesita</span>' +
        '<div class="aviso bad">No se pudieron leer. No quiere decir que no tome ' +
        'ninguna. Vuelve a abrir su ficha.</div></div>';
    }

    /* UNA sola lista: da igual si el renglon esta enlazado al catalogo o
       escrito a mano. Cada uno se corrige y se quita ahi mismo. */
    var lista = m.filter(function (y) { return y.producto_id || y.texto_original; });

    return '<div class="trat">' +
      '<span class="lbl">' + (lista.length
        ? 'Medicinas que necesita · ' + lista.length
        : 'Medicinas que necesita') + '</span>' +
      (lista.length === 0
        ? '<span class="sub chico">Todavía no tiene ninguna anotada.</span>'
        : '<div class="trat-lista">' + lista.map(function (y) {
            var hay = Math.round(Number(y.disponible) || 0);
            var nom = y.producto || y.texto_original;
            return '<span class="trat-par">' +
              '<span class="trat-texto' + (y.producto_id ? ' del-catalogo' : '') + '">' +
                esc(nom) +
                (y.dosificacion ? ' <em>' + esc(y.dosificacion) + '</em>' : '') +
                ' <em' + (y.situacion === 'solo_vencido' ? ' class="mal"' : '') + '>' +
                  (y.producto_id
                    ? (hay > 0 ? hay + (hay === 1 ? ' disponible' : ' disponibles')
                               : (y.situacion === 'solo_vencido' ? 'solo vencido'
                                                                 : 'sin existencia'))
                    : 'no está en el catálogo') + '</em></span>' +
              '<button type="button" class="trat-edita" data-editamed="' + esc(y.tratamiento_id) + '" ' +
                'data-texto="' + esc(nom) + '" ' +
                'aria-label="Corregir ' + esc(nom) + '" title="Corregir">&#9998;&#65038;</button>' +
              '<button type="button" class="trat-quita" data-quitamed="' + esc(y.tratamiento_id) + '" ' +
                'aria-label="Quitar ' + esc(nom) + '" title="Quitar">&#10005;</button>' +
            '</span>';
          }).join('') + '</div>') +
      (t.abierto === 'med'
        ? window.FARMPICK.caja(i('Med'), 'Buscar la medicina',
            'Escribe el nombre del medicamento…', '')
        : '<button type="button" class="trat-mas" id="' + i('MasMed') + '">+ Anotar una medicina</button>') +
    '</div>';
  };

  /* Corregir un renglon. Si coincide con un medicamento del catalogo queda
     enlazado a el; si no, queda como texto, tal cual se escribio. */
  Personas.prototype.corregirMedicina = function (id, actual) {
    var t = this, pid = t.quien.id;

    var mismos = (t.tratamiento || []).filter(function (y) {
      return String(y.tratamiento_id) === String(id);
    });
    if (mismos.length > 1) {
      t.aviso('warn', 'Este renglón trae ' + mismos.length + ' medicinas escritas juntas (' +
        mismos.map(function (y) { return y.producto || y.texto_original; }).join(', ') +
        '). Quítalo y anótalas por separado, así cada una se puede entregar sola.');
      return;
    }

    var nuevo = window.prompt('Corrige el nombre del medicamento:', actual || '');
    if (nuevo == null) return;
    nuevo = nuevo.replace(/\s+/g, ' ').trim();
    if (nuevo.length < 3) { t.aviso('warn', 'Escribe al menos tres letras.'); return; }
    if (window.FARMPICK.mismo(nuevo, actual)) return;

    if ((t.tratamiento || []).some(function (y) {
      return String(y.tratamiento_id) !== String(id) &&
             window.FARMPICK.mismo(y.producto || y.texto_original, nuevo);
    })) { t.aviso('warn', nuevo + ' ya está en su tratamiento.'); return; }

    t.sb.from('v_catalogo').select('producto_id,producto').ilike('producto', nuevo).limit(5)
      .then(function (r) {
        var enCat = (r.data || []).filter(function (c) {
          return window.FARMPICK.mismo(c.producto, nuevo);
        })[0];
        var cambio = enCat
          ? { producto_id: enCat.producto_id, texto_original: null }
          : { producto_id: null, texto_original: nuevo };
        return t.sb.from('tratamientos_paciente').update(cambio).eq('id', id)
          .then(function (u) {
            if (u.error) { t.aviso('bad', 'No se pudo corregir: ' + u.error.message); return; }
            if (!t.quien || t.quien.id !== pid) return;
            t.recargarAnexos(function () {
              t.aviso('ok', enCat
                ? 'Quedó como ' + enCat.producto + ', enlazado al catálogo.'
                : 'Quedó como «' + nuevo + '». No está en el catálogo todavía.');
            });
          });
      });
  };

  Personas.prototype.engancharAnexos = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    if (!z) return;

    var vh = t.q('HistMas');
    if (vh) vh.addEventListener('click', function () {
      t.histTodo = !t.histTodo; t.pintarFicha();
    });

    var mp = t.q('MasPat');
    if (mp) mp.addEventListener('click', function () {
      t.abierto = 'pat'; t.pintarFicha();
      var c = t.q('PatBusca'); if (c) c.focus();
    });
    var mm = t.q('MasMed');
    if (mm) mm.addEventListener('click', function () {
      t.abierto = 'med'; t.pintarFicha();
      var c = t.q('MedBusca'); if (c) c.focus();
    });

    if (t.abierto === 'pat') {
      window.FARMPICK.patologias(t.sb, i('Pat'), function (x) { t.anotarPatologia(x.patologia); });
    }
    if (t.abierto === 'med') {
      window.FARMPICK.medicinas(t.sb, i('Med'), function (x) { t.anotarMedicina(x); });
    }

    z.querySelectorAll('[data-quitapat]').forEach(function (b) {
      b.addEventListener('click', function () { t.quitarPatologia(b.dataset.quitapat); });
    });
    z.querySelectorAll('[data-quitamed]').forEach(function (b) {
      b.addEventListener('click', function () { t.quitarMedicina(b.dataset.quitamed); });
    });
    z.querySelectorAll('[data-editamed]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.corregirMedicina(b.dataset.editamed, b.dataset.texto);
      });
    });
  };

  Personas.prototype.anotarPatologia = function (txt) {
    var t = this, pid = t.quien.id;
    var ya = (t.patologias || []).some(function (d) {
      return window.FARMPICK.mismo(d.patologia, txt);
    });
    if (ya) { t.aviso('warn', txt + ' ya estaba anotada.'); return; }

    t.sb.from('patologias_paciente').insert({ paciente_id: pid, patologia: txt, activo: true })
      .then(function (r) {
        if (r.error) {
          t.aviso('bad', r.error.code === '23505'
            ? txt + ' ya estaba anotada.'
            : 'No se pudo anotar: ' + r.error.message);
          return;
        }
        t.recargarAnexos(function () { t.aviso('ok', txt + ' quedó anotada.'); });
      });
  };

  Personas.prototype.quitarPatologia = function (id) {
    var t = this, pid = t.quien.id;
    var d = (t.patologias || []).filter(function (y) { return String(y.id) === String(id); })[0];
    if (!window.confirm('¿Quitar ' + ((d && d.patologia) || 'esta patología') +
        ' de su ficha?\n\nQueda registrado con tu nombre y se puede volver a anotar.')) return;

    t.sb.from('patologias_paciente').update({ activo: false }).eq('id', id).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo quitar: ' + r.error.message); return; }
      if (!t.quien || t.quien.id !== pid) return;
      t.recargarAnexos(function () { t.aviso('ok', 'Se quitó de su ficha.'); });
    });
  };

  Personas.prototype.anotarMedicina = function (x) {
    var t = this, pid = t.quien.id;
    var ya = (t.tratamiento || []).some(function (y) {
      if (x.producto_id && y.producto_id) return y.producto_id === x.producto_id;
      return window.FARMPICK.mismo(y.producto || y.texto_original, x.producto || x.texto_original);
    });
    if (ya) { t.aviso('warn', x.producto + ' ya estaba anotada.'); return; }

    var fila = { paciente_id: pid, activo: true };
    if (x.producto_id) fila.producto_id = x.producto_id;
    else fila.texto_original = x.texto_original;

    t.sb.from('tratamientos_paciente').insert(fila).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo anotar: ' + r.error.message); return; }
      t.recargarAnexos(function () { t.aviso('ok', x.producto + ' quedó anotada.'); });
    });
  };

  Personas.prototype.quitarMedicina = function (id) {
    var t = this, pid = t.quien.id;
    /* Un renglón viejo puede traer varias medicinas en un mismo texto
       ("LOSARTAN/METFORMINA"): se ven separadas pero en la base son UNA
       fila, así que quitar una las quita todas. Se dice antes. */
    var mismos = (t.tratamiento || []).filter(function (y) {
      return String(y.tratamiento_id) === String(id);
    });
    var nombres = mismos.map(function (y) { return y.producto || y.texto_original; });
    var pregunta = mismos.length > 1
      ? '¿Quitar las ' + mismos.length + ' medicinas de este renglón?\n\n' + nombres.join('\n') +
        '\n\nVienen escritas juntas en el mismo renglón, así que salen todas.'
      : '¿Quitar ' + (nombres[0] || 'esta medicina') + ' de su ficha?';
    if (!window.confirm(pregunta)) return;

    t.sb.from('tratamientos_paciente').update({ activo: false }).eq('id', id).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo quitar: ' + r.error.message); return; }
      if (!t.quien || t.quien.id !== pid) return;
      t.recargarAnexos(function () {
        t.aviso('ok', mismos.length > 1
          ? 'Se quitaron ' + mismos.length + ' medicinas.'
          : 'Se quitó ' + (nombres[0] || 'la medicina') + '.');
      });
    });
  };

  Personas.prototype.recargarAnexos = function (luego) {
    var t = this, pid = t.quien.id;
    t.abierto = null;
    Promise.all([
      t.sb.from('patologias_paciente').select('id,patologia,nota')
        .eq('paciente_id', pid).eq('activo', true).order('patologia'),
      t.sb.from('v_tratamiento_paciente')
        .select('tratamiento_id,producto_id,producto,dosificacion,texto_original,' +
                'disponible,situacion,origen')
        .eq('paciente_id', pid)
    ]).then(function (r) {
      if (!t.quien || t.quien.id !== pid) return;
      if (r[0].error || r[1].error) {
        t.pintarFicha();
        t.aviso('bad', 'Se guardó, pero no se pudo volver a leer su ficha. Ábrela otra vez.');
        return;
      }
      t.patologias = r[0].data || [];
      t.tratamiento = r[1].data || [];
      t.falloAnexos = null;
      t.quien.n_patologias = t.patologias.length;
      t.quien.medicamentos = t.tratamiento.length;
      t.pintarFicha();
      if (luego) luego();
    });
  };

  /* ================================================================
     LOS CAMPOS DE LA PERSONA (los mismos al crear y al corregir)
  ================================================================ */
  Personas.prototype.camposPersona = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    x = x || {};
    var nac = x.nacionalidad || 'V';
    var sex = x.sexo || '';
    return '' +
      '<label>Nacionalidad</label>' +
      '<div class="chips" id="' + i('Nac') + '">' +
        '<button type="button" data-v="V"' + (nac === 'V' ? ' class="on"' : '') + '>V · Venezolana</button>' +
        '<button type="button" data-v="E"' + (nac === 'E' ? ' class="on"' : '') + '>E · Extranjera</button>' +
      '</div>' +

      '<label for="' + i('Cedula') + '">Cédula</label>' +
      '<div class="fila-clave">' +
        '<input id="' + i('Cedula') + '" type="text" inputmode="numeric" autocomplete="off" ' +
          'placeholder="Solo números" value="' + esc(x.cedula || '') + '">' +
        '<button type="button" class="suave" id="' + i('Cne') + '">Buscar en el registro</button>' +
      '</div>' +
      '<p class="sub chico" id="' + i('AvisoCne') + '"></p>' +

      '<label for="' + i('Nombre') + '">Nombre y apellido</label>' +
      '<input id="' + i('Nombre') + '" type="text" autocomplete="off" value="' + esc(x.nombre || '') + '">' +

      '<label>Sexo</label>' +
      '<div class="chips" id="' + i('Sexo') + '">' +
        '<button type="button" data-v="F"' + (sex === 'F' ? ' class="on"' : '') + '>Femenino</button>' +
        '<button type="button" data-v="M"' + (sex === 'M' ? ' class="on"' : '') + '>Masculino</button>' +
        '<button type="button" data-v=""' + (sex ? '' : ' class="on"') + '>No lo dice</button>' +
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Fecha') + '">Fecha de nacimiento <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Fecha') + '" type="date" value="' +
          esc(x.fecha_nac ? String(x.fecha_nac).slice(0, 10) : '') + '"></div>' +
        '<div><label for="' + i('Telefono') + '">Teléfono <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Telefono') + '" type="tel" inputmode="tel" autocomplete="off" ' +
          'placeholder="0424-1234567" value="' + esc(x.telefono || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Direccion') + '">Dirección <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Direccion') + '" type="text" autocomplete="off" ' +
        'placeholder="Sector, calle, casa…" value="' + esc(x.direccion || '') + '">';
  };

  Personas.prototype.engancharCampos = function () {
    var t = this;
    ['Nac', 'Sexo'].forEach(function (g) {
      var z = t.q(g);
      if (!z) return;
      z.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          z.querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
          b.classList.add('on');
        });
      });
    });
    var cne = t.q('Cne');
    if (cne) cne.addEventListener('click', function () { t.consultarCne(); });
    var ced = t.q('Cedula');
    if (ced) ced.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); t.consultarCne(); }
    });
  };

  Personas.prototype.elegido = function (g) {
    var z = this.q(g);
    var b = z && z.querySelector('button.on');
    return b ? b.dataset.v : '';
  };

  Personas.prototype.leerCampos = function () {
    var t = this;
    return {
      nombre: t.q('Nombre').value.trim().replace(/\s+/g, ' '),
      cedula: t.q('Cedula').value.replace(/\D/g, ''),
      nacionalidad: t.elegido('Nac') || 'V',
      sexo: t.elegido('Sexo') || null,
      fecha_nac: t.q('Fecha').value || null,
      telefono: t.q('Telefono').value.trim() || null,
      direccion: t.q('Direccion').value.trim() || null
    };
  };

  Personas.prototype.valida = function (d) {
    if (d.nombre.length < 4) return 'Escribe el nombre y el apellido completos.';
    if (!/^\d{6,9}$/.test(d.cedula)) return 'La cédula debe tener entre 6 y 9 números.';
    if (d.fecha_nac && d.fecha_nac > hoyEs()) return 'La fecha de nacimiento no puede ser futura.';
    return null;
  };

  /* Del registro electoral se toman SOLO el nombre y la fecha de
     nacimiento. Lo del centro de votación dice dónde vota la persona, no
     dónde vive, y suele estar desactualizado: no se usa. */
  Personas.prototype.consultarCne = function () {
    var t = this;
    var ced = t.q('Cedula').value.replace(/\D/g, '');
    var av = t.q('AvisoCne');
    var btn = t.q('Cne');
    if (!/^\d{6,9}$/.test(ced)) {
      av.innerHTML = '<span class="ojo">Escribe una cédula de 6 a 9 números.</span>';
      return;
    }
    av.textContent = 'Consultando…';
    btn.disabled = true;
    var nac = t.elegido('Nac') || 'V';

    var yaHay = t.modo === 'nueva'
      ? t.sb.from('v_pacientes_ficha').select(CAMPOS).eq('cedula', ced).eq('nacionalidad', nac).limit(1)
      : Promise.resolve({ data: [] });

    yaHay.then(function (r) {
      var ya = r.data && r.data[0];
      if (ya) {
        btn.disabled = false;
        av.innerHTML = '<span class="ojo">Esa cédula ya está registrada: <b>' + esc(ya.nombre) +
          '</b>. </span><button type="button" class="enlace" id="' + t.id('UsarYa') + '">Abrir su ficha</button>';
        t.q('UsarYa').addEventListener('click', function () { t.abrirConPendientes(ya); });
        return;
      }
      return fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/consultar-cedula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: window.CONFIG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ cedula: ced, nacionalidad: nac })
      }).then(function (rr) { return rr.json(); }).then(function (d) {
        btn.disabled = false;
        var y = d && d.data;
        if (!y || d.error) {
          av.innerHTML = '<span class="ojo">No aparece en el registro. Escribe el nombre a mano.</span>';
          t.q('Nombre').focus();
          return;
        }
        var nom = [y.primer_nombre, y.segundo_nombre, y.primer_apellido, y.segundo_apellido]
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (nom) t.q('Nombre').value = nom;
        if (y.fecha_nac) t.q('Fecha').value = String(y.fecha_nac).slice(0, 10);
        av.innerHTML = '<span class="ok-txt">Encontrada en el registro. Revisa que esté bien y ' +
          'completa lo demás. El sexo no viene: ponlo tú.</span>';
      });
    }).catch(function (e) {
      btn.disabled = false;
      av.innerHTML = '<span class="ojo">No se pudo consultar el registro (' +
        esc(e.message || e) + '). Escribe el nombre a mano.</span>';
    });
  };

  Personas.prototype.guardarDatos = function () {
    var t = this;
    var d = t.leerCampos();
    var mal = t.valida(d);
    if (mal) { t.aviso('warn', mal); return; }

    var btn = t.q('Guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    d.cedula_cruda = d.cedula;

    t.sb.from('pacientes').update(d).eq('id', t.quien.id).then(function (r) {
      btn.disabled = false; btn.textContent = 'Guardar los cambios';
      if (r.error) {
        t.aviso('bad', r.error.code === '23505'
          ? 'Esa cédula ya la tiene otra persona registrada.'
          : 'No se pudo guardar: ' + r.error.message);
        return;
      }
      /* Se vuelve a leer de la ficha para traer la edad recalculada. */
      t.sb.from('v_pacientes_ficha').select(CAMPOS).eq('id', t.quien.id).single()
        .then(function (f) {
          if (f.data) t.quien = f.data;
          t.pintarFicha();
          t.aviso('ok', 'Los datos de ' + t.quien.nombre + ' quedaron guardados.');
        });
    });
  };

  /* ================================================================
     REGISTRAR A ALGUIEN NUEVO
  ================================================================ */
  Personas.prototype.verFormulario = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
        '<div class="prod-nom"><b>Registrar una persona</b>' +
          '<span>Escribe la cédula y pulsa «Buscar en el registro»: trae el nombre y la ' +
          'fecha de nacimiento. Lo demás se completa a mano.</span></div>' +
      '</div>' +
      t.camposPersona(null) +

      '<h3 class="sub-t">Sus patologías <span class="opc">(opcional)</span></h3>' +
      '<p class="sub">Se eligen de la lista para que todos las escribamos igual. Si de verdad ' +
      'no está, se puede anotar tal cual.</p>' +
      '<div id="' + i('ListaPat') + '"></div>' +
      window.FARMPICK.caja(i('Pat'), 'Buscar la patología',
        'Escribe para buscar, o toca una de abajo…', '') +

      '<h3 class="sub-t">Medicinas que necesita <span class="opc">(opcional)</span></h3>' +
      '<p class="sub">Quedan en su ficha y salen solas cuando venga a retirar.</p>' +
      '<div id="' + i('ListaMed') + '"></div>' +
      window.FARMPICK.caja(i('Med'), 'Buscar la medicina',
        'Escribe el nombre del medicamento…', '') +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="' + i('Crear') + '">Registrar la persona</button>' +
        '<button type="button" class="secundario" id="' + i('Cancelar') + '">Cancelar</button>' +
      '</div>';

    t.q('Volver').addEventListener('click', function () { t.aLaLista(); });
    t.q('Cancelar').addEventListener('click', function () { t.aLaLista(); });
    t.engancharCampos();
    t.pintarPendientes();

    window.FARMPICK.patologias(t.sb, i('Pat'), function (x) {
      if (t.pendientes.pat.some(function (y) { return window.FARMPICK.mismo(y, x.patologia); })) return;
      t.pendientes.pat.push(x.patologia);
      t.pintarPendientes();
    });
    window.FARMPICK.medicinas(t.sb, i('Med'), function (x) {
      if (t.pendientes.med.some(function (y) {
        if (x.producto_id && y.producto_id) return y.producto_id === x.producto_id;
        return window.FARMPICK.mismo(y.producto, x.producto);
      })) return;
      t.pendientes.med.push(x);
      t.pintarPendientes();
    });
    t.q('Crear').addEventListener('click', function () { t.crear(); });
  };

  Personas.prototype.aLaLista = function () {
    this.modo = 'lista'; this.quien = null; this.abierto = null;
    this.pendientes = { pat: [], med: [] };
    this.limpiaAviso(); this.pintar();
  };

  Personas.prototype.pintarPendientes = function () {
    var t = this;
    var lista = function (z, arr, texto, quita) {
      if (!z) return;
      if (!arr.length) {
        z.innerHTML = '<p class="sub chico">Todavía no has anotado ninguna.</p>';
        return;
      }
      z.innerHTML = '<div class="trat-lista">' + arr.map(function (x, n) {
        return '<span class="trat-par"><span class="trat-texto del-catalogo">' +
          esc(texto(x)) + '</span>' +
          '<button type="button" class="trat-quita" data-n="' + n + '" ' +
          'aria-label="Quitar ' + esc(texto(x)) + '">&#10005;</button></span>';
      }).join('') + '</div>';
      z.querySelectorAll('[data-n]').forEach(function (b) {
        b.addEventListener('click', function () { quita(+b.dataset.n); });
      });
    };
    lista(t.q('ListaPat'), t.pendientes.pat, function (x) { return x; },
      function (n) { t.pendientes.pat.splice(n, 1); t.pintarPendientes(); });
    lista(t.q('ListaMed'), t.pendientes.med, function (x) { return x.producto; },
      function (n) { t.pendientes.med.splice(n, 1); t.pintarPendientes(); });
  };

  Personas.prototype.crear = function () {
    var t = this;
    var d = t.leerCampos();
    var mal = t.valida(d);
    if (mal) { t.aviso('warn', mal); return; }

    var btn = t.q('Crear');
    btn.disabled = true; btn.textContent = 'Registrando…';
    d.cedula_cruda = d.cedula;
    d.estado = 'activo';

    t.sb.from('pacientes').insert(d).select().single().then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Registrar la persona';
        if (r.error.code === '23505') {
          t.aviso('warn', 'Esa cédula ya está registrada. Búscala en la lista y ábrele su ficha; ' +
            (t.pendientes.pat.length + t.pendientes.med.length
              ? 'lo que anotaste no se pierde, te lo ofrezco al abrirla.'
              : ''));
          return;
        }
        t.aviso('bad', 'No se pudo registrar: ' + r.error.message);
        return;
      }
      var pid = r.data.id;
      var pats = t.pendientes.pat.map(function (p) {
        return { paciente_id: pid, patologia: p, activo: true };
      });
      var meds = t.pendientes.med.map(function (m) {
        var fila = { paciente_id: pid, activo: true };
        if (m.producto_id) fila.producto_id = m.producto_id;
        else fila.texto_original = m.texto_original;
        return fila;
      });

      Promise.all([
        pats.length ? t.sb.from('patologias_paciente').insert(pats) : Promise.resolve({}),
        meds.length ? t.sb.from('tratamientos_paciente').insert(meds) : Promise.resolve({})
      ]).then(function (rr) {
        btn.disabled = false; btn.textContent = 'Registrar la persona';
        /* Nunca se dice "guardado" de lo que el servidor no confirmó. */
        var falta = [];
        if (rr[0] && rr[0].error) falta.push('las patologías (' + rr[0].error.message + ')');
        if (rr[1] && rr[1].error) falta.push('las medicinas (' + rr[1].error.message + ')');

        t.pendientes = { pat: [], med: [] };
        t.sb.from('v_pacientes_ficha').select(CAMPOS).eq('id', pid).single().then(function (f) {
          t.quien = f.data || r.data;
          t.modo = 'ficha'; t.abierto = null;
          t.patologias = null; t.tratamiento = null; t.falloAnexos = null;
          /* Sin esto, t.historial se queda "undefined" (nunca se había
             tocado, por ser una persona recién creada) y bloqueHistorial()
             revienta en "h.length" porque su guardia solo contempla null o
             un arreglo, no undefined. Pasaba SIEMPRE al registrar a alguien
             nuevo: la ficha se quedaba en blanco justo al terminar. */
          t.historial = null; t.falloHist = null;
          t.pintar();
          t.cargarAnexos();
          if (falta.length) {
            t.aviso('warn', 'La persona quedó registrada, pero NO se guardaron ' +
              falta.join(' ni ') + '. Anótalas otra vez aquí abajo.');
          } else {
            t.aviso('ok', d.nombre + ' quedó registrada' +
              (pats.length || meds.length
                ? ' con ' + (pats.length ? pats.length + (pats.length === 1 ? ' patología' : ' patologías') : '') +
                  (pats.length && meds.length ? ' y ' : '') +
                  (meds.length ? meds.length + (meds.length === 1 ? ' medicina' : ' medicinas') : '')
                : '') + '.');
          }
        });
      });
    });
  };

  /* Al abrir la ficha de alguien que ya existía, con cosas anotadas en el
     formulario que no llegó a guardarse: no se tiran. */
  Personas.prototype.abrirConPendientes = function (x) {
    var t = this;
    var pend = t.pendientes;
    t.abrir(x);
    if (!pend.pat.length && !pend.med.length) return;
    t.pendientes = pend;
    setTimeout(function () {
      t.aviso('warn', 'Habías anotado ' +
        (pend.pat.length ? pend.pat.length + ' patologías ' : '') +
        (pend.pat.length && pend.med.length ? 'y ' : '') +
        (pend.med.length ? pend.med.length + ' medicinas ' : '') +
        'antes de saber que ya estaba registrada. Anótalas aquí con los botones de arriba: ' +
        pend.pat.concat(pend.med.map(function (m) { return m.producto; })).join(' · '));
    }, 400);
  };

  /* ---------------------------------------------------------------- entrada */
  window.PANTALLA_PERSONAS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Personas(cliente, contenedor, o.prefijo || 'pe');
    t.pintar();
    return t;
  };
})();
