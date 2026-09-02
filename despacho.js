/* Pantalla de ENTREGA de medicamentos.
   La usan los despachadores todo el día, casi siempre desde el teléfono.
   Objetivo: de que llega la persona a que queda registrada la entrega,
   en el menor número de toques posible. */
(function () {
  'use strict';

  var sb = null, ancla = null, cesta = [], destino = null, modo = 'paciente';

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
        modo = b.dataset.modo; destino = null; cesta = [];
        ancla.querySelectorAll('.conmuta button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        pintarDestino(); pintarCesta();
      });
    });
    pintarDestino(); pintarCesta();
  }

  /* ---------------------------------------------------------------- destino */
  function pintarDestino() {
    var z = document.getElementById('zonaDestino');
    if (destino) {
      z.innerHTML =
        '<div class="elegido">' +
          '<div><b>' + esc(destino.titulo) + '</b><span>' + esc(destino.sub) + '</span></div>' +
          '<button type="button" class="quitar" id="cambiarDestino">Cambiar</button>' +
        '</div>' +
        (destino.tratamiento ? '<div class="trat"><span class="lbl">Su tratamiento</span>' +
           esc(destino.tratamiento) + '</div>' : '') +
        (modo === 'institucion' ?
          '<label for="recibeNombre">Quién recibe</label>' +
          '<input id="recibeNombre" type="text" placeholder="Nombre y apellido de quien firma" autocomplete="off">' +
          '<label for="recibeCedula">Su cédula</label>' +
          '<input id="recibeCedula" type="text" inputmode="numeric" placeholder="Solo números">' : '');
      document.getElementById('cambiarDestino').addEventListener('click', function () {
        destino = null; pintarDestino();
      });
      return;
    }

    z.innerHTML =
      '<label for="buscaDestino">' +
        (modo === 'paciente' ? 'Buscar a la persona' : 'Buscar el centro de salud') + '</label>' +
      '<input id="buscaDestino" type="search" autocomplete="off" ' +
        'placeholder="' + (modo === 'paciente' ? 'Cédula o nombre…' : 'Nombre del CDI…') + '">' +
      '<div id="resultados" class="lista"></div>';

    var caja = document.getElementById('buscaDestino');
    caja.addEventListener('input', retardo(function () { buscarDestino(caja.value.trim()); }, 280));
    caja.focus();
  }

  function buscarDestino(q) {
    var lista = document.getElementById('resultados');
    if (!lista) return;
    if (q.length < 2) { lista.innerHTML = ''; return; }
    lista.innerHTML = '<div class="cargando">Buscando…</div>';

    var p;
    if (modo === 'paciente') {
      var t = q.replace(/[%,()]/g, '');
      p = sb.from('pacientes')
            .select('id,nombre,cedula,nacionalidad,cedula_cruda,estado,telefono,direccion')
            .or('cedula.ilike.*' + t + '*,nombre.ilike.*' + t + '*')
            .order('nombre').limit(12);
    } else {
      p = sb.from('instituciones').select('id,nombre,tipo,direccion,responsable')
            .ilike('nombre', '*' + q.replace(/[%,()]/g, '') + '*')
            .eq('activo', true).order('nombre').limit(12);
    }

    p.then(function (r) {
      if (r.error) { lista.innerHTML = '<div class="cargando">No se pudo buscar. ' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      if (!f.length) {
        lista.innerHTML = '<div class="cargando">No aparece nadie con eso.' +
          (modo === 'paciente' ? ' <button type="button" class="enlace" id="nuevoPac">Registrar persona nueva</button>' : '') +
          '</div>';
        var np = document.getElementById('nuevoPac');
        if (np) np.addEventListener('click', function () { formNuevoPaciente(q); });
        return;
      }
      lista.innerHTML = f.map(function (x, i) {
        if (modo === 'paciente') {
          var ced = x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula
                             : '<i>' + esc(x.cedula_cruda || 'sin cédula') + '</i>';
          return '<button type="button" class="item" data-i="' + i + '">' +
                 '<b>' + esc(x.nombre) + '</b><span>' + ced +
                 (x.estado === 'por_revisar' ? ' · <em class="ojo">revisar sus datos</em>' : '') +
                 '</span></button>';
        }
        return '<button type="button" class="item" data-i="' + i + '">' +
               '<b>' + esc(x.nombre) + '</b><span>' + esc(x.tipo || '') +
               (x.direccion ? ' · ' + esc(x.direccion) : '') + '</span></button>';
      }).join('');

      lista.querySelectorAll('.item').forEach(function (b) {
        b.addEventListener('click', function () { elegirDestino(f[+b.dataset.i]); });
      });
    });
  }

  function elegirDestino(x) {
    if (modo === 'paciente') {
      destino = { tipo: 'paciente', id: x.id, titulo: x.nombre,
                  sub: (x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula : 'sin cédula válida') +
                       (x.telefono ? ' · ' + x.telefono : '') };
      pintarDestino();
      sb.from('tratamientos_paciente').select('texto_original').eq('paciente_id', x.id).limit(1)
        .then(function (r) {
          var t = r.data && r.data[0] ? r.data[0].texto_original : null;
          if (t) { destino.tratamiento = t; pintarDestino(); }
        });
    } else {
      destino = { tipo: 'institucion', id: x.id, titulo: x.nombre, sub: x.tipo || 'Centro de salud' };
      pintarDestino();
    }
  }

  /* ------------------------------------------------- registrar a alguien nuevo */
  function formNuevoPaciente(texto) {
    var z = document.getElementById('zonaDestino');
    var soloNum = /^\d{6,9}$/.test(texto.replace(/\D/g, '')) ? texto.replace(/\D/g, '') : '';
    z.innerHTML =
      '<h2>Registrar persona nueva</h2>' +
      '<label for="nNombre">Nombre y apellido</label>' +
      '<input id="nNombre" type="text" value="' + esc(soloNum ? '' : texto) + '">' +
      '<label for="nCedula">Cédula</label>' +
      '<input id="nCedula" type="text" inputmode="numeric" value="' + esc(soloNum) + '" placeholder="Solo números">' +
      '<label for="nTelefono">Teléfono <span class="opc">(opcional)</span></label>' +
      '<input id="nTelefono" type="tel" inputmode="tel">' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="guardarPac">Registrar y continuar</button>' +
        '<button type="button" class="secundario" id="cancelarPac">Cancelar</button>' +
      '</div>' +
      '<div id="errPac" class="aviso bad" hidden></div>';

    document.getElementById('cancelarPac').addEventListener('click', pintarDestino);
    document.getElementById('guardarPac').addEventListener('click', function () {
      var nom = document.getElementById('nNombre').value.trim();
      var ced = document.getElementById('nCedula').value.replace(/\D/g, '');
      var err = document.getElementById('errPac');
      if (nom.length < 4) { err.textContent = 'Escribe el nombre completo.'; err.hidden = false; return; }
      if (!/^\d{6,9}$/.test(ced)) { err.textContent = 'La cédula debe tener entre 6 y 9 números.'; err.hidden = false; return; }
      err.hidden = true;
      sb.from('pacientes').insert({
        nombre: nom, cedula: ced, nacionalidad: 'V', cedula_cruda: ced,
        telefono: document.getElementById('nTelefono').value.trim() || null, estado: 'activo'
      }).select().single().then(function (r) {
        if (r.error) {
          err.textContent = r.error.code === '23505'
            ? 'Esa cédula ya está registrada. Búscala arriba.'
            : 'No se pudo guardar. ' + r.error.message;
          err.hidden = false; return;
        }
        elegirDestino(r.data);
      });
    });
  }

  /* ---------------------------------------------------------------- renglones */
  function pintarCesta() {
    var z = document.getElementById('zonaCesta');
    z.innerHTML =
      '<h2>Qué se entrega</h2>' +
      '<label for="buscaMed">Buscar el medicamento</label>' +
      '<input id="buscaMed" type="search" autocomplete="off" placeholder="Nombre del medicamento…">' +
      '<div id="resMed" class="lista"></div>' +
      '<div id="renglones"></div>' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="btnRegistrar"' +
        (cesta.length && destino ? '' : ' disabled') + '>Registrar la entrega</button>' +
      '</div>';

    var caja = document.getElementById('buscaMed');
    caja.addEventListener('input', retardo(function () { buscarMed(caja.value.trim()); }, 280));
    document.getElementById('btnRegistrar').addEventListener('click', registrar);
    pintarRenglones();
  }

  function buscarMed(q) {
    var lista = document.getElementById('resMed');
    if (!lista) return;
    if (q.length < 3) { lista.innerHTML = ''; return; }
    lista.innerHTML = '<div class="cargando">Buscando…</div>';

    // La vista ya viene ordenada por el que vence primero (FEFO) y sin vencidos.
    sb.from('v_lotes_para_despachar')
      .select('lote_id,producto_id,producto,lote,vence,existencia,situacion')
      .ilike('producto', '*' + q.replace(/[%,()]/g, '') + '*')
      .limit(20)
      .then(function (r) {
        if (r.error) { lista.innerHTML = '<div class="cargando">' + esc(r.error.message) + '</div>'; return; }
        var f = r.data || [];
        if (!f.length) {
          lista.innerHTML = '<div class="cargando">No hay existencia disponible de eso. ' +
            'Puede estar agotado o vencido.</div>';
          return;
        }
        lista.innerHTML = f.map(function (x, i) {
          var alerta = x.situacion === 'por_vencer_30' ? ' <em class="ojo">vence pronto</em>' : '';
          return '<button type="button" class="item" data-i="' + i + '">' +
                 '<b>' + esc(x.producto) + '</b>' +
                 '<span>lote ' + esc(x.lote || 'sin número') + ' · vence ' + fecha(x.vence) +
                 ' · quedan ' + Math.round(x.existencia) + alerta + '</span></button>';
        }).join('');
        lista.querySelectorAll('.item').forEach(function (b) {
          b.addEventListener('click', function () { agregar(f[+b.dataset.i]); });
        });
      });
  }

  function agregar(l) {
    if (cesta.some(function (c) { return c.lote_id === l.lote_id; })) return;
    cesta.push({ lote_id: l.lote_id, producto: l.producto, lote: l.lote,
                 vence: l.vence, disponible: l.existencia, cantidad: 1 });
    document.getElementById('buscaMed').value = '';
    document.getElementById('resMed').innerHTML = '';
    pintarRenglones(); refrescarBoton();
  }

  function pintarRenglones() {
    var z = document.getElementById('renglones');
    if (!z) return;
    if (!cesta.length) { z.innerHTML = ''; return; }
    z.innerHTML = '<div class="renglones">' + cesta.map(function (c, i) {
      return '<div class="renglon">' +
        '<div class="que"><b>' + esc(c.producto) + '</b>' +
        '<span>lote ' + esc(c.lote || 'sin número') + ' · vence ' + fecha(c.vence) +
        ' · quedan ' + Math.round(c.disponible) + '</span></div>' +
        '<input class="cant" type="number" min="1" max="' + Math.round(c.disponible) + '" ' +
          'value="' + c.cantidad + '" data-i="' + i + '" inputmode="numeric" aria-label="Cantidad">' +
        '<button type="button" class="quitar" data-q="' + i + '" aria-label="Quitar">✕</button>' +
      '</div>';
    }).join('') + '</div>';

    z.querySelectorAll('.cant').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.dataset.i, v = parseInt(inp.value, 10);
        cesta[i].cantidad = isNaN(v) || v < 1 ? 1 : Math.min(v, Math.round(cesta[i].disponible));
        refrescarBoton();
      });
    });
    z.querySelectorAll('.quitar').forEach(function (b) {
      b.addEventListener('click', function () {
        cesta.splice(+b.dataset.q, 1); pintarRenglones(); refrescarBoton();
      });
    });
  }

  function refrescarBoton() {
    var b = document.getElementById('btnRegistrar');
    if (b) b.disabled = !(cesta.length && destino);
  }

  /* ---------------------------------------------------------------- registrar */
  function registrar() {
    var btn = document.getElementById('btnRegistrar');
    var av = document.getElementById('zonaAviso');
    av.innerHTML = '';

    if (!destino) { aviso('warn', 'Falta elegir a quién se le entrega.'); return; }
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
      aviso('ok', 'Entrega registrada para ' + destino.titulo + ': ' +
                  res.n + (res.n === 1 ? ' medicamento' : ' medicamentos') +
                  '. Ya quedó descontado del inventario.');
      destino = null; cesta = [];
      pintarDestino(); pintarCesta();
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

  function aviso(clase, texto) {
    document.getElementById('zonaAviso').innerHTML =
      '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  /* ---------------------------------------------------------------- entrada */
  window.PANTALLA_DESPACHO = function (cliente, contenedor) {
    sb = cliente; ancla = contenedor;
    cesta = []; destino = null; modo = 'paciente';
    pintar();
  };
})();
