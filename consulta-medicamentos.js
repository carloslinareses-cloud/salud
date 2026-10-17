/* Consulta compartida por Inventario y Administración. Solo lectura.
   La guía de opciones y las existencias son independientes: un agotado no desaparece. */
(function () {
  'use strict';
  var guia = window.GUIA_CONSULTA_MEDICAMENTOS;
  function normalizar(t) { return String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function identidad(texto) {
    var t=normalizar(texto);
    if (/\+|\b(?:PLUS|FORTE|COMPUEST|CAFEINA|VITAMINA|CON|Y)\b/.test(t)) return null;
    return guia.identidades.find(function(f){return f.nombres.some(function(n){return t===n||t.indexOf(n+' ')===0&&/^\d/.test(t.slice(n.length).trim());});})||null;
  }
  function disponibilidad(p) {
    if(p.referencia)return 'No registrado en inventario';
    if(p.inconsistente||(!p.vigente&&p.sinFecha>0))return 'Existencia por confirmar';
    return p.vigente>0?'Disponible':'Sin existencia utilizable';
  }
  function numero(n) { return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 }); }
  function hoy() { return window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Intl.DateTimeFormat('en-CA', {timeZone:'America/Caracas', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  function esInsumo(p) {
    return /^(ADESIV|ADHESIV|AEROZOL MASK|ALGODON|BANDE ADHES|BIODEGRADABLE|BOLSAS? RECOL|CEPILLO|COMPRESA|CONJUNTO MONO|ENVASE DE ORINA|EQUIPO PERICRANEAL|ESPONJ|GASAS?\b|GEL DE ULTR|GUANTES?\b|JABON\b|JELCO\b|JERINGA|KIT DE PACIENTE|LLAVE 3 VIAS|MACROGOTERO|MASCARILLA|MICROGOTERO|OBSTURADOR|OBTURADOR|RECOLECTOR DE ORINA|SONDA|SUTURA|TUBO TAPA|VENDA|WHATA|YESO)/.test(normalizar(p.nombre));
  }
  function fuerzas(texto) {
    var m, valores = [], re = /(\d+(?:[.,]\d+)?)\s*(MCG|UG|MG|G|UI|%)(?![A-Z])/g;
    texto = normalizar(texto);
    while ((m = re.exec(texto))) {
      var valor = Number(m[1].replace(',', '.')), unidad = m[2];
      if (unidad === 'G') { valor *= 1000; unidad = 'MG'; }
      if (unidad === 'UG') unidad = 'MCG';
      var clave = valor + ' ' + unidad;
      if (valores.indexOf(clave) < 0) valores.push(clave);
    }
    return valores;
  }
  function perfil(p) {
    var nombre = normalizar(p.nombre), todo = normalizar([p.nombre,p.dosificacion,p.presentacion].join(' '));
    var familia=identidad(nombre);
    if(familia){var alias=familia.nombres.slice().sort(function(a,b){return b.length-a.length;}).find(function(n){return nombre===n||nombre.indexOf(n+' ')===0;});nombre=familia.principio+nombre.slice(alias.length);}
    var r = { principio: '', forma: '', fuerza: '', completo: false, motivo: '' };
    if (esInsumo(p)) { r.motivo = 'Es un insumo; no se ofrecen sustitutos farmacológicos.'; return r; }
    if (/TOR[CS]ILAX/.test(nombre)) { r.motivo = 'Marca o combinación: confirmar el envase. Torsilax contiene varios principios, incluido diclofenaco; no se trata como equivalente simple.'; return r; }
    if (/\+|\bCON\b|LIBERACION|RETARD|PROLONGAD|GASTRORRESIST|ENTERIC|\b(?:XR|SR|LP|CR|MR|IV|IM)\b/.test(todo)) {
      r.motivo = 'Combinación, vía especial o liberación modificada: requiere revisión del envase.'; return r;
    }
    if (/^(?:PARACETAMOL|ACETAMINOFEN)\b/.test(nombre)) r.principio = 'PARACETAMOL';
    else if (/^DICLOFENACO?\b/.test(nombre)) {
      if (/POTASICO/.test(nombre)) r.principio = 'DICLOFENAC POTASICO';
      else if (/SODICO/.test(nombre)) r.principio = 'DICLOFENAC SODICO';
      else { r.motivo = 'Falta confirmar la sal del diclofenaco.'; return r; }
    } else {
      r.principio = guia.principios.slice().sort(function(a,b){return b.length-a.length;}).find(function(n){ return nombre === n || nombre.indexOf(n+' ') === 0; }) || '';
    }
    if (!r.principio) { r.motivo = 'Principio activo o fórmula pendiente de verificar; no se adivina a partir de la marca.'; return r; }
    if(r.principio==='ACIDO ACETILSALICILICO'){
      r.motivo='Ácido acetilsalicílico: confirmar la concentración y el tipo de tableta (simple, masticable o entérica). Compartir principio activo no confirma que sean intercambiables.';
      return r;
    }
    // No equiparar dos fórmulas que solo comparten el primer principio.
    var sinPrincipio = /^(?:PARACETAMOL|ACETAMINOFEN|DICLOFENACO?)\b/.test(nombre)
      ? nombre.replace(/^(?:PARACETAMOL|ACETAMINOFEN|DICLOFENACO?\s+(?:POTASICO|SODICO))\b/, '')
      : nombre.slice(r.principio.length);
    if (guia.principios.some(function(n){ return new RegExp('\\b'+n+'\\b').test(sinPrincipio); })) {
      r.motivo = 'Posible combinación de principios: confirmar la fórmula.'; return r;
    }
    var resto=sinPrincipio.replace(/\d+(?:[.,]\d+)?/g,'').replace(/\b(?:MCG|UG|MG|G|GR|ML|UI|X|TABLETAS?|COMPRIMIDOS?|CAPSULAS?)\b/g,'').replace(/[\s/%.,()\-]/g,'');
    if(resto){r.motivo='El nombre contiene componentes o términos no verificados; confirmar la fórmula del envase.';return r;}
    var forma = normalizar(p.presentacion);
    if (/^TABLETAS?\b|^COMPRIMIDOS?\b/.test(forma)) r.forma = 'TABLETA';
    else if (/^CAPSULAS?\b/.test(forma)) r.forma = 'CAPSULA';
    else if (/^CREMA\b/.test(forma)) r.forma = 'CREMA';
    else if (/^JARABE\b/.test(forma)) r.forma = 'JARABE';
    else if (/^SUSPENSION\b/.test(forma)) r.forma = 'SUSPENSION';
    else { r.motivo = 'Vía o presentación pendiente de verificar; no se comparan inyectables ni gotas sin vía confirmada.'; return r; }
    if (r.forma === 'CREMA') {
      var porcentajes=fuerzas(todo);
      if(porcentajes.length===1&&porcentajes[0].endsWith(' %')){r.fuerza=porcentajes[0];r.completo=true;return r;}
      r.motivo='La crema necesita un porcentaje explícito y sin contradicciones.';return r;
    }
    if(r.forma==='JARABE'||r.forma==='SUSPENSION') {
      var concentraciones=[], m, re=/(\d+(?:[.,]\d+)?)\s*(MG|G)\s*\/\s*(\d+(?:[.,]\d+)?)?\s*ML\b/g;
      while((m=re.exec(todo))){var volumen=Number((m[3]||'1').replace(',','.'));if(volumen<=0)continue;var valor=Number(m[1].replace(',','.'))*(m[2]==='G'?1000:1)/volumen;var clave=Number(valor.toPrecision(10))+' MG/ML';if(!concentraciones.includes(clave))concentraciones.push(clave);}
      var expresado=fuerzas(todo);
      if(concentraciones.length===1&&expresado.length===1&&!/AMPOLLA|INYECT|\bIV\b|\bIM\b/.test(todo)){r.fuerza=concentraciones[0];r.completo=true;return r;}
      r.motivo='Falta una concentración completa en mg/ml o hay datos contradictorios; confirmar el envase.';return r;
    }
    if (/\b(?:ML|AMPOLLA|INYECT|INFUS|INFUC|GOTAS|SUSPENSION|JARABE|CREMA)\b|%|\//.test(todo)) {
      r.motivo = 'La concentración o vía no coincide con una presentación oral sólida simple.'; return r;
    }
    var dosis = fuerzas(todo);
    if (dosis.length !== 1) { r.motivo = dosis.length > 1 ? 'Hay concentraciones contradictorias: verificar el envase.' : 'Falta concentración: verificar el envase.'; return r; }
    r.fuerza = dosis[0]; r.completo = true;
    return r;
  }
  function inventariar(productos, lotes, fecha) {
    var porProducto = Object.create(null);
    productos.forEach(function(p){ porProducto[p.id] = Object.assign({},p,{vigente:0,vencido:0,sinFecha:0,retenido:0,total:0,lotes:[],inconsistente:false,insumo:esInsumo(p),perfil:perfil(p)}); });
    lotes.forEach(function(l){
      var p = porProducto[l.producto_id]; if (!p) return;
      var cantidad = Number(l.existencia);
      if (!Number.isFinite(cantidad)) throw Error('Hay una existencia inválida. No se calcularán alternativas.');
      p.total += cantidad; p.lotes.push(l);
      if (cantidad < 0) { p.inconsistente = true; return; }
      if (l.estado !== 'disponible') p.retenido += cantidad;
      else if (!l.vence || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.vence).slice(0,10))) p.sinFecha += cantidad;
      else if (String(l.vence).slice(0,10) < fecha) p.vencido += cantidad;
      else p.vigente += cantidad;
    });
    return productos.map(function(p){ return porProducto[p.id]; });
  }
  function alternativas(p, lista, permitirClinicas, incluirSinExistencia) {
    if (!p.perfil.completo || p.insumo || p.activo === false || p.inconsistente) return [];
    return lista.filter(function(q){return q.id !== p.id && q.activo !== false && (incluirSinExistencia || q.vigente > 0) && !q.inconsistente && q.perfil.completo && !q.insumo;}).map(function(q){
      var a=p.perfil,b=q.perfil;
      if (a.principio === b.principio && a.forma === b.forma && a.fuerza === b.fuerza) return {producto:q,tipo:'misma',texto:'Mismo principio, concentración y forma. Confirmar el envase y la prescripción.'};
      if (!permitirClinicas || a.principio === b.principio || !['TABLETA','CAPSULA'].includes(a.forma) || !['TABLETA','CAPSULA'].includes(b.forma)) return null;
      if (guia.dolor.includes(a.principio) && guia.dolor.includes(b.principio)) return {producto:q,tipo:'clinica',texto:guia.notaDolor};
      if (guia.alergia.includes(a.principio) && guia.alergia.includes(b.principio)) return {producto:q,tipo:'clinica',texto:guia.notaAlergia};
      return null;
    }).filter(Boolean).sort(function(a,b){return (a.tipo==='misma'?0:1)-(b.tipo==='misma'?0:1)||a.producto.nombre.localeCompare(b.producto.nombre,'es');});
  }
  function referenciaDe(p) {
    return guia.referencias.find(function(r){return r.principios.includes(p.perfil.principio);});
  }
  function referenciaVacia(r) {
    return {producto:{id:'referencia:'+r.clave,nombre:r.nombre,presentacion:'Uso oral en adultos',vigente:0,referencia:true},tipo:'clinica',texto:guia.grupos[r.grupo].nota,grupo:r.grupo};
  }
  function porDisponibilidad(a,b) {
    return Number(a.tipo!=='misma')-Number(b.tipo!=='misma')||Number(b.producto.vigente>0)-Number(a.producto.vigente>0)||a.producto.nombre.localeCompare(b.producto.nombre,'es');
  }
  function ordenarOpciones(opciones) {
    var vistos=Object.create(null);
    return opciones.sort(porDisponibilidad).filter(function(a){
      var p=a.producto,f=p.perfil;
      var clave=f&&f.completo?[f.principio,f.forma,f.fuerza].join('|'):normalizar(p.nombre)+'|'+normalizar(p.presentacion);
      if(vistos[clave])return false;vistos[clave]=true;return true;
    });
  }
  function opcionesReferencia(origen,lista) {
    var resultado=[];
    guia.referencias.filter(function(r){return r.grupo===origen.grupo&&r.clave!==origen.clave;}).forEach(function(r){
      var productos=lista.filter(function(p){return p.activo!==false&&!p.insumo&&p.perfil.completo&&!p.inconsistente&&['TABLETA','CAPSULA'].includes(p.perfil.forma)&&r.principios.includes(p.perfil.principio);});
      if(productos.length)productos.forEach(function(p){resultado.push({producto:p,tipo:'clinica',texto:guia.grupos[r.grupo].nota,grupo:r.grupo});});
      else resultado.push(referenciaVacia(r));
    });
    return ordenarOpciones(resultado);
  }
  function opcionesConsulta(p,lista) {
    var resultado=alternativas(p,lista,true,true),origen=referenciaDe(p);
    if(origen&&p.perfil.completo&&!p.inconsistente&&['TABLETA','CAPSULA'].includes(p.perfil.forma)){
      opcionesReferencia(origen,lista).forEach(function(opcion){
        if(!resultado.some(function(a){return a.producto.id===opcion.producto.id;}))resultado.push(opcion);
      });
    }
    return ordenarOpciones(resultado);
  }
  function buscarReferencias(texto) {
    var q=normalizar(texto);
    // La guía general es oral para adultos. No reinterpretar una búsqueda de otra vía.
    if(q.length<2||/\+|AMPOLL|INYECT|JARABE|SUSPENSION|CREMA|GOTAS|\d\s*ML\b|\b(?:IV|IM|INFUSION|INFUCION)\b/.test(q))return [];
    q=q.replace(/\d+(?:[.,]\d+)?\s*(?:MCG|MG|G)\b/g,'').replace(/\b(?:TABLETAS?|CAPSULAS?|COMPRIMIDOS?)\b/g,'').replace(/\s+/g,' ').trim();
    if(q.length<2)return [];
    return guia.referencias.filter(function(r){return [r.nombre].concat(r.aliases).some(function(n){return normalizar(n).includes(q);});});
  }
  function familiaConsulta(texto,lista) {
    if(/\+|AMPOLL|INYECT|JARABE|SUSPENSION|CREMA|GOTAS|\d\s*ML\b|\bML\b|\b(?:IV|IM)\b/.test(normalizar(texto)))return null;
    var f=identidad(texto);if(!f)return null;
    var dosis=fuerzas(texto);
    var registros=lista.filter(function(p){return p.activo!==false&&!p.insumo&&identidad(p.nombre)===f&&(!dosis.length||dosis.every(function(d){return fuerzas([p.nombre,p.dosificacion].join(' ')).includes(d);}));});
    var referencias=f.referencias.filter(function(r){return (!dosis.length||dosis.every(function(d){return fuerzas(r.nombre).includes(d);}))&&!registros.some(function(p){return normalizar(p.nombre)===normalizar(r.nombre);});}).map(function(r){return {nombre:r.nombre,presentacion:r.forma,referencia:true,fuente:r.fuente};});
    return {familia:f,registros:registros.concat(referencias).sort(function(a,b){return Number(b.vigente>0)-Number(a.vigente>0)||a.nombre.localeCompare(b.nombre,'es');})};
  }
  async function leerTodo(sb, tabla, columnas, orden) {
    var filas=[], offset=0, tamano=400, esperado=null;
    while(true){
      var r=await sb.from(tabla).select(columnas,{count:'exact'}).order(orden).range(offset,offset+tamano-1);
      if(r.error) throw Error(r.error.message || 'No se pudo consultar '+tabla);
      if(!Array.isArray(r.data)) throw Error('La base no devolvió la lista completa.');
      if(typeof r.count!=='number') throw Error('No se pudo comprobar la cantidad total de '+tabla+'.');
      if(esperado===null)esperado=r.count;
      if(r.count!==esperado)throw Error('El inventario cambió durante la consulta; vuelve a actualizar.');
      filas=filas.concat(r.data);
      if(filas.length===esperado)return filas;
      if(r.data.length<tamano||filas.length>esperado)throw Error('La consulta de '+tabla+' llegó incompleta.');
      offset+=tamano;
    }
  }
  var montajes = new WeakMap();
  function montar(sb, ancla, opciones) {
    if (montajes.has(ancla)) montajes.get(ancla)();
    if (!['admin','inventario'].includes((window.FARMACIA_PERFIL || {}).rol)) {
      ancla.innerHTML='<div class="aviso bad">Solo Administración e Inventario pueden consultar este módulo.</div>'; return;
    }
    var id=(opciones&&opciones.prefijo)||'consultaMed', lista=[], consulta='', listo=false, ocupado=false, vivo=true;
    ancla.innerHTML='<section class="consulta-med cm-simple" aria-label="Consulta de medicamentos">'+
      '<h2>Consulta de medicamentos</h2><label for="'+id+'-busca">Nombre del medicamento</label>'+
      '<input id="'+id+'-busca" type="search" placeholder="Escribe aquí, por ejemplo: diclofenac" autocomplete="off">'+
      '<div data-cm="lista" role="status" aria-live="polite"><p>Preparando la consulta…</p></div>'+
      '<p class="cm-ayuda">Las opciones deben ser confirmadas por el médico o farmacéutico.</p>'+
      '<details class="cm-fuentes"><summary>Información de la consulta</summary><p>Se muestran opciones documentadas con y sin existencia en Salud. «Disponible» exige un lote vigente; «Sin existencia utilizable» significa que el catálogo no tiene saldo vigente verificado; «No registrado en inventario» identifica referencias externas; «Existencia por confirmar» indica datos insuficientes. No indica si se venden en otra farmacia. «No hay» significa que esta guía no tiene opciones verificadas para esa consulta; no es una lista exhaustiva de tratamientos. Las opciones no son combinaciones ni equivalencias de dosis y requieren valoración profesional.</p><p>'+esc(guia.notaDolor)+'</p><p>'+esc(guia.notaAlergia)+'</p><p>Torsilax contiene varios principios, incluido diclofenaco; no es un reemplazo simple. Las marcas o fórmulas sin confirmar no se adivinan.</p><ul>'+guia.fuentes.map(function(f){return '<li><a href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">'+esc(f.nombre)+'</a></li>';}).join('')+'</ul></details></section>';
    var entrada=ancla.querySelector('#'+id+'-busca'), salida=ancla.querySelector('[data-cm="lista"]');
    function activo(){return vivo&&ancla.isConnected&&ancla.contains(entrada);}
    function clave(t){return normalizar(t).replace(/DICLOFENACO\b/g,'DICLOFENAC').replace(/ACETAMINOFEN/g,'PARACETAMOL');}
    function pintar(){
      if(!activo()||!listo)return;
      var q=clave(consulta);
      if(q.length<2){salida.innerHTML='<p class="cm-vacio">Escribe el nombre para ver las opciones.</p>';return;}
      var familia=familiaConsulta(consulta,lista);
      function fichaCriterio(r){var g=guia.grupos[r.grupo];return '<p class="cm-criterio"><b>'+esc(g.indicacion)+'.</b> '+esc(g.nota)+' <a href="'+esc(g.fuente)+'" target="_blank" rel="noopener noreferrer">Fuente</a></p>';}
      function etiqueta(p){return '<span class="cm-disponibilidad '+(p.vigente>0?'cm-disponible':'cm-sin-existencia')+'">'+esc(disponibilidad(p))+'</span>';}
      var encontrados=lista.filter(function(p){
        return !p.insumo&&p.activo!==false&&q.split(' ').every(function(t){return clave([p.nombre,p.dosificacion,p.presentacion,p.perfil.principio].join(' ')).includes(t);});
      }).sort(function(a,b){return Number(b.perfil.completo&&!b.inconsistente)-Number(a.perfil.completo&&!a.inconsistente);});
      var referencias=buscarReferencias(consulta).filter(function(r){return !encontrados.some(function(p){return r.principios.includes(p.perfil.principio)&&p.perfil.completo&&['TABLETA','CAPSULA'].includes(p.perfil.forma);});});
      if(!encontrados.length&&!referencias.length&&!familia){salida.innerHTML='<p class="cm-vacio">Nombre o fórmula no evaluados en esta guía; confirmar el principio activo del envase.</p>';return;}
      function mostrarOpciones(opciones){
        return opciones.length?['misma','clinica'].map(function(tipo){var filas=opciones.filter(function(a){return a.tipo===tipo;});return filas.length?'<p><b>'+(tipo==='misma'?'Coinciden principio, concentración y forma':'Otras opciones para valorar según la indicación')+'</b></p><ul class="cm-opciones">'+filas.map(function(a){return '<li><strong>'+esc(a.producto.nombre)+'</strong><span>'+esc(a.producto.presentacion||'')+(tipo==='clinica'?' · Otro principio; no es sustitución directa':' · Confirmar envase y prescripción')+'</span>'+etiqueta(a.producto)+'</li>';}).join('')+'</ul>':'';}).join(''):'<p class="cm-sin-opciones">No hay una alternativa verificada en esta guía para esta presentación.</p>';
      }
      if(familia){
        var f=familia.familia,ref=guia.referencias.find(function(r){return r.principios.includes(f.principio);});
        salida.innerHTML='<section class="cm-resultado"><h3>'+esc(f.titulo)+'</h3><p class="cm-criterio">'+esc(f.nota)+' <a href="'+esc(f.fuente)+'" target="_blank" rel="noopener noreferrer">Fuente</a></p><p><b>Otros nombres y presentaciones del mismo principio</b></p>'+
          (familia.registros.length?'<ul class="cm-opciones">'+familia.registros.map(function(p){var dosis=fuerzas([p.nombre,p.dosificacion].join(' '));return '<li><strong>'+esc(p.nombre)+'</strong><span>'+esc(p.presentacion||'Presentación por confirmar')+' · '+(dosis.length===1?esc(dosis[0]):'Concentración por confirmar')+' · Mismo principio; confirmar dosis y recubrimiento</span>'+etiqueta(p)+'</li>';}).join('')+'</ul>':'<p>No hay una presentación registrada que coincida con esa concentración.</p>')+
          (ref?fichaCriterio(ref)+mostrarOpciones(opcionesReferencia(ref,lista)):'<p class="cm-criterio">No hay una sustitución directa por otro principio verificada para esta consulta. Las distintas concentraciones y recubrimientos requieren revisión profesional.</p>')+'</section>';
        return;
      }
      // Una búsqueda general puede encontrar varias vías. Cada presentación
      // mantiene sus propias opciones: nunca se mezclan jarabe, tableta o inyectable.
      salida.innerHTML=encontrados.map(function(p){
        var opciones=opcionesConsulta(p,lista);
        var encabezado='<h3>'+esc(p.nombre)+'</h3><p class="cm-presentacion">'+esc([p.dosificacion,p.presentacion].filter(Boolean).join(' · '))+'</p>';
        if(p.inconsistente||!p.perfil.completo)return '<section class="cm-resultado">'+encabezado+'<p>No se pueden confirmar opciones: '+esc(p.inconsistente?'la existencia tiene inconsistencias.':p.perfil.motivo)+'</p></section>';
        var r=referenciaDe(p);
        return '<section class="cm-resultado">'+encabezado+(r&&['TABLETA','CAPSULA'].includes(p.perfil.forma)?fichaCriterio(r):'')+mostrarOpciones(opciones)+'</section>';
      }).join('')+referencias.map(function(r){return '<section class="cm-resultado"><h3>'+esc(r.nombre)+'</h3><p class="cm-presentacion">Referencia general · Vía oral · Adultos</p>'+fichaCriterio(r)+mostrarOpciones(opcionesReferencia(r,lista))+'</section>';}).join('');
    }
    async function cargar(){
      if(ocupado||!activo())return;
      ocupado=true;listo=false;salida.innerHTML='<p>Consultando disponibilidad…</p>';
      try{
        var datos=await Promise.all([leerTodo(sb,'productos','id,nombre,dosificacion,presentacion,categoria,unidad,activo','id'),leerTodo(sb,'v_existencia_lote','lote_id,producto_id,lote,vence,estado,existencia','lote_id')]);
        if(!activo())return;
        lista=inventariar(datos[0],datos[1],hoy()).sort(function(a,b){return a.nombre.localeCompare(b.nombre,'es');});
        listo=true;pintar();
      }catch(e){if(activo()){lista=[];salida.innerHTML='<p>No se pudo consultar la disponibilidad.</p><button type="button" data-cm="reintentar">Reintentar</button>';}}
      finally{ocupado=false;}
    }
    entrada.addEventListener('input',function(){consulta=entrada.value;pintar();});
    ancla.addEventListener('click',function(e){if(activo()&&e.target.closest('[data-cm="reintentar"]'))cargar();});
    var timer=setInterval(function(){if(!activo()){limpiar();return;}if(!document.hidden&&ancla.getClientRects().length)cargar();},30000);
    function limpiar(){vivo=false;clearInterval(timer);}
    montajes.set(ancla,limpiar);cargar();
  }
  window.CONSULTA_MEDICAMENTOS={normalizar:normalizar,identidad:identidad,disponibilidad:disponibilidad,familiaConsulta:familiaConsulta,perfil:perfil,inventariar:inventariar,alternativas:alternativas,opcionesConsulta:opcionesConsulta,opcionesReferencia:opcionesReferencia,buscarReferencias:buscarReferencias,leerTodo:leerTodo,esInsumo:esInsumo};
  window.PANTALLA_CONSULTA_MEDICAMENTOS=montar;
})();
