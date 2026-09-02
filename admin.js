/* PANEL DEL ADMINISTRADOR.
   Todo lo que se ve aquí se pide por la API REST: cifras del día,
   actividad en vivo, bitácora completa y gestión de usuarios. */
(function () {
  'use strict';

  var sb = null, ancla = null, pestana = 'tablero', yo = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hace(iso) {
    if (!iso) return '';
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'hace un momento';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    var d = Math.floor(s / 86400);
    return d === 1 ? 'ayer' : 'hace ' + d + ' días';
  }
  function aviso(clase, texto) {
    var z = document.getElementById('avisoAdm');
    if (z) z.innerHTML = '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="conmuta">' +
          '<button type="button" data-p="tablero">Tablero</button>' +
          '<button type="button" data-p="bitacora">Bitácora</button>' +
          '<button type="button" data-p="usuarios">Usuarios</button>' +
          '<button type="button" data-p="revisar">Por revisar</button>' +
        '</div>' +
        '<div id="zonaAdm"></div>' +
        '<div id="avisoAdm"></div>' +
      '</div>';
    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.addEventListener('click', function () { pestana = b.dataset.p; pintar(); });
      b.classList.toggle('on', b.dataset.p === pestana);
    });
    ({ tablero: verTablero, bitacora: verBitacora,
       usuarios: verUsuarios, revisar: verRevisar })[pestana]();
  }

  /* ---------------------------------------------------------------- tablero */
  function verTablero() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML = '<div class="cargando">Cargando el tablero…</div>';
    var hoy = new Date().toISOString().slice(0, 10);

    Promise.all([
      sb.from('entregas').select('id', { count: 'exact', head: true }).eq('fecha', hoy).eq('anulada', false),
      sb.from('v_alertas').select('tipo,existencia').limit(1000),
      sb.from('pacientes').select('id', { count: 'exact', head: true }).eq('estado', 'por_revisar'),
      sb.from('bitacora').select('momento,usuario_nombre,usuario_rol,tabla,operacion,despues,nota')
        .order('momento', { ascending: false }).limit(25),
      sb.from('entregas').select('entregado_por_nombre').eq('fecha', hoy).eq('anulada', false).limit(500)
    ]).then(function (r) {
      var entregasHoy = r[0].count || 0;
      var al = r[1].data || [];
      var venc = al.filter(function (x) { return x.tipo === 'vencido'; });
      var p30  = al.filter(function (x) { return x.tipo === 'por_vencer_30'; });
      var porRev = r[2].count || 0;
      var act = r[3].data || [];

      var porUsuario = {};
      (r[4].data || []).forEach(function (e) {
        var n = e.entregado_por_nombre || 'Sin registrar';
        porUsuario[n] = (porUsuario[n] || 0) + 1;
      });

      z.innerHTML =
        '<div class="cifras">' +
          cif(entregasHoy, 'entregas hoy', '') +
          cif(venc.length, 'lotes vencidos', venc.length ? 'alerta' : '') +
          cif(p30.length, 'vencen en 30 días', p30.length ? 'alerta' : '') +
          cif(porRev, 'pacientes por revisar', porRev ? 'alerta' : '') +
        '</div>' +
        (Object.keys(porUsuario).length
          ? '<h3 class="sub-t">Entregas de hoy, por persona</h3><div class="renglones">' +
            Object.keys(porUsuario).sort(function (a, b) { return porUsuario[b] - porUsuario[a]; })
              .map(function (n) {
                return '<div class="renglon"><div class="que"><b>' + esc(n) + '</b></div>' +
                       '<span class="pill">' + porUsuario[n] + '</span></div>';
              }).join('') + '</div>'
          : '') +
        '<h3 class="sub-t">Lo último que pasó</h3>' +
        (act.length ? '<div class="feed">' + act.map(linea).join('') + '</div>'
                    : '<p class="sub">Todavía no hay movimientos.</p>');
    }).catch(function (e) {
      z.innerHTML = '<div class="aviso bad">No se pudo cargar: ' + esc(e.message || e) + '</div>';
    });
  }

  function cif(n, txt, clase) {
    return '<div class="cifra ' + clase + '"><b>' + n + '</b><span>' + txt + '</span></div>';
  }

  /* Traduce un renglón de la bitácora a algo que se lea en cristiano. */
  function linea(b) {
    // Sin usuario = lo hizo la carga de datos o una tarea del servidor,
    // no una persona. Se dice tal cual en vez de atribuirselo a alguien.
    var quien = b.usuario_nombre || 'El sistema (carga de datos)';
    var d = b.despues || {};
    var t = '';

    if (b.nota && b.operacion === 'INTENTO_SUPLANTACION') {
      t = '<em class="ojo">' + esc(quien) + ' intentó registrar una entrega a nombre de otra persona</em>';
    } else if (b.tabla === 'entregas' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> registró una entrega';
    } else if (b.tabla === 'entrega_detalle' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> entregó ' + esc(d.cantidad || '') + ' unidades';
    } else if (b.tabla === 'movimientos' && b.operacion === 'INSERT') {
      var tipos = { entrada: 'registró la entrada de', salida: 'sacó', ajuste: 'corrigió', baja: 'dio de baja' };
      t = '<b>' + esc(quien) + '</b> ' + (tipos[d.tipo] || d.tipo) + ' ' +
          esc(Math.abs(Number(d.cantidad || 0))) + ' unidades' +
          (d.motivo ? ' — ' + esc(d.motivo) : '');
    } else if (b.tabla === 'pacientes' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> registró al paciente ' + esc(d.nombre || '');
    } else if (b.tabla === 'pacientes' && b.operacion === 'UPDATE') {
      t = '<b>' + esc(quien) + '</b> corrigió los datos de ' + esc(d.nombre || 'un paciente');
    } else if (b.tabla === 'productos' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> agregó ' + esc(d.nombre || '') + ' al catálogo';
    } else if (b.tabla === 'lotes' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> registró el lote ' + esc(d.codigo || 'sin número');
    } else if (b.tabla === 'perfiles' && b.operacion === 'INSERT') {
      t = '<b>' + esc(quien) + '</b> creó el usuario ' + esc(d.nombre || d.correo || '');
    } else if (b.tabla === 'perfiles' && b.operacion === 'UPDATE') {
      t = '<b>' + esc(quien) + '</b> cambió el usuario ' + esc(d.nombre || '') +
          (d.activo === false ? ' (lo desactivó)' : '');
    } else {
      t = '<b>' + esc(quien) + '</b> ' + esc(b.operacion.toLowerCase()) + ' en ' + esc(b.tabla);
    }
    return '<div class="ev"><span class="txt">' + t + '</span>' +
           '<span class="cuando">' + hace(b.momento) + '</span></div>';
  }

  /* ---------------------------------------------------------------- bitácora */
  function verBitacora() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML =
      '<h3 class="sub-t">Buscar en la bitácora</h3>' +
      '<p class="sub">Todo lo que se hace queda aquí. Nadie la puede editar ni borrar, ' +
      'ni siquiera tú: es lo que la hace servir como prueba.</p>' +
      '<div class="filtros">' +
        '<select id="fTabla"><option value="">Todo</option>' +
          '<option value="entregas">Entregas</option>' +
          '<option value="movimientos">Movimientos de inventario</option>' +
          '<option value="pacientes">Pacientes</option>' +
          '<option value="productos">Catálogo</option>' +
          '<option value="lotes">Lotes</option>' +
          '<option value="perfiles">Usuarios</option></select>' +
        '<input id="fUsuario" type="search" placeholder="Nombre de la persona…">' +
      '</div>' +
      '<div id="resBit"><div class="cargando">Cargando…</div></div>';

    document.getElementById('fTabla').addEventListener('change', cargarBit);
    document.getElementById('fUsuario').addEventListener('input', function () {
      clearTimeout(window._tb); window._tb = setTimeout(cargarBit, 300);
    });
    cargarBit();
  }

  function cargarBit() {
    var z = document.getElementById('resBit');
    var tabla = document.getElementById('fTabla').value;
    var usu = document.getElementById('fUsuario').value.trim();
    var q = sb.from('bitacora')
      .select('momento,usuario_nombre,usuario_rol,tabla,operacion,despues,campos,nota')
      .order('momento', { ascending: false }).limit(120);
    if (tabla) q = q.eq('tabla', tabla);
    if (usu) q = q.ilike('usuario_nombre', '*' + usu.replace(/[%,()]/g, '') + '*');

    q.then(function (r) {
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      z.innerHTML = f.length
        ? '<div class="feed">' + f.map(function (b) {
            return '<div class="ev"><span class="txt">' + linea(b).replace(/^<div class="ev">|<\/div>$/g, '')
              .replace(/<span class="cuando">.*?<\/span>/, '') + '</span>' +
              '<span class="cuando">' + esc(new Date(b.momento).toLocaleString('es-VE')) + '</span></div>';
          }).join('') + '</div>'
        : '<p class="sub">No hay nada con ese filtro.</p>';
    });
  }

  /* ---------------------------------------------------------------- usuarios */
  function verUsuarios() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    sb.from('perfiles').select('id,nombre,correo,rol,activo').order('rol').then(function (r) {
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      z.innerHTML =
        '<h3 class="sub-t">Quién puede entrar</h3>' +
        '<div class="renglones">' + f.map(function (u) {
          return '<div class="renglon">' +
            '<div class="que"><b>' + esc(u.nombre || u.correo) + '</b>' +
            '<span>' + esc(u.correo || '') + ' · ' + esc(u.rol) +
            (u.activo ? '' : ' · <em class="ojo">desactivado</em>') + '</span></div>' +
            (u.id === yo.id ? '<span class="pill">tú</span>' :
              '<button type="button" class="quitar" data-u="' + u.id + '" data-a="' + (u.activo ? 1 : 0) + '">' +
              (u.activo ? 'Desactivar' : 'Activar') + '</button>') +
          '</div>';
        }).join('') + '</div>' +
        '<h3 class="sub-t">Crear un usuario</h3>' +
        '<p class="sub">La persona se registra sola en la pantalla de entrada con su correo. ' +
        'Nace <b>desactivada y sin permisos</b>: aquí le das el rol y la activas. ' +
        'Así nadie puede darse permisos a sí mismo.</p>' +
        '<label for="uCorreo">Correo de quien ya se registró</label>' +
        '<input id="uCorreo" type="email" placeholder="nombre@alcaldiadecharallave.com">' +
        '<label for="uNombre">Nombre y apellido</label>' +
        '<input id="uNombre" type="text">' +
        '<label for="uRol">Qué va a hacer</label>' +
        '<select id="uRol">' +
          '<option value="despacho">Despacho — entrega medicamentos</option>' +
          '<option value="inventario">Inventario — registra lo que llega</option>' +
          '<option value="admin">Administrador — ve y hace todo</option>' +
        '</select>' +
        '<div class="botonera"><button type="button" class="principal" id="uGuardar">Activar y dar permisos</button></div>';

      z.querySelectorAll('[data-u]').forEach(function (b) {
        b.addEventListener('click', function () {
          sb.from('perfiles').update({ activo: b.dataset.a !== '1', actualizado_en: new Date().toISOString() })
            .eq('id', b.dataset.u).then(function (r) {
              if (r.error) { aviso('bad', r.error.message); return; }
              aviso('ok', 'Listo. Queda registrado en la bitácora.'); verUsuarios();
            });
        });
      });

      document.getElementById('uGuardar').addEventListener('click', function () {
        var correo = document.getElementById('uCorreo').value.trim().toLowerCase();
        var nombre = document.getElementById('uNombre').value.trim();
        var rol = document.getElementById('uRol').value;
        if (!correo || nombre.length < 4) { aviso('warn', 'Faltan el correo y el nombre completo.'); return; }
        sb.from('perfiles').update({ nombre: nombre, rol: rol, activo: true,
                                     actualizado_en: new Date().toISOString() })
          .eq('correo', correo).select().then(function (r) {
            if (r.error) { aviso('bad', r.error.message); return; }
            if (!r.data || !r.data.length) {
              aviso('warn', 'No hay nadie registrado con ese correo. ' +
                    'Pídele que entre a la página y se registre primero.');
              return;
            }
            aviso('ok', nombre + ' ya puede entrar como ' + rol + '.');
            verUsuarios();
          });
      });
    });
  }

  /* ------------------------------------------------------------- por revisar */
  function verRevisar() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    sb.from('pacientes').select('id,nombre,cedula_cruda,motivo_revision,telefono,origen_fila')
      .eq('estado', 'por_revisar').order('nombre').limit(200)
      .then(function (r) {
        if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
        var f = r.data || [];
        z.innerHTML =
          '<h3 class="sub-t">Pacientes que hay que revisar (' + f.length + ')</h3>' +
          '<p class="sub">Vinieron así del Excel. <b>No se corrigieron solos a propósito:</b> ' +
          'adivinar la cédula de una persona real es justo lo que no se debe hacer. ' +
          'Escribe la correcta y el paciente pasa a activo.</p>' +
          '<div class="renglones">' + f.map(function (p, i) {
            return '<div class="renglon rev">' +
              '<div class="que"><b>' + esc(p.nombre) + '</b>' +
              '<span>venía como: <i>' + esc(p.cedula_cruda || 'vacío') + '</i> · ' +
              esc(p.motivo_revision || '') + '</span></div>' +
              '<input class="cedfix" type="text" inputmode="numeric" placeholder="Cédula" data-i="' + i + '">' +
              '<button type="button" class="quitar" data-fix="' + i + '">Guardar</button>' +
            '</div>';
          }).join('') + '</div>';

        z.querySelectorAll('[data-fix]').forEach(function (b) {
          b.addEventListener('click', function () {
            var i = +b.dataset.fix;
            var val = z.querySelector('.cedfix[data-i="' + i + '"]').value.replace(/\D/g, '');
            if (!/^\d{6,9}$/.test(val)) { aviso('warn', 'La cédula debe tener entre 6 y 9 números.'); return; }
            sb.from('pacientes').update({ cedula: val, nacionalidad: 'V', estado: 'activo',
                                          motivo_revision: null })
              .eq('id', f[i].id).then(function (r) {
                if (r.error) {
                  aviso('bad', r.error.code === '23505'
                    ? 'Esa cédula ya la tiene otro paciente. Revisa cuál es la correcta.'
                    : r.error.message);
                  return;
                }
                aviso('ok', f[i].nombre + ' quedó corregido y activo.');
                verRevisar();
              });
          });
        });
      });
  }

  window.PANTALLA_ADMIN = function (cliente, contenedor, usuario) {
    sb = cliente; ancla = contenedor; yo = usuario; pestana = 'tablero'; pintar();
  };
})();
