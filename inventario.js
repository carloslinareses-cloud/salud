/* Pantalla de INVENTARIO: registrar lo que llega, ver los vencimientos
   y corregir existencias tras un conteo. La usa una sola persona. */
(function () {
  'use strict';

  var sb = null, ancla = null, pestana = 'alertas';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fecha(f) {
    if (!f) return 'sin fecha';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : f;
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function aviso(clase, texto) {
    var z = document.getElementById('avisoInv');
    if (z) z.innerHTML = '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="conmuta">' +
          '<button type="button" data-p="alertas">Alertas</button>' +
          '<button type="button" data-p="entrada">Registrar lo que llega</button>' +
          '<button type="button" data-p="ajuste">Corregir existencia</button>' +
        '</div>' +
        '<div id="zonaInv"></div>' +
        '<div id="avisoInv"></div>' +
      '</div>';
    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.addEventListener('click', function () { pestana = b.dataset.p; pintar(); });
      b.classList.toggle('on', b.dataset.p === pestana);
    });
    if (pestana === 'alertas') verAlertas();
    else if (pestana === 'entrada') formEntrada();
    else formAjuste();
  }

  /* ---------------------------------------------------------------- alertas */
  function verAlertas() {
    var z = document.getElementById('zonaInv');
    z.innerHTML = '<div class="cargando">Revisando el inventario…</div>';

    sb.from('v_alertas').select('*').order('vence').limit(500).then(function (r) {
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      var venc = f.filter(function (x) { return x.tipo === 'vencido'; });
      var p30  = f.filter(function (x) { return x.tipo === 'por_vencer_30'; });
      var p90  = f.filter(function (x) { return x.tipo === 'por_vencer_90'; });
      var suma = function (a) { return a.reduce(function (s, x) { return s + Number(x.existencia || 0); }, 0); };

      z.innerHTML =
        '<div class="cifras">' +
          tarjeta(venc.length, 'lotes vencidos', 'alerta') +
          tarjeta(Math.round(suma(venc)), 'unidades vencidas', 'alerta') +
          tarjeta(p30.length, 'vencen en 30 días', p30.length ? 'alerta' : '') +
          tarjeta(p90.length, 'vencen en 90 días', '') +
        '</div>' +
        bloque('Vencidos — no se pueden entregar', venc, true) +
        bloque('Vencen dentro de 30 días — úsalos primero', p30, false) +
        bloque('Vencen dentro de 90 días', p90, false);

      z.querySelectorAll('[data-baja]').forEach(function (b) {
        b.addEventListener('click', function () { darDeBaja(b.dataset.baja, b.dataset.nombre, b.dataset.cant); });
      });
    });
  }

  function tarjeta(n, txt, clase) {
    return '<div class="cifra ' + clase + '"><b>' + n + '</b><span>' + txt + '</span></div>';
  }

  function bloque(titulo, filas, conBaja) {
    if (!filas.length) return '';
    return '<h3 class="sub-t">' + esc(titulo) + '</h3><div class="renglones">' +
      filas.map(function (x) {
        return '<div class="renglon">' +
          '<div class="que"><b>' + esc(x.producto) + '</b>' +
          '<span>lote ' + esc(x.lote || 'sin número') + ' · vence ' + fecha(x.vence) +
          ' · ' + Math.round(x.existencia) + ' unidades</span></div>' +
          (conBaja ? '<button type="button" class="quitar" data-baja="' + x.lote_id + '" ' +
            'data-nombre="' + esc(x.producto) + '" data-cant="' + Math.round(x.existencia) + '">Dar de baja</button>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  function darDeBaja(loteId, nombre, cant) {
    if (!window.confirm('¿Dar de baja ' + cant + ' unidades de ' + nombre + '?\n\n' +
        'Quedará registrado quién lo hizo y cuándo. No se puede deshacer, ' +
        'pero sí corregir con un ajuste.')) return;

    sb.from('movimientos').insert({
      lote_id: loteId, tipo: 'baja', cantidad: -Math.abs(Number(cant)),
      motivo: 'Baja por vencimiento', origen: 'sistema'
    }).then(function (r) {
      if (r.error) { aviso('bad', 'No se pudo dar de baja: ' + r.error.message); return; }
      return sb.from('lotes').update({ estado: 'dado_de_baja' }).eq('id', loteId).then(function () {
        aviso('ok', 'Se dieron de baja ' + cant + ' unidades de ' + nombre + '. Quedó registrado.');
        verAlertas();
      });
    });
  }

  /* ------------------------------------------------------ entrada de mercancía */
  function formEntrada() {
    var z = document.getElementById('zonaInv');
    z.innerHTML =
      '<h3 class="sub-t">Registrar mercancía que llega</h3>' +
      '<label for="eProd">Medicamento o insumo</label>' +
      '<input id="eProd" type="search" autocomplete="off" placeholder="Escribe el nombre…">' +
      '<div id="eRes" class="lista"></div>' +
      '<div id="eElegido"></div>';

    var caja = document.getElementById('eProd');
    caja.addEventListener('input', retardo(function () { buscarProducto(caja.value.trim()); }, 280));
    caja.focus();
  }

  function buscarProducto(q) {
    var lista = document.getElementById('eRes');
    if (q.length < 3) { lista.innerHTML = ''; return; }
    lista.innerHTML = '<div class="cargando">Buscando…</div>';
    sb.from('productos').select('id,nombre,categoria')
      .ilike('nombre', '*' + q.replace(/[%,()]/g, '') + '*').eq('activo', true)
      .order('nombre').limit(15)
      .then(function (r) {
        var f = (r.data || []);
        lista.innerHTML = f.map(function (x, i) {
          return '<button type="button" class="item" data-i="' + i + '"><b>' + esc(x.nombre) + '</b>' +
                 '<span>' + esc(x.categoria) + '</span></button>';
        }).join('') +
        '<button type="button" class="item nuevo" data-nuevo="1"><b>+ Es uno nuevo</b>' +
        '<span>Crear "' + esc(q) + '" en el catálogo</span></button>';

        lista.querySelectorAll('.item').forEach(function (b) {
          b.addEventListener('click', function () {
            if (b.dataset.nuevo) crearProducto(q);
            else formLote(f[+b.dataset.i]);
          });
        });
      });
  }

  function crearProducto(nombre) {
    sb.from('productos').insert({ nombre: nombre, categoria: 'medicamento' })
      .select().single().then(function (r) {
        if (r.error) {
          aviso('bad', r.error.code === '23505'
            ? 'Ese medicamento ya está en el catálogo, búscalo arriba.'
            : 'No se pudo crear: ' + r.error.message);
          return;
        }
        formLote(r.data);
      });
  }

  function formLote(prod) {
    document.getElementById('eRes').innerHTML = '';
    document.getElementById('eProd').value = '';
    document.getElementById('eElegido').innerHTML =
      '<div class="elegido"><div><b>' + esc(prod.nombre) + '</b>' +
      '<span>' + esc(prod.categoria) + '</span></div></div>' +
      '<label for="lCodigo">Número de lote <span class="opc">(como viene en la caja)</span></label>' +
      '<input id="lCodigo" type="text" autocomplete="off">' +
      '<label for="lVence">Fecha de vencimiento</label>' +
      '<input id="lVence" type="date">' +
      '<label for="lCant">Cuántas unidades llegaron</label>' +
      '<input id="lCant" type="number" min="1" inputmode="numeric">' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="lGuardar">Registrar la entrada</button>' +
        '<button type="button" class="secundario" id="lCancelar">Cancelar</button>' +
      '</div>';

    document.getElementById('lCancelar').addEventListener('click', formEntrada);
    document.getElementById('lGuardar').addEventListener('click', function () {
      var cod = document.getElementById('lCodigo').value.trim() || null;
      var ven = document.getElementById('lVence').value || null;
      var can = parseInt(document.getElementById('lCant').value, 10);
      if (!can || can < 1) { aviso('warn', 'Falta cuántas unidades llegaron.'); return; }
      if (!ven) {
        if (!window.confirm('No pusiste fecha de vencimiento.\n\n' +
            'Sin ella el sistema no puede avisar cuándo se vence ni ordenar por el que vence primero. ' +
            '¿Registrar igual?')) return;
      }
      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';

      sb.from('lotes').insert({ producto_id: prod.id, codigo: cod, vence: ven })
        .select().single().then(function (r) {
          // si el lote ya existía, lo reutilizamos en vez de fallar
          if (r.error && r.error.code === '23505') {
            return sb.from('lotes').select('id').eq('producto_id', prod.id)
              .eq('codigo', cod).eq('vence', ven).single();
          }
          if (r.error) throw r.error;
          return r;
        }).then(function (r) {
          if (r.error) throw r.error;
          return sb.from('movimientos').insert({
            lote_id: r.data.id, tipo: 'entrada', cantidad: can,
            motivo: 'Entrada de mercancía', origen: 'sistema'
          });
        }).then(function (r) {
          if (r && r.error) throw r.error;
          aviso('ok', 'Registradas ' + can + ' unidades de ' + prod.nombre +
                      (cod ? ' (lote ' + cod + ')' : '') + '. Ya están disponibles.');
          formEntrada();
        }).catch(function (e) {
          aviso('bad', 'No se pudo registrar: ' + (e.message || e));
          btn.disabled = false; btn.textContent = 'Registrar la entrada';
        });
    });
  }

  /* ---------------------------------------------------------------- ajustes */
  function formAjuste() {
    var z = document.getElementById('zonaInv');
    z.innerHTML =
      '<h3 class="sub-t">Corregir existencia tras un conteo</h3>' +
      '<p class="sub">Busca el lote, escribe cuántas unidades hay <b>de verdad</b> y el sistema ' +
      'registra la diferencia. Queda constancia de quién lo hizo y por qué.</p>' +
      '<label for="aProd">Buscar el lote</label>' +
      '<input id="aProd" type="search" autocomplete="off" placeholder="Nombre del medicamento…">' +
      '<div id="aRes" class="lista"></div>' +
      '<div id="aElegido"></div>';

    var caja = document.getElementById('aProd');
    caja.addEventListener('input', retardo(function () {
      var q = caja.value.trim();
      var lista = document.getElementById('aRes');
      if (q.length < 3) { lista.innerHTML = ''; return; }
      sb.from('v_existencia_lote').select('lote_id,producto,lote,vence,existencia,situacion')
        .ilike('producto', '*' + q.replace(/[%,()]/g, '') + '*').eq('estado', 'disponible')
        .limit(15).then(function (r) {
          var f = r.data || [];
          lista.innerHTML = f.map(function (x, i) {
            return '<button type="button" class="item" data-i="' + i + '"><b>' + esc(x.producto) + '</b>' +
              '<span>lote ' + esc(x.lote || 'sin número') + ' · vence ' + fecha(x.vence) +
              ' · el sistema dice ' + Math.round(x.existencia) + '</span></button>';
          }).join('');
          lista.querySelectorAll('.item').forEach(function (b) {
            b.addEventListener('click', function () { formConteo(f[+b.dataset.i]); });
          });
        });
    }, 280));
  }

  function formConteo(l) {
    document.getElementById('aRes').innerHTML = '';
    document.getElementById('aElegido').innerHTML =
      '<div class="elegido"><div><b>' + esc(l.producto) + '</b>' +
      '<span>lote ' + esc(l.lote || 'sin número') + ' · el sistema dice ' +
      Math.round(l.existencia) + '</span></div></div>' +
      '<label for="cReal">Cuántas unidades hay de verdad</label>' +
      '<input id="cReal" type="number" min="0" inputmode="numeric" value="' + Math.round(l.existencia) + '">' +
      '<label for="cMotivo">Por qué no cuadra</label>' +
      '<input id="cMotivo" type="text" placeholder="Conteo físico, rotura, derrame…">' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="cGuardar">Registrar la corrección</button>' +
        '<button type="button" class="secundario" id="cCancelar">Cancelar</button>' +
      '</div>';

    document.getElementById('cCancelar').addEventListener('click', formAjuste);
    document.getElementById('cGuardar').addEventListener('click', function () {
      var real = parseInt(document.getElementById('cReal').value, 10);
      var mot  = document.getElementById('cMotivo').value.trim();
      if (isNaN(real) || real < 0) { aviso('warn', 'Escribe cuántas unidades hay.'); return; }
      if (mot.length < 4) { aviso('warn', 'Escribe por qué no cuadra: queda en la bitácora.'); return; }
      var dif = real - Math.round(l.existencia);
      if (dif === 0) { aviso('warn', 'No hay diferencia que corregir.'); return; }

      sb.from('movimientos').insert({
        lote_id: l.lote_id, tipo: 'ajuste', cantidad: dif, motivo: mot, origen: 'sistema'
      }).then(function (r) {
        if (r.error) { aviso('bad', 'No se pudo: ' + r.error.message); return; }
        aviso('ok', 'Corregido: de ' + Math.round(l.existencia) + ' a ' + real +
                    ' (' + (dif > 0 ? '+' : '') + dif + '). Quedó registrado con tu nombre.');
        formAjuste();
      });
    });
  }

  window.PANTALLA_INVENTARIO = function (cliente, contenedor) {
    sb = cliente; ancla = contenedor; pestana = 'alertas'; pintar();
  };
})();
