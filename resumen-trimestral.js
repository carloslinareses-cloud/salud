/* Resumen clínico-administrativo de entregas. Solo lectura y datos agregados.
   Una persona pertenece a un único grupo: edad en su primera entrega del trimestre.
   No infiere diagnósticos ni cantidades de los registros históricos en texto libre. */
(function () {
  'use strict';
  var GRUPOS = { menores: 'Menores de edad (0 a 17 años)', adultos: 'Adultos (18 años en adelante)', sinEdad: 'Personas sin edad verificable' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var numero = function (n) { return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 }); };
  function clave(s) { return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase(); }
  function fechaValida(s) {
    var f = String(s || '').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
    var d = new Date(f + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === f ? f : null;
  }
  function edadFecha(nacimiento, referencia) {
    var n = fechaValida(nacimiento), r = fechaValida(referencia);
    if (!n || !r || n > r) return null;
    var edad = Number(r.slice(0,4)) - Number(n.slice(0,4));
    if (r.slice(5) < n.slice(5)) edad--;
    return edad <= 120 ? edad : null;
  }
  function edadRegistrada(texto) {
    var t = String(texto || '').trim().toLowerCase();
    var m = /^(\d{1,3})(?:\s*(?:a[ñn]os?|years?)(?:\b|\s|$))/.exec(t) || /^(\d{1,3})$/.exec(t);
    if (m) return Number(m[1]) <= 120 ? Number(m[1]) : null;
    m = /^(\d{1,3})\s*mes(?:es)?\b/.exec(t);
    if (m) return Number(m[1]) < 24 ? Math.floor(Number(m[1])/12) : null;
    m = /^(\d{1,3})\s*d[ií]as?\b/.exec(t);
    return m && Number(m[1]) < 366 ? 0 : null;
  }
  function periodo(anio, trimestre) {
    anio = Number(anio); trimestre = Number(trimestre);
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2100 || !Number.isInteger(trimestre) || trimestre < 1 || trimestre > 4) throw Error('Selecciona un año y un trimestre válidos.');
    var mes = (trimestre-1)*3;
    return { anio:anio, trimestre:trimestre, desde:new Date(Date.UTC(anio,mes,1)).toISOString().slice(0,10), hasta:new Date(Date.UTC(anio,mes+3,0)).toISOString().slice(0,10) };
  }
  function grupoVacio(nombre) { return { nombre:nombre, personas:new Set(), entregas:new Set(), patologias:new Map(), productos:new Map(), historicos:new Map(), sinPatologia:new Set(), sinFechaNacimiento:new Set(), sinCantidad:0 }; }
  function productoEn(g,x) {
    var cantidad = x.cantidad == null || x.cantidad === '' ? null : Number(x.cantidad);
    if (!Number.isFinite(cantidad) || cantidad < 0) cantidad = null;
    if (cantidad == null) g.sinCantidad++;
    if (!x.producto || !String(x.producto).trim()) {
      var texto = String(x.lo_entregado || 'Sin detalle de productos registrado').trim();
      var k = clave(texto), h = g.historicos.get(k);
      if (!h) { h = { texto:texto, personas:new Set(), entregas:new Set() }; g.historicos.set(k,h); }
      if (x.paciente_id) h.personas.add(String(x.paciente_id));
      h.entregas.add(String(x.entrega_id)); return;
    }
    // La dosis, presentación y unidad forman parte de la identidad del producto.
    var k = JSON.stringify([clave(x.producto),clave(x.dosificacion),clave(x.presentacion),clave(x.unidad)]);
    var m = g.productos.get(k);
    if (!m) { m = { producto:String(x.producto).trim(), dosificacion:x.dosificacion || 'No registrada', presentacion:x.presentacion || 'No registrada', unidad:x.unidad || 'No registrada', cantidad:0, conCantidad:0, sinCantidad:0, personas:new Set(), entregas:new Set() }; g.productos.set(k,m); }
    if (cantidad == null) m.sinCantidad++; else { m.cantidad += cantidad; m.conCantidad++; }
    if (x.paciente_id) m.personas.add(String(x.paciente_id));
    m.entregas.add(String(x.entrega_id));
  }
  function calcular(filas, pacientes, patologias, p) {
    var grupos = { menores:grupoVacio(GRUPOS.menores), adultos:grupoVacio(GRUPOS.adultos), sinEdad:grupoVacio(GRUPOS.sinEdad) };
    var institucional = grupoVacio('Entregas a instituciones y registros sin paciente identificado');
    var todas = new Set(), anuladas = new Set(), centros = new Set(), primeras = new Map(), pats = new Map();
    var personas = new Map((pacientes || []).map(function (x) { return [String(x.id),x]; }));
    var vigentes = (filas || []).filter(function (x) {
      var f = fechaValida(x.fecha); if (!f || f < p.desde || f > p.hasta) return false;
      if (x.anulada) { anuladas.add(String(x.entrega_id)); return false; }
      return true;
    });
    vigentes.forEach(function (x) {
      todas.add(String(x.entrega_id));
      if (x.institucion_id) { centros.add(String(x.institucion_id)); return; }
      if (!x.paciente_id) return;
      var id = String(x.paciente_id), fecha = fechaValida(x.fecha);
      if (!primeras.has(id) || fecha < primeras.get(id)) primeras.set(id,fecha);
    });
    (patologias || []).forEach(function (x) {
      if (!x.activo || !x.paciente_id || !clave(x.patologia)) return;
      var id = String(x.paciente_id), mapa = pats.get(id) || new Map();
      mapa.set(clave(x.patologia),String(x.patologia).trim().replace(/\s+/g,' ').toUpperCase()); pats.set(id,mapa);
    });
    var porPersona = new Map();
    primeras.forEach(function (fecha,id) {
      var paciente = personas.get(id) || {};
      var e = paciente.fecha_nac ? edadFecha(paciente.fecha_nac,fecha) : edadRegistrada(paciente.edad_texto);
      var g = e == null ? grupos.sinEdad : e < 18 ? grupos.menores : grupos.adultos;
      porPersona.set(id,g); g.personas.add(id);
      if (!paciente.fecha_nac && e != null) g.sinFechaNacimiento.add(id);
      var ps = pats.get(id);
      if (!ps || !ps.size) g.sinPatologia.add(id);
      else ps.forEach(function (nombre,k) { var a = g.patologias.get(k) || {patologia:nombre,personas:new Set()}; a.personas.add(id); g.patologias.set(k,a); });
    });
    vigentes.forEach(function (x) {
      var g = !x.institucion_id && x.paciente_id ? porPersona.get(String(x.paciente_id)) : institucional;
      g.entregas.add(String(x.entrega_id)); productoEn(g,x);
    });
    var ordenar = function (mapa,campo) { return Array.from(mapa.values()).sort(function (a,b) { return a[campo].localeCompare(b[campo],'es'); }); };
    function finalizar(g) {
      var sinDesglose=new Set();g.historicos.forEach(function (h) {h.entregas.forEach(function (id) {sinDesglose.add(id);});});
      return { nombre:g.nombre, personas:g.personas.size, entregas:g.entregas.size, sinPatologia:g.sinPatologia.size, edadSoloTexto:g.sinFechaNacimiento.size, sinCantidad:g.sinCantidad,
        sinDesgloseEntregas:sinDesglose.size,
        patologias:ordenar(g.patologias,'patologia').map(function (x) { return {patologia:x.patologia,personas:x.personas.size}; }),
        productos:ordenar(g.productos,'producto').map(function (x) { return Object.assign({},x,{personas:x.personas.size,entregas:x.entregas.size}); }),
        historicos:ordenar(g.historicos,'texto').map(function (x) { return {texto:x.texto,personas:x.personas.size,entregas:x.entregas.size}; }) };
    }
    return { periodo:p, personas:primeras.size, entregas:todas.size, anuladas:anuladas.size, centros:centros.size, grupos:Object.keys(grupos).map(function (k) { return finalizar(grupos[k]); }), institucional:finalizar(institucional) };
  }
  var CRITERIOS = [
    'Personas atendidas: personas distintas con al menos una entrega vigente en el trimestre; no equivale al número de consultas médicas.',
    'Cada persona pertenece a un solo grupo, según la edad en su primera entrega del trimestre. Se calcula con la fecha de nacimiento; si falta, se usa la edad escrita en su ficha, identificada como edad registrada sin fecha de nacimiento. No se estima una edad histórica a partir de ese texto.',
    'Patologías: condiciones activas registradas en la ficha al generar el informe. No demuestra que se diagnosticaran o trataran en esa entrega. Una persona puede figurar en varias patologías: no sumar esas filas como personas únicas.',
    'Cantidades: se suman por producto, dosis, presentación y unidad. Los renglones sin cantidad no aportan unidades; no se suman tabletas, frascos y otras unidades entre sí.',
    'Los históricos sin productos desglosados conservan su texto original en un apartado propio. No se adivinan medicamentos ni cantidades. Las entregas institucionales no se convierten en personas atendidas.',
    'Se incluyen todas las entregas vigentes del trimestre seleccionado, sin aplicar la búsqueda del tablero. Las anuladas quedan excluidas.'
  ];
  function tablas(r, incluirHistoricos) {
    var grupos = r.grupos.filter(function (g,i) {return i<2 || g.personas>0;});
    var bloques = [{ titulo:'1. Personas atendidas', nota:'Personas distintas con entregas. Edad en la primera entrega del trimestre.',
      encabezados:['Grupo de edad','Personas distintas'], filas:grupos.map(function (g) {return [g.nombre,g.personas];}).concat([['TOTAL',r.personas]]),
      anchos:[70,24], columnas:{0:{cellWidth:150},1:{cellWidth:37}} }];
    grupos.forEach(function (g,i) {
      var filas=g.patologias.map(function (x) {return [x.patologia,x.personas];});
      if(g.sinPatologia)filas.push(['Sin patología registrada',g.sinPatologia]);
      if(!filas.length)filas.push(['No hubo personas atendidas',0]);
      bloques.push({titulo:'2.'+(i+1)+' Patologías - '+g.nombre,nota:'Patologías de la ficha. Una persona puede figurar en varias; no sumar como personas únicas.',encabezados:['Patología registrada','Personas distintas'],filas:filas,anchos:[64,24],columnas:{0:{cellWidth:150},1:{cellWidth:37}}});
    });
    grupos.forEach(function (g,i) {
      bloques.push({titulo:'3.'+(i+1)+' Medicamentos e insumos - '+g.nombre,
        encabezados:['Medicamento, dosis y presentación','Cantidad registrada','Unidad','Personas distintas','Renglones sin cantidad'],
        filas:g.productos.length ? g.productos.map(function (x) {return [x.producto+'\n'+x.dosificacion+' · '+x.presentacion,x.conCantidad ? x.cantidad : 'No registrada',x.unidad,x.personas,x.sinCantidad];}) : [['Sin productos desglosados','No registrada','',0,0]],
        anchos:[64,24,20,24,25],columnas:{0:{cellWidth:81},1:{cellWidth:25},2:{cellWidth:25},3:{cellWidth:24},4:{cellWidth:32}}});
    });
    if(r.institucional.productos.length)bloques.push({titulo:'4. Productos entregados a instituciones o sin paciente identificado',
      encabezados:['Producto, dosis y presentación','Cantidad registrada','Unidad','Entregas registradas'],
      filas:r.institucional.productos.map(function (x) {return [x.producto+'\n'+x.dosificacion+' · '+x.presentacion,x.conCantidad ? x.cantidad : 'No registrada',x.unidad,x.entregas];}),
      anchos:[70,24,24,24],columnas:{0:{cellWidth:99},1:{cellWidth:29},2:{cellWidth:29},3:{cellWidth:30}}});
    var faltantes=[];
    r.grupos.forEach(function (g) {
      if(g.edadSoloTexto)faltantes.push(['Edad escrita sin fecha de nacimiento - '+g.nombre,g.edadSoloTexto+' personas']);
      if(g.historicos.length)faltantes.push(['Históricos sin medicamentos desglosados - '+g.nombre,g.sinDesgloseEntregas+' entregas']);
    });
    if(r.grupos[2].personas)faltantes.push(['Personas sin edad verificable',r.grupos[2].personas]);
    if(r.institucional.entregas)faltantes.push(['Entregas institucionales o sin paciente identificado (no son personas atendidas)',r.institucional.entregas]);
    if(r.institucional.historicos.length)faltantes.push(['Históricos institucionales sin desglose',r.institucional.sinDesgloseEntregas]);
    if(r.anuladas)faltantes.push(['Entregas anuladas excluidas',r.anuladas]);
    if(faltantes.length)bloques.push({titulo:'Datos incompletos y registros separados',encabezados:['Dato','Conteo'],filas:faltantes,anchos:[100,25],columnas:{0:{cellWidth:150},1:{cellWidth:37}}});
    bloques.push({titulo:'Nota de lectura',encabezados:['Criterio'],filas:[['No se infieren diagnósticos ni cantidades. Las patologías son las registradas en la ficha al generar el informe. La edad escrita sin fecha de nacimiento no demuestra la edad histórica. Los medicamentos conservan dosis, presentación y unidad; no se suman unidades distintas.']],anchos:[130],columnas:{0:{cellWidth:187}}});
    if(incluirHistoricos)r.grupos.concat([r.institucional]).forEach(function (g) {
      if(g.historicos.length)bloques.push({titulo:'Anexo sin desglose - '+g.nombre,encabezados:['Texto original de lo entregado','Entregas registradas','Personas distintas'],filas:g.historicos.map(function (x) {return [x.texto,x.entregas,x.personas];}),anchos:[90,24,24],columnas:{0:{cellWidth:127},1:{cellWidth:30},2:{cellWidth:30}}});
    });
    return bloques;
  }
  function fechaTexto(f) { return f.slice(8,10)+'/'+f.slice(5,7)+'/'+f.slice(0,4); }
  function montar(sb,raiz) {
    var hoy = window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0,10);
    var anio=Number(hoy.slice(0,4)), trimestre=Math.floor((Number(hoy.slice(5,7))-1)/3)+1, informe=null, version=0;
    raiz.innerHTML='<details class="resumen-trimestral"><summary><b>Resumen trimestral por edades</b></summary><p class="sub">Personas atendidas, patologías registradas y medicamentos entregados: menores de 0 a 17 años y adultos de 18 años en adelante.</p>'+
      '<div class="rango-fechas"><label>Año<input data-rt="anio" type="number" min="1900" max="2100" value="'+anio+'"></label><label>Trimestre<select data-rt="trimestre">'+[1,2,3,4].map(function (n) {return '<option value="'+n+'"'+(n===trimestre?' selected':'')+'>'+n+' · '+['enero a marzo','abril a junio','julio a septiembre','octubre a diciembre'][n-1]+'</option>';}).join('')+'</select></label><button type="button" data-rt="generar">Generar resumen trimestral</button></div>'+
      '<p class="sub chico">Incluye el trimestre completo. Edad en la primera entrega del período.</p><label class="rt-anexos"><input data-rt="anexos" type="checkbox"> Incluir anexo de históricos sin medicamentos desglosados</label><div data-rt="resultado" aria-live="polite"></div></details>';
    var q=function (n) {return raiz.querySelector('[data-rt="'+n+'"]');};
    async function cargarTodo(tabla,campos,p) {
      var filas=[];
      for (var n=0;;n+=1000) {
        var consulta=sb.from(tabla).select(campos);
        if(p)consulta=consulta.gte('fecha',p.desde).lte('fecha',p.hasta).order('fecha').order('entrega_id').order('renglon_id',{nullsFirst:false});
        else consulta=consulta.order('id');
        var r=await consulta.range(n,n+999);if(r.error)throw Error(r.error.message || 'No se pudieron leer los registros.');
        filas=filas.concat(r.data || []);if(!r.data || r.data.length<1000)return filas;
      }
    }
    function invalidar() {version++;informe=null;q('resultado').innerHTML='<p class="sub">Genera el resumen del período seleccionado.</p>';}
    q('anio').addEventListener('change',invalidar);q('trimestre').addEventListener('change',invalidar);
    q('anexos').addEventListener('change',function () {if(informe)presentar();});
    q('generar').addEventListener('click',async function () {
      var v=++version; informe=null;
      try {
        var p=periodo(q('anio').value,q('trimestre').value);
        q('generar').disabled=true;q('resultado').innerHTML='<div class="cargando">Preparando el resumen completo del trimestre…</div>';
        var datos=await Promise.all([cargarTodo('v_entregas_renglon','entrega_id,fecha,anulada,paciente_id,institucion_id,producto_id,producto,dosificacion,presentacion,unidad,cantidad,lo_entregado,renglon_id',p),cargarTodo('pacientes','id,fecha_nac,edad_texto'),cargarTodo('patologias_paciente','paciente_id,patologia,activo')]);
        if(v!==version)return;
        informe=calcular(datos[0],datos[1],datos[2],p);
        presentar();
      } catch(e) {if(v===version)q('resultado').innerHTML='<div class="aviso bad">No se pudo generar el resumen completo: '+esc(e.message)+'. Puedes volver a intentarlo.</div>';}
      finally {q('generar').disabled=false;}
    });
    function presentar() {
        var p=informe.periodo, b=tablas(informe,q('anexos').checked);
        q('resultado').innerHTML='<h3>Resumen clínico-administrativo · '+p.trimestre+'º trimestre de '+p.anio+'</h3><p>'+fechaTexto(p.desde)+' a '+fechaTexto(p.hasta)+(p.hasta>=hoy ? ' · Corte parcial: registros disponibles al '+fechaTexto(hoy) : '')+'</p>'+
          '<div class="descargas"><button type="button" data-rt="pdf">Descargar resumen trimestral en PDF</button><button type="button" data-rt="excel">Descargar resumen trimestral en Excel</button></div>'+
          b.map(function (x) {return '<section><h3 class="sub-t">'+esc(x.titulo)+'</h3><div class="tabla-caja"><table class="tabla datos tabla-entregas"><thead><tr>'+x.encabezados.map(function (e) {return '<th>'+esc(e)+'</th>';}).join('')+'</tr></thead><tbody>'+x.filas.map(function (fila) {return '<tr>'+fila.map(function (c,i) {return '<td data-col="'+esc(x.encabezados[i])+'">'+esc(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div></section>';}).join('');
        q('pdf').addEventListener('click',function () {descargar('pdf');});q('excel').addEventListener('click',function () {descargar('excel');});
    }
    function descargar(tipo) {
      if(!informe || !window.FARMREP)return;
      var p=informe.periodo, archivo='Resumen trimestral Salud '+p.anio+' T'+p.trimestre;
      var sub=fechaTexto(p.desde)+' a '+fechaTexto(p.hasta)+' · Generado el '+fechaTexto(hoy)+(p.hasta>=hoy?' · Corte parcial':'');
      var bloques=tablas(informe,q('anexos').checked);
      if(tipo==='excel')window.FARMREP.excel(archivo,bloques.map(function (b,i) {
        var grupo=b.titulo.includes('Menores')?'menores':b.titulo.includes('Adultos')?'adultos':b.titulo.includes('instituciones')?'institucionales':'sin edad';
        var nombre=i===0?'Personas atendidas':b.titulo.includes('Patologías')?'Patologías '+grupo:b.titulo.includes('Medicamentos')?'Medicamentos '+grupo:b.titulo.includes('Anexo')?'Históricos '+grupo:b.titulo.startsWith('4.')?'Entregas institucionales':b.titulo.startsWith('Datos')?'Datos incompletos':'Criterios';
        return {nombre:nombre,titulo:b.titulo+' · '+sub,encabezados:b.encabezados,filas:b.filas,anchos:b.anchos};
      }));
      else window.FARMREP.pdfInforme({titulo:'Resumen trimestral de Salud',subtitulo:sub,resumen:[{k:'Personas atendidas',v:numero(informe.personas)},{k:'Entregas registradas',v:numero(informe.entregas)}],bloques:bloques,horizontal:false,repetirEncabezado:true,archivo:archivo});
    }
  }
  window.FARMRESUMEN_TRIMESTRAL={montar:montar,calcular:calcular,periodo:periodo,tablas:tablas,edadFecha:edadFecha,edadRegistrada:edadRegistrada};
})();
