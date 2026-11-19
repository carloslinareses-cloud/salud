/* Consulta compartida, de solo lectura. Nunca selecciona un lote para entregar. */
(function () {
  'use strict';
  var cliente = null, ventana = null, turno = 0, actual = null, suscripcion = null;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function permitido() { return ['admin','inventario','despacho'].includes((window.FARMACIA_PERFIL || {}).rol); }
  function uuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }
  function boton(id, nombre) {
    if (!permitido() || !uuid(id)) return '';
    return '<button type="button" class="suave lm-ver" data-ver-lotes="'+esc(id)+'" aria-label="Ver lotes'+(nombre?' de '+esc(nombre):'')+'">Ver lotes</button>';
  }
  function fechaValida(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v; }
  function estado(l, hoy) {
    var n = l.existencia == null ? NaN : Number(l.existencia);
    if (!Number.isFinite(n)) return 'Existencia por confirmar';
    if (n < 0) return 'Saldo negativo: revisar';
    if (l.estado !== 'disponible') return !l.estado ? 'Estado por confirmar' : ['baja','dado_de_baja'].includes(l.estado) ? 'Dado de baja' : 'Estado: '+l.estado;
    if (!fechaValida(l.vence)) return 'Vencimiento por confirmar';
    if (l.vence < hoy) return 'Vencido';
    return n > 0 ? 'Disponible' : 'Sin existencia';
  }
  async function leerLotes(sb, id) {
    if (!uuid(id)) throw Error('Producto no válido');
    var filas = [], esperado = null, vistos = new Set();
    while (filas.length < 20000) {
      var r = await sb.from('v_existencia_lote').select('lote_id,producto_id,lote,vence,estado,existencia',{count:'exact'})
        .eq('producto_id',id).order('lote_id').range(filas.length,filas.length+399);
      if (r.error || !Array.isArray(r.data) || !Number.isInteger(r.count) || r.count > 20000) throw Error('Lectura incompleta');
      if (esperado === null) esperado = r.count;
      if (r.count !== esperado) throw Error('Los lotes cambiaron durante la consulta');
      r.data.forEach(function (l) {
        if (!uuid(l.lote_id) || String(l.producto_id).toLowerCase()!==String(id).toLowerCase() || vistos.has(l.lote_id)) throw Error('Lotes sin confirmar');
        vistos.add(l.lote_id);
      });
      filas = filas.concat(r.data);
      if (filas.length === esperado) return filas.sort(function (a,b) { return String(a.vence || '9999').localeCompare(String(b.vence || '9999')) || String(a.lote || '').localeCompare(String(b.lote || ''),'es'); });
      if (r.data.length < 400 || filas.length > esperado) throw Error('Lectura incompleta');
    }
    throw Error('Demasiados lotes para comprobarlos');
  }
  function cerrar() {
    turno++; actual = null;
    if (ventana) { if (ventana.open) ventana.close(); ventana.querySelector('[data-lm-contenido]').textContent = ''; }
  }
  function preparar() {
    if (ventana) return;
    ventana = document.createElement('dialog'); ventana.className = 'lm-dialog';
    ventana.setAttribute('aria-labelledby','lm-titulo');
    ventana.innerHTML = '<div class="lm-cabecera"><h2 id="lm-titulo">Lotes en inventario</h2><button type="button" class="secundario" data-lm-cerrar>Cerrar</button></div><div data-lm-contenido role="status" aria-live="polite"></div>';
    document.body.appendChild(ventana);
    ventana.querySelector('[data-lm-cerrar]').addEventListener('click',cerrar);
    ventana.addEventListener('close',function () { if(ventana.open)return;turno++; actual=null; ventana.querySelector('[data-lm-contenido]').textContent=''; });
    ventana.addEventListener('click',function (e) { if(e.target.closest('[data-lm-reintentar]') && actual) abrir(actual); });
  }
  async function abrir(id) {
    if (!cliente || !permitido() || !uuid(id)) return;
    preparar(); actual=id; var mio=++turno, sb=cliente;
    var zona=ventana.querySelector('[data-lm-contenido]');
    zona.textContent='Consultando los lotes y sus existencias…';
    if (!ventana.open) ventana.showModal();
    try {
      var respuesta=await Promise.all([sb.from('productos').select('nombre,dosificacion,presentacion,unidad').eq('id',id).single(),leerLotes(sb,id)]);
      if (mio!==turno || !ventana.open) return;
      if (respuesta[0].error || !respuesta[0].data) throw Error('No se pudo confirmar el producto');
      var p=respuesta[0].data,lotes=respuesta[1];
      var hoy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      function fecha(v) { return fechaValida(v)?new Intl.DateTimeFormat('es-VE',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v+'T12:00:00Z')):'Sin fecha válida'; }
      function numero(n) { return n==null || !Number.isFinite(Number(n))?'Por confirmar':Number(n).toLocaleString('es-VE',{maximumFractionDigits:2}); }
      zona.innerHTML='<h3>'+esc(p.nombre)+'</h3><p>'+esc([p.dosificacion,p.presentacion].filter(Boolean).join(' · '))+'</p><p class="sub chico">Existencias por lote · Actualizado '+esc(new Date().toLocaleString('es-VE',{timeZone:'America/Caracas'}))+'</p>'+
        (lotes.length?'<p>'+lotes.length+(lotes.length===1?' lote registrado':' lotes registrados')+'</p><ul class="lm-lista">'+lotes.map(function (l) { return '<li><strong>Lote '+esc(l.lote || 'sin número')+'</strong><span>Vence: '+esc(fecha(l.vence))+'</span><span>Existencia: <b>'+esc(numero(l.existencia))+'</b> '+esc(p.unidad || 'unidades')+'</span><b class="lm-estado">'+esc(estado(l,hoy))+'</b></li>'; }).join('')+'</ul>':'<p>No hay lotes registrados para este medicamento.</p>');
    } catch (e) {
      if (mio===turno && ventana.open) zona.innerHTML='<p>No se pudieron consultar todos los lotes. No se puede confirmar la existencia.</p><button type="button" class="secundario" data-lm-reintentar>Reintentar</button>';
    }
  }
  function montarBuscador(sb, zona) {
    if (!permitido()) { zona.textContent='No tienes acceso a esta consulta.'; return; }
    var pagina=0, termino='', consulta=0, demora, tamano=25;
    zona.innerHTML='<form class="busca-fila" data-lm-buscar><div class="busca-campo"><label for="desLoteBusca">Número de lote o medicamento</label><input id="desLoteBusca" type="search" autocomplete="off" placeholder="Código de lote o nombre del medicamento…"></div><div class="herr-der"><button type="submit" class="secundario">Buscar</button><button type="button" class="secundario" data-lm-actualizar>Actualizar</button></div></form>'+
      '<p class="sub">Lotes registrados en Inventario. Usa Actualizar para consultar las entradas nuevas. Puedes volver a tu pantalla sin perder lo que estabas completando.</p><p data-lm-resumen role="status" aria-live="polite"></p><div data-lm-resultados></div><div data-lm-paginas class="herr-der"></div>';
    var campo=zona.querySelector('input'), resultado=zona.querySelector('[data-lm-resultados]'), resumen=zona.querySelector('[data-lm-resumen]'), paginas=zona.querySelector('[data-lm-paginas]');
    function vigente(id) { return consulta===id && document.documentElement.contains(zona) && permitido(); }
    function buscar() {
      var id=++consulta; paginas.innerHTML=''; resultado.innerHTML='';
      resumen.textContent='Buscando lotes…';
      var peticion=sb.from('v_existencia_lote').select('lote_id,producto_id,producto,dosificacion,presentacion,lote,vence,estado,existencia',{count:'exact'});
      if (termino) {
        var patron='%'+termino.replace(/[\\%_]/g,'\\$&')+'%';
        var literal='"'+patron.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
        peticion=peticion.or('lote.ilike.'+literal+',producto.ilike.'+literal);
      }
      peticion.order('producto').order('lote').order('lote_id').range(pagina*tamano,(pagina+1)*tamano-1)
        .then(function (r) {
          if (!vigente(id)) return;
          if (r.error || !Array.isArray(r.data) || !Number.isInteger(r.count)) throw Error('Lectura incompleta');
          if (!r.count) { resumen.textContent=termino?'No hay lotes que coincidan con «'+termino+'».':'No hay lotes registrados en Inventario.'; return; }
          if (pagina*tamano>=r.count) { pagina=Math.floor((r.count-1)/tamano); buscar(); return; }
          resumen.textContent=r.count+(termino?(r.count===1?' lote encontrado':' lotes encontrados'):(r.count===1?' lote en Inventario':' lotes en Inventario'))+' · Página '+(pagina+1)+' de '+Math.ceil(r.count/tamano);
          var hoy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
          var filas=r.data, exactos=filas.filter(function (l) { return String(l.lote || '').trim().toLocaleUpperCase()===termino.toLocaleUpperCase(); });
          var compartido=new Set(exactos.map(function (l) { return l.producto_id; })).size>1;
          /* Los códigos antiguos pueden repetirse entre medicamentos. Si la
             consulta completa es ese código, mostrar primero los que tienen
             saldo; conservar visibles los agotados y sus propios estados. */
          if (compartido && filas.length===r.count && exactos.length===filas.length) {
            filas=filas.slice().sort(function (a,b) { return Number(Number(b.existencia)>0)-Number(Number(a.existencia)>0) || String(a.producto).localeCompare(String(b.producto),'es') || String(a.lote_id).localeCompare(String(b.lote_id)); });
          }
          resultado.innerHTML=(compartido?'<p class="aviso warn"><b>El lote '+esc(termino)+' está registrado en varios medicamentos.</b> Revisa el medicamento de cada fila: sus existencias se cuentan por separado.</p>':'')+
            '<p class="sub chico">Desliza la tabla hacia los lados para ver todas las columnas.</p><div class="tabla-caja" tabindex="0" role="region" aria-label="Lotes encontrados"><table class="tabla"><thead><tr><th scope="col">Medicamento</th><th scope="col">Presentación</th><th scope="col">Lote</th><th scope="col">Vencimiento</th><th scope="col" class="der">Existencia</th><th scope="col">Estado</th></tr></thead><tbody>'+filas.map(function (l) {
            var vence=fechaValida(l.vence)?new Intl.DateTimeFormat('es-VE',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(l.vence+'T12:00:00Z')):'Sin fecha confirmada';
            var cantidad=l.existencia==null || !Number.isFinite(Number(l.existencia))?'Por confirmar':Number(l.existencia).toLocaleString('es-VE',{maximumFractionDigits:2});
            return '<tr><td>'+esc(l.producto)+' '+esc(l.dosificacion || '')+' '+boton(l.producto_id,l.producto)+'</td><td>'+esc(l.presentacion || '—')+'</td><td>'+esc(l.lote || 'Sin número')+'</td><td>'+esc(vence)+'</td><td class="der">'+esc(cantidad)+'</td><td>'+esc(estado(l,hoy))+'</td></tr>';
          }).join('')+'</tbody></table></div>';
          paginas.innerHTML='<button type="button" class="secundario" data-lm-anterior '+(pagina===0?'disabled':'')+'>Anterior</button><button type="button" class="secundario" data-lm-siguiente '+((pagina+1)*tamano>=r.count?'disabled':'')+'>Siguiente</button>';
          paginas.querySelector('[data-lm-anterior]').onclick=function () { pagina--; buscar(); };
          paginas.querySelector('[data-lm-siguiente]').onclick=function () { pagina++; buscar(); };
        }).catch(function () { if (vigente(id)) { resultado.innerHTML=''; paginas.innerHTML=''; resumen.textContent='No se pudieron consultar los lotes. Pulsa Buscar para volver a intentarlo.'; } });
    }
    zona.querySelector('form').onsubmit=function (e) { e.preventDefault(); clearTimeout(demora); termino=campo.value.trim(); pagina=0; buscar(); };
    campo.oninput=function () { clearTimeout(demora); consulta++; demora=setTimeout(function () { termino=campo.value.trim(); pagina=0; buscar(); },300); };
    function actualizar() {
      clearTimeout(demora);
      var nuevo=campo.value.trim(); if (nuevo!==termino) pagina=0; termino=nuevo;
      buscar();
    }
    zona.querySelector('[data-lm-actualizar]').onclick=actualizar;
    buscar();
    return {actualizar:actualizar};
  }
  function iniciar(sb) {
    cerrar(); cliente=sb;
    if (suscripcion) suscripcion.unsubscribe();
    if (sb.auth && sb.auth.onAuthStateChange) suscripcion=sb.auth.onAuthStateChange(function (evento,sesion) { if (!sesion) { cerrar(); cliente=null; } }).data.subscription;
  }
  document.addEventListener('click',function (e) {
    var b=e.target.closest('[data-ver-lotes]'); if (!b) return;
    e.preventDefault();e.stopPropagation();abrir(b.dataset.verLotes);
  },true);
  document.addEventListener('keydown',function (e) { if ((e.key==='Enter'||e.key===' ') && e.target.closest('[data-ver-lotes]')) e.stopPropagation(); },true);
  window.LOTES_MEDICAMENTOS={iniciar:iniciar,boton:boton,abrir:abrir,cerrar:cerrar,leerLotes:leerLotes,estado:estado,montarBuscador:montarBuscador};
})();
