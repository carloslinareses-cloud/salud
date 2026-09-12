/* DASHBOARD: el panel general de la farmacia, en números.

   No registra nada ni corrige nada -es de solo lectura-. Junta lo que
   ya hay en Personas, Jornadas, Centros y Lo entregado y lo cuenta,
   por día, por semana y por mes, para quien necesita ver de un
   vistazo cómo va todo. Solo lo ven admin e inventario, porque vive
   dentro de Mercancía igual que Jornadas y Centros.

   Se puede descargar en PDF (un informe con todas las secciones) y en
   Excel (una hoja por cada tabla, para revisar con calma o imprimir).

   La lógica de contar está separada de la pantalla a propósito
   -"calcularInforme" no toca el DOM- para poder probarla con datos
   inventados sin necesitar navegador ni base de datos. */
(function () {
  'use strict';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-VE'); }
  function unNum(n) {
    var v = Number(n) || 0;
    return v % 1 === 0 ? num(v) : v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
  }

  var HOJAS_TXT = {
    'JORNADAS 2026': 'Jornadas 2026',
    'JULIO A SEPTIEMBRE': 'Julio a septiembre',
    'OCTUBRE A DICIEMBRE': 'Octubre a diciembre',
    'RUTA MATERNA MES JULIO': 'Ruta materna (julio)'
  };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ================================================================
     LA CUENTA -pura, sin DOM ni red-

     Todo lo de aquí abajo recibe datos ya traídos y una fecha de "hoy",
     y devuelve números. Nada de esto pregunta la hora ni llama a la
     base: así se puede probar con datos inventados y una fecha fija.
  ================================================================ */

  /* El día de Venezuela para una fecha cualquiera del sistema. Los
     "creado_en" vienen en UTC; a las 8 de la noche de Charallave en UTC
     ya es mañana, así que hay que pasarlos por la zona de Caracas -la
     misma regla que ya usa el resto de la aplicación (ver comunes.js). */
  function diaLocal(FARM, iso) {
    if (!iso) return null;
    return FARM.hoyCaracas ? FARM.hoyCaracas(iso) : String(iso).slice(0, 10);
  }

  function enRango(fecha, desde, hasta) {
    return !!fecha && fecha >= desde && fecha <= hasta;
  }
  function contarEnRango(filas, desde, hasta) {
    var n = 0;
    for (var i = 0; i < filas.length; i++) if (enRango(filas[i].fecha, desde, hasta)) n++;
    return n;
  }
  function sumarEnRango(filas, campo, desde, hasta) {
    var n = 0;
    for (var i = 0; i < filas.length; i++) {
      if (enRango(filas[i].fecha, desde, hasta)) n += Number(filas[i][campo] || 0);
    }
    return n;
  }

  /* Cuenta agrupando por un campo (sexo, estado, tipo…), con una
     etiqueta para lo que venga vacío. */
  function agrupar(filas, campo, vacio) {
    var por = {}, orden = [];
    filas.forEach(function (f) {
      var v = f[campo] || vacio;
      if (!(v in por)) { por[v] = 0; orden.push(v); }
      por[v]++;
    });
    return orden.sort(function (a, b) { return por[b] - por[a]; })
      .map(function (v) { return { etiqueta: v, cantidad: por[v] }; });
  }

  /* Igual, pero sumando una cantidad en vez de contar filas -para "qué
     medicamento salió más" o "cuánto entregó cada quien". */
  function agruparSuma(filas, campo, valorCampo, vacio) {
    var por = {}, orden = [];
    filas.forEach(function (f) {
      var cant = Number(f[valorCampo]);
      if (!cant) return;                    // sin cantidad no suma a ningún ranking
      var v = f[campo] || vacio;
      if (!(v in por)) { por[v] = { unidades: 0, veces: 0 }; orden.push(v); }
      por[v].unidades += cant; por[v].veces++;
    });
    return orden.sort(function (a, b) { return por[b].unidades - por[a].unidades; })
      .map(function (v) { return { etiqueta: v, unidades: por[v].unidades, veces: por[v].veces }; });
  }

  /* Los últimos N períodos, terminando hoy. Devuelve un rango {desde,
     hasta,etiqueta} por cada uno, del más viejo al más nuevo -así la
     tabla se lee igual que un calendario, de izquierda a derecha. */
  function ultimosPeriodos(FARM, vista, hoy, n) {
    var out = [];
    if (vista === 'semana') {
      var actual = FARM.periodo('semana', hoy);
      for (var i = n - 1; i >= 0; i--) {
        var lunes = FARM.sumaDias(actual.desde, -7 * i);
        var r = FARM.periodo('semana', lunes);
        out.push({ desde: r.desde, hasta: r.hasta, etiqueta: 'Semana del ' + corta(r.desde) });
      }
      return out;
    }
    if (vista === 'mes') {
      var p = hoy.split('-'); var anio = +p[0], mes = +p[1];
      for (var j = n - 1; j >= 0; j--) {
        var mm = mes - j, aa = anio;
        while (mm <= 0) { mm += 12; aa -= 1; }
        var enEseMes = aa + '-' + String(mm).padStart(2, '0') + '-01';
        var rm = FARM.periodo('mes', enEseMes);
        out.push({ desde: rm.desde, hasta: rm.hasta, etiqueta: capitaliza(MESES[mm - 1]) + ' ' + aa });
      }
      return out;
    }
    // 'dia'
    for (var k = n - 1; k >= 0; k--) {
      var d = FARM.sumaDias(hoy, -k);
      out.push({ desde: d, hasta: d, etiqueta: corta(d) + (d === hoy ? ' (hoy)' : '') });
    }
    return out;
  }
  function corta(f) {
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(f);
  }
  function capitaliza(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  var VENTANA = { dia: 14, semana: 8, mes: 6 };

  /* Arma la tabla de tendencia de un conjunto de filas ya normalizado
     (cada una con `.fecha` = día de Venezuela). `valorCampo` es opcional:
     si se da, además de contar filas se suma esa cantidad. */
  function tendencia(FARM, filas, vista, hoy, valorCampo) {
    var periodos = ultimosPeriodos(FARM, vista, hoy, VENTANA[vista]);
    return periodos.map(function (r) {
      var fila = { etiqueta: r.etiqueta, cantidad: contarEnRango(filas, r.desde, r.hasta) };
      if (valorCampo) fila.unidades = sumarEnRango(filas, valorCampo, r.desde, r.hasta);
      return fila;
    });
  }

  /* De toda la lista de renglones de entregas (una fila por medicamento,
     con nulos cuando la entrega vieja del Excel no traía detalle),
     saca UNA fila por entrega -para no contar la misma visita varias
     veces- y descarta las anuladas: lo anulado no debe sumar a nada. */
  function entregasUnicas(renglones) {
    var vistos = {}, out = [];
    renglones.forEach(function (r) {
      if (r.anulada) return;
      if (!vistos[r.entrega_id]) { vistos[r.entrega_id] = true; out.push(r); }
    });
    return out;
  }

  /* La función principal: recibe lo que se trajo de la base (ya en
     arreglos planos) más la vista elegida (dia|semana|mes) y la fecha
     de hoy, y devuelve TODO lo que pinta la pantalla, ya calculado. */
  function calcularInforme(FARM, datos, vista, hoy) {
    var rHoy = { desde: hoy, hasta: hoy };
    var rSemana = FARM.periodo('semana', hoy);
    var rMes = FARM.periodo('mes', hoy);

    /* -------- Personas -------- */
    var personas = (datos.personas || []).map(function (p) {
      return { fecha: diaLocal(FARM, p.creado_en), sexo: p.sexo, estado: p.estado };
    });
    var infoPersonas = {
      total: personas.length,
      hoy: contarEnRango(personas, rHoy.desde, rHoy.hasta),
      semana: contarEnRango(personas, rSemana.desde, rSemana.hasta),
      mes: contarEnRango(personas, rMes.desde, rMes.hasta),
      porRevisar: personas.filter(function (p) { return p.estado === 'por_revisar'; }).length,
      porSexo: agrupar(personas, 'sexo', 'Sin dato'),
      tendencia: tendencia(FARM, personas, vista, hoy)
    };

    /* -------- Jornadas -------- */
    var jornadas = (datos.jornadas || []).map(function (j) {
      return { fecha: diaLocal(FARM, j.creado_en), conjunto: j.conjunto, hoja_origen: j.hoja_origen, estado: j.estado };
    });
    var infoJornadas = {
      total: jornadas.length,
      hoy: contarEnRango(jornadas, rHoy.desde, rHoy.hasta),
      semana: contarEnRango(jornadas, rSemana.desde, rSemana.hasta),
      mes: contarEnRango(jornadas, rMes.desde, rMes.hasta),
      porRevisar: jornadas.filter(function (j) { return j.estado === 'por_revisar'; }).length,
      porConjunto: agrupar(jornadas.map(function (j) {
        return { conjunto: j.conjunto === 'ruta_materna' ? 'Ruta materna' : 'Jornada de salud' };
      }), 'conjunto', 'Sin dato'),
      porHoja: agrupar(jornadas.map(function (j) {
        return { hoja: HOJAS_TXT[j.hoja_origen] || j.hoja_origen || 'Sin hoja' };
      }), 'hoja', 'Sin hoja'),
      tendencia: tendencia(FARM, jornadas, vista, hoy)
    };

    /* -------- Centros -------- */
    var centros = (datos.centros || []).map(function (c) {
      return { fecha: diaLocal(FARM, c.creado_en), tipo: c.tipo, activo: c.activo };
    });
    var ficha = datos.centrosFicha || [];
    var totalInsumosPedidos = ficha.reduce(function (s, c) { return s + Number(c.insumos || 0); }, 0);
    var totalUnidadesCentros = ficha.reduce(function (s, c) { return s + Number(c.unidades_recibidas || 0); }, 0);
    var ranking = ficha
      .filter(function (c) { return Number(c.unidades_recibidas) > 0; })
      .sort(function (a, b) { return Number(b.unidades_recibidas) - Number(a.unidades_recibidas); })
      .slice(0, 10)
      .map(function (c) { return { etiqueta: c.nombre, unidades: Number(c.unidades_recibidas), veces: Number(c.entregas || 0) }; });

    /* -------- Lo entregado -------- */
    var renglones = datos.entregasRenglon || [];
    var eventosUnicos = entregasUnicas(renglones);

    /* Cuántas de esas visitas SÍ traen al menos un renglón con cantidad.
       Las que no -casi todas las migradas del cuaderno viejo- cuentan
       como visita pero no pueden sumar a ninguna cifra de unidades. */
    var conDetalle = {};
    renglones.forEach(function (r) { if (!r.anulada && r.cantidad != null) conDetalle[r.entrega_id] = true; });
    var totalSinDetalle = eventosUnicos.filter(function (r) { return !conDetalle[r.entrega_id]; }).length;

    var unicas = eventosUnicos.map(function (r) {
      return {
        fecha: r.fecha, tipo_destinatario: r.tipo_destinatario,
        destinatario: r.destinatario, entregado_por: r.entregado_por || 'No consta',
        origen: r.origen
      };
    });

    var renglonesConCantidad = renglones.filter(function (r) { return !r.anulada && r.cantidad != null; })
      .map(function (r) {
        return { fecha: r.fecha, cantidad: Number(r.cantidad), producto: r.producto || 'Sin producto',
                 entregado_por: r.entregado_por || 'No consta' };
      });

    var centroEntregas = unicas.filter(function (u) { return u.tipo_destinatario === 'institucion'; });
    var pacienteEntregas = unicas.filter(function (u) { return u.tipo_destinatario === 'paciente'; });

    var infoEntregado = {
      total: unicas.length,
      hoy: contarEnRango(unicas, rHoy.desde, rHoy.hasta),
      semana: contarEnRango(unicas, rSemana.desde, rSemana.hasta),
      mes: contarEnRango(unicas, rMes.desde, rMes.hasta),
      aPacientes: pacienteEntregas.length,
      aCentros: centroEntregas.length,
      sinDetalle: totalSinDetalle,
      unidadesTotal: renglonesConCantidad.reduce(function (s, r) { return s + r.cantidad; }, 0),
      unidadesHoy: sumarEnRango(renglonesConCantidad, 'cantidad', rHoy.desde, rHoy.hasta),
      unidadesSemana: sumarEnRango(renglonesConCantidad, 'cantidad', rSemana.desde, rSemana.hasta),
      unidadesMes: sumarEnRango(renglonesConCantidad, 'cantidad', rMes.desde, rMes.hasta),
      topMedicamentos: agruparSuma(renglonesConCantidad, 'producto', 'cantidad', 'Sin producto').slice(0, 10),
      porDespachador: agruparSuma(renglonesConCantidad, 'entregado_por', 'cantidad', 'No consta').slice(0, 15),
      tendencia: tendencia(FARM, unicas, vista, hoy),
      tendenciaUnidades: tendencia(FARM, renglonesConCantidad, vista, hoy, 'cantidad')
    };

    var infoCentros = {
      total: centros.length,
      activos: centros.filter(function (c) { return c.activo !== false; }).length,
      inactivos: centros.filter(function (c) { return c.activo === false; }).length,
      porTipo: agrupar(centros, 'tipo', 'Otro'),
      insumosPedidos: totalInsumosPedidos,
      unidadesRecibidas: totalUnidadesCentros,
      entregasTotal: centroEntregas.length,
      entregasHoy: contarEnRango(centroEntregas, rHoy.desde, rHoy.hasta),
      entregasSemana: contarEnRango(centroEntregas, rSemana.desde, rSemana.hasta),
      entregasMes: contarEnRango(centroEntregas, rMes.desde, rMes.hasta),
      ranking: ranking,
      tendencia: tendencia(FARM, centroEntregas, vista, hoy)
    };

    return {
      hoy: hoy, vista: vista,
      rotuloSemana: FARM.rotuloPeriodo ? FARM.rotuloPeriodo(rSemana.desde, rSemana.hasta, hoy) : '',
      rotuloMes: FARM.rotuloPeriodo ? FARM.rotuloPeriodo(rMes.desde, rMes.hasta, hoy) : '',
      personas: infoPersonas, jornadas: infoJornadas, centros: infoCentros, entregado: infoEntregado
    };
  }

  /* ================================================================
     TRAER LOS DATOS
  ================================================================ */
  function traeTodo(sb, tabla, campos) {
    var todo = [];
    function pag(desde) {
      return sb.from(tabla).select(campos).range(desde, desde + 999).then(function (r) {
        if (r.error) throw r.error;
        var f = r.data || [];
        todo = todo.concat(f);
        if (f.length === 1000) return pag(desde + 1000);
        return todo;
      });
    }
    return pag(0);
  }

  var CAMPOS_ENTREGAS = 'entrega_id,fecha,tipo_destinatario,anulada,origen,cantidad,producto,' +
                         'destinatario,entregado_por';

  function traerDatos(sb) {
    return Promise.all([
      traeTodo(sb, 'pacientes', 'id,sexo,estado,creado_en'),
      traeTodo(sb, 'jornadas_registros', 'id,conjunto,hoja_origen,estado,creado_en'),
      traeTodo(sb, 'instituciones', 'id,tipo,activo,creado_en'),
      sb.from('v_instituciones_ficha').select('id,nombre,tipo,activo,entregas,insumos,unidades_recibidas')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; }),
      traeTodo(sb, 'v_entregas_renglon', CAMPOS_ENTREGAS)
    ]).then(function (r) {
      return { personas: r[0], jornadas: r[1], centros: r[2], centrosFicha: r[3], entregasRenglon: r[4] };
    });
  }

  /* ================================================================
     LA PANTALLA
  ================================================================ */
  function Dashboard(sb, raiz, pfx) {
    this.sb = sb; this.raiz = raiz; this.pfx = pfx;
    this.vista = 'dia';
    this.datos = null;
    this.informe = null;
  }
  Dashboard.prototype.id = function (n) { return this.pfx + n; };
  Dashboard.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };

  Dashboard.prototype.pintar = function () {
    var t = this;
    t.raiz.innerHTML = '<div id="' + t.id('Zona') + '"></div>';
    t.cargar();
  };

  Dashboard.prototype.cargar = function () {
    var t = this;
    var z = t.q('Zona');
    z.innerHTML = '<div class="cargando">Contando personas, jornadas, centros y entregas…</div>';
    traerDatos(t.sb).then(function (datos) {
      t.datos = datos;
      t.recalcular();
    }).catch(function (e) {
      z.innerHTML = '<div class="aviso bad">No se pudo calcular el dashboard: ' + esc(e.message || e) + '</div>';
    });
  };

  Dashboard.prototype.recalcular = function () {
    var FARM = window.FARM || {};
    var hoy = FARM.hoyCaracas ? FARM.hoyCaracas() : new Date().toISOString().slice(0, 10);
    this.informe = calcularInforme(FARM, this.datos, this.vista, hoy);
    this.pintarZona();
  };

  function cif(n, txt, clase) {
    return '<div class="cifra ' + (clase || '') + '"><b>' + n + '</b><span>' + esc(txt) + '</span></div>';
  }
  function tablaSimple(enc, filas) {
    if (!filas.length) return '<p class="sub chico">Todavía no hay nada que contar aquí.</p>';
    return '<div class="tabla-caja"><table class="tabla"><thead><tr>' +
      enc.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr>' + f.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  Dashboard.prototype.pintarZona = function () {
    var t = this, i = function (n) { return t.id(n); };
    var inf = t.informe;
    var z = t.q('Zona');

    var VISTA_TXT = { dia: 'Por día', semana: 'Por semana', mes: 'Por mes' };

    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<h2>Dashboard</h2>' +
        '<div class="descargas">' +
          '<button type="button" id="' + i('Excel') + '">Descargar Excel</button>' +
          '<button type="button" id="' + i('Pdf') + '">Descargar informe en PDF</button>' +
        '</div>' +
      '</div>' +
      '<p class="sub">Todo lo que hay registrado hoy en Personas, Jornadas, Centros y Lo entregado, ' +
        'contado día por día, semana por semana y mes por mes. Semana: ' + esc(inf.rotuloSemana) +
        '. Mes: ' + esc(inf.rotuloMes) + '.</p>' +

      '<div class="chips" id="' + i('Vista') + '">' +
        ['dia', 'semana', 'mes'].map(function (v) {
          return '<button type="button" data-v="' + v + '"' + (inf.vista === v ? ' class="on"' : '') + '>' +
                 VISTA_TXT[v] + '</button>';
        }).join('') +
      '</div>' +

      seccionPersonas(inf.personas, inf.vista) +
      seccionJornadas(inf.jornadas, inf.vista) +
      seccionCentros(inf.centros, inf.vista) +
      seccionEntregado(inf.entregado, inf.vista);

    t.q('Vista').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.v === t.vista) return;
        t.vista = b.dataset.v;
        t.recalcular();
      });
    });
    t.q('Excel').addEventListener('click', function () { descargarExcel(t.informe); });
    t.q('Pdf').addEventListener('click', function () { descargarPdf(t.informe); });
  };

  function seccionPersonas(p, vista) {
    return '<h2 class="sub-t">Personas registradas</h2>' +
      '<div class="cifras">' +
        cif(num(p.total), 'personas en total') +
        cif(num(p.hoy), 'nuevas hoy') +
        cif(num(p.semana), 'nuevas esta semana') +
        cif(num(p.mes), 'nuevas este mes') +
        cif(num(p.porRevisar), 'por revisar', p.porRevisar ? 'alerta' : '') +
      '</div>' +
      '<div class="renglones">' +
        p.porSexo.map(function (x) {
          return '<div class="renglon"><div class="que"><b>' + esc(x.etiqueta === 'F' ? 'Femenino' :
            x.etiqueta === 'M' ? 'Masculino' : x.etiqueta) + '</b></div><span class="pill">' + num(x.cantidad) + '</span></div>';
        }).join('') +
      '</div>' +
      tablaSimple(['Período', 'Personas nuevas'],
        p.tendencia.map(function (r) { return [esc(r.etiqueta), '<b>' + num(r.cantidad) + '</b>']; }));
  }

  function seccionJornadas(j, vista) {
    return '<h2 class="sub-t">Jornadas y ruta materna</h2>' +
      '<div class="cifras">' +
        cif(num(j.total), 'registros en total') +
        cif(num(j.hoy), 'nuevos hoy') +
        cif(num(j.semana), 'nuevos esta semana') +
        cif(num(j.mes), 'nuevos este mes') +
        cif(num(j.porRevisar), 'por revisar', j.porRevisar ? 'alerta' : '') +
      '</div>' +
      '<div class="renglones">' +
        j.porConjunto.map(function (x) {
          return '<div class="renglon"><div class="que"><b>' + esc(x.etiqueta) + '</b></div><span class="pill">' + num(x.cantidad) + '</span></div>';
        }).join('') +
      '</div>' +
      '<p class="sub chico">Por hoja del Excel</p>' +
      tablaSimple(['Hoja', 'Registros'], j.porHoja.map(function (x) { return [esc(x.etiqueta), '<b>' + num(x.cantidad) + '</b>']; })) +
      tablaSimple(['Período', 'Registros nuevos'],
        j.tendencia.map(function (r) { return [esc(r.etiqueta), '<b>' + num(r.cantidad) + '</b>']; }));
  }

  function seccionCentros(c, vista) {
    return '<h2 class="sub-t">Centros de salud</h2>' +
      '<div class="cifras">' +
        cif(num(c.total), 'centros registrados') +
        cif(num(c.activos), 'activos') +
        cif(num(c.inactivos), 'inactivos', c.inactivos ? 'alerta' : '') +
        cif(num(c.entregasTotal), 'entregas realizadas') +
        cif(unNum(c.unidadesRecibidas), 'unidades recibidas en total') +
        cif(num(c.insumosPedidos), 'renglones de insumos que piden (sumado)') +
      '</div>' +
      '<div class="renglones">' +
        c.porTipo.map(function (x) {
          return '<div class="renglon"><div class="que"><b>' + esc(x.etiqueta) +
            '</b></div><span class="pill">' + num(x.cantidad) + '</span></div>';
        }).join('') +
      '</div>' +
      '<p class="sub chico">Los diez centros que más unidades han recibido</p>' +
      tablaSimple(['Centro', 'Unidades recibidas', 'Entregas'],
        c.ranking.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
      '<p class="sub chico">Entregas a centros, ' + (vista === 'dia' ? 'por día' : vista === 'semana' ? 'por semana' : 'por mes') + '</p>' +
      tablaSimple(['Período', 'Entregas'], c.tendencia.map(function (r) { return [esc(r.etiqueta), '<b>' + num(r.cantidad) + '</b>']; }));
  }

  function seccionEntregado(e, vista) {
    return '<h2 class="sub-t">Lo entregado</h2>' +
      '<div class="cifras">' +
        cif(num(e.total), 'entregas en total') +
        cif(num(e.hoy), 'entregas hoy') +
        cif(num(e.semana), 'entregas esta semana') +
        cif(num(e.mes), 'entregas este mes') +
      '</div>' +
      '<div class="cifras">' +
        cif(unNum(e.unidadesTotal), 'unidades entregadas en total') +
        cif(unNum(e.unidadesHoy), 'unidades hoy') +
        cif(unNum(e.unidadesSemana), 'unidades esta semana') +
        cif(unNum(e.unidadesMes), 'unidades este mes') +
      '</div>' +
      (e.sinDetalle
        ? '<p class="sub chico ojo">' + num(e.sinDetalle) + ' entregas del cuaderno viejo no traen la cantidad ' +
          'anotada -no se pueden sumar en unidades, aunque sí cuentan como visita-. Las cifras de unidades de ' +
          'arriba solo suman lo que sí tiene cantidad registrada.</p>' : '') +
      '<div class="renglones">' +
        '<div class="renglon"><div class="que"><b>A personas</b></div><span class="pill">' + num(e.aPacientes) + '</span></div>' +
        '<div class="renglon"><div class="que"><b>A centros de salud</b></div><span class="pill">' + num(e.aCentros) + '</span></div>' +
      '</div>' +
      '<p class="sub chico">Los diez medicamentos que más han salido, por unidades</p>' +
      tablaSimple(['Medicamento', 'Unidades', 'Entregas'],
        e.topMedicamentos.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
      '<p class="sub chico">Cuánto ha entregado cada quien despacha (solo lo que trae cantidad)</p>' +
      tablaSimple(['Quién despachó', 'Unidades', 'Renglones'],
        e.porDespachador.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
      '<p class="sub chico">Entregas, ' + (vista === 'dia' ? 'por día' : vista === 'semana' ? 'por semana' : 'por mes') + '</p>' +
      tablaSimple(['Período', 'Entregas', 'Unidades'],
        e.tendenciaUnidades.map(function (r, idx) {
          return [esc(r.etiqueta), '<b>' + num(e.tendencia[idx].cantidad) + '</b>', unNum(r.unidades)];
        }));
  }

  /* ================================================================
     DESCARGAS
  ================================================================ */
  function descargarExcel(inf) {
    if (!window.FARMREP) { alert('Todavía se está cargando el generador de reportes.'); return; }
    var hojas = [
      { nombre: 'Personas', titulo: 'Personas registradas', anchos: [22, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Total histórico', inf.personas.total], ['Nuevas hoy', inf.personas.hoy],
          ['Nuevas esta semana', inf.personas.semana], ['Nuevas este mes', inf.personas.mes],
          ['Por revisar', inf.personas.porRevisar]
        ].concat(inf.personas.porSexo.map(function (x) { return [x.etiqueta, x.cantidad]; })) },
      { nombre: 'Personas-tendencia', titulo: 'Personas nuevas, ' + rotVista(inf.vista), anchos: [22, 16],
        encabezados: ['Período', 'Nuevas'], filas: inf.personas.tendencia.map(function (r) { return [r.etiqueta, r.cantidad]; }) },

      { nombre: 'Jornadas', titulo: 'Jornadas y ruta materna', anchos: [26, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Total histórico', inf.jornadas.total], ['Nuevos hoy', inf.jornadas.hoy],
          ['Nuevos esta semana', inf.jornadas.semana], ['Nuevos este mes', inf.jornadas.mes],
          ['Por revisar', inf.jornadas.porRevisar]
        ].concat(inf.jornadas.porConjunto.map(function (x) { return [x.etiqueta, x.cantidad]; }))
         .concat(inf.jornadas.porHoja.map(function (x) { return [x.etiqueta, x.cantidad]; })) },
      { nombre: 'Jornadas-tendencia', titulo: 'Jornadas nuevas, ' + rotVista(inf.vista), anchos: [22, 16],
        encabezados: ['Período', 'Nuevos'], filas: inf.jornadas.tendencia.map(function (r) { return [r.etiqueta, r.cantidad]; }) },

      { nombre: 'Centros', titulo: 'Centros de salud', anchos: [30, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Total registrados', inf.centros.total], ['Activos', inf.centros.activos], ['Inactivos', inf.centros.inactivos],
          ['Entregas realizadas', inf.centros.entregasTotal], ['Unidades recibidas en total', inf.centros.unidadesRecibidas],
          ['Renglones de insumos que piden (sumado)', inf.centros.insumosPedidos]
        ].concat(inf.centros.porTipo.map(function (x) { return [x.etiqueta, x.cantidad]; })) },
      { nombre: 'Centros-ranking', titulo: 'Los diez centros que más han recibido', anchos: [40, 18, 14],
        encabezados: ['Centro', 'Unidades recibidas', 'Entregas'],
        filas: inf.centros.ranking.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Centros-tendencia', titulo: 'Entregas a centros, ' + rotVista(inf.vista), anchos: [22, 14],
        encabezados: ['Período', 'Entregas'], filas: inf.centros.tendencia.map(function (r) { return [r.etiqueta, r.cantidad]; }) },

      { nombre: 'Entregado', titulo: 'Lo entregado', anchos: [30, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Entregas en total', inf.entregado.total], ['Entregas hoy', inf.entregado.hoy],
          ['Entregas esta semana', inf.entregado.semana], ['Entregas este mes', inf.entregado.mes],
          ['Unidades en total', inf.entregado.unidadesTotal], ['Unidades hoy', inf.entregado.unidadesHoy],
          ['Unidades esta semana', inf.entregado.unidadesSemana], ['Unidades este mes', inf.entregado.unidadesMes],
          ['Entregas a personas', inf.entregado.aPacientes], ['Entregas a centros', inf.entregado.aCentros],
          ['Entregas del cuaderno viejo sin cantidad anotada', inf.entregado.sinDetalle]
        ] },
      { nombre: 'Entregado-top', titulo: 'Los diez medicamentos que más han salido', anchos: [36, 16, 14],
        encabezados: ['Medicamento', 'Unidades', 'Entregas'],
        filas: inf.entregado.topMedicamentos.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Entregado-despacho', titulo: 'Cuánto ha entregado cada quien despacha', anchos: [30, 16, 14],
        encabezados: ['Quién despachó', 'Unidades', 'Renglones'],
        filas: inf.entregado.porDespachador.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Entregado-tendencia', titulo: 'Entregas y unidades, ' + rotVista(inf.vista), anchos: [22, 14, 16],
        encabezados: ['Período', 'Entregas', 'Unidades'],
        filas: inf.entregado.tendencia.map(function (r, idx) { return [r.etiqueta, r.cantidad, inf.entregado.tendenciaUnidades[idx].unidades]; }) }
    ];
    window.FARMREP.excel('Dashboard - Farmacia Municipal', hojas);
  }
  function rotVista(v) { return v === 'dia' ? 'por día' : v === 'semana' ? 'por semana' : 'por mes'; }

  function descargarPdf(inf) {
    if (!window.FARMREP) { alert('Todavía se está cargando el generador de reportes.'); return; }
    window.FARMREP.pdfInforme({
      titulo: 'Dashboard de la Farmacia Municipal',
      subtitulo: 'Semana: ' + inf.rotuloSemana + ' · Mes: ' + inf.rotuloMes + ' · Vista ' + rotVista(inf.vista),
      horizontal: true,
      resumen: [
        { k: 'Personas registradas', v: num(inf.personas.total) },
        { k: 'Jornadas registradas', v: num(inf.jornadas.total) },
        { k: 'Centros activos', v: num(inf.centros.activos) },
        { k: 'Entregas realizadas', v: num(inf.entregado.total) },
        { k: 'Unidades entregadas', v: unNum(inf.entregado.unidadesTotal) },
        { k: 'Personas por revisar', v: num(inf.personas.porRevisar) }
      ],
      bloques: [
        { titulo: 'Personas — nuevas ' + rotVista(inf.vista), encabezados: ['Período', 'Nuevas'],
          filas: inf.personas.tendencia.map(function (r) { return [r.etiqueta, num(r.cantidad)]; }) },
        { titulo: 'Personas — por sexo', encabezados: ['Sexo', 'Cantidad'],
          filas: inf.personas.porSexo.map(function (x) { return [x.etiqueta, num(x.cantidad)]; }) },

        { titulo: 'Jornadas — nuevas ' + rotVista(inf.vista), encabezados: ['Período', 'Nuevas'],
          filas: inf.jornadas.tendencia.map(function (r) { return [r.etiqueta, num(r.cantidad)]; }) },
        { titulo: 'Jornadas — por hoja del Excel', encabezados: ['Hoja', 'Cantidad'],
          filas: inf.jornadas.porHoja.map(function (x) { return [x.etiqueta, num(x.cantidad)]; }) },

        { titulo: 'Centros — los diez que más han recibido', encabezados: ['Centro', 'Unidades', 'Entregas'],
          filas: inf.centros.ranking.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },
        { titulo: 'Centros — entregas ' + rotVista(inf.vista), encabezados: ['Período', 'Entregas'],
          filas: inf.centros.tendencia.map(function (r) { return [r.etiqueta, num(r.cantidad)]; }) },

        { titulo: 'Lo entregado — los diez medicamentos que más han salido', encabezados: ['Medicamento', 'Unidades', 'Entregas'],
          filas: inf.entregado.topMedicamentos.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },
        { titulo: 'Lo entregado — por quién despachó', encabezados: ['Quién despachó', 'Unidades', 'Renglones'],
          filas: inf.entregado.porDespachador.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },
        { titulo: 'Lo entregado — ' + rotVista(inf.vista),
          nota: inf.entregado.sinDetalle ? (num(inf.entregado.sinDetalle) + ' entregas viejas del cuaderno no traen cantidad y no suman a las unidades.') : '',
          encabezados: ['Período', 'Entregas', 'Unidades'],
          filas: inf.entregado.tendencia.map(function (r, idx) {
            return [r.etiqueta, num(r.cantidad), unNum(inf.entregado.tendenciaUnidades[idx].unidades)];
          }) }
      ]
    });
  }

  window.PANTALLA_DASHBOARD = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Dashboard(cliente, contenedor, o.prefijo || 'da');
    t.pintar();
    return t;
  };

  // Se expone para las pruebas unitarias: es lógica pura, sin DOM.
  window.DASHBOARD_CALCULAR = calcularInforme;
})();
