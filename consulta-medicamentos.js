/* Consulta compartida por Inventario y Administración. Solo lectura.
   Las propuestas se calculan contra lotes vigentes, nunca contra un catálogo fijo. */
(function () {
  'use strict';
  var guia = window.GUIA_CONSULTA_MEDICAMENTOS;
  function normalizar(t) { return String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
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
    // No equiparar dos fórmulas que solo comparten el primer principio.
    var sinPrincipio = /^(?:PARACETAMOL|ACETAMINOFEN|DICLOFENACO?)\b/.test(nombre)
      ? nombre.replace(/^(?:PARACETAMOL|ACETAMINOFEN|DICLOFENACO?\s+(?:POTASICO|SODICO))\b/, '')
      : nombre.slice(r.principio.length);
    if (guia.principios.some(function(n){ return new RegExp('\\b'+n+'\\b').test(sinPrincipio); })) {
      r.motivo = 'Posible combinación de principios: confirmar la fórmula.'; return r;
    }
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
  function alternativas(p, lista, permitirClinicas) {
    if (!p.perfil.completo || p.insumo || p.activo === false || p.inconsistente) return [];
    return lista.filter(function(q){return q.id !== p.id && q.activo !== false && q.vigente > 0 && !q.inconsistente && q.perfil.completo && !q.insumo;}).map(function(q){
      var a=p.perfil,b=q.perfil;
      if (a.principio === b.principio && a.forma === b.forma && a.fuerza === b.fuerza) return {producto:q,tipo:'misma',texto:'Mismo principio, concentración y forma. Confirmar el envase y la prescripción.'};
      if (!permitirClinicas || a.principio === b.principio || !['TABLETA','CAPSULA'].includes(a.forma) || !['TABLETA','CAPSULA'].includes(b.forma)) return null;
      if (guia.dolor.includes(a.principio) && guia.dolor.includes(b.principio)) return {producto:q,tipo:'clinica',texto:guia.notaDolor};
      if (guia.alergia.includes(a.principio) && guia.alergia.includes(b.principio)) return {producto:q,tipo:'clinica',texto:guia.notaAlergia};
      return null;
    }).filter(Boolean).sort(function(a,b){return (a.tipo==='misma'?0:1)-(b.tipo==='misma'?0:1)||a.producto.nombre.localeCompare(b.producto.nombre,'es');});
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
    if(montajes.has(ancla)) montajes.get(ancla)();
    var perfilUsuario=window.FARMACIA_PERFIL||{};
    if(!['admin','inventario'].includes(perfilUsuario.rol)){ancla.innerHTML='<div class="aviso bad">Solo Administración e Inventario pueden consultar este módulo.</div>';return;}
    var id=(opciones&&opciones.prefijo)||'consultaMed', lista=[], busqueda='', filtro='todos', tipo='medicamentos', pagina=0, elegido=null, ocupado=false, datosListos=false, vivo=true, version=0;
    ancla.innerHTML='<section class="consulta-med" aria-label="Consulta de medicamentos">'+
      '<div class="cm-cabecera"><div><h2>Consulta de medicamentos</h2><p>Inventario y opciones disponibles para valoración profesional · Piloto</p></div><button type="button" class="btn" data-cm="actualizar">Actualizar inventario</button></div>'+
      '<p class="cm-criterio">Una opción para el mismo síntoma no es una sustitución automática. El profesional confirma la indicación, el envase y el tratamiento. No se calculan dosis ni se registran entregas desde esta consulta.</p>'+
      '<div class="cm-filtros"><label for="'+id+'-busca">Buscar medicamento o principio activo<input id="'+id+'-busca" type="search" placeholder="Ej.: diclofenac, ibuprofeno, losartán" autocomplete="off"></label>'+
      '<label for="'+id+'-stock">Existencia<select id="'+id+'-stock"><option value="todos">Todos</option><option value="con">Con existencia vigente</option><option value="sin">Sin existencia vigente</option><option value="revisar">Datos por revisar</option></select></label>'+
      '<label for="'+id+'-tipo">Ver<select id="'+id+'-tipo"><option value="medicamentos">Medicamentos y fórmulas por verificar</option><option value="insumos">Insumos</option><option value="todos">Catálogo completo</option></select></label></div>'+
      '<label class="cm-opcion"><input type="checkbox" data-cm="clinicas" checked> Incluir opciones para dolor/fiebre y alergia en adultos, sujetas a valoración profesional</label>'+
      '<p data-cm="estado" role="status" aria-live="polite">Cargando inventario…</p><div data-cm="detalle"></div><div data-cm="lista"></div><div class="cm-paginacion" data-cm="paginas"></div>'+
      '<details class="cm-fuentes"><summary>Cómo leer «No hay» y fuentes de la consulta</summary><p>«No hay» significa que este piloto no encontró otra opción de referencia con existencia vigente. «Por revisar» significa que faltan datos o hay contradicciones; no demuestra que no exista un tratamiento. No se proponen moléculas distintas para antibióticos, tratamientos crónicos, anticoagulantes ni antiepilépticos. Los lotes sin fecha se muestran, pero no se recomiendan hasta verificar el vencimiento.</p><p>Torsilax contiene diclofenaco, paracetamol, carisoprodol y cafeína: no es un reemplazo simple del diclofenaco. Una marca escrita como «Torcilax» requiere confirmar la fórmula del envase.</p><ul>'+guia.fuentes.map(function(f){return '<li><a href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">'+esc(f.nombre)+'</a></li>';}).join('')+'</ul><p>Criterios revisados el 17/10/2026. Referencias informativas; no certifican intercambiabilidad de productos locales ni constituyen un protocolo de sustitución aprobado por Salud.</p></details></section>';
    function zona(n){return ancla.querySelector('[data-cm="'+n+'"]');}
    function activo(){return vivo&&ancla.isConnected&&!!zona('lista');}
    function opcionesDe(p){return alternativas(p,lista,zona('clinicas').checked);}
    function estadoDe(p){if(p.insumo)return 'Insumo';if(p.activo===false)return 'Inactivo';if(!p.perfil.completo||p.inconsistente)return 'Por revisar';return opcionesDe(p).length?'Ver opciones':'No hay';}
    function resumenStock(p){return '<b>'+numero(p.vigente)+'</b> '+esc(p.unidad||'unidades')+' vigentes'+(p.vencido?'<small>'+numero(p.vencido)+' vencidas</small>':'')+(p.sinFecha?'<small>'+numero(p.sinFecha)+' sin fecha</small>':'')+(p.retenido?'<small>'+numero(p.retenido)+' retenidas / dadas de baja</small>':'')+(p.inconsistente?'<small>Saldo negativo: revisar movimientos</small>':'');}
    function renderizar(){
      if(!activo()||!datosListos)return;
      var q=normalizar(busqueda).replace(/DICLOFENACO\b/g,'DICLOFENAC').replace(/ACETAMINOFEN/g,'PARACETAMOL');
      var filtrada=lista.filter(function(p){
        var texto=normalizar([p.nombre,p.presentacion,p.dosificacion,p.perfil.principio].join(' ')).replace(/DICLOFENACO\b/g,'DICLOFENAC').replace(/ACETAMINOFEN/g,'PARACETAMOL');
        return (!q||q.split(' ').every(function(t){return texto.includes(t);}))&&(tipo==='todos'||(tipo==='insumos'?p.insumo:!p.insumo))&&(filtro==='todos'||(filtro==='con'?p.vigente>0:filtro==='sin'?p.vigente<=0:!p.perfil.completo||p.inconsistente));
      });
      pagina=Math.min(pagina,Math.max(0,Math.ceil(filtrada.length/30)-1));
      var visibles=filtrada.slice(pagina*30,pagina*30+30);
      zona('lista').innerHTML=filtrada.length?'<div class="cm-tabla"><table><thead><tr><th>Medicamento / presentación</th><th>Existencia</th><th>Otras opciones vigentes</th></tr></thead><tbody>'+visibles.map(function(p){return '<tr><td><strong>'+esc(p.nombre)+'</strong><small>'+esc([p.dosificacion,p.presentacion].filter(Boolean).join(' · ')||'Presentación por verificar')+'</small></td><td>'+resumenStock(p)+'</td><td><button type="button" class="btn secundario" data-producto="'+esc(p.id)+'">'+esc(estadoDe(p))+'</button></td></tr>';}).join('')+'</tbody></table></div>':'<p class="aviso">No se encontraron registros con estos filtros.</p>';
      zona('paginas').innerHTML='<span>'+numero(filtrada.length)+' registros · '+numero(lista.length)+' en el catálogo completo</span><button type="button" class="btn secundario" data-paso="-1" '+(pagina===0?'disabled':'')+'>Anterior</button><span>Página '+(pagina+1)+' de '+Math.max(1,Math.ceil(filtrada.length/30))+'</span><button type="button" class="btn secundario" data-paso="1" '+((pagina+1)*30>=filtrada.length?'disabled':'')+'>Siguiente</button>';
      if(elegido)detalle(elegido,false);
    }
    function detalle(idProducto,enfocar){
      if(!datosListos)return;
      var p=lista.find(function(p){return p.id===idProducto;});if(!p){elegido=null;zona('detalle').innerHTML='';return;}
      elegido=p.id;var opciones=opcionesDe(p);
      zona('detalle').innerHTML='<section class="cm-detalle" tabindex="-1"><div class="cm-cabecera"><h3>'+esc(p.nombre)+'</h3><button class="btn secundario" type="button" data-cm="cerrar">Cerrar ficha</button></div><p>'+esc([p.dosificacion,p.presentacion].filter(Boolean).join(' · '))+'</p><p>'+resumenStock(p)+'</p>'+
        (p.insumo?'<p>No aplica: es un insumo.</p>':p.inconsistente?'<p><b>Por revisar.</b> Hay saldos negativos. No se ofrecen opciones hasta revisar los movimientos.</p>':!p.perfil.completo?'<p><b>Por revisar.</b> '+esc(p.perfil.motivo)+'</p>':p.activo===false?'<p>Registro inactivo. No se proponen alternativas.</p>':opciones.length?'<h4>Opciones para valorar por el profesional</h4><ul class="cm-alternativas">'+opciones.map(function(a){return '<li><strong>'+esc(a.producto.nombre)+'</strong><span>'+esc(a.producto.presentacion)+' · '+numero(a.producto.vigente)+' '+esc(a.producto.unidad||'unidades')+' vigentes</span><span class="cm-clase">'+(a.tipo==='misma'?'Mismo principio y presentación':'Otro medicamento: requiere valoración clínica')+'</span><p>'+esc(a.texto)+'</p></li>';}).join('')+'</ul>':'<p><b>No hay.</b> No se encontraron otras opciones de referencia con existencia vigente en este inventario.</p>')+
        '<details><summary>Lotes y existencias de este registro</summary><ul>'+p.lotes.map(function(l){return '<li>'+esc(l.lote||'Sin código')+' · '+numero(l.existencia)+' '+esc(p.unidad||'unidades')+' · '+(l.vence?'Vence '+esc(String(l.vence).slice(0,10).split('-').reverse().join('/')):'Sin fecha de vencimiento')+' · '+esc(l.estado)+'</li>';}).join('')+'</ul><p>Total contable de este registro: '+numero(p.total)+' '+esc(p.unidad||'unidades')+'. Las cantidades retenidas, vencidas o sin fecha se distinguen de las vigentes.</p></details></section>';
      if(enfocar){var f=zona('detalle').firstElementChild;f.focus();f.scrollIntoView({block:'start',behavior:'smooth'});}
    }
    async function cargar(){
      if(ocupado||!activo())return;ocupado=true;datosListos=false;var turno=++version;
      zona('actualizar').disabled=true;zona('estado').textContent='Consultando el catálogo completo y todos sus lotes…';
      zona('lista').innerHTML='';zona('detalle').innerHTML='';zona('paginas').innerHTML='';
      try{
        var r=await Promise.all([leerTodo(sb,'productos','id,nombre,dosificacion,presentacion,categoria,unidad,activo','id'),leerTodo(sb,'v_existencia_lote','lote_id,producto_id,lote,vence,estado,existencia','lote_id')]);
        if(!activo()||turno!==version)return;
        lista=inventariar(r[0],r[1],hoy()).sort(function(a,b){return a.nombre.localeCompare(b.nombre,'es');});
        datosListos=true;
        var insumos=lista.filter(function(p){return p.insumo;}).length;
        zona('estado').textContent=numero(lista.length)+' registros de catálogo ('+numero(lista.length-insumos)+' medicamentos/fórmulas y '+numero(insumos)+' insumos) · '+numero(r[1].length)+' lotes · Actualizado '+new Date().toLocaleString('es-VE',{timeZone:'America/Caracas'})+' · Se actualiza cada 30 segundos mientras esta consulta está visible.';
        renderizar();
      }catch(e){if(activo()&&turno===version){lista=[];zona('estado').textContent='No se pudo actualizar el inventario.';zona('lista').innerHTML='<div class="aviso bad">'+esc(e.message||e)+'. Pulsa Actualizar inventario para reintentar. No se muestran cifras ni alternativas de una carga incompleta.</div>';}}
      finally{ocupado=false;if(activo())zona('actualizar').disabled=false;}
    }
    ancla.querySelector('#'+id+'-busca').addEventListener('input',function(e){busqueda=e.target.value;pagina=0;renderizar();});
    ancla.querySelector('#'+id+'-stock').addEventListener('change',function(e){filtro=e.target.value;pagina=0;renderizar();});
    ancla.querySelector('#'+id+'-tipo').addEventListener('change',function(e){tipo=e.target.value;pagina=0;renderizar();});
    zona('clinicas').addEventListener('change',renderizar);
    ancla.addEventListener('click',function(e){if(!activo())return;var b=e.target.closest('button');if(!b||!ancla.contains(b))return;if(b.dataset.cm==='actualizar')cargar();else if(b.dataset.cm==='cerrar'){elegido=null;zona('detalle').innerHTML='';}else if(b.dataset.producto)detalle(b.dataset.producto,true);else if(b.dataset.paso){pagina+=Number(b.dataset.paso);renderizar();}});
    var timer=setInterval(function(){if(!activo()){limpiar();return;}if(!document.hidden&&ancla.getClientRects().length)cargar();},30000);
    function limpiar(){vivo=false;version++;clearInterval(timer);}
    montajes.set(ancla,limpiar);
    cargar();
  }
  window.CONSULTA_MEDICAMENTOS={normalizar:normalizar,perfil:perfil,inventariar:inventariar,alternativas:alternativas,leerTodo:leerTodo,esInsumo:esInsumo};
  window.PANTALLA_CONSULTA_MEDICAMENTOS=montar;
})();
