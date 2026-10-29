// RxNav ayuda a identificar nombres. Sus coincidencias no autorizan cambios clínicos.
export async function buscarEnRxNav(texto) {
  const url=new URL('https://rxnav.nlm.nih.gov/REST/approximateTerm.json');
  url.searchParams.set('term',texto);
  url.searchParams.set('maxEntries','12');
  url.searchParams.set('option','1');
  try {
    const r=await fetch(url.toString(),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Error('RXNAV_NO_DISPONIBLE');
    const longitud=Number(r.headers.get('content-length')||0);
    if(longitud>150000)throw Error('RXNAV_RESPUESTA_EXCESIVA');
    if(!r.body)throw Error('RXNAV_RESPUESTA_INVALIDA');
    const lector=r.body.getReader(),partes=[];let bytes=0;
    try { while(true){const {done,value}=await lector.read();if(done)break;bytes+=value.length;if(bytes>150000)throw Error('RXNAV_RESPUESTA_EXCESIVA');partes.push(value);} }
    catch(e){await lector.cancel();throw e;}
    const contenido=new Uint8Array(bytes);let indice=0;for(const parte of partes){contenido.set(parte,indice);indice+=parte.length;}
    const datos=JSON.parse(new TextDecoder().decode(contenido)),candidatos=datos?.approximateGroup?.candidate;
    if(candidatos!==undefined&&!Array.isArray(candidatos))throw Error('RXNAV_RESPUESTA_INVALIDA');
    const vistos=new Set(),coincidencias=[];
    for(const c of candidatos||[]){
      const id=String(c.rxcui||''),nombre=String(c.name||'').trim();
      if(!/^\d{1,12}$/.test(id)||!nombre||nombre.length>160||vistos.has(id))continue;
      vistos.add(id);
      coincidencias.push({nombre,url:'https://rxnav.nlm.nih.gov/REST/rxcui/'+id+'/properties.json'});
      if(coincidencias.length===5)break;
    }
    return {estado:coincidencias.length?'encontrado':'sin_resultados',coincidencias};
  } catch {
    return {estado:'no_disponible',coincidencias:[]};
  }
}
