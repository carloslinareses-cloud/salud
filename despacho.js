/* Pantalla de ENTREGA de medicamentos.
   La usan los despachadores todo el día, casi siempre desde el teléfono.
   Objetivo: de que llega la persona a que queda registrada la entrega,
   en el menor número de toques posible. */
(function () {
  'use strict';

  var sb = null, ancla = null, cesta = [], destino = null, modo = 'paciente', yo = null;
  /* La ultima persona o centro elegido, para poder ofrecer volver a
     elegirlo despues de registrar sin tener que buscarlo otra vez. */
  var ultimo = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fecha(f) {
    if (!f) return '—';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : f;
  }
  function sinAcentos(t) {
    return window.FARM && window.FARM.sinAcentos
      ? window.FARM.sinAcentos(t)
      : String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  }
  function retardo(fn, ms) {
    var t; return function () {
      var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms);
    };
  }

  /* ---------------------------------------------------------------- armazón */
  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="conmuta">' +
          '<button type="button" class="on" data-modo="paciente">A una persona</button>' +
          '<button type="button" data-modo="institucion">A un centro (CDI)</button>' +
        '</div>' +
        '<div id="zonaDestino"></div>' +
      '</div>' +
      '<div class="tarjeta" id="zonaCesta"></div>' +
      '<div id="zonaAviso"></div>';

    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.addEventListener('click', function () {
        modo = b.dataset.modo; destino = null; cesta = []; olvidaTratamiento();
        bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };
        ancla.querySelectorAll('.conmuta button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        pintarDestino(); pintarCesta();
      });
    });
    pintarDestino(); pintarCesta();
  }

  /* ================================================================
     A QUIÉN SE LE ENTREGA

     Se puede ver la lista completa sin escribir nada, y cada renglón
     dice lo suficiente para reconocer a la persona: su edad, su
     teléfono, cuántos medicamentos toma y cuándo retiró por última vez.
     Con dos personas del mismo nombre, eso es lo que las distingue.
  ================================================================ */
  var POR_PAGINA = 20;
  var bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };

  /* Las medicinas que se le van anotando a una persona nueva mientras se
     llena su ficha. Se guardan cuando se guarda la persona: antes no
     existe todavia a quien colgarselas. */
  var tratNuevo = [];
  var tratAbierto = false;      // el buscador de medicinas esta desplegado
  var tratBusca = '';
  var histTodo = false;         // el historial esta desplegado entero

  /* Estas tres viven lo que dure la pagina: el area de Entregar se esconde
     al cambiar de pantalla, no se destruye. Si no se limpian al cambiar de
     persona, el buscador aparece abierto y con lo que se escribio para
     OTRO paciente, y un toque se lo anota a quien no era. */
  function olvidaTratamiento() {
    tratNuevo = []; tratAbierto = false; tratBusca = ''; histTodo = false;
  }

  var TIPOS_CENTRO = ['CDI', 'Ambulatorio', 'Consultorio Popular',
                      'Base de Misiones', 'Hospital', 'Otro'];

  function pintarDestino() {
    var z = document.getElementById('zonaDestino');
    if (!z) return;

    /* ---- ya está elegido: su ficha y su tratamiento ---- */
    if (destino) {
      z.innerHTML =
        '<div class="elegido">' +
          '<div><b>' + esc(destino.titulo) + '</b><span>' + esc(destino.sub) + '</span></div>' +
          '<button type="button" class="quitar" id="cambiarDestino">Cambiar</button>' +
        '</div>' +
        (destino.detalle ? '<p class="sub chico">' + esc(destino.detalle) + '</p>' : '') +
        pintarPatologias() +
        pintarTratamiento() +
        pintarRequerimientos() +
        pintarHistorial() +
        (modo === 'institucion' ?
          '<h2 class="sub-t">Quién recibe</h2>' +
          '<p class="sub">Hace falta para el acta de entrega-recepción.</p>' +
          '<label for="recibeNombre">Nombre y apellido de quien firma</label>' +
          '<input id="recibeNombre" type="text" autocomplete="off"' +
            (destino.responsable ? ' value="' + esc(destino.responsable) + '"' : '') + '>' +
          '<label for="recibeCedula">Su cédula</label>' +
          '<input id="recibeCedula" type="text" inputmode="numeric" placeholder="Solo números">' : '');

      document.getElementById('cambiarDestino').addEventListener('click', function () {
        destino = null; bus.pagina = 0; olvidaTratamiento(); pintarDestino();
      });
      var suLista = (destino.tratamiento || []).filter(function (x) {
        return x.producto_id || x.texto_original;
      });
      z.querySelectorAll('[data-trat]').forEach(function (b) {
        b.addEventListener('click', function () { agregarDelTratamiento(suLista[+b.dataset.trat]); });
      });
      z.querySelectorAll('[data-edita]').forEach(function (b) {
        b.addEventListener('click', function () {
          corregirMedicina(b.dataset.edita, b.dataset.texto);
        });
      });
      z.querySelectorAll('[data-quita]').forEach(function (b) {
        b.addEventListener('click', function () { quitarMedicina(b.dataset.quita); });
      });
      var vh = document.getElementById('histMas');
      if (vh) vh.addEventListener('click', function () { histTodo = !histTodo; pintarDestino(); });
      var conReq = (destino.requerimientos || []).filter(function (x) { return x.producto_id; });
      z.querySelectorAll('[data-req]').forEach(function (b) {
        b.addEventListener('click', function () {
          agregarDelPedido(conReq[+b.dataset.req]).then(function (r) {
            if (r) { pintarRenglones(); refrescarBoton(); }
            if (r === 'corto') {
              aviso('warn', 'De ' + conReq[+b.dataset.req].producto +
                ' no hay lo que pide: se agregó todo lo que queda.');
            }
          });
        });
      });
      var todo = document.getElementById('reqTodo');
      if (todo) todo.addEventListener('click', function () {
        var puede = conReq.filter(function (x) { return Number(x.disponible) > 0; });
        todo.disabled = true; todo.textContent = 'Agregando…';
        Promise.all(puede.map(function (x) { return agregarDelPedido(x, true); }))
          .then(function (rs) {
            pintarRenglones(); refrescarBoton();
            var puestos = rs.filter(Boolean).length;
            var cortos = rs.filter(function (y) { return y === 'corto'; }).length;
            aviso(cortos ? 'warn' : 'ok',
              'Se agregaron ' + puestos + ' de los ' + puede.length + ' insumos que pide' +
              (cortos ? '. De ' + cortos + (cortos === 1 ? ' no hay' : ' no hay') +
                        ' lo que pide: se puso lo que queda.' : '.') +
              ' Revisa las cantidades antes de registrar.');
          });
      });
      var pend = document.getElementById('tratPend');
      if (pend) pend.addEventListener('click', function () { anotarPendientes(); });
      var tira = document.getElementById('tratTira');
      if (tira) tira.addEventListener('click', function () {
        tratNuevo = []; pintarDestino();
      });
      var mas = document.getElementById('tratMas');
      if (mas) mas.addEventListener('click', function () {
        tratAbierto = true; tratBusca = ''; pintarDestino();
        var c = document.getElementById('tratBusca'); if (c) c.focus();
      });
      if (tratAbierto) engancharBuscador(anotarMedicina);
      return;
    }

    /* ---- todavía no: buscar o crear ---- */
    var esPac = modo === 'paciente';
    z.innerHTML =
      '<div class="busca-fila">' +
        '<div class="busca-campo">' +
          '<label for="buscaDestino">' + (esPac ? 'Buscar a la persona' : 'Buscar el centro de salud') + '</label>' +
          '<input id="buscaDestino" type="search" autocomplete="off" ' +
            'placeholder="' + (esPac ? 'Cédula o nombre…' : 'Nombre del centro…') + '">' +
        '</div>' +
        '<button type="button" class="secundario" id="btnNuevoDestino">+ ' +
          (esPac ? 'Registrar persona' : 'Registrar centro') + '</button>' +
      '</div>' +
      '<div id="resultados"></div>' +
      '<div id="formDestino"></div>';

    var caja = document.getElementById('buscaDestino');
    caja.value = bus.busca;
    caja.addEventListener('input', retardo(function () {
      bus.busca = caja.value.trim(); bus.pagina = 0; cargarDestinos();
    }, 300));
    document.getElementById('btnNuevoDestino').addEventListener('click', function () {
      if (esPac) formNuevoPaciente(bus.busca); else formNuevoCentro(bus.busca);
    });
    cargarDestinos();
  }

  function cargarDestinos() {
    var z = document.getElementById('resultados');
    if (!z) return;
    var f = document.getElementById('formDestino');
    if (f) f.innerHTML = '';
    z.innerHTML = '<div class="cargando">Buscando…</div>';

    var q, esPac = modo === 'paciente';
    if (esPac) {
      q = sb.from('v_pacientes_ficha')
        .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,' +
                'estado,medicamentos,entregas,ultima_entrega,patologias,n_patologias', { count: 'exact' });
      if (bus.busca.length >= 2) {
        var t = bus.busca.replace(/[%,()]/g, '');
        var soloNum = t.replace(/\D/g, '');
        q = soloNum.length >= 4 && /^\D*\d[\d.\s-]*$/.test(t)
          ? q.ilike('cedula', '*' + soloNum + '*')
          : q.ilike('busqueda', '*' + sinAcentos(t) + '*');
      }
      q = q.order('nombre');
    } else {
      q = sb.from('v_instituciones_ficha')
        .select('id,nombre,tipo,direccion,responsable,telefono,entregas,ultima_entrega', { count: 'exact' })
        .eq('activo', true);
      if (bus.busca.length >= 2) {
        q = q.ilike('busqueda', '*' + sinAcentos(bus.busca).replace(/[%,()]/g, '') + '*');
      }
      q = q.order('nombre');
    }

    var desde = bus.pagina * POR_PAGINA;
    q.range(desde, desde + POR_PAGINA - 1).then(function (r) {
      var zz = document.getElementById('resultados');
      if (!zz) return;
      if (r.error) { zz.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      bus.filas = r.data || [];
      bus.total = r.count == null ? bus.filas.length : r.count;
      pintarLista();
    });
  }

  function pintarLista() {
    var z = document.getElementById('resultados');
    if (!z) return;
    var esPac = modo === 'paciente';

    if (!bus.filas.length) {
      z.innerHTML = '<div class="vacio"><b>' +
        (bus.busca ? 'No aparece nadie con «' + esc(bus.busca) + '».'
                   : (esPac ? 'Todavía no hay personas registradas.'
                            : 'Todavía no hay ningún centro de salud registrado.')) + '</b>' +
        '<span>' + (esPac ? 'Regístrala con el botón de arriba.'
                          : 'Regístralo con el botón de arriba.') + '</span></div>';
      return;
    }

    var desdeN = bus.pagina * POR_PAGINA + 1;
    var hastaN = Math.min(desdeN + POR_PAGINA - 1, bus.total);
    z.innerHTML =
      '<p class="conteo">' + (bus.total <= POR_PAGINA
        ? bus.total + (esPac ? (bus.total === 1 ? ' persona' : ' personas')
                             : (bus.total === 1 ? ' centro' : ' centros'))
        : 'Del ' + desdeN + ' al ' + hastaN + ' de ' + bus.total +
          (esPac ? ' personas' : ' centros')) + '</p>' +
      '<div class="fichas">' + bus.filas.map(function (x, i) {
        return esPac ? fichaPersona(x, i) : fichaCentro(x, i);
      }).join('') + '</div>' +
      paginador();

    z.querySelectorAll('.ficha').forEach(function (b) {
      b.addEventListener('click', function () { elegirDestino(bus.filas[+b.dataset.i]); });
    });
    z.querySelectorAll('[data-pag]').forEach(function (b) {
      b.addEventListener('click', function () {
        bus.pagina += b.dataset.pag === 'sig' ? 1 : -1;
        if (bus.pagina < 0) bus.pagina = 0;
        cargarDestinos();
      });
    });
  }

  function paginador() {
    var paginas = Math.ceil(bus.total / POR_PAGINA);
    if (paginas <= 1) return '';
    return '<div class="paginador">' +
      '<button type="button" data-pag="ant"' + (bus.pagina === 0 ? ' disabled' : '') + '>← Anteriores</button>' +
      '<span>Página ' + (bus.pagina + 1) + ' de ' + paginas + '</span>' +
      '<button type="button" data-pag="sig"' + (bus.pagina + 1 >= paginas ? ' disabled' : '') + '>Siguientes →</button>' +
    '</div>';
  }

  function fichaPersona(x, i) {
    /* Algunos pacientes traen en la celda de la cedula lo que se colo del
       Excel: a veces la lista de medicamentos entera. Se muestra recortado
       y completo en el title, para que no empuje la pantalla. */
    var crudo = x.cedula_cruda || '';
    var ced = x.cedula
      ? (x.nacionalidad || 'V') + '-' + x.cedula
      : (crudo ? esc(crudo.length > 22 ? crudo.slice(0, 20) + '…' : crudo) : 'sin cédula');
    var tituloCed = !x.cedula && crudo.length > 22 ? ' title="' + esc(crudo) + '"' : '';
    var linea2 = [];
    if (x.edad != null) linea2.push(x.edad + ' años');
    if (x.sexo) linea2.push(x.sexo === 'F' ? 'Femenino' : x.sexo === 'M' ? 'Masculino' : x.sexo);
    if (x.telefono) linea2.push(x.telefono);
    var linea3 = [];
    if (x.medicamentos) linea3.push(x.medicamentos + (x.medicamentos === 1 ? ' medicamento' : ' medicamentos'));
    if (x.entregas) linea3.push(x.entregas + (x.entregas === 1 ? ' entrega' : ' entregas'));
    if (x.ultima_entrega) linea3.push('última ' + fecha(x.ultima_entrega));

    return '<button type="button" class="ficha" data-i="' + i + '">' +
      '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
        (linea2.length ? '<span class="ficha-pres">' + esc(linea2.join(' · ')) + '</span>' : '') +
        (linea3.length ? '<span class="ficha-pres">' + esc(linea3.join(' · ')) + '</span>' : '') +
      '</div>' +
      '<div class="ficha-datos"><span class="ficha-ced"' + tituloCed + '>' + ced + '</span></div>' +
      (x.estado === 'por_revisar' ? '<span class="sit ojo">Revisar sus datos</span>' : '') +
    '</button>';
  }

  function fichaCentro(x, i) {
    var linea2 = [x.direccion, x.responsable, x.telefono].filter(Boolean).join(' · ');
    var linea3 = x.entregas
      ? x.entregas + (x.entregas === 1 ? ' entrega' : ' entregas') +
        (x.ultima_entrega ? ' · última ' + fecha(x.ultima_entrega) : '')
      : 'Todavía no ha recibido nada';
    return '<button type="button" class="ficha" data-i="' + i + '">' +
      '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
        (linea2 ? '<span class="ficha-pres">' + esc(linea2) + '</span>' : '') +
        '<span class="ficha-pres">' + esc(linea3) + '</span>' +
      '</div>' +
      '<span class="sit gris">' + esc(x.tipo || '') + '</span>' +
    '</button>';
  }

  function elegirDestino(x) {
    ultimo = x;
    if (modo === 'paciente') {
      var ced = x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula
                         : (x.cedula_cruda || 'sin cédula válida');
      var det = [];
      if (x.edad != null) det.push(x.edad + ' años');
      if (x.telefono) det.push(x.telefono);
      if (x.direccion) det.push(x.direccion);
      destino = { tipo: 'paciente', id: x.id, titulo: x.nombre, sub: ced,
                  detalle: det.join(' · ') || null,
                  patologias: x.patologias || '' };
      pintarDestino(); pintarRenglones();
      cargarHistorial('paciente', x.id);
      sb.from('v_tratamiento_paciente')
        .select('tratamiento_id,producto_id,producto,dosificacion,texto_original,disponible,situacion,origen')
        .eq('paciente_id', x.id)
        .then(function (r) {
          if (!destino || destino.id !== x.id) return;   // ya cambió de paciente
          /* Un error aquí no significa que no tome nada: significa que no
             se pudo preguntar. La diferencia importa en una ficha médica. */
          destino.tratamiento = r.error ? null : (r.data || []);
          destino.tratamientoFallo = r.error ? r.error.message : null;
          pintarDestino();
        });
    } else {
      destino = { tipo: 'institucion', id: x.id, titulo: x.nombre,
                  sub: (x.tipo || 'Centro de salud') + (x.direccion ? ' · ' + x.direccion : ''),
                  detalle: x.telefono || null, responsable: x.responsable || '' };
      pintarDestino(); pintarRenglones();
      cargarHistorial('institucion', x.id);
      /* Su lista de insumos, la que hace rapido armarle el pedido. */
      sb.from('v_requerimientos_institucion')
        .select('requerimiento_id,producto_id,producto,dosificacion,texto_original,' +
                'cantidad,disponible,vencido,cobertura')
        .eq('institucion_id', x.id).order('producto', { nullsFirst: false })
        .then(function (r) {
          if (!destino || destino.id !== x.id) return;   // ya cambio de centro
          /* Un error NO es "no pide nada": es "no se pudo preguntar". */
          destino.requerimientos = r.error ? null : (r.data || []);
          destino.falloReq = r.error ? r.error.message : null;
          pintarDestino();
        });
    }
  }

  /* ================================================================
     REGISTRAR UNA PERSONA NUEVA
     Todos los campos de la ficha, no solo tres. La cédula se puede
     consultar en el registro electoral para traer el nombre: se teclea
     menos y se evitan las erratas.
  ================================================================ */
  function formNuevoPaciente(texto) {
    var soloNum = String(texto || '').replace(/\D/g, '');
    var esCedula = /^\d{6,9}$/.test(soloNum);
    var z = document.getElementById('formDestino');
    document.getElementById('resultados').innerHTML = '';

    z.innerHTML =
      '<h2 class="sub-t">Registrar una persona nueva</h2>' +
      '<p class="sub">Escribe la cédula y pulsa <b>Buscar en el registro</b>: trae el nombre y la ' +
      'fecha de nacimiento. Lo demás se completa a mano.</p>' +

      '<label>Nacionalidad</label>' +
      '<div class="chips" id="nNac">' +
        '<button type="button" data-n="V" class="on">V · Venezolana</button>' +
        '<button type="button" data-n="E">E · Extranjera</button>' +
      '</div>' +

      '<label for="nCedula">Cédula</label>' +
      '<div class="fila-clave">' +
        '<input id="nCedula" type="text" inputmode="numeric" autocomplete="off" ' +
          'value="' + esc(esCedula ? soloNum : '') + '" placeholder="Solo números">' +
        '<button type="button" class="suave" id="nBuscarCne">Buscar en el registro</button>' +
      '</div>' +
      '<p class="sub chico" id="nAvisoCne"></p>' +

      '<label for="nNombre">Nombre y apellido</label>' +
      '<input id="nNombre" type="text" autocomplete="off" ' +
        'value="' + esc(esCedula ? '' : (texto || '')) + '">' +

      '<label>Sexo</label>' +
      '<div class="chips" id="nSexo">' +
        '<button type="button" data-s="F">Femenino</button>' +
        '<button type="button" data-s="M">Masculino</button>' +
        '<button type="button" data-s="" class="on">No lo dice</button>' +
      '</div>' +

      '<label for="nFecha">Fecha de nacimiento <span class="opc">(opcional)</span></label>' +
      '<input id="nFecha" type="date">' +

      '<label for="nTelefono">Teléfono <span class="opc">(opcional)</span></label>' +
      '<input id="nTelefono" type="tel" inputmode="tel" autocomplete="off" placeholder="0424-1234567">' +

      '<label for="nDireccion">Dirección <span class="opc">(opcional)</span></label>' +
      '<input id="nDireccion" type="text" autocomplete="off" placeholder="Sector, calle, casa…">' +

      '<h2 class="sub-t">Qué medicinas necesita <span class="opc">(opcional)</span></h2>' +
      '<p class="sub">Quedan guardadas en su ficha. La próxima vez que venga salen ' +
      'aquí mismo, con lo que hay en existencia, y se entregan de un toque.</p>' +
      '<div id="tratElegidos"></div>' +
      buscadorMedicinas('Buscar la medicina') +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="guardarPac">Registrar y continuar</button>' +
        '<button type="button" class="secundario" id="cancelarPac">Cancelar</button>' +
      '</div>' +
      '<div id="errPac" class="aviso bad" hidden></div>';

    chips('nNac'); chips('nSexo');
    tratNuevo = []; tratBusca = '';
    pintarTratNuevo();
    engancharBuscador(function (x) {
      if (yaLoTiene(tratNuevo, x)) return;
      tratNuevo.push(x);
      pintarTratNuevo();
    });
    document.getElementById('cancelarPac').addEventListener('click', function () {
      pintarDestino();
    });
    document.getElementById('nBuscarCne').addEventListener('click', consultarCne);
    document.getElementById('nCedula').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); consultarCne(); }
    });
    document.getElementById('guardarPac').addEventListener('click', guardarPaciente);
  }

  /* Lo que se le lleva anotado a la persona nueva. Se ve arriba del
     buscador para que no haya que recordar qué se puso. */
  function pintarTratNuevo() {
    var z = document.getElementById('tratElegidos');
    if (!z) return;
    if (!tratNuevo.length) {
      z.innerHTML = '<p class="sub chico">Todavía no has anotado ninguna. ' +
        'Se puede registrar la persona sin esto y anotarlas después.</p>';
      return;
    }
    z.innerHTML = '<div class="trat-lista">' + tratNuevo.map(function (x, i) {
      return '<span class="trat-par"><span class="trat-texto' +
        (x.producto_id ? ' del-catalogo' : '') + '">' + esc(x.producto) +
        (x.dosificacion ? ' <em>' + esc(x.dosificacion) + '</em>' : '') +
        (x.producto_id ? '' : ' <em class="a-mano">a mano</em>') + '</span>' +
        '<button type="button" class="trat-quita" data-saca="' + i + '" ' +
        'aria-label="Quitar ' + esc(x.producto) + '">&#10005;</button></span>';
    }).join('') + '</div>' +
    '<p class="sub chico">' + tratNuevo.length +
      (tratNuevo.length === 1 ? ' medicina anotada' : ' medicinas anotadas') + '.</p>';

    z.querySelectorAll('[data-saca]').forEach(function (b) {
      b.addEventListener('click', function () {
        tratNuevo.splice(+b.dataset.saca, 1);
        pintarTratNuevo();
      });
    });
  }

  /* Marca el botón elegido dentro de un grupo de opciones. */
  function chips(id) {
    var g = document.getElementById(id);
    if (!g) return;
    g.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        g.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
  }
  function elegido(id, attr) {
    var b = document.querySelector('#' + id + ' button.on');
    return b ? b.dataset[attr] : '';
  }

  /* Consulta el registro electoral: de ahí se toman SOLO el nombre y la
     fecha de nacimiento. Dónde vota no se usa: no dice dónde vive. */
  function consultarCne() {
    var ced = document.getElementById('nCedula').value.replace(/\D/g, '');
    var av = document.getElementById('nAvisoCne');
    var btn = document.getElementById('nBuscarCne');
    if (!/^\d{6,9}$/.test(ced)) {
      av.innerHTML = '<span class="ojo">Escribe una cédula de 6 a 9 números.</span>';
      return;
    }
    av.innerHTML = 'Consultando…';
    btn.disabled = true;

    /* Primero: ¿ya está registrada aquí? Si sí, no se crea otra vez. */
    sb.from('v_pacientes_ficha')
      .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,estado,medicamentos,entregas,ultima_entrega,patologias,n_patologias')
      .eq('cedula', ced).eq('nacionalidad', elegido('nNac', 'n') || 'V').limit(1)
      .then(function (r) {
        var ya = r.data && r.data[0];
        if (ya) {
          btn.disabled = false;
          av.innerHTML = '<span class="ojo">Esa cédula ya está registrada: <b>' + esc(ya.nombre) +
            '</b>. </span><button type="button" class="enlace" id="usarYa">Usar esa ficha</button>';
          document.getElementById('usarYa').addEventListener('click', function () {
            elegirDestino(ya);
          });
          return;
        }
        return fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/consultar-cedula', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: window.CONFIG.SUPABASE_ANON_KEY },
          body: JSON.stringify({ cedula: ced, nacionalidad: elegido('nNac', 'n') || 'V' })
        }).then(function (rr) { return rr.json(); }).then(function (d) {
          btn.disabled = false;
          var x = d && d.data;
          if (!x || d.error) {
            av.innerHTML = '<span class="ojo">No aparece en el registro. Escribe el nombre a mano.</span>';
            document.getElementById('nNombre').focus();
            return;
          }
          var nom = [x.primer_nombre, x.segundo_nombre, x.primer_apellido, x.segundo_apellido]
            .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          if (nom) document.getElementById('nNombre').value = nom;
          if (x.fecha_nac) document.getElementById('nFecha').value = String(x.fecha_nac).slice(0, 10);
          av.innerHTML = '<span class="ok-txt">Encontrada en el registro. Revisa que esté bien y ' +
            'completa lo demás.</span>';
        });
      })
      .catch(function () {
        btn.disabled = false;
        av.innerHTML = '<span class="ojo">No se pudo consultar. Escribe el nombre a mano.</span>';
      });
  }

  function guardarPaciente() {
    var err = document.getElementById('errPac');
    var nom = document.getElementById('nNombre').value.trim().replace(/\s+/g, ' ');
    var ced = document.getElementById('nCedula').value.replace(/\D/g, '');
    var nac = elegido('nNac', 'n') || 'V';
    var sex = elegido('nSexo', 's') || null;
    var fnac = document.getElementById('nFecha').value || null;
    var tel = document.getElementById('nTelefono').value.trim() || null;
    var dir = document.getElementById('nDireccion').value.trim() || null;

    if (nom.length < 4) { err.textContent = 'Escribe el nombre y el apellido completos.'; err.hidden = false; return; }
    if (!/^\d{6,9}$/.test(ced)) { err.textContent = 'La cédula debe tener entre 6 y 9 números.'; err.hidden = false; return; }
    if (fnac && fnac > (window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10))) {
      err.textContent = 'La fecha de nacimiento no puede ser futura.'; err.hidden = false; return;
    }
    err.hidden = true;

    var btn = document.getElementById('guardarPac');
    btn.disabled = true; btn.textContent = 'Registrando…';

    sb.from('pacientes').insert({
      nombre: nom, cedula: ced, nacionalidad: nac, cedula_cruda: ced,
      sexo: sex, fecha_nac: fnac, telefono: tel, direccion: dir, estado: 'activo'
    }).select().single().then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Registrar y continuar';
        if (r.error.code === '23505') {
          err.innerHTML = 'Esa cédula ya está registrada. ' +
            '<button type="button" class="enlace" id="verYa">Buscarla en la lista</button>' +
            (tratNuevo.length
              ? '<br><span class="chico">Las ' + tratNuevo.length + ' medicinas que anotaste ' +
                'no se pierden: al abrir su ficha te ofrezco ponérselas.</span>'
              : '');
          err.hidden = false;
          document.getElementById('verYa').addEventListener('click', function () {
            bus.busca = ced; bus.pagina = 0; pintarDestino();
          });
          return;
        }
        err.textContent = 'No se pudo guardar. ' + r.error.message; err.hidden = false;
        return;
      }
      /* Las medicinas que necesita, si se anotaron. Si esto fallara, la
         persona YA está registrada: se avisa y se sigue, pero no se
         miente diciendo que quedaron guardadas. */
      var medicinas = tratNuevo.map(function (x) {
        var fila = { paciente_id: r.data.id, activo: true };
        if (x.producto_id) fila.producto_id = x.producto_id;
        else fila.texto_original = x.texto_original;
        return fila;
      });
      var guardaTrat = medicinas.length
        ? sb.from('tratamientos_paciente').insert(medicinas)
        : Promise.resolve({ error: null });

      guardaTrat.then(function (tr) {
        var falloTrat = tr && tr.error ? tr.error.message : null;
        tratNuevo = []; tratBusca = ''; tratAbierto = false;
        /* Se vuelve a leer de la ficha, para que traiga la edad calculada. */
        sb.from('v_pacientes_ficha')
          .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,estado,medicamentos,entregas,ultima_entrega,patologias,n_patologias')
          .eq('id', r.data.id).single()
          .then(function (f) {
            elegirDestino(f.data || r.data);
            if (falloTrat) {
              aviso('warn', 'La persona quedó registrada, pero sus medicinas NO se guardaron: ' +
                            falloTrat + '. Anótalas otra vez desde su ficha.');
            }
          });
      });
    });
  }

  /* ================================================================
     REGISTRAR UN CENTRO DE SALUD NUEVO
  ================================================================ */
  function formNuevoCentro(texto) {
    var z = document.getElementById('formDestino');
    document.getElementById('resultados').innerHTML = '';

    z.innerHTML =
      '<h2 class="sub-t">Registrar un centro de salud</h2>' +
      '<p class="sub">Los centros a los que se despacha: CDI, ambulatorios, consultorios ' +
      'populares. Se registran una vez y quedan para las siguientes entregas.</p>' +

      '<label for="cNombre">Nombre del centro</label>' +
      '<input id="cNombre" type="text" autocomplete="off" value="' + esc(texto || '') + '" ' +
        'placeholder="CDI Mamá Pancha">' +

      '<label for="cTipo">Qué tipo de centro es</label>' +
      '<select id="cTipo">' + TIPOS_CENTRO.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
      }).join('') + '</select>' +

      '<label for="cDireccion">Dirección</label>' +
      '<input id="cDireccion" type="text" autocomplete="off" placeholder="Sector, avenida, punto de referencia">' +

      '<label for="cResponsable">Responsable <span class="opc">(quien suele recibir)</span></label>' +
      '<input id="cResponsable" type="text" autocomplete="off" placeholder="Nombre y apellido">' +

      '<label for="cTelefono">Teléfono <span class="opc">(opcional)</span></label>' +
      '<input id="cTelefono" type="tel" inputmode="tel" autocomplete="off" placeholder="0239-1234567">' +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="guardarCen">Registrar y continuar</button>' +
        '<button type="button" class="secundario" id="cancelarCen">Cancelar</button>' +
      '</div>' +
      '<div id="errCen" class="aviso bad" hidden></div>';

    document.getElementById('cancelarCen').addEventListener('click', function () { pintarDestino(); });
    document.getElementById('guardarCen').addEventListener('click', function () {
      var err = document.getElementById('errCen');
      var nom = document.getElementById('cNombre').value.trim().replace(/\s+/g, ' ');
      if (nom.length < 4) { err.textContent = 'Escribe el nombre completo del centro.'; err.hidden = false; return; }
      err.hidden = true;
      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';

      /* Si ya existe uno con ese nombre, se usa ese en vez de repetirlo. */
      sb.from('v_instituciones_ficha')
        .select('id,nombre,tipo,direccion,responsable,telefono,entregas,ultima_entrega')
        .ilike('nombre', nom).limit(1)
        .then(function (r) {
          var ya = r.data && r.data[0];
          if (ya) {
            btn.disabled = false; btn.textContent = 'Registrar y continuar';
            err.innerHTML = 'Ese centro ya está registrado. ' +
              '<button type="button" class="enlace" id="usarCen">Usarlo</button>';
            err.hidden = false;
            document.getElementById('usarCen').addEventListener('click', function () { elegirDestino(ya); });
            return;
          }
          return sb.from('instituciones').insert({
            nombre: nom,
            tipo: document.getElementById('cTipo').value,
            direccion: document.getElementById('cDireccion').value.trim() || null,
            responsable: document.getElementById('cResponsable').value.trim() || null,
            telefono: document.getElementById('cTelefono').value.trim() || null,
            activo: true
          }).select().single().then(function (rr) {
            if (rr.error) {
              btn.disabled = false; btn.textContent = 'Registrar y continuar';
              err.textContent = 'No se pudo guardar. ' + rr.error.message; err.hidden = false;
              return;
            }
            elegirDestino(Object.assign({ entregas: 0 }, rr.data));
          });
        });
    });
  }

  /* ================================================================
     QUÉ MEDICINAS NECESITA  (el tratamiento del paciente)

     Es lo que hace rápido atender a alguien: se abre su ficha y ahí
     están las medicinas que toma, con su existencia al lado y un toque
     para agregarlas a lo que se le va a entregar. Se anotan al registrar
     a la persona y se pueden corregir después, porque un tratamiento
     cambia.

     Se puede anotar una medicina que TODAVÍA NO está en el catálogo: el
     catálogo se está cargando a mano y que no esté no significa que la
     persona no la necesite. Esas quedan guardadas como texto, tal cual
     se escribieron, y aparecen aparte para no confundirlas con las que
     sí están enlazadas.
  ================================================================ */

  /* LO QUE PIDE EL CENTRO.

     Un CDI pide veinte renglones casi siempre iguales. Su lista se
     mantiene en Mercancia > Centros; aqui sale para armar el pedido de un
     toque. Cada renglon dice cuanto necesita y cuanto hay: si no alcanza,
     se agrega lo que hay y se dice, en vez de prometer lo que no existe. */
  function pintarRequerimientos() {
    if (destino.tipo !== 'institucion') return '';
    var r = destino.requerimientos;
    if (r === undefined) return '<div class="trat"><span class="lbl">Lo que pide este centro</span>' +
      '<span class="sub chico">Buscando…</span></div>';
    if (r === null) return '<div class="trat"><span class="lbl">Lo que pide este centro</span>' +
      '<div class="aviso bad">No se pudo leer su lista' +
      (destino.falloReq ? ': ' + esc(destino.falloReq) : '') +
      '. No quiere decir que no pida nada.</div></div>';
    if (!r.length) return '<div class="trat"><span class="lbl">Lo que pide este centro</span>' +
      '<span class="sub chico">No tiene lista de insumos. Se le puede armar en ' +
      'Mercancía → Centros y así la próxima vez sale sola.</span></div>';

    /* Lo que se puede entregar hoy va PRIMERO. Un centro puede pedir
       ochenta renglones y estar enlazados solo seis: si no se ordena, los
       seis que sirven quedan enterrados. */
    var conProd = r.filter(function (x) { return x.producto_id; })
      .sort(function (a, b) { return (Number(b.disponible) || 0) - (Number(a.disponible) || 0); });
    var sueltos = r.filter(function (x) { return !x.producto_id && x.texto_original; });
    var sePuede = conProd.filter(function (x) { return Number(x.disponible) > 0; });

    return '<div class="trat">' +
      '<span class="lbl">Lo que pide este centro · ' + r.length +
        (r.length === 1 ? ' insumo' : ' insumos') + '</span>' +
      (conProd.length
        ? '<div class="trat-lista">' + conProd.map(function (x, i) {
            var hay = Math.round(Number(x.disponible) || 0);
            var pide = x.cantidad == null ? null : Math.round(x.cantidad);
            /* No es lo mismo "no hay" que "hay, pero vencido": en el
               segundo caso hay algo que sacar del estante hoy. */
            var soloVenc = x.cobertura === 'solo_vencido';
            var venc = Math.round(Number(x.vencido) || 0);
            return '<button type="button" class="trat-med' + (hay > 0 ? '' : ' sin') + '" ' +
              'data-req="' + i + '"' + (hay > 0 ? '' : ' disabled') + '>' +
              '<span class="tm-nom">' + esc(x.producto) +
                (x.dosificacion ? ' <em>' + esc(x.dosificacion) + '</em>' : '') + '</span>' +
              '<span class="tm-hay' + (soloVenc ? ' tm-venc' : '') + '">' +
                (pide != null ? 'necesita ' + pide + ' · ' : '') +
                (hay > 0 ? 'hay ' + hay
                         : (soloVenc ? 'solo vencido' + (venc ? ' · ' + venc : '')
                                     : 'sin existencia')) +
                (pide != null && hay > 0 && hay < pide ? ' — no alcanza' : '') +
              '</span></button>';
          }).join('') + '</div>'
        : '') +
      /* Los que no estan en el catalogo no se pueden tocar, asi que no se
         pintan como botones: van juntos en un renglon de texto. Se siguen
         viendo todos —es lo que pide el centro— sin tapar lo que sirve. */
      (sueltos.length
        ? '<div class="pide-texto">' +
          '<span class="ts-lbl">Pide también ' + sueltos.length +
            (sueltos.length === 1 ? ' insumo' : ' insumos') +
            ' que no están en el catálogo</span>' +
          '<p class="sub chico">' +
          esc(sueltos.map(function (x) {
            return x.texto_original + (x.cantidad != null ? ' (' + Math.round(x.cantidad) + ')' : '');
          }).join(' · ')) + '</p>' +
          '<span class="sub chico">Se pueden entregar buscándolos abajo, o cargarlos ' +
          'al catálogo para que salgan aquí de una vez.</span></div>'
        : '') +
      (sePuede.length > 1
        ? '<button type="button" class="trat-mas" id="reqTodo">+ Agregar los ' + sePuede.length +
          ' que hay en existencia</button>'
        : '') +
    '</div>';
  }

  /* Cuando de un medicamento no queda nada que se pueda entregar hay dos
     motivos muy distintos: que se haya acabado, o que lo que queda este
     vencido. Decir "no queda nada" habiendo tres cajas vencidas en el
     estante manda a la gente a buscar algo que si esta ahi pero no
     sirve, y ademas deja el vencido ahi otro mes mas. */
  function porQueNoHay(productoId, nombre) {
    return sb.from('v_lotes_para_ver')
      .select('existencia,vence').eq('producto_id', productoId).eq('es_vencido', 1)
      .then(function (r) {
        var v = (!r.error && r.data) || [];
        if (!v.length) return 'De ' + esc(nombre) + ' no queda nada que se pueda entregar.';
        var u = 0, viejo = null;
        v.forEach(function (x) {
          u += Number(x.existencia) || 0;
          if (x.vence && (!viejo || x.vence < viejo)) viejo = x.vence;
        });
        return 'De ' + esc(nombre) + ' lo único que queda está <b>vencido</b>: ' +
          Math.round(u) + (Math.round(u) === 1 ? ' unidad en ' : ' unidades en ') +
          v.length + (v.length === 1 ? ' lote' : ' lotes') +
          (viejo ? ', el más viejo venció el ' + fecha(viejo) : '') +
          '. No se puede entregar: hay que darlo de baja en Mercancía.';
      });
  }

  /* Deja el motivo en el aviso de arriba, cuando se sepa. */
  function avisaNoHay(productoId, nombre) {
    porQueNoHay(productoId, nombre).then(function (msg) {
      var a = document.getElementById('zonaAviso');
      if (a) a.innerHTML = '<div class="aviso warn">' + msg + '</div>';
    });
  }

  /* Agrega un renglon del pedido con la cantidad que pide el centro, o con
     lo que quede si no alcanza. Nunca mas de lo que hay: la base lo
     rechazaria y ademas seria prometer lo que no existe. */
  function agregarDelPedido(x, callado) {
    var av = document.getElementById('zonaAviso');
    return sb.from('v_lotes_para_despachar')
      .select('lote_id,producto_id,producto,lote,vence,existencia,en_cajas,' +
              'empaque,unidades_por_empaque,situacion')
      .eq('producto_id', x.producto_id).limit(1)
      .then(function (r) {
        var l = r.data && r.data[0];
        if (!l) {
          if (!callado) avisaNoHay(x.producto_id, x.producto);
          return false;
        }
        if (cesta.some(function (c) { return c.lote_id === l.lote_id; })) return false;
        var hay = Math.round(Number(l.existencia) || 0);
        var pide = x.cantidad == null ? 1 : Math.round(x.cantidad);
        cesta.push({ lote_id: l.lote_id, producto: l.producto, lote: l.lote,
                     vence: l.vence, disponible: l.existencia,
                     cantidad: Math.max(1, Math.min(pide, hay)),
                     empaque: l.empaque, porEmpaque: l.unidades_por_empaque });
        return pide > hay ? 'corto' : true;
      });
  }

  /* ================================================================
     LO QUE YA SE LE ENTREGO

     Cuando alguien vuelve, lo primero que hace falta saber es que se le
     dio y cuando: si vino hace tres dias por lo mismo, si lleva dos
     meses sin retirar su tratamiento, o si otro despachador ya lo
     atendio esta manana. Antes eso solo se veia saliendo a Mercancia;
     aqui esta al lado de la persona, con el dia, la hora, quien lo
     atendio y que se le entrego.

     Es solo de LECTURA. Corregir una entrega no se hace aqui: se anula,
     que deja constancia. Una entrega anulada sigue apareciendo, tachada
     y con su motivo, porque haberla anulado tambien es historia.
  ================================================================ */

  /* Cuantas visitas se ven de entrada. Con tres se responde "cuando vino
     la ultima vez" sin llenar la pantalla; el resto esta a un toque. */
  var HIST_PRIMERAS = 3;
  /* Cuantos renglones se piden. Una entrega trae uno por medicamento,
     asi que 300 son muchisimas visitas; aun asi puede quedarse corto y
     por eso se avisa en vez de callarlo. */
  var HIST_TOPE = 300;

  function cargarHistorial(tipo, id) {
    var col = tipo === 'institucion' ? 'institucion_id' : 'paciente_id';
    sb.from('v_entregas_renglon')
      .select('entrega_id,fecha,creado_en,origen,anulada,anulada_motivo,' +
              'entregado_por,lo_entregado,renglon_id,producto,dosificacion,' +
              'presentacion,cantidad,en_cajas,lote,vence')
      .eq(col, id)
      /* La fecha manda; entre dos del mismo dia, la hora. El entrega_id
         va de tercero como desempate estable: sin el, dos entregas con
         la misma hora pueden salir en distinto orden en cada consulta. */
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false, nullsFirst: false })
      .order('entrega_id')
      .limit(HIST_TOPE)
      .then(function (r) {
        if (!destino || destino.id !== id) return;      // ya cambio de persona
        /* Un error NO es "nunca se le entrego nada": es "no se pudo
           preguntar". Confundirlos aqui lleva a entregarle dos veces lo
           mismo el mismo dia. */
        if (r.error) {
          destino.historial = null;
          destino.falloHist = r.error.message;
        } else {
          var filas = r.data || [];
          /* Al tope: la última entrega puede venir a medias y se descarta. */
          destino.historial = window.FARM.agrupaEntregas(filas, filas.length >= HIST_TOPE);
          destino.falloHist = null;
        }
        pintarDestino();
      });
  }

  /* Un renglon de lo que se entrego, con su cantidad. */
  function lineaRenglon(y) {
    var nom = [y.producto, y.dosificacion].filter(Boolean).join(' ');
    return '<li>' + esc(nom || 'sin nombre') +
      (y.cantidad == null
        ? ' <em>no consta la cantidad</em>'
        : ' <b>' + Math.round(y.cantidad) + '</b>' +
          (y.en_cajas ? ' <em>' + esc(y.en_cajas) + '</em>' : '')) +
      (y.lote ? ' <em>lote ' + esc(y.lote) + '</em>' : '') +
    '</li>';
  }

  function tarjetaEntrega(e) {
    var hora = window.FARM.horaCaracas(e.creado_en);
    /* Las entregas que vinieron del cuaderno tienen `creado_en` del dia
       en que se cargaron, no del dia en que se entregaron: poner esa
       hora seria inventarla. Solo se muestra la de las del sistema. */
    var conHora = e.origen === 'sistema' && hora;

    return '<li class="hist-item' + (e.anulada ? ' hist-anulada' : '') + '">' +
      '<div class="hist-cab">' +
        '<b>' + fecha(e.fecha) + (conHora ? ' \u00b7 ' + esc(hora) : '') + '</b>' +
        (e.anulada ? '<span class="sit mal">ANULADA</span>' : '') +
      '</div>' +
      '<span class="hist-quien">Entreg\u00f3: ' + esc(e.entregado_por || 'no consta') +
        (e.origen === 'sistema' ? '' : ' \u00b7 viene del cuaderno') + '</span>' +
      (e.renglones.length
        ? '<ul class="hist-meds">' + e.renglones.map(lineaRenglon).join('') + '</ul>'
        : (e.lo_entregado
            ? '<p class="hist-texto">' + esc(e.lo_entregado) + '</p>' +
              '<span class="hist-nota">Del cuaderno: no anotaba la cantidad.</span>'
            : '<span class="hist-nota">No qued\u00f3 anotado qu\u00e9 se entreg\u00f3.</span>')) +
      (e.anulada && e.anulada_motivo
        ? '<span class="hist-nota">Motivo de la anulaci\u00f3n: ' + esc(e.anulada_motivo) + '</span>'
        : '') +
    '</li>';
  }

  function pintarHistorial() {
    var lbl = destino.tipo === 'institucion'
      ? 'Lo que ya se le ha entregado a este centro'
      : 'Lo que ya se le ha entregado';
    var h = destino.historial;

    if (h === undefined) return '<div class="trat"><span class="lbl">' + lbl + '</span>' +
      '<span class="sub chico">Buscando\u2026</span></div>';
    if (h === null) return '<div class="trat"><span class="lbl">' + lbl + '</span>' +
      '<div class="aviso bad">No se pudo leer su historial' +
      (destino.falloHist ? ': ' + esc(destino.falloHist) : '') +
      '. No quiere decir que no se le haya entregado nada.</div></div>';
    if (!h.length) return '<div class="trat"><span class="lbl">' + lbl + '</span>' +
      '<span class="sub chico">No hay ninguna entrega registrada todav\u00eda.</span></div>';

    var ver = histTodo ? h : h.slice(0, HIST_PRIMERAS);
    var quedan = h.length - ver.length;
    /* Las anuladas se ven, pero contarlas junto a las buenas diría que
       se le entregó algo que no se le entregó. Van dichas aparte. */
    var anul = h.filter(function (e) { return e.anulada; }).length;

    return '<div class="trat">' +
      '<span class="lbl">' + lbl + ' \u00b7 ' + h.length +
        (h.length === 1 ? ' entrega' : ' entregas') +
        (anul ? ', ' + anul + (anul === 1 ? ' anulada' : ' anuladas') : '') + '</span>' +
      '<ul class="hist">' + ver.map(tarjetaEntrega).join('') + '</ul>' +
      (quedan > 0
        ? '<button type="button" class="trat-mas" id="histMas">' +
          (quedan === 1 ? 'Ver la anterior' : 'Ver las ' + quedan + ' anteriores') +
          '</button>'
        : (histTodo && h.length > HIST_PRIMERAS
            ? '<button type="button" class="trat-mas" id="histMas">Ver solo las \u00faltimas ' +
              HIST_PRIMERAS + '</button>'
            : '')) +
    '</div>';
  }

  /* Lo que tiene la persona. Se ve, no se toca: aqui se entrega, y
     corregir la ficha clinica se hace en Mercancia > Personas, con calma
     y con todos los campos delante. */
  function pintarPatologias() {
    if (destino.tipo !== 'paciente') return '';
    var p = destino.patologias;
    if (!p) return '';
    return '<div class="trat patologias-ficha">' +
      '<span class="lbl">Sus patologías</span>' +
      '<div class="trat-lista">' +
        String(p).split(' · ').map(function (x) {
          return '<span class="pat-chip">' + esc(x) + '</span>';
        }).join('') +
      '</div></div>';
  }

  function pintarTratamiento() {
    if (destino.tipo !== 'paciente') return '';
    var t = destino.tratamiento;
    if (t === undefined) return '<div class="trat"><span class="lbl">Su tratamiento</span>' +
      '<span class="sub chico">Buscando…</span></div>';
    /* Nulo NO es lo mismo que vacio: vacio es "no toma nada", nulo es "no
       se pudo preguntar". Decir lo primero cuando es lo segundo es mentir
       sobre la ficha de una persona. */
    if (t === null) return '<div class="trat"><span class="lbl">Su tratamiento</span>' +
      '<div class="aviso bad">No se pudo leer su tratamiento' +
      (destino.tratamientoFallo ? ': ' + esc(destino.tratamientoFallo) : '') +
      '. No quiere decir que no tome nada. Vuelve a abrir su ficha.</div></div>';

    /* UNA sola lista. Da igual si el renglon esta enlazado al catalogo o
       escrito a mano: para quien atiende es lo mismo, lo que la persona
       necesita. Lo que cambia es lo que se puede hacer con el: si esta
       enlazado y hay existencia, se toca y se agrega a la entrega. */
    var lista = (t || []).filter(function (x) { return x.producto_id || x.texto_original; });
    var cuantos = lista.length;

    return '<div class="trat">' +
      '<span class="lbl">' + (cuantos
        ? 'Su tratamiento · ' + cuantos + (cuantos === 1 ? ' medicamento' : ' medicamentos')
        : 'Su tratamiento') + '</span>' +

      (cuantos === 0
        ? '<span class="sub chico">Todavía no tiene medicinas anotadas. ' +
          'Anótalas y la próxima vez que venga aparecen aquí de una vez.</span>'
        : '<div class="trat-lista">' + lista.map(function (x, i) {
            var hay = Math.round(Number(x.disponible) || 0);
            var nom = x.producto || x.texto_original;
            var sePuede = !!x.producto_id && hay > 0;
            return '<span class="trat-par">' +
              '<button type="button" class="trat-med' + (sePuede ? '' : ' sin') + '" ' +
                'data-trat="' + i + '"' + (sePuede ? '' : ' disabled') +
                ' title="' + esc(sePuede ? 'Agregar a la entrega' : 'No se puede entregar ahora') + '">' +
                '<span class="tm-nom">' + esc(nom) +
                  (x.dosificacion ? ' <em>' + esc(x.dosificacion) + '</em>' : '') + '</span>' +
                '<span class="tm-hay' +
                  (x.situacion === 'solo_vencido' ? ' tm-venc' : '') + '">' + (x.producto_id
                  ? (hay > 0 ? hay + ' disponibles'
                             : (x.situacion === 'solo_vencido' ? 'solo vencido' : 'sin existencia'))
                  : 'no está en el catálogo') + '</span>' +
              '</button>' +
              (x.tratamiento_id
                ? '<button type="button" class="trat-edita" data-edita="' + esc(x.tratamiento_id) + '" ' +
                  'data-texto="' + esc(nom) + '" ' +
                  'aria-label="Corregir ' + esc(nom) + '" title="Corregir">&#9998;&#65038;</button>' +
                  '<button type="button" class="trat-quita" data-quita="' + esc(x.tratamiento_id) + '" ' +
                  'aria-label="Quitar ' + esc(nom) + ' de su tratamiento" title="Quitar">&#10005;</button>'
                : '') +
            '</span>';
          }).join('') + '</div>') +

      /* Lo que se habia anotado en un formulario que no llego a guardarse
         (la cedula ya existia). No se tira: se ofrece ponerselo aqui. */
      (tratNuevo.length
        ? '<div class="trat-pend"><span class="tp-lbl">Habías anotado ' + tratNuevo.length +
          (tratNuevo.length === 1 ? ' medicina' : ' medicinas') + ' antes de saber que ya estaba registrada</span>' +
          '<span class="tp-lista">' +
          esc(tratNuevo.map(function (x) { return x.producto; }).join(' · ')) + '</span>' +
          '<button type="button" class="trat-mas" id="tratPend">Ponérselas a ' +
          esc(String(destino.titulo).split(' ')[0]) + '</button>' +
          '<button type="button" class="enlace" id="tratTira">Descartarlas</button></div>'
        : '') +

      (tratAbierto
        ? buscadorMedicinas('Busca la medicina que necesita')
        : '<button type="button" class="trat-mas" id="tratMas">+ Anotar una medicina que necesita</button>') +
      '<div id="tratAviso"></div>' +
    '</div>';
  }

  /* El buscador de medicinas es el de picker.js: lo comparten esta
     pantalla y la de Personas. Aquí solo se dice dónde va y qué hacer
     con lo que se elija. */
  function buscadorMedicinas(rotulo) {
    return window.FARMPICK.caja('trat', rotulo, 'Escribe el nombre del medicamento…', tratBusca);
  }

  function engancharBuscador(alElegir) {
    if (!document.getElementById('tratBusca')) return;
    window.FARMPICK.medicinas(sb, 'trat', alElegir);
  }

  /* ---- corregir el tratamiento de alguien que YA está registrado ---- */
  function avisoTrat(clase, txt) {
    var z = document.getElementById('tratAviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    /* En el telefono el aviso cae por debajo del borde y parece que no
       paso nada. Se lleva la vista hasta el. */
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* Compara CRUZADO: lo escrito a mano contra el nombre del catalogo y al
     reves. Sin esto, anotar "losartan" a mano cuando ya tenia LOSARTAN del
     catalogo lo dejaba dos veces. */
  function yaLoTiene(lista, x) {
    var igual = window.FARMPICK.mismo;
    return (lista || []).some(function (t) {
      if (x.producto_id && t.producto_id) return t.producto_id === x.producto_id;
      return igual(t.producto || t.texto_original, x.producto || x.texto_original) ||
             igual(t.texto_original, x.producto) ||
             igual(t.producto, x.texto_original);
    });
  }

  function anotarMedicina(x) {
    if (!destino || destino.tipo !== 'paciente') return;
    var pid = destino.id;

    if (yaLoTiene(destino.tratamiento, x)) {
      avisoTrat('warn', x.producto + ' ya estaba en su tratamiento.');
      return;
    }
    var fila = { paciente_id: pid, activo: true };
    if (x.producto_id) fila.producto_id = x.producto_id;
    else fila.texto_original = x.texto_original;

    sb.from('tratamientos_paciente').insert(fila).select().single().then(function (r) {
      if (r.error) { avisoTrat('bad', 'No se pudo anotar: ' + r.error.message); return; }
      recargarTratamiento(pid, function () {
        avisoTrat('ok', x.producto + ' quedó anotado en su tratamiento.');
      });
    });
  }

  /* Guarda de golpe lo que quedo anotado en el formulario que no llego a
     guardarse. Se salta las que la persona ya tiene. */
  function anotarPendientes() {
    if (!destino || destino.tipo !== 'paciente' || !tratNuevo.length) return;
    var pid = destino.id;
    var nuevas = tratNuevo.filter(function (x) { return !yaLoTiene(destino.tratamiento, x); });
    var repes = tratNuevo.length - nuevas.length;
    if (!nuevas.length) {
      tratNuevo = []; pintarDestino();
      avisoTrat('warn', 'Ya las tenía todas anotadas.');
      return;
    }
    sb.from('tratamientos_paciente').insert(nuevas.map(function (x) {
      var fila = { paciente_id: pid, activo: true };
      if (x.producto_id) fila.producto_id = x.producto_id;
      else fila.texto_original = x.texto_original;
      return fila;
    })).then(function (r) {
      if (r.error) { avisoTrat('bad', 'No se pudieron anotar: ' + r.error.message); return; }
      var n = nuevas.length;
      tratNuevo = [];
      recargarTratamiento(pid, function () {
        avisoTrat('ok', 'Quedaron anotadas ' + n + (n === 1 ? ' medicina' : ' medicinas') +
          (repes ? ' (' + repes + ' ya la' + (repes === 1 ? '' : 's') + ' tenía)' : '') + '.');
      });
    });
  }

  /* Corregir un renglon. Si lo que se escribe coincide con un medicamento
     del catalogo, queda enlazado a el —y entonces se puede entregar de un
     toque—; si no, queda como texto, tal cual se escribio. Es la misma
     regla que usa la pantalla para mostrarlo, asi que no hay sorpresas. */
  function corregirMedicina(tratamientoId, actual) {
    if (!destino || destino.tipo !== 'paciente') return;
    var pid = destino.id;

    var mismos = (destino.tratamiento || []).filter(function (t) {
      return t.tratamiento_id === tratamientoId;
    });
    if (mismos.length > 1) {
      avisoTrat('warn', 'Este renglón trae ' + mismos.length + ' medicinas escritas juntas (' +
        mismos.map(function (m) { return m.producto || m.texto_original; }).join(', ') +
        '). Quítalo y anótalas por separado, así cada una se puede entregar sola.');
      return;
    }

    var nuevo = window.prompt('Corrige el nombre del medicamento:', actual || '');
    if (nuevo == null) return;
    nuevo = nuevo.replace(/\s+/g, ' ').trim();
    if (nuevo.length < 3) { avisoTrat('warn', 'Escribe al menos tres letras.'); return; }
    if (window.FARMPICK.mismo(nuevo, actual)) return;

    if ((destino.tratamiento || []).some(function (t) {
      return t.tratamiento_id !== tratamientoId &&
             window.FARMPICK.mismo(t.producto || t.texto_original, nuevo);
    })) { avisoTrat('warn', nuevo + ' ya está en su tratamiento.'); return; }

    sb.from('v_catalogo').select('producto_id,producto').ilike('producto', nuevo).limit(5)
      .then(function (r) {
        var enCat = (r.data || []).filter(function (c) {
          return window.FARMPICK.mismo(c.producto, nuevo);
        })[0];
        var cambio = enCat
          ? { producto_id: enCat.producto_id, texto_original: null }
          : { producto_id: null, texto_original: nuevo };
        return sb.from('tratamientos_paciente').update(cambio).eq('id', tratamientoId)
          .then(function (u) {
            if (u.error) { avisoTrat('bad', 'No se pudo corregir: ' + u.error.message); return; }
            recargarTratamiento(pid, function () {
              avisoTrat('ok', enCat
                ? 'Quedó como ' + enCat.producto + ', enlazado al catálogo.'
                : 'Quedó como «' + nuevo + '». No está en el catálogo, así que no se ' +
                  'puede entregar de un toque hasta que se cargue.');
            });
          });
      });
  }

  function quitarMedicina(tratamientoId) {
    if (!destino || destino.tipo !== 'paciente') return;
    var pid = destino.id;

    /* Un renglón del Excel puede traer varios medicamentos en un mismo
       texto ("LOSARTAN/METFORMINA"). Se ven separados, pero en la base
       son UNA fila: quitar uno los quita todos. Se dice antes. */
    var mismos = (destino.tratamiento || []).filter(function (t) {
      return t.tratamiento_id === tratamientoId;
    });
    var nombres = mismos.map(function (t) { return t.producto || t.texto_original; });
    var pregunta = mismos.length > 1
      ? '¿Quitar de su tratamiento las ' + mismos.length + ' medicinas de este renglón?\n\n' +
        nombres.join('\n') + '\n\nVienen escritas juntas en el mismo renglón, así que ' +
        'salen todas. Queda registrado con tu nombre.'
      : '¿Quitar ' + (nombres[0] || 'esta medicina') + ' de su tratamiento?\n\n' +
        'Queda registrado con tu nombre y se puede volver a anotar.';
    if (!window.confirm(pregunta)) return;

    /* No se borra: se marca inactiva. La ficha de una persona es un
       historial, y la bitácora deja constancia de quién la cambió. */
    sb.from('tratamientos_paciente').update({ activo: false }).eq('id', tratamientoId)
      .then(function (r) {
        if (r.error) { avisoTrat('bad', 'No se pudo quitar: ' + r.error.message); return; }
        recargarTratamiento(pid, function () {
          avisoTrat('ok', mismos.length > 1
            ? 'Se quitaron ' + mismos.length + ' medicinas de su tratamiento.'
            : 'Se quitó ' + (nombres[0] || 'la medicina') + ' de su tratamiento.');
        });
      });
  }

  function recargarTratamiento(pacienteId, luego) {
    sb.from('v_tratamiento_paciente')
      .select('tratamiento_id,producto_id,producto,dosificacion,texto_original,disponible,situacion')
      .eq('paciente_id', pacienteId)
      .then(function (r) {
        if (!destino || destino.id !== pacienteId) return;
        /* Si la consulta falla NO se puede decir que la persona no toma
           nada: es su ficha clinica. Se deja lo que ya se sabia y se
           avisa de que no se pudo comprobar. */
        if (r.error) {
          pintarDestino();
          avisoTrat('bad', 'No se pudo volver a leer su tratamiento (' + r.error.message +
                           '). Lo que se ve puede estar desactualizado: vuelve a abrir su ficha.');
          return;
        }
        destino.tratamiento = r.data || [];
        pintarDestino();
        if (luego) luego();
      });
  }

  /* Al tocar un medicamento del tratamiento se busca su lote: el que vence
     primero, que es el que hay que sacar. */
  function agregarDelTratamiento(x) {
    sb.from('v_lotes_para_despachar')
      .select('lote_id,producto_id,producto,lote,vence,existencia,en_cajas,'+
              'empaque,unidades_por_empaque,situacion')
      .eq('producto_id', x.producto_id).limit(1)
      .then(function (r) {
        var l = r.data && r.data[0];
        if (!l) { avisaNoHay(x.producto_id, x.producto); return; }
        agregar(l);
      });
  }

  /* ---------------------------------------------------------------- renglones */
  function pintarCesta() {
    var z = document.getElementById('zonaCesta');
    z.innerHTML =
      '<h2>Qué se entrega</h2>' +
      /* Lo que llevas va PRIMERO, con el botón pegado: antes estaba
         debajo de la lista de treinta lotes y había que bajar hasta
         el fondo para ver lo que habías agregado. */
      '<div id="renglones"></div>' +
      '<h2 class="sub-t">Agregar un medicamento</h2>' +
      '<input id="buscaMed" type="search" autocomplete="off" ' +
        'aria-label="Buscar el medicamento" placeholder="Escribe para acotar la lista…">' +
      '<div id="resMed"></div>';

    var caja = document.getElementById('buscaMed');
    caja.addEventListener('input', retardo(function () { buscarMed(caja.value.trim()); }, 280));
    pintarRenglones();
    /* Se muestra de entrada lo que hay, sin obligar a escribir: así se ve
       qué se puede entregar hoy en vez de adivinar nombres. */
    buscarMed('');
  }

  var SIT_TXT = {
    por_vencer_30: { t: 'Vence en 30 días', c: 'ojo' },
    por_vencer_90: { t: 'Vence en 90 días', c: 'ojo' },
    sin_fecha:     { t: 'Sin vencimiento',  c: 'gris' },
    vigente:       { t: 'Vigente',          c: 'ok' }
  };

  /* Numero de busqueda. Se piden dos consultas a la vez y el usuario
     sigue escribiendo: sin esto, una respuesta lenta de hace dos letras
     puede pintarse encima de la buena. */
  var buscaNum = 0;

  /* El cuerpo de la ficha de un lote. Lo comparten la lista de lo que se
     puede entregar y la de lo vencido; lo unico que cambia es que en la
     segunda la fecha ya paso y se dice en pasado. */
  function fichaLote(x, venc) {
    return '<div class="ficha-nom"><b>' + esc(x.producto) + '</b>' +
        /* En los vencidos la fecha va en su propio renglón, sin punto de
           separación: es EL dato que hay que leer, y colgado detrás del
           número de lote se parte a mitad de línea. */
        '<span class="ficha-pres">lote ' + esc(x.lote || 'sin número') +
        (venc ? '<b>venció el ' + fecha(x.vence) + '</b>'
              : ' · vence ' + fecha(x.vence)) +
        '</span></div>' +
      '<div class="ficha-datos">' +
        '<span class="ficha-cant">' + Math.round(x.existencia) + '<em>quedan</em></span>' +
        (x.en_cajas ? '<span class="ficha-cajas">' + esc(x.en_cajas) + '</span>' : '') +
      '</div>';
  }

  /* LO QUE HAY PARA ENTREGAR, Y LO QUE HAY VENCIDO.

     Antes esta pantalla solo consultaba los lotes despachables. El efecto
     era el contrario del que se buscaba: quien atiende escribia el nombre,
     no salia nada, y no tenia forma de saber si es que no habia, si nunca
     se cargo, o si estaba ahi mismo en el estante pero vencido. Ahora
     salen las dos cosas, en dos grupos: arriba lo que se puede entregar,
     abajo lo vencido, apagado y con su etiqueta. */
  function buscarMed(q) {
    var lista = document.getElementById('resMed');
    if (!lista) return;
    lista.innerHTML = '<div class="cargando">Buscando…</div>';
    var mio = ++buscaNum;

    function consulta(vencidos) {
      var p = sb.from('v_lotes_para_ver')
        .select('lote_id,producto_id,producto,dosificacion,lote,vence,existencia,' +
                'en_cajas,empaque,unidades_por_empaque,situacion', { count: 'exact' })
        .eq('es_vencido', vencidos ? 1 : 0);
      if (q.length >= 2) p = p.ilike('producto', '*' + q.replace(/[%,()]/g, '') + '*');
      /* FEFO: el que vence primero es el que hay que sacar. Entre los
         vencidos, primero el que lleva mas tiempo vencido. Los que no
         tienen fecha van al final, que es lo que hacia la vista vieja. */
      return p.order('vence', { nullsFirst: false })
              /* Desempate: muchos lotes vencen el mismo dia. Sin un
                 segundo criterio, el corte de los 30 varia de una
                 consulta a otra y un lote entra y sale solo. */
              .order('lote_id')
              .limit(vencidos ? 15 : 30);
    }

    Promise.all([consulta(false), consulta(true)]).then(function (rr) {
      var zz = document.getElementById('resMed');
      if (!zz || mio !== buscaNum) return;      // llego una busqueda mas nueva
      if (rr[0].error) {
        zz.innerHTML = '<div class="cargando">' + esc(rr[0].error.message) + '</div>';
        return;
      }
      var f = rr[0].data || [];
      /* Si falla la consulta de vencidos no se cae la pantalla: se entrega
         igual y sencillamente no se muestra ese bloque. */
      var v = rr[1].error ? [] : (rr[1].data || []);
      var total  = rr[0].count == null ? f.length : rr[0].count;
      var totalV = rr[1].count == null ? v.length : rr[1].count;

      if (!f.length && !v.length) {
        zz.innerHTML = '<div class="vacio"><b>' +
          (q ? 'No hay nada de «' + esc(q) + '», ni siquiera vencido.'
             : 'No hay nada cargado para entregar.') +
          '</b><span>Se carga en Mercancía → Entrada de mercancía.</span></div>';
        return;
      }

      var partes = [];

      if (f.length) {
        partes.push('<p class="conteo">' + (total > f.length
            ? 'Los ' + f.length + ' primeros de ' + total + ' lotes disponibles. Escribe para acotar.'
            : total + (total === 1 ? ' lote disponible' : ' lotes disponibles')) + '</p>' +
          '<div class="fichas">' + f.map(function (x, i) {
            var m = SIT_TXT[x.situacion] || { t: '', c: 'gris' };
            var yaEsta = cesta.some(function (c) { return c.lote_id === x.lote_id; });
            return '<button type="button" class="ficha" data-i="' + i + '"' +
              (yaEsta ? ' disabled' : '') + '>' + fichaLote(x, false) +
              (yaEsta ? '<span class="sit ok">Ya está</span>'
                      : '<span class="sit ' + m.c + '">' + m.t + '</span>') +
            '</button>';
          }).join('') + '</div>');
      } else {
        partes.push('<div class="vacio"><b>' +
          (q ? 'De «' + esc(q) + '» no hay nada que se pueda entregar.'
             : 'No hay nada vigente para entregar.') +
          '</b><span>Lo que queda está vencido: es lo de abajo.</span></div>');
      }

      if (v.length) {
        partes.push('<div class="venc-caja">' +
          '<p class="venc-lbl">' + totalV +
            (totalV === 1 ? ' lote vencido' : ' lotes vencidos') +
            (totalV > v.length ? ' (se ven los ' + v.length + ' más viejos)' : '') +
            '. No se pueden entregar; hay que darlos de baja en Mercancía.</p>' +
          '<div class="fichas">' + v.map(function (x) {
            return '<button type="button" class="ficha ficha-venc" disabled ' +
              'title="Vencido: el sistema no permite entregarlo">' + fichaLote(x, true) +
              '<span class="sit mal">VENCIDO</span></button>';
          }).join('') + '</div></div>');
      }

      zz.innerHTML = partes.join('');
      /* Solo los de arriba se pueden tocar; los vencidos van disabled y
         sin escuchador, para que no haya forma de meterlos por error. */
      zz.querySelectorAll('.ficha[data-i]').forEach(function (b) {
        b.addEventListener('click', function () { agregar(f[+b.dataset.i]); });
      });
    });
  }

  function agregar(l) {
    if (cesta.some(function (c) { return c.lote_id === l.lote_id; })) return;
    cesta.push({ lote_id: l.lote_id, producto: l.producto, lote: l.lote,
                 vence: l.vence, disponible: l.existencia, cantidad: 1,
                 empaque: l.empaque, porEmpaque: l.unidades_por_empaque });
    pintarRenglones(); refrescarBoton();
    var caja = document.getElementById('buscaMed');
    buscarMed(caja ? caja.value.trim() : '');
    /* Se lleva la vista a lo que acaba de agregarse: si no, en el teléfono
       queda abajo en la lista y no se ve que pasó nada. */
    var cst = document.getElementById('renglones');
    if (cst && cst.scrollIntoView) cst.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* Lo mismo dicho en cajas, cuando el medicamento viene empacado. */
  function enCajas(unidades, c) {
    var n = c && c.porEmpaque;
    if (!(n > 1) || !(unidades > 0)) return '';
    var emp = c.empaque || 'caja';
    var cajas = Math.floor(unidades / n), sueltas = unidades % n;
    var t = [];
    if (cajas) t.push(cajas + ' ' + emp + (cajas === 1 ? '' : 's'));
    if (sueltas) t.push(sueltas + ' suelta' + (sueltas === 1 ? '' : 's'));
    return t.join(' y ');
  }

  function pintarRenglones() {
    var z = document.getElementById('renglones');
    if (!z) return;

    if (!cesta.length) {
      z.innerHTML =
        '<div class="vacio"><b>Todavía no has agregado nada.</b>' +
        '<span>' + (destino && destino.tipo === 'paciente'
          ? 'Toca un medicamento de su tratamiento, arriba, o búscalo en la lista de abajo.'
          : 'Búscalo en la lista de abajo.') + '</span></div>';
      return;
    }

    var unidades = cesta.reduce(function (s, c) { return s + Number(c.cantidad || 0); }, 0);

    z.innerHTML =
      '<p class="conteo">' + cesta.length +
        (cesta.length === 1 ? ' medicamento' : ' medicamentos') + ' · ' +
        unidades + (unidades === 1 ? ' unidad' : ' unidades') + '</p>' +
      '<div class="cesta">' + cesta.map(function (c, i) {
        var max = Math.round(c.disponible);
        return '<div class="cesta-item">' +
          '<div class="ci-nom"><b>' + esc(c.producto) + '</b>' +
            '<span>lote ' + esc(c.lote || 'sin número') + ' · vence ' + fecha(c.vence) + '</span>' +
          '</div>' +
          '<div class="ci-cant">' +
            '<button type="button" class="paso" data-menos="' + i + '" aria-label="Una menos"' +
              (c.cantidad <= 1 ? ' disabled' : '') + '>−</button>' +
            '<input class="cant" type="number" min="1" max="' + max + '" value="' + c.cantidad + '" ' +
              'data-i="' + i + '" inputmode="numeric" aria-label="Cuántas unidades de ' +
              esc(c.producto) + '">' +
            '<button type="button" class="paso" data-mas="' + i + '" aria-label="Una más"' +
              (c.cantidad >= max ? ' disabled' : '') + '>+</button>' +
            '<span class="ci-tope">de ' + max +
              (enCajas(c.cantidad, c) ? '<em>' + esc(enCajas(c.cantidad, c)) + '</em>' : '') +
            '</span>' +
          '</div>' +
          '<button type="button" class="ci-quitar" data-q="' + i + '" ' +
            'aria-label="Quitar ' + esc(c.producto) + ' de la entrega">✕</button>' +
        '</div>';
      }).join('') + '</div>' +
      /* Antes esto era una linea gris debajo del boton y el boton iba
         deshabilitado. Al tocarlo no pasaba nada de nada, y quien
         atiende se quedaba sin saber por que. */
      (destino ? '' :
        '<div class="aviso warn"><b>Falta elegir a quién se le entrega</b>' +
        'Los medicamentos ya están puestos. Busca arriba a la persona o ' +
        'al centro y toca su nombre.</div>') +
      '<div class="botonera">' +
        /* Nunca deshabilitado: si falta algo, el boton lo dice y lleva
           hasta donde se arregla. */
        '<button type="button" class="principal" id="btnRegistrar">' +
        (destino
          ? 'Registrar la entrega · ' + unidades + (unidades === 1 ? ' unidad' : ' unidades')
          : 'Elegir a quién se le entrega') +
        '</button>' +
      '</div>';

    document.getElementById('btnRegistrar').addEventListener('click', registrar);

    function pon(i, valor) {
      var max = Math.round(cesta[i].disponible);
      cesta[i].cantidad = Math.max(1, Math.min(valor, max));
      pintarRenglones();
      /* La lista de abajo marca lo que ya está en la entrega. */
      var caja = document.getElementById('buscaMed');
      if (caja) buscarMed(caja.value.trim());
    }

    z.querySelectorAll('[data-menos]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.menos; pon(i, cesta[i].cantidad - 1);
      });
    });
    z.querySelectorAll('[data-mas]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.mas; pon(i, cesta[i].cantidad + 1);
      });
    });
    z.querySelectorAll('.cant').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.dataset.i, v = parseInt(inp.value, 10);
        cesta[i].cantidad = isNaN(v) || v < 1 ? 1 : Math.min(v, Math.round(cesta[i].disponible));
        refrescarBoton();
      });
      inp.addEventListener('blur', function () { pintarRenglones(); });
      inp.addEventListener('focus', function () { inp.select(); });
    });
    z.querySelectorAll('.ci-quitar').forEach(function (b) {
      b.addEventListener('click', function () {
        cesta.splice(+b.dataset.q, 1);
        pintarRenglones();
        var caja = document.getElementById('buscaMed');
        if (caja) buscarMed(caja.value.trim());
      });
    });
  }

  /* Se llama desde fuera cuando cambia el destino: el botón depende de que
     haya alguien a quien entregarle. */
  function refrescarBoton() {
    /* Se toca el boton EN SITIO, sin volver a pintar la cesta. Si se
       repintara, la casilla de la cantidad se rehace mientras la
       persona escribe y pierde el cursor a media cifra. */
    var b = document.getElementById('btnRegistrar');
    if (!b) return;
    var u = cesta.reduce(function (t, c) { return t + Number(c.cantidad || 0); }, 0);
    b.textContent = destino
      ? 'Registrar la entrega · ' + u + (u === 1 ? ' unidad' : ' unidades')
      : 'Elegir a quién se le entrega';
  }

  /* ---------------------------------------------------------------- registrar */
  function registrar() {
    var btn = document.getElementById('btnRegistrar');
    var av = document.getElementById('zonaAviso');
    av.innerHTML = '';

    if (!destino) {
      aviso('warn', 'Falta elegir a quién se le entrega. Busca arriba a la persona ' +
                    'o al centro y toca su nombre.');
      /* No basta con decir "arriba": se sube y se pone el cursor ahi. */
      var c = document.getElementById('buscaDestino');
      if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.focus(); }
      return;
    }
    if (!cesta.length) { aviso('warn', 'No has agregado ningún medicamento.'); return; }

    var cab = { tipo_destinatario: destino.tipo, origen: 'sistema',
                clave_idempotencia: 'e-' + destino.id + '-' + Date.now() };
    if (destino.tipo === 'paciente') {
      cab.paciente_id = destino.id;
    } else {
      cab.institucion_id = destino.id;
      var rn = document.getElementById('recibeNombre');
      var rc = document.getElementById('recibeCedula');
      cab.recibe_nombre = rn ? rn.value.trim() : '';
      cab.recibe_cedula = rc ? rc.value.replace(/\D/g, '') || null : null;
      if (cab.recibe_nombre.length < 3) {
        aviso('warn', 'Para entregar a un centro hay que anotar quién recibe.');
        if (rn) rn.focus();
        return;
      }
    }

    btn.disabled = true; btn.textContent = 'Registrando…';

    sb.from('entregas').insert(cab).select().single().then(function (r) {
      if (r.error) throw r.error;
      var idEnt = r.data.id;
      return sb.from('entrega_detalle').insert(cesta.map(function (c) {
        return { entrega_id: idEnt, lote_id: c.lote_id, cantidad: c.cantidad };
      })).select().then(function (d) {
        if (d.error) throw d.error;
        return { id: idEnt, n: (d.data || []).length };
      });
    }).then(function (res) {
      /* Se guarda copia de lo entregado ANTES de vaciar la cesta, para
         poder imprimir el acta o el comprobante después. */
      var papel = {
        /* La misma fecha que guarda la base: la de Venezuela. Con
           toISOString el papel salia con el dia de mañana a partir de las
           ocho de la noche. */
        fecha: (window.FARM && window.FARM.hoyCaracas)
          ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10),
        tipo: destino.tipo,
        centro: destino.titulo,
        centroTipo: (destino.sub || '').split(' · ')[0],
        paciente: destino.titulo,
        cedula: destino.sub,
        recibeNombre: cab.recibe_nombre || '',
        recibeCedula: cab.recibe_cedula || '',
        entregaNombre: (yo && yo.nombre) || '',
        entregaCedula: '',
        renglones: cesta.map(function (c) {
          return { producto: c.producto, lote: c.lote, vence: c.vence, cantidad: c.cantidad };
        })
      };

      aviso('ok', 'Entrega registrada para ' + destino.titulo + ': ' +
                  res.n + (res.n === 1 ? ' medicamento' : ' medicamentos') +
                  '. Ya quedó descontado del inventario.');
      var atendido = ultimo;
      destino = null; cesta = []; olvidaTratamiento();
      /* Tambien se limpia la busqueda. Si no, el nombre sigue escrito y
         la persona sigue en la lista de abajo, y parece que sigue
         elegida cuando ya no lo esta. */
      bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };
      pintarDestino(); pintarCesta();
      ofrecerPapel(papel);
      ofrecerOtraVez(atendido, papel.tipo === 'institucion' ? papel.centro : papel.paciente);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (err) {
      // Nunca decimos "guardado" si el servidor no confirmó.
      aviso('bad', traducir(err));
      btn.disabled = false; btn.textContent = 'Registrar la entrega';
    });
  }

  function traducir(err) {
    var m = (err && err.message ? err.message : String(err));
    if (/venci/i.test(m)) return 'Ese lote está vencido: el sistema no permite entregarlo. ' + m;
    if (/No hay suficiente/i.test(m)) return m;
    if (/dado de baja/i.test(m)) return m;
    if (/duplicate key|23505/i.test(m)) return 'Esa entrega ya se había registrado. Revisa antes de repetirla.';
    if (/Failed to fetch|NetworkError/i.test(m))
      return 'Se cayó la conexión y NO se registró la entrega. Vuelve a intentar cuando tengas internet.';
    return 'No se pudo registrar: ' + m;
  }

  /* Al terminar una entrega se ofrece el documento: el acta que firma el
     centro de salud, o el comprobante de la persona. Se ofrece, no se
     descarga solo: no siempre hace falta imprimirlo. */
  function ofrecerPapel(papel) {
    var z = document.getElementById('zonaAviso');
    if (!z || !window.FARMREP) return;
    var esCentro = papel.tipo === 'institucion';
    var caja = document.createElement('div');
    caja.className = 'descargas';
    caja.innerHTML = '<button type="button" id="btnPapel">' +
      (esCentro ? 'Descargar el acta de entrega-recepción' : 'Descargar el comprobante') +
      '</button>';
    z.appendChild(caja);
    document.getElementById('btnPapel').addEventListener('click', function () {
      if (esCentro) window.FARMREP.acta(papel);
      else window.FARMREP.comprobante(papel);
    });
  }

  /* Media de las veces, lo siguiente que se quiere es darle otra cosa a
     la misma persona. Antes habia que volver a buscarla; y como la
     pantalla parecia haberla dejado elegida, se agregaban medicinas sin
     destino y el boton no dejaba registrar. */
  function ofrecerOtraVez(x, nombre) {
    var z = document.getElementById('zonaAviso');
    if (!z || !x) return;
    var caja = document.createElement('div');
    caja.className = 'descargas';
    caja.innerHTML = '<button type="button" id="btnOtraVez">Entregarle otra cosa a ' +
      esc(String(nombre || '').split(' ')[0] || 'la misma persona') + '</button>';
    z.appendChild(caja);
    document.getElementById('btnOtraVez').addEventListener('click', function () {
      elegirDestino(x);
      z.innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function aviso(clase, texto) {
    document.getElementById('zonaAviso').innerHTML =
      '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  /* ---------------------------------------------------------------- entrada */
  window.PANTALLA_DESPACHO = function (cliente, contenedor, usuario) {
    sb = cliente; ancla = contenedor; yo = usuario || null;
    cesta = []; destino = null; modo = 'paciente'; ultimo = null;
    olvidaTratamiento();
    bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };
    pintar();
  };
})();
