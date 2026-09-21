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

  /* Cuántos valores DISTINTOS tiene un campo -para "cuántos pacientes
     distintos" o "cuántos insumos distintos", que no es lo mismo que
     contar filas: la misma persona puede pedir récipe varias veces. */
  function distintos(filas, campo) {
    var s = {};
    filas.forEach(function (f) { if (f[campo] != null) s[f[campo]] = true; });
    return Object.keys(s).length;
  }
  function distintosEnRango(filas, campo, desde, hasta) {
    var s = {};
    filas.forEach(function (f) {
      if (enRango(f.fecha, desde, hasta) && f[campo] != null) s[f[campo]] = true;
    });
    return Object.keys(s).length;
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
      return { fecha: j.fecha || diaLocal(FARM, j.creado_en), conjunto: j.conjunto,
               hoja_origen: j.hoja_origen, estado: j.estado, tratamiento: j.tratamiento };
    });
    var unidadesJornada = [], sinCantidadJornada = [];
    jornadas.forEach(function (j) {
      var piezas = FARM.piezasTratamientoCant ? FARM.piezasTratamientoCant(j.tratamiento) : [];
      piezas.forEach(function (m) {
        var fila = { fecha: j.fecha, producto: m.nombre || 'Sin identificar' };
        if (m.anotada) {
          fila.cantidad = Number(m.cantidad) || 0;
          unidadesJornada.push(fila);
        } else {
          sinCantidadJornada.push(fila);
        }
      });
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
      unidadesTotal: unidadesJornada.reduce(function (s, r) { return s + r.cantidad; }, 0),
      unidadesHoy: sumarEnRango(unidadesJornada, 'cantidad', rHoy.desde, rHoy.hasta),
      unidadesSemana: sumarEnRango(unidadesJornada, 'cantidad', rSemana.desde, rSemana.hasta),
      unidadesMes: sumarEnRango(unidadesJornada, 'cantidad', rMes.desde, rMes.hasta),
      sinCantidad: sinCantidadJornada.length,
      topMedicamentos: agruparSuma(unidadesJornada, 'producto', 'cantidad', 'Sin identificar').slice(0, 10),
      tendencia: tendencia(FARM, jornadas, vista, hoy),
      tendenciaUnidades: tendencia(FARM, unidadesJornada, vista, hoy, 'cantidad')
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
        paciente_id: r.paciente_id, institucion_id: r.institucion_id,
        destinatario: r.destinatario, entregado_por: r.entregado_por || 'No consta',
        origen: r.origen
      };
    });

    var renglonesConCantidad = renglones.filter(function (r) { return !r.anulada && r.cantidad != null; })
      .map(function (r) {
        return { fecha: r.fecha, cantidad: Number(r.cantidad), producto: r.producto || 'Sin producto',
                 tipo_destinatario: r.tipo_destinatario, paciente_id: r.paciente_id,
                 institucion_id: r.institucion_id,
                 entregado_por: r.entregado_por || 'No consta' };
      });

    var centroEntregas = unicas.filter(function (u) { return u.tipo_destinatario === 'institucion'; });
    var pacienteEntregas = unicas.filter(function (u) { return u.tipo_destinatario === 'paciente'; });
    var unidadesPacientes = renglonesConCantidad.filter(function (r) { return r.tipo_destinatario === 'paciente'; });
    var unidadesCentros = renglonesConCantidad.filter(function (r) { return r.tipo_destinatario === 'institucion'; });

    infoPersonas.entregasReales = pacienteEntregas.length;
    infoPersonas.receptoresReales = distintos(pacienteEntregas, 'paciente_id');
    infoPersonas.unidadesEntregadas = unidadesPacientes.reduce(function (s, r) { return s + r.cantidad; }, 0);
    infoPersonas.unidadesHoy = sumarEnRango(unidadesPacientes, 'cantidad', rHoy.desde, rHoy.hasta);
    infoPersonas.unidadesSemana = sumarEnRango(unidadesPacientes, 'cantidad', rSemana.desde, rSemana.hasta);
    infoPersonas.unidadesMes = sumarEnRango(unidadesPacientes, 'cantidad', rMes.desde, rMes.hasta);
    infoPersonas.topEntregado = agruparSuma(unidadesPacientes, 'producto', 'cantidad', 'Sin producto').slice(0, 10);
    infoPersonas.tendenciaEntregado = tendencia(FARM, unidadesPacientes, vista, hoy, 'cantidad');

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
      unidadesHoy: sumarEnRango(unidadesCentros, 'cantidad', rHoy.desde, rHoy.hasta),
      unidadesSemana: sumarEnRango(unidadesCentros, 'cantidad', rSemana.desde, rSemana.hasta),
      unidadesMes: sumarEnRango(unidadesCentros, 'cantidad', rMes.desde, rMes.hasta),
      entregasTotal: centroEntregas.length,
      entregasHoy: contarEnRango(centroEntregas, rHoy.desde, rHoy.hasta),
      entregasSemana: contarEnRango(centroEntregas, rSemana.desde, rSemana.hasta),
      entregasMes: contarEnRango(centroEntregas, rMes.desde, rMes.hasta),
      ranking: ranking,
      topMedicamentos: agruparSuma(unidadesCentros, 'producto', 'cantidad', 'Sin producto').slice(0, 10),
      tendencia: tendencia(FARM, centroEntregas, vista, hoy),
      tendenciaUnidades: tendencia(FARM, unidadesCentros, vista, hoy, 'cantidad')
    };

    /* -------- Récipes --------
       Esto es lo que se PIDIÓ por récipe (tabla solicitudes): cuántos
       récipes llegaron, a cuántas personas distintas y qué insumos
       distintos pidieron. NO es lo mismo que "Lo entregado": un récipe
       deja anotada la necesidad, y la entrega de verdad -la que
       descuenta inventario- es un paso aparte, que ya se cuenta en la
       sección de abajo. Mezclar las dos cifras haría parecer que todo
       récipe se despachó igual, y eso no se sabe. */
    var mapaProductos = {};
    (datos.productos || []).forEach(function (p) { mapaProductos[p.id] = p.nombre; });
    var recipes = (datos.recipes || []).map(function (s) {
      return { id: s.id, paciente_id: s.paciente_id, fecha: diaLocal(FARM, s.creado_en) };
    });
    var fechaDeSolicitud = {};
    recipes.forEach(function (r) { fechaDeSolicitud[r.id] = r.fecha; });
    var renglonesRecipe = (datos.tratRecipe || [])
      .filter(function (t) { return t.solicitud_id && fechaDeSolicitud[t.solicitud_id]; })
      .map(function (t) {
        return {
          fecha: fechaDeSolicitud[t.solicitud_id],
          producto: t.producto_id ? (mapaProductos[t.producto_id] || 'Del catálogo') : (t.texto_original || 'Sin identificar')
        };
      });
    var infoRecipes = {
      total: recipes.length,
      hoy: contarEnRango(recipes, rHoy.desde, rHoy.hasta),
      semana: contarEnRango(recipes, rSemana.desde, rSemana.hasta),
      mes: contarEnRango(recipes, rMes.desde, rMes.hasta),
      pacientes: distintos(recipes, 'paciente_id'),
      pacientesHoy: distintosEnRango(recipes, 'paciente_id', rHoy.desde, rHoy.hasta),
      pacientesSemana: distintosEnRango(recipes, 'paciente_id', rSemana.desde, rSemana.hasta),
      pacientesMes: distintosEnRango(recipes, 'paciente_id', rMes.desde, rMes.hasta),
      insumosDistintos: distintos(renglonesRecipe, 'producto'),
      renglonesTotal: renglonesRecipe.length,
      topInsumos: agrupar(renglonesRecipe, 'producto', 'Sin identificar').slice(0, 10),
      tendencia: tendencia(FARM, recipes, vista, hoy)
    };

    /* -------- Insumos --------
       Las dos hojas del módulo se mantienen separadas de las entregas
       formales para no duplicar inventario. Aquí sí se suman los items
       con cantidad por producto. Los totales viejos del Excel se muestran
       aparte, porque no se pueden repartir entre sus nombres. */
    var insumosEventos = [];
    function anexarInsumos(lista, area, campoExcel) {
      (lista || []).forEach(function (e) {
        if (e.anulada) return;
        var evento = { id: area + ':' + e.id, fecha: e.fecha || diaLocal(FARM, e.creado_en),
                       area: area, totalExcel: Number(e[campoExcel] || 0), items: e.items || [] };
        insumosEventos.push(evento);
      });
    }
    anexarInsumos(datos.insumosCds, 'Centros y destinos', 'cantidad_total_excel');
    anexarInsumos(datos.insumosControl, 'Control a personas', 'total_entregado_excel');
    var insumosConCantidad = [], insumosSinCantidad = 0;
    insumosEventos.forEach(function (e) {
      (e.items || []).forEach(function (it) {
        if (it.cantidad == null || !(Number(it.cantidad) > 0)) { insumosSinCantidad++; return; }
        insumosConCantidad.push({ fecha: e.fecha, area: e.area,
          producto: it.descripcion || 'Sin identificar', cantidad: Number(it.cantidad) });
      });
    });
    var infoInsumos = {
      entregas: insumosEventos.length,
      unidadesTotal: insumosConCantidad.reduce(function (s, r) { return s + r.cantidad; }, 0),
      unidadesHoy: sumarEnRango(insumosConCantidad, 'cantidad', rHoy.desde, rHoy.hasta),
      unidadesSemana: sumarEnRango(insumosConCantidad, 'cantidad', rSemana.desde, rSemana.hasta),
      unidadesMes: sumarEnRango(insumosConCantidad, 'cantidad', rMes.desde, rMes.hasta),
      totalExcel: insumosEventos.reduce(function (s, e) { return s + e.totalExcel; }, 0),
      sinCantidad: insumosSinCantidad,
      topProductos: agruparSuma(insumosConCantidad, 'producto', 'cantidad', 'Sin identificar').slice(0, 15),
      porArea: agruparSuma(insumosConCantidad, 'area', 'cantidad', 'Sin área'),
      tendencia: tendencia(FARM, insumosConCantidad, vista, hoy, 'cantidad')
    };

    return {
      hoy: hoy, vista: vista,
      rotuloSemana: FARM.rotuloPeriodo ? FARM.rotuloPeriodo(rSemana.desde, rSemana.hasta, hoy) : '',
      rotuloMes: FARM.rotuloPeriodo ? FARM.rotuloPeriodo(rMes.desde, rMes.hasta, hoy) : '',
      personas: infoPersonas, jornadas: infoJornadas, centros: infoCentros,
      recipes: infoRecipes, insumos: infoInsumos, entregado: infoEntregado
    };
  }

  /* ================================================================
     TRAER LOS DATOS
  ================================================================ */
  function traeTodo(sb, tabla, campos, filtro) {
    var todo = [];
    function pag(desde) {
      var q = sb.from(tabla).select(campos).range(desde, desde + 999);
      if (filtro) q = filtro(q);
      return q.then(function (r) {
        if (r.error) throw r.error;
        var f = r.data || [];
        todo = todo.concat(f);
        if (f.length === 1000) return pag(desde + 1000);
        return todo;
      });
    }
    return pag(0);
  }

  var CAMPOS_ENTREGAS = 'entrega_id,fecha,tipo_destinatario,paciente_id,institucion_id,anulada,origen,' +
                         'cantidad,producto,destinatario,entregado_por';

  function traerDatos(sb) {
    return Promise.all([
      traeTodo(sb, 'pacientes', 'id,sexo,estado,creado_en'),
      traeTodo(sb, 'jornadas_registros', 'id,conjunto,hoja_origen,estado,fecha,tratamiento,creado_en'),
      traeTodo(sb, 'instituciones', 'id,tipo,activo,creado_en'),
      sb.from('v_instituciones_ficha').select('id,nombre,tipo,activo,entregas,insumos,unidades_recibidas')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; }),
      traeTodo(sb, 'v_entregas_renglon', CAMPOS_ENTREGAS),
      /* Récipes: lo que se PIDIÓ (solicitudes), no lo ya entregado -eso
         sigue saliendo de v_entregas_renglon, arriba-. */
      traeTodo(sb, 'solicitudes', 'id,paciente_id,creado_en', function (q) { return q.eq('via', 'recipe'); }),
      traeTodo(sb, 'tratamientos_paciente', 'solicitud_id,producto_id,texto_original',
        function (q) { return q.eq('origen', 'recipe'); }),
      traeTodo(sb, 'productos', 'id,nombre'),
      traeTodo(sb, 'v_insumos_entregas_cds', 'id,fecha,creado_en,anulada,cantidad_total_excel,items'),
      traeTodo(sb, 'v_insumos_control_entregas', 'id,fecha,creado_en,anulada,total_entregado_excel,items')
    ]).then(function (r) {
      return {
        personas: r[0], jornadas: r[1], centros: r[2], centrosFicha: r[3], entregasRenglon: r[4],
        recipes: r[5], tratRecipe: r[6], productos: r[7], insumosCds: r[8], insumosControl: r[9]
      };
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
    this.canal = null;
    this.recargaPendiente = null;
    this.cargando = false;
    this.estadoTiempoReal = 'conectando';
  }
  Dashboard.prototype.id = function (n) { return this.pfx + n; };
  Dashboard.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };

  Dashboard.prototype.pintar = function () {
    var t = this;
    t.raiz.innerHTML = '<div id="' + t.id('Zona') + '"></div>';
    t.cargar();
    t.iniciarTiempoReal();
  };

  Dashboard.prototype.cargar = function (silenciosa) {
    var t = this;
    if (t.cargando) return;
    t.cargando = true;
    var z = t.q('Zona');
    if (!silenciosa || !t.datos) {
      z.innerHTML = '<div class="cargando">Sumando cantidades reales de todas las áreas…</div>';
    } else {
      t.estadoTiempoReal = 'actualizando';
      t.pintarEstadoTiempoReal();
    }
    traerDatos(t.sb).then(function (datos) {
      t.cargando = false;
      t.datos = datos;
      if (t.estadoTiempoReal === 'actualizando') t.estadoTiempoReal = 'en_vivo';
      t.recalcular();
    }).catch(function (e) {
      t.cargando = false;
      z.innerHTML = '<div class="aviso bad">No se pudo calcular el dashboard: ' + esc(e.message || e) + '</div>';
    });
  };

  Dashboard.prototype.pintarEstadoTiempoReal = function () {
    var e = this.q('TiempoReal');
    if (!e) return;
    var txt = this.estadoTiempoReal === 'en_vivo' ? '● En vivo' :
              this.estadoTiempoReal === 'actualizando' ? '↻ Actualizando…' :
              this.estadoTiempoReal === 'error' ? 'Sin conexión en vivo' : 'Conectando…';
    e.textContent = txt;
    e.className = 'sit ' + (this.estadoTiempoReal === 'en_vivo' ? 'ok' :
                            this.estadoTiempoReal === 'error' ? 'ojo' : '');
  };

  Dashboard.prototype.iniciarTiempoReal = function () {
    var t = this;
    if (!t.sb || !t.sb.channel) return;
    var tablas = ['pacientes', 'jornadas_registros', 'jornadas_eventos', 'instituciones',
      'entregas', 'entrega_detalle', 'solicitudes', 'tratamientos_paciente', 'productos',
      'insumos_entregas_cds', 'insumos_entregas_cds_items',
      'insumos_control_entregas', 'insumos_control_entregas_items'];
    var canal = t.sb.channel('dashboard-tiempo-real-' + t.pfx + '-' + Date.now());
    tablas.forEach(function (tabla) {
      canal.on('postgres_changes', { event: '*', schema: 'farmacia', table: tabla }, function () {
        if (!t.q('Zona')) { t.detenerTiempoReal(); return; }
        clearTimeout(t.recargaPendiente);
        t.recargaPendiente = setTimeout(function () { t.cargar(true); }, 450);
      });
    });
    t.canal = canal.subscribe(function (estado) {
      t.estadoTiempoReal = estado === 'SUBSCRIBED' ? 'en_vivo' :
                           (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' ? 'error' : 'conectando');
      t.pintarEstadoTiempoReal();
    });
  };

  Dashboard.prototype.detenerTiempoReal = function () {
    clearTimeout(this.recargaPendiente);
    if (this.canal && this.sb && this.sb.removeChannel) this.sb.removeChannel(this.canal);
    this.canal = null;
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

  /* Un anillo de datos con su leyenda -no barras sueltas-: llena el
     panel como el de la derecha, y de un vistazo se ve quién pesa
     más. El "dibujado" empieza vacío (dashoffset = la vuelta entera)
     y `animarAnillos` lo lleva a su valor real: eso es lo que dibuja
     el anillo al entrar, en vez de aparecer ya lleno. */
  var PALETA_DATOS = ['#3b82f6', '#f4c20d', '#22d3ee', '#a78bfa', '#fb7185', '#34d399'];
  function anillo(items, centroTxt) {
    items = items.filter(function (x) { return x.cantidad > 0; });
    if (!items.length) return '<p class="sub chico">Todavía no hay nada que contar aquí.</p>';
    var total = items.reduce(function (s, x) { return s + x.cantidad; }, 0);
    var r = 60, circ = 2 * Math.PI * r, acumulado = 0;

    var segmentos = items.map(function (x, i) {
      var dash = (x.cantidad / total) * circ;
      var offset = circ - (acumulado / total) * circ;
      acumulado += x.cantidad;
      return { color: PALETA_DATOS[i % PALETA_DATOS.length], dash: dash, offset: offset };
    });

    var svg = '<svg viewBox="0 0 140 140" aria-hidden="true">' +
      '<circle class="pista" cx="70" cy="70" r="' + r + '"></circle>' +
      segmentos.map(function (s) {
        return '<circle class="seg" cx="70" cy="70" r="' + r + '" stroke="' + s.color + '" ' +
          'stroke-dasharray="' + s.dash.toFixed(1) + ' ' + (circ - s.dash).toFixed(1) + '" ' +
          'stroke-dashoffset="' + circ.toFixed(1) + '" data-offset="' + s.offset.toFixed(1) + '"></circle>';
      }).join('') +
      '</svg>' +
      '<div class="dash-anillo-centro"><b>' + num(total) + '</b><span>' + esc(centroTxt || 'total') + '</span></div>';

    var leyenda = items.map(function (x, i) {
      var pct = Math.round(x.cantidad / total * 100);
      var color = PALETA_DATOS[i % PALETA_DATOS.length];
      return '<div class="dash-leyenda-fila">' +
        '<span class="dash-leyenda-punto" style="background:' + color + '"></span>' +
        '<span>' + esc(x.etiqueta) + '</span><b>' + num(x.cantidad) + ' · ' + pct + '%</b></div>';
    }).join('');

    return '<div class="dash-anillo-caja"><div class="dash-anillo">' + svg + '</div>' +
      '<div class="dash-leyenda">' + leyenda + '</div></div>';
  }
  /* El primer pintado deja cada anillo en dashoffset = la vuelta
     entera (invisible). Un instante después -ya en el DOM, para que
     el navegador tenga algo de qué animar- se lleva cada uno a su
     valor real, y la transición CSS hace el dibujado. */
  function animarAnillos(raiz) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        raiz.querySelectorAll('.dash-anillo .seg').forEach(function (c) {
          c.style.strokeDashoffset = c.dataset.offset;
        });
      });
    });
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
        '<h2>Dashboard <span id="' + i('TiempoReal') + '" class="sit">Conectando…</span></h2>' +
        '<div class="descargas">' +
          '<button type="button" id="' + i('Excel') + '">Descargar Excel</button>' +
          '<button type="button" id="' + i('Pdf') + '">Descargar informe en PDF</button>' +
        '</div>' +
      '</div>' +
      '<p class="sub">Las cantidades son unidades realmente anotadas en cada entrega; un nombre sin cantidad ' +
        'se señala aparte y nunca se convierte en una unidad. Se actualiza automáticamente. Semana: ' + esc(inf.rotuloSemana) +
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
      seccionInsumos(inf.insumos, inf.vista) +
      seccionRecipes(inf.recipes, inf.vista) +
      seccionEntregado(inf.entregado, inf.vista);

    animarAnillos(z);
    t.pintarEstadoTiempoReal();

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

  function rotuloVista(vista) { return vista === 'dia' ? 'por día' : vista === 'semana' ? 'por semana' : 'por mes'; }
  function nombreSexo(s) { return s === 'F' ? 'Femenino' : s === 'M' ? 'Masculino' : s; }

  function seccionPersonas(p, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#3b82f6;--dash-glow:rgba(59,130,246,.18)">' +
      '<h2><span class="dash-punto"></span>Personas registradas</h2>' +
      '<div class="cifras">' +
        cif(num(p.total), 'personas en total') +
        cif(num(p.hoy), 'nuevas hoy') +
        cif(num(p.semana), 'nuevas esta semana') +
        cif(num(p.mes), 'nuevas este mes') +
        cif(num(p.porRevisar), 'por revisar', p.porRevisar ? 'alerta' : '') +
      '</div>' +
      '<div class="cifras">' +
        cif(num(p.entregasReales), 'entregas reales a personas') +
        cif(num(p.receptoresReales), 'personas distintas que recibieron') +
        cif(unNum(p.unidadesEntregadas), 'unidades entregadas a personas') +
        cif(unNum(p.unidadesHoy), 'unidades hoy') +
        cif(unNum(p.unidadesSemana), 'unidades esta semana') +
        cif(unNum(p.unidadesMes), 'unidades este mes') +
      '</div>' +
      '<div class="dash-grid">' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Por sexo</p>' +
          anillo(p.porSexo.map(function (x) { return { etiqueta: nombreSexo(x.etiqueta), cantidad: x.cantidad }; }), 'personas') +
        '</div>' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Nuevas, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Personas nuevas'],
            p.tendencia.map(function (r) { return [esc(r.etiqueta), '<b>' + num(r.cantidad) + '</b>']; })) +
          '<p class="sub chico">Medicamentos realmente entregados a personas</p>' +
          tablaSimple(['Medicamento', 'Unidades', 'Renglones'],
            p.topEntregado.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
        '</div>' +
      '</div></div>';
  }

  function seccionJornadas(j, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#a78bfa;--dash-glow:rgba(167,139,250,.18)">' +
      '<h2><span class="dash-punto"></span>Jornadas y ruta materna</h2>' +
      '<div class="cifras">' +
        cif(num(j.total), 'registros en total') +
        cif(num(j.hoy), 'nuevos hoy') +
        cif(num(j.semana), 'nuevos esta semana') +
        cif(num(j.mes), 'nuevos este mes') +
        cif(num(j.porRevisar), 'por revisar', j.porRevisar ? 'alerta' : '') +
      '</div>' +
      '<div class="cifras">' +
        cif(unNum(j.unidadesTotal), 'unidades con cantidad anotada') +
        cif(unNum(j.unidadesHoy), 'unidades hoy') +
        cif(unNum(j.unidadesSemana), 'unidades esta semana') +
        cif(unNum(j.unidadesMes), 'unidades este mes') +
        cif(num(j.sinCantidad), 'medicamentos sin cantidad', j.sinCantidad ? 'alerta' : '') +
      '</div>' +
      (j.sinCantidad ? '<p class="sub chico ojo">Los nombres sin una cantidad escrita se mantienen visibles para revisión, ' +
        'pero no se suman como unidades entregadas.</p>' : '') +
      '<div class="dash-grid">' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Medicamentos con cantidad comprobable</p>' +
          tablaSimple(['Medicamento', 'Unidades', 'Renglones'],
            j.topMedicamentos.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
        '</div>' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Por hoja del Excel</p>' +
          tablaSimple(['Hoja', 'Registros'], j.porHoja.map(function (x) { return [esc(x.etiqueta), '<b>' + num(x.cantidad) + '</b>']; })) +
          '<p class="sub chico">Actividad y unidades, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Registros', 'Unidades'],
            j.tendenciaUnidades.map(function (r, idx) {
              return [esc(r.etiqueta), '<b>' + num(j.tendencia[idx].cantidad) + '</b>', unNum(r.unidades)];
            })) +
        '</div>' +
      '</div></div>';
  }

  function seccionCentros(c, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#22d3ee;--dash-glow:rgba(34,211,238,.18)">' +
      '<h2><span class="dash-punto"></span>Centros de salud</h2>' +
      '<div class="cifras">' +
        cif(num(c.total), 'centros registrados') +
        cif(num(c.activos), 'activos') +
        cif(num(c.inactivos), 'inactivos', c.inactivos ? 'alerta' : '') +
        cif(num(c.entregasTotal), 'entregas realizadas') +
        cif(unNum(c.unidadesRecibidas), 'unidades recibidas en total') +
        cif(unNum(c.unidadesHoy), 'unidades hoy') +
        cif(unNum(c.unidadesSemana), 'unidades esta semana') +
        cif(unNum(c.unidadesMes), 'unidades este mes') +
      '</div>' +
      '<p class="sub chico">Los ' + num(c.insumosPedidos) + ' renglones solicitados por los centros son demanda, no entrega; ' +
        'por eso no se mezclan con las unidades recibidas.</p>' +
      '<div class="dash-grid">' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Por tipo de centro</p>' +
          anillo(c.porTipo, 'centros') +
        '</div>' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Los diez centros que más unidades han recibido</p>' +
          tablaSimple(['Centro', 'Unidades recibidas', 'Entregas'],
            c.ranking.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
          '<p class="sub chico">Medicamentos entregados a centros</p>' +
          tablaSimple(['Medicamento', 'Unidades', 'Renglones'],
            c.topMedicamentos.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
          '<p class="sub chico">Entregas a centros, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Entregas', 'Unidades'], c.tendenciaUnidades.map(function (r, idx) {
            return [esc(r.etiqueta), '<b>' + num(c.tendencia[idx].cantidad) + '</b>', unNum(r.unidades)];
          })) +
        '</div>' +
      '</div></div>';
  }

  function seccionInsumos(x, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#fb7185;--dash-glow:rgba(251,113,133,.18)">' +
      '<h2><span class="dash-punto"></span>Insumos entregados</h2>' +
      '<div class="cifras">' +
        cif(num(x.entregas), 'entregas registradas') +
        cif(unNum(x.unidadesTotal), 'unidades con cantidad por insumo') +
        cif(unNum(x.unidadesHoy), 'unidades hoy') +
        cif(unNum(x.unidadesSemana), 'unidades esta semana') +
        cif(unNum(x.unidadesMes), 'unidades este mes') +
        cif(num(x.sinCantidad), 'renglones sin cantidad', x.sinCantidad ? 'alerta' : '') +
      '</div>' +
      (x.totalExcel ? '<p class="sub chico ojo"><b>' + unNum(x.totalExcel) + '</b> unidades adicionales aparecen como total ' +
        'general en el Excel viejo. Se muestran aparte y no se reparten entre productos.</p>' : '') +
      '<div class="dash-grid">' +
        '<div class="dash-panel"><p class="sub chico">Unidades reales por área</p>' +
          anillo(x.porArea.map(function (r) { return { etiqueta: r.etiqueta, cantidad: r.unidades }; }), 'unidades') +
          '<p class="sub chico">Unidades, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Unidades'], x.tendencia.map(function (r) {
            return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>'];
          })) + '</div>' +
        '<div class="dash-panel"><p class="sub chico">Productos más entregados por cantidad</p>' +
          tablaSimple(['Producto', 'Unidades', 'Renglones'], x.topProductos.map(function (r) {
            return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)];
          })) + '</div>' +
      '</div></div>';
  }

  function seccionRecipes(r, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#22c55e;--dash-glow:rgba(34,197,94,.18)">' +
      '<h2><span class="dash-punto"></span>Récipes</h2>' +
      '<div class="cifras">' +
        cif(num(r.total), 'récipes registrados') +
        cif(num(r.hoy), 'hoy') +
        cif(num(r.semana), 'esta semana') +
        cif(num(r.mes), 'este mes') +
        cif(num(r.pacientes), 'pacientes atendidos por récipe') +
        cif(num(r.insumosDistintos), 'insumos distintos solicitados') +
      '</div>' +
      '<p class="sub chico">Esto es lo que se <b>pidió</b> por récipe. No es lo mismo que "Lo ' +
        'entregado", más abajo: ahí está lo que de verdad salió de la farmacia.</p>' +
      '<div class="dash-grid">' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Los insumos más pedidos por récipe</p>' +
          anillo(r.topInsumos, 'insumos pedidos') +
        '</div>' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Récipes, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Récipes'], r.tendencia.map(function (x) { return [esc(x.etiqueta), '<b>' + num(x.cantidad) + '</b>']; })) +
        '</div>' +
      '</div></div>';
  }

  function seccionEntregado(e, vista) {
    return '<div class="dash-seccion" style="--dash-acento:#f4c20d;--dash-glow:rgba(244,194,13,.18)">' +
      '<h2><span class="dash-punto"></span>Lo entregado</h2>' +
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
      '<div class="dash-grid">' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Por destinatario</p>' +
          anillo([{ etiqueta: 'A personas', cantidad: e.aPacientes }, { etiqueta: 'A centros de salud', cantidad: e.aCentros }], 'entregas') +
          '<p class="sub chico">Entregas, ' + rotuloVista(vista) + '</p>' +
          tablaSimple(['Período', 'Entregas', 'Unidades'],
            e.tendenciaUnidades.map(function (r, idx) {
              return [esc(r.etiqueta), '<b>' + num(e.tendencia[idx].cantidad) + '</b>', unNum(r.unidades)];
            })) +
        '</div>' +
        '<div class="dash-panel">' +
          '<p class="sub chico">Los diez medicamentos que más han salido, por unidades</p>' +
          tablaSimple(['Medicamento', 'Unidades', 'Entregas'],
            e.topMedicamentos.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
          '<p class="sub chico">Cuánto ha entregado cada quien despacha (solo lo que trae cantidad)</p>' +
          tablaSimple(['Quién despachó', 'Unidades', 'Renglones'],
            e.porDespachador.map(function (r) { return [esc(r.etiqueta), '<b>' + unNum(r.unidades) + '</b>', num(r.veces)]; })) +
        '</div>' +
      '</div></div>';
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
          ['Por revisar', inf.personas.porRevisar],
          ['Entregas reales a personas', inf.personas.entregasReales],
          ['Personas distintas que recibieron', inf.personas.receptoresReales],
          ['Unidades entregadas a personas', inf.personas.unidadesEntregadas],
          ['Unidades a personas hoy', inf.personas.unidadesHoy],
          ['Unidades a personas esta semana', inf.personas.unidadesSemana],
          ['Unidades a personas este mes', inf.personas.unidadesMes]
        ].concat(inf.personas.porSexo.map(function (x) { return [x.etiqueta, x.cantidad]; })) },
      { nombre: 'Personas-entregado', titulo: 'Medicamentos realmente entregados a personas', anchos: [38, 16, 14],
        encabezados: ['Medicamento', 'Unidades', 'Renglones'],
        filas: inf.personas.topEntregado.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Personas-tendencia', titulo: 'Personas nuevas, ' + rotVista(inf.vista), anchos: [22, 16],
        encabezados: ['Período', 'Nuevas'], filas: inf.personas.tendencia.map(function (r) { return [r.etiqueta, r.cantidad]; }) },

      { nombre: 'Jornadas', titulo: 'Jornadas y ruta materna', anchos: [26, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Total histórico', inf.jornadas.total], ['Nuevos hoy', inf.jornadas.hoy],
          ['Nuevos esta semana', inf.jornadas.semana], ['Nuevos este mes', inf.jornadas.mes],
          ['Por revisar', inf.jornadas.porRevisar],
          ['Unidades con cantidad anotada', inf.jornadas.unidadesTotal],
          ['Unidades hoy', inf.jornadas.unidadesHoy],
          ['Unidades esta semana', inf.jornadas.unidadesSemana],
          ['Unidades este mes', inf.jornadas.unidadesMes],
          ['Medicamentos sin cantidad', inf.jornadas.sinCantidad]
        ].concat(inf.jornadas.porConjunto.map(function (x) { return [x.etiqueta, x.cantidad]; }))
         .concat(inf.jornadas.porHoja.map(function (x) { return [x.etiqueta, x.cantidad]; })) },
      { nombre: 'Jornadas-productos', titulo: 'Medicamentos entregados en jornadas con cantidad comprobable', anchos: [38, 16, 14],
        encabezados: ['Medicamento', 'Unidades', 'Renglones'],
        filas: inf.jornadas.topMedicamentos.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Jornadas-tendencia', titulo: 'Jornadas y unidades, ' + rotVista(inf.vista), anchos: [22, 16, 16],
        encabezados: ['Período', 'Registros', 'Unidades'], filas: inf.jornadas.tendencia.map(function (r, idx) {
          return [r.etiqueta, r.cantidad, inf.jornadas.tendenciaUnidades[idx].unidades];
        }) },

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
      { nombre: 'Centros-productos', titulo: 'Medicamentos entregados a centros', anchos: [38, 16, 14],
        encabezados: ['Medicamento', 'Unidades', 'Renglones'],
        filas: inf.centros.topMedicamentos.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Centros-tendencia', titulo: 'Entregas a centros, ' + rotVista(inf.vista), anchos: [22, 14, 16],
        encabezados: ['Período', 'Entregas', 'Unidades'], filas: inf.centros.tendencia.map(function (r, idx) {
          return [r.etiqueta, r.cantidad, inf.centros.tendenciaUnidades[idx].unidades];
        }) },

      { nombre: 'Insumos', titulo: 'Insumos entregados: cantidades reales', anchos: [38, 18],
        encabezados: ['Indicador', 'Cantidad'], filas: [
          ['Entregas registradas', inf.insumos.entregas],
          ['Unidades con cantidad por insumo', inf.insumos.unidadesTotal],
          ['Unidades hoy', inf.insumos.unidadesHoy], ['Unidades esta semana', inf.insumos.unidadesSemana],
          ['Unidades este mes', inf.insumos.unidadesMes], ['Renglones sin cantidad', inf.insumos.sinCantidad],
          ['Totales del Excel sin desglose (separados)', inf.insumos.totalExcel]
        ] },
      { nombre: 'Insumos-productos', titulo: 'Productos más entregados por cantidad', anchos: [40, 16, 14],
        encabezados: ['Producto', 'Unidades', 'Renglones'],
        filas: inf.insumos.topProductos.map(function (r) { return [r.etiqueta, r.unidades, r.veces]; }) },
      { nombre: 'Insumos-tendencia', titulo: 'Unidades de insumos, ' + rotVista(inf.vista), anchos: [24, 16],
        encabezados: ['Período', 'Unidades'],
        filas: inf.insumos.tendencia.map(function (r) { return [r.etiqueta, r.unidades]; }) },

      { nombre: 'Récipes', titulo: 'Récipes (lo que se pidió, no lo ya entregado)', anchos: [34, 16],
        encabezados: ['Indicador', 'Cantidad'],
        filas: [
          ['Récipes registrados en total', inf.recipes.total], ['Récipes hoy', inf.recipes.hoy],
          ['Récipes esta semana', inf.recipes.semana], ['Récipes este mes', inf.recipes.mes],
          ['Pacientes atendidos por récipe', inf.recipes.pacientes],
          ['Insumos distintos pedidos', inf.recipes.insumosDistintos],
          ['Renglones pedidos en total', inf.recipes.renglonesTotal]
        ] },
      { nombre: 'Récipes-insumos', titulo: 'Los insumos más pedidos por récipe', anchos: [40, 16],
        encabezados: ['Insumo', 'Veces pedido'],
        filas: inf.recipes.topInsumos.map(function (x) { return [x.etiqueta, x.cantidad]; }) },
      { nombre: 'Récipes-tendencia', titulo: 'Récipes, ' + rotVista(inf.vista), anchos: [22, 14],
        encabezados: ['Período', 'Récipes'], filas: inf.recipes.tendencia.map(function (r) { return [r.etiqueta, r.cantidad]; }) },

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
        { k: 'Unidades en jornadas', v: unNum(inf.jornadas.unidadesTotal) },
        { k: 'Centros activos', v: num(inf.centros.activos) },
        { k: 'Unidades de insumos', v: unNum(inf.insumos.unidadesTotal) },
        { k: 'Récipes registrados', v: num(inf.recipes.total) },
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
        { titulo: 'Jornadas — medicamentos por cantidad real',
          nota: inf.jornadas.sinCantidad ? num(inf.jornadas.sinCantidad) + ' nombres sin cantidad quedaron fuera de la suma.' : '',
          encabezados: ['Medicamento', 'Unidades', 'Renglones'],
          filas: inf.jornadas.topMedicamentos.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },

        { titulo: 'Centros — los diez que más han recibido', encabezados: ['Centro', 'Unidades', 'Entregas'],
          filas: inf.centros.ranking.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },
        { titulo: 'Centros — entregas ' + rotVista(inf.vista), encabezados: ['Período', 'Entregas', 'Unidades'],
          filas: inf.centros.tendencia.map(function (r, idx) {
            return [r.etiqueta, num(r.cantidad), unNum(inf.centros.tendenciaUnidades[idx].unidades)];
          }) },

        { titulo: 'Insumos — productos por cantidad real',
          nota: inf.insumos.sinCantidad ? num(inf.insumos.sinCantidad) + ' renglones sin cantidad no entran en la suma.' : '',
          encabezados: ['Producto', 'Unidades', 'Renglones'],
          filas: inf.insumos.topProductos.map(function (r) { return [r.etiqueta, unNum(r.unidades), num(r.veces)]; }) },
        { titulo: 'Insumos — ' + rotVista(inf.vista), encabezados: ['Período', 'Unidades'],
          filas: inf.insumos.tendencia.map(function (r) { return [r.etiqueta, unNum(r.unidades)]; }) },

        { titulo: 'Récipes — los insumos más pedidos', encabezados: ['Insumo', 'Veces pedido'],
          filas: inf.recipes.topInsumos.map(function (x) { return [x.etiqueta, num(x.cantidad)]; }) },
        { titulo: 'Récipes — ' + rotVista(inf.vista),
          nota: 'Lo que se pidió por récipe, no lo ya entregado (eso sale en "Lo entregado", más abajo).',
          encabezados: ['Período', 'Récipes'],
          filas: inf.recipes.tendencia.map(function (r) { return [r.etiqueta, num(r.cantidad)]; }) },

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
    if (window.DASHBOARD_ACTIVO && window.DASHBOARD_ACTIVO.detenerTiempoReal) {
      window.DASHBOARD_ACTIVO.detenerTiempoReal();
    }
    var t = new Dashboard(cliente, contenedor, o.prefijo || 'da');
    window.DASHBOARD_ACTIVO = t;
    t.pintar();
    return t;
  };

  // Se expone para las pruebas unitarias: es lógica pura, sin DOM.
  window.DASHBOARD_CALCULAR = calcularInforme;
})();
