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
          '<button type="button" data-p="entregas">Entregas</button>' +
          '<button type="button" data-p="bitacora">Bitácora</button>' +
          '<button type="button" data-p="usuarios">Usuarios</button>' +
          '<button type="button" data-p="historial">Historial</button>' +
          '<button type="button" data-p="revisar">Por revisar</button>' +
        '</div>' +
        '<div id="zonaAdm"></div>' +
        '<div id="avisoAdm"></div>' +
      '</div>';
    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.addEventListener('click', function () { pestana = b.dataset.p; pintar(); });
      b.classList.toggle('on', b.dataset.p === pestana);
    });
    ({ tablero: verTablero, entregas: verEntregas, bitacora: verBitacora,
       historial: verHistorial, usuarios: verUsuarios, revisar: verRevisar })[pestana]();
  }

  /* ------------------------------------------------------- lo que se entregó
     El mismo tablero que hay en Mercancía. Se monta con otro prefijo:
     las dos copias viven a la vez en la página —las áreas se esconden,
     no se destruyen— y con los mismos identificadores una escribiría
     encima de la otra. */
  function verEntregas() {
    var z = document.getElementById('zonaAdm');
    if (typeof window.TABLERO_ENTREGAS !== 'function') {
      z.innerHTML = '<div class="aviso warn">El tablero de entregas todavía se está cargando. ' +
                    'Vuelve a entrar en unos segundos.</div>';
      return;
    }
    window.TABLERO_ENTREGAS(sb, z, { prefijo: 'adm' });
  }

  /* ---------------------------------------------------------------- tablero */
  function verTablero() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML = '<div class="cargando">Cargando el tablero…</div>';
    /* El dia que cuenta es el de Venezuela, que es el que guarda la base.
       Con la fecha de UTC, a partir de las ocho de la noche esto contaba
       las entregas de MAÑANA y decia 0. */
    var hoy = (window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10));

    Promise.all([
      sb.from('entregas').select('id', { count: 'exact', head: true }).eq('fecha', hoy).eq('anulada', false),
      sb.from('v_alertas').select('tipo,existencia').limit(1000),
      sb.from('pacientes').select('id', { count: 'exact', head: true }).eq('estado', 'por_revisar'),
      sb.from('bitacora').select('momento,usuario_nombre,usuario_rol,tabla,operacion,despues,nota,registro_id')
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
          ? '<h2 class="sub-t">Entregas de hoy, por persona</h2><div class="renglones">' +
            Object.keys(porUsuario).sort(function (a, b) { return porUsuario[b] - porUsuario[a]; })
              .map(function (n) {
                return '<div class="renglon"><div class="que"><b>' + esc(n) + '</b></div>' +
                       '<span class="pill">' + porUsuario[n] + '</span></div>';
              }).join('') + '</div>'
          : '') +
        '<h2 class="sub-t">Lo último que pasó</h2>' +
        (act.length ? '<p class="sub">Lo que se creó por equivocación y todavía no tiene ' +
                      'historial se puede quitar desde aquí.</p>' +
                      '<div class="feed">' + act.map(linea).join('') + '</div>'
                    : '<p class="sub">Todavía no hay movimientos.</p>');

      engancharDeshacer(z, verTablero);
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
    /* Solo se puede deshacer lo que se CREO y todavia no tiene historial.
       La base lo comprueba otra vez al borrar: si ya tiene un lote, un
       movimiento o una entrega, se niega. */
    var sePuede = b.operacion === 'INSERT' && b.registro_id &&
                  BORRABLES[b.tabla] && d.nombre !== undefined || false;
    if (b.operacion === 'INSERT' && b.registro_id && BORRABLES[b.tabla]) sePuede = true;

    return '<div class="ev"><span class="txt">' + t + '</span>' +
           (sePuede
             ? '<button type="button" class="deshacer" data-quitar="' + esc(b.registro_id) + '" ' +
               'data-tabla="' + esc(b.tabla) + '" data-que="' +
               esc(d.nombre || d.codigo || d.correo || '') + '">Quitar</button>'
             : '') +
           '<span class="cuando">' + hace(b.momento) + '</span></div>';
  }

  /* Qué se puede deshacer y cómo se llama en cristiano. */
  var BORRABLES = {
    productos:     { que: 'el medicamento', porque: 'ya tiene lotes cargados o pacientes que lo toman' },
    lotes:         { que: 'el lote',        porque: 'ya tiene entradas, salidas o ajustes' },
    pacientes:     { que: 'a la persona',   porque: 'ya retiró medicamentos o tiene tratamiento cargado' },
    instituciones: { que: 'el centro',      porque: 'ya recibió alguna entrega' }
  };

  /* Engancha los botones de deshacer de un contenedor. */
  function engancharDeshacer(z, recargar) {
    z.querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var info = BORRABLES[b.dataset.tabla];
        var que = b.dataset.que || 'esto';
        if (!window.confirm('¿Quitar ' + info.que + ' «' + que + '»?\n\n' +
            'Solo se puede si todavía no tiene historial. Queda anotado en la bitácora.')) return;
        b.disabled = true; b.textContent = 'Quitando…';

        sb.from(b.dataset.tabla).delete().eq('id', b.dataset.quitar).select()
          .then(function (r) {
            if (r.error) {
              b.disabled = false; b.textContent = 'Quitar';
              aviso('bad', 'No se pudo quitar: ' + r.error.message);
              return;
            }
            if (!r.data || !r.data.length) {
              /* La base lo rechazó por su candado: no se borra lo que ya
                 tiene historial. Se dice por qué, no un error seco. */
              b.disabled = false; b.textContent = 'Quitar';
              aviso('warn', 'No se puede quitar «' + que + '»: ' + info.porque + '. ' +
                            'Lo que ya pasó no se borra. Si no se va a usar más, desactívalo.');
              return;
            }
            aviso('ok', 'Se quitó «' + que + '». Quedó anotado en la bitácora.');
            recargar();
          });
      });
    });
  }

  /* ---------------------------------------------------------------- bitácora */
  function verBitacora() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML =
      '<h2 class="sub-t">Buscar en la bitácora</h2>' +
      '<p class="sub">Todo lo que se hace queda aquí. Nadie la puede editar ni borrar, ' +
      'ni siquiera tú: es lo que la hace servir como prueba.</p>' +
      '<div class="filtros">' +
        '<select id="fTabla" aria-label="Filtrar por tipo de acción"><option value="">Todo</option>' +
          '<option value="entregas">Entregas</option>' +
          '<option value="movimientos">Movimientos de inventario</option>' +
          '<option value="pacientes">Pacientes</option>' +
          '<option value="productos">Catálogo</option>' +
          '<option value="lotes">Lotes</option>' +
          '<option value="perfiles">Usuarios</option></select>' +
        '<input id="fUsuario" type="search" aria-label="Filtrar por persona" placeholder="Nombre de la persona…">' +
      '</div>' +
      '<div class="descargas">' +
        '<button type="button" id="bitExcel">Descargar la bitácora en Excel</button>' +
      '</div>' +
      '<div id="resBit"><div class="cargando">Cargando…</div></div>';

    document.getElementById('bitExcel').addEventListener('click', function () {
      bajarBitacora(this);
    });
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

  /* ---------------------------------------------------------------- usuarios
     El administrador crea la cuenta completa: nombre, correo, puesto y
     contraseña. La persona no tiene que registrarse antes.

     Crear una cuenta de acceso exige la llave secreta del servidor, que
     NO puede estar en esta página (quien mirara el código fuente la
     tendría). Por eso el trabajo lo hace la función `farmacia-usuarios`,
     que vive en el servidor: comprueba que quien la llama sea un
     administrador activo y recién entonces crea la cuenta.
  --------------------------------------------------------------------- */

  /* Llama a la función del servidor con la sesión de quien está usando el
     panel. Sin sesión no hace nada: la función la rechaza. */
  function llamaFuncion(accion, datos) {
    return sb.auth.getSession().then(function (s) {
      var token = s && s.data && s.data.session ? s.data.session.access_token : null;
      if (!token) throw new Error('Se cerró tu sesión. Vuelve a entrar.');
      var cuerpo = { accion: accion };
      for (var k in datos) if (Object.prototype.hasOwnProperty.call(datos, k)) cuerpo[k] = datos[k];
      return fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/farmacia-usuarios', {
        method: 'POST',
        headers: {
          'apikey': window.CONFIG.SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cuerpo)
      });
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!r.ok) throw new Error((j && j.error) || 'No se pudo completar (error ' + r.status + ').');
        return j;
      });
    }).catch(function (e) {
      if (e instanceof TypeError) throw new Error('No hay conexión con el servidor. NO se guardó nada.');
      throw e;
    });
  }

  /* Una contraseña provisional que se pueda dictar por teléfono. */
  function claveSugerida() {
    var palabras = ['Salud', 'Charallave', 'Botica', 'Miranda'];
    var letras = 'abcdefghjkmnpqrstuvwxyz';       // sin i, l, o: se confunden
    var az = new Uint32Array(4);
    (window.crypto || window.msCrypto).getRandomValues(az);
    return palabras[az[0] % palabras.length] + '-' +
           (1000 + (az[1] % 9000)) +
           letras[az[2] % letras.length] + letras[az[3] % letras.length];
  }

  var ROLES_TEXTO = {
    despacho:   'Despacho — entrega medicamentos',
    inventario: 'Inventario — registra lo que llega',
    admin:      'Administrador — ve y hace todo'
  };

  /* Caja con los datos para entregarle a la persona. Se pinta dentro del
     mismo dibujado de la lista: si se escribiera despues, el refresco de
     la lista la borraria a veces (y a veces no, segun lo que tardara). */
  function cajaCredencial(c) {
    if (!c) return '';
    return '<div class="aviso ok"><b>' + esc(c.titulo) + '</b>' +
      '<span class="credencial">' + esc(c.correo) + '<br>' + esc(c.clave) + '</span>' +
      'Anotalo ahora: la contrasena no se vuelve a mostrar. ' +
      'Al entrar, el sistema le va a pedir que la cambie.</div>';
  }

  function verUsuarios(credencial) {
    var z = document.getElementById('zonaAdm');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    sb.from('perfiles').select('id,nombre,correo,rol,activo').order('rol').then(function (r) {
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      var admins = f.filter(function (u) { return u.rol === 'admin' && u.activo; }).length;

      z.innerHTML =
        '<h2 class="sub-t">Quién puede entrar</h2>' +
        '<div class="renglones">' + f.map(function (u) {
          var soyYo = u.id === yo.id;
          return '<div class="renglon">' +
            '<div class="que"><b>' + esc(u.nombre || u.correo) + '</b>' +
            '<span>' + esc(u.correo || '') + ' · ' + esc(ROLES_TEXTO[u.rol] || u.rol).split(' — ')[0] +
            (u.activo ? '' : ' · <em class="ojo">desactivado</em>') + '</span></div>' +
            '<div class="acciones-u">' +
              (soyYo ? '<span class="pill">tú</span>' :
                '<button type="button" class="quitar" data-u="' + u.id + '" data-a="' + (u.activo ? 1 : 0) + '">' +
                (u.activo ? 'Desactivar' : 'Activar') + '</button>') +
              '<button type="button" class="suave" data-clave="' + esc(u.correo) + '" ' +
                'data-nombre="' + esc(u.nombre || u.correo) + '">Cambiar contraseña</button>' +
              (soyYo ? '' :
                '<button type="button" class="peligro" data-borrar="' + esc(u.correo) + '" ' +
                'data-nombre="' + esc(u.nombre || u.correo) + '">Borrar</button>') +
            '</div>' +
          '</div>';
        }).join('') + '</div>' +

        '<h2 class="sub-t">Crear un usuario</h2>' +
        '<p class="sub">Le pones aquí todo y ya puede entrar. No tiene que registrarse. ' +
        'La contraseña que le pongas es provisional: el sistema le va a pedir cambiarla ' +
        'la primera vez que entre.</p>' +
        '<label for="uNombre">Nombre y apellido</label>' +
        '<input id="uNombre" type="text" autocomplete="off" placeholder="Ana Rodríguez">' +
        '<label for="uCorreo">Correo</label>' +
        '<input id="uCorreo" type="email" autocomplete="off" inputmode="email" ' +
          'placeholder="nombre@alcaldiadecharallave.com">' +
        '<label for="uRol">Qué va a hacer</label>' +
        '<select id="uRol">' +
          '<option value="despacho">' + ROLES_TEXTO.despacho + '</option>' +
          '<option value="inventario">' + ROLES_TEXTO.inventario + '</option>' +
          '<option value="admin">' + ROLES_TEXTO.admin + '</option>' +
        '</select>' +
        '<label for="uClave">Contraseña provisional</label>' +
        '<div class="fila-clave">' +
          '<input id="uClave" type="text" autocomplete="off" value="' + esc(claveSugerida()) + '">' +
          '<button type="button" class="suave" id="uOtraClave">Otra</button>' +
        '</div>' +
        '<p class="sub chico">Al menos 8 caracteres, con letras y números.</p>' +
        '<div class="botonera"><button type="button" class="principal" id="uGuardar">Crear el usuario</button></div>' +
        '<div id="uResultado">' + cajaCredencial(credencial) + '</div>';

      /* --- activar y desactivar --- */
      z.querySelectorAll('[data-u]').forEach(function (b) {
        b.addEventListener('click', function () {
          var activando = b.dataset.a !== '1';
          b.disabled = true;
          sb.from('perfiles').update({ activo: activando,
                                       debe_cambiar_clave: activando ? true : undefined,
                                       actualizado_en: new Date().toISOString() })
            .eq('id', b.dataset.u).then(function (r) {
              b.disabled = false;
              if (r.error) { aviso('bad', r.error.message); return; }
              aviso('ok', 'Listo. Queda registrado en la bitácora.'); verUsuarios();
            });
        });
      });

      /* --- cambiarle la contraseña a alguien --- */
      z.querySelectorAll('[data-clave]').forEach(function (b) {
        b.addEventListener('click', function () {
          var sugerida = claveSugerida();
          var nueva = window.prompt(
            'Contraseña nueva para ' + b.dataset.nombre + '.\n' +
            'Se le va a pedir que la cambie cuando entre.', sugerida);
          if (nueva === null) return;
          b.disabled = true;
          llamaFuncion('clave', { correo: b.dataset.clave, clave: nueva })
            .then(function (res) {
              aviso('ok', res.mensaje);
              verUsuarios({ titulo: 'Contraseña nueva de ' + b.dataset.nombre,
                            correo: b.dataset.clave, clave: nueva });
            })
            .catch(function (e) { b.disabled = false; aviso('bad', e.message); });
        });
      });

      /* --- borrar --- */
      z.querySelectorAll('[data-borrar]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm('¿Quitar del sistema a ' + b.dataset.nombre + '?\n\n' +
                              'Ya no va a poder entrar. Lo que haya hecho NO se borra: ' +
                              'sus entregas y sus apuntes de la bitácora se quedan con su nombre.')) return;
          b.disabled = true;
          llamaFuncion('borrar', { correo: b.dataset.borrar })
            .then(function (res) { aviso('ok', res.mensaje); verUsuarios(); })
            .catch(function (e) { b.disabled = false; aviso('bad', e.message); });
        });
      });

      /* --- otra contraseña sugerida --- */
      document.getElementById('uOtraClave').addEventListener('click', function () {
        document.getElementById('uClave').value = claveSugerida();
      });

      /* --- crear --- */
      document.getElementById('uGuardar').addEventListener('click', function () {
        var boton = this;
        var nombre = document.getElementById('uNombre').value.trim().replace(/\s+/g, ' ');
        var correo = document.getElementById('uCorreo').value.trim().toLowerCase();
        var rol    = document.getElementById('uRol').value;
        var clave  = document.getElementById('uClave').value;

        if (nombre.length < 4) { aviso('warn', 'Escribe el nombre y el apellido completos.'); return; }
        if (!correo) { aviso('warn', 'Falta el correo.'); return; }
        var malaClave = window.FARM && window.FARM.revisaClave ? window.FARM.revisaClave(clave) : null;
        if (malaClave) { aviso('warn', malaClave); return; }

        boton.disabled = true;
        boton.textContent = 'Creando…';
        llamaFuncion('crear', { correo: correo, nombre: nombre, rol: rol, clave: clave })
          .then(function (res) {
            aviso('ok', res.mensaje);
            /* Los datos se muestran una sola vez, para entregárselos a la
               persona: la contraseña no se guarda en ningún lado. */
            verUsuarios({ titulo: 'Datos para entregarle a ' + nombre,
                          correo: correo, clave: clave });
          })
          .catch(function (e) {
            boton.disabled = false;
            boton.textContent = 'Crear el usuario';
            aviso('bad', e.message);
          });
      });
    });
  }

  /* Se trae TODO lo que cumple el filtro, no solo lo que se ve en pantalla:
     cuando se pide un listado, se pide completo. El servidor no manda más
     de mil filas por vez, así que se pide por tandas. */
  function porTandas(hazConsulta, tope) {
    var todo = [];
    function tanda(desde) {
      return hazConsulta(desde).then(function (r) {
        if (r.error) throw r.error;
        var f = r.data || [];
        todo = todo.concat(f);
        if (f.length === 1000 && todo.length < (tope || 20000)) return tanda(desde + 1000);
      });
    }
    return tanda(0).then(function () { return todo; });
  }

  function bajarBitacora(btn) {
    var texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparando…';
    var tabla = document.getElementById('fTabla').value;
    var usu = document.getElementById('fUsuario').value.trim();

    porTandas(function (desde) {
      var q = sb.from('bitacora')
        .select('momento,usuario_nombre,usuario_rol,tabla,operacion,campos,nota')
        .order('momento', { ascending: false }).range(desde, desde + 999);
      if (tabla) q = q.eq('tabla', tabla);
      if (usu) q = q.ilike('usuario_nombre', '*' + usu.replace(/[%,()]/g, '') + '*');
      return q;
    }, 20000).then(function (todo) {
      var QUE = { INSERT: 'Creó', UPDATE: 'Cambió', DELETE: 'Borró',
                  INTENTO_SUPLANTACION: 'Intento de suplantación' };
      var filas = todo.map(function (b) {
        var d = new Date(b.momento);
        return [d.toLocaleDateString('es-VE'), d.toLocaleTimeString('es-VE'),
                b.usuario_nombre || 'El sistema (carga de datos)',
                b.usuario_rol || '', QUE[b.operacion] || b.operacion, b.tabla,
                Array.isArray(b.campos) ? b.campos.join(', ') : (b.campos || ''),
                b.nota || ''];
      });
      window.FARMREP.excel('Bitacora - Farmacia Municipal', [{
        nombre: 'Bitácora',
        titulo: 'Bitácora de la Farmacia Municipal' + (tabla ? ' · ' + tabla : '') +
                (usu ? ' · ' + usu : ''),
        encabezados: ['Fecha', 'Hora', 'Quién', 'Puesto', 'Qué hizo', 'Dónde',
                      'Campos que cambiaron', 'Nota'],
        filas: filas,
        anchos: [12, 11, 26, 12, 14, 18, 30, 34]
      }]);
      btn.disabled = false; btn.textContent = texto;
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = texto;
      aviso('bad', 'No se pudo preparar la descarga: ' + (e.message || e));
    });
  }

  function bajarHistorial(btn) {
    var texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparando…';
    var q = document.getElementById('hBusca').value.trim().replace(/[%,()]/g, '');

    porTandas(function (desde) {
      var c = sb.from('v_historial_entregas')
        .select('fecha,fecha_original,paciente,nacionalidad,cedula,entregado_por,lo_entregado,origen,anulada')
        .order('fecha', { ascending: false, nullsFirst: false }).range(desde, desde + 999);
      if (q) c = c.or('cedula.ilike.*' + q + '*,paciente.ilike.*' + q + '*');
      return c;
    }, 20000).then(function (todo) {
      var filas = todo.map(function (x) {
        return [x.fecha ? window.FARMREP.fechaCorta(x.fecha) : (x.fecha_original || 'sin fecha'),
                x.paciente || '', x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula : '',
                x.lo_entregado || '', x.entregado_por || '',
                x.origen === 'migracion_excel' ? 'Del Excel' : 'Del sistema',
                x.anulada ? 'Anulada' : ''];
      });
      window.FARMREP.excel('Historial de entregas - Farmacia Municipal', [{
        nombre: 'Entregas',
        titulo: 'Historial de entregas · Farmacia Municipal' + (q ? ' · «' + q + '»' : ''),
        encabezados: ['Fecha', 'Paciente', 'Cédula', 'Lo que se entregó',
                      'Quién entregó', 'De dónde viene', 'Estado'],
        filas: filas,
        anchos: [12, 34, 14, 46, 24, 15, 10]
      }]);
      btn.disabled = false; btn.textContent = texto;
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = texto;
      aviso('bad', 'No se pudo preparar la descarga: ' + (e.message || e));
    });
  }

  /* --------------------------------------------------------------- historial */
  function verHistorial() {
    var z = document.getElementById('zonaAdm');
    z.innerHTML =
      '<h2 class="sub-t">Historial de entregas</h2>' +
      '<p class="sub">Las 4.999 entregas que venían de los Excel, más las que se ' +
      'registran ahora. Las del Excel <b>no descuentan del inventario</b>: el 87% ' +
      'no anotaba la cantidad, así que descontarlas sería inventar números.</p>' +
      '<div class="filtros">' +
        '<input id="hBusca" type="search" aria-label="Buscar por cédula o nombre" placeholder="Cédula o nombre del paciente…">' +
      '</div>' +
      '<div class="descargas">' +
        '<button type="button" id="hisExcel">Descargar el historial en Excel</button>' +
      '</div>' +
      '<div id="resHist"><div class="cargando">Cargando…</div></div>';
    document.getElementById('hBusca').addEventListener('input', function () {
      clearTimeout(window._th); window._th = setTimeout(cargarHist, 320);
    });
    document.getElementById('hisExcel').addEventListener('click', function () {
      bajarHistorial(this);
    });
    cargarHist();
  }

  function cargarHist() {
    var z = document.getElementById('resHist');
    var q = document.getElementById('hBusca').value.trim().replace(/[%,()]/g, '');
    var c = sb.from('v_historial_entregas')
      .select('fecha,fecha_original,paciente,nacionalidad,cedula,entregado_por,lo_entregado,origen')
      .order('fecha', { ascending: false, nullsFirst: false }).limit(100);
    if (q) c = c.or('cedula.ilike.*' + q + '*,paciente.ilike.*' + q + '*');

    c.then(function (r) {
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      if (!f.length) { z.innerHTML = '<p class="sub">No hay entregas con esa búsqueda.</p>'; return; }
      z.innerHTML = '<div class="renglones">' + f.map(function (x) {
        var cuando = x.fecha
          ? x.fecha.slice(8, 10) + '/' + x.fecha.slice(5, 7) + '/' + x.fecha.slice(0, 4)
          : '<em class="ojo">fecha ilegible: ' + esc(x.fecha_original || '') + '</em>';
        return '<div class="renglon"><div class="que">' +
          '<b>' + esc(x.paciente || 'Sin paciente') + '</b>' +
          '<span>' + (x.cedula ? esc((x.nacionalidad || 'V') + '-' + x.cedula) : 'sin cédula') +
          ' · ' + cuando + ' · ' + esc(x.entregado_por) + '</span>' +
          '<span class="meds">' + esc(x.lo_entregado || '') + '</span></div></div>';
      }).join('') + '</div>' +
      (f.length >= 100 ? '<p class="sub">Se muestran las 100 más recientes. Busca por cédula o nombre para afinar.</p>' : '');
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
          '<h2 class="sub-t">Pacientes que hay que revisar (' + f.length + ')</h2>' +
          '<p class="sub">Vinieron así del Excel. <b>No se corrigieron solos a propósito:</b> ' +
          'adivinar la cédula de una persona real es justo lo que no se debe hacer. ' +
          'Escribe la correcta y el paciente pasa a activo.</p>' +
          '<div class="renglones">' + f.map(function (p, i) {
            return '<div class="renglon rev">' +
              '<div class="que"><b>' + esc(p.nombre) + '</b>' +
              '<span>venía como: <i>' + esc(p.cedula_cruda || 'vacío') + '</i> · ' +
              esc(p.motivo_revision || '') + '</span></div>' +
              '<input class="cedfix" type="text" inputmode="numeric" placeholder="Cédula" ' +
                'aria-label="Cédula de ' + esc(p.nombre || 'este paciente') + '" data-i="' + i + '">' +
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
