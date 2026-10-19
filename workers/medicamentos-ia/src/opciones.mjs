import {consulta,oms,guia} from '../generado/referencias.mjs';

// La IA no crea relaciones clínicas. Recibe únicamente estas opciones documentadas.
export function opcionesDocumentadas(texto,productos,lotes,fecha) {
  const lista=consulta.inventariar(productos,lotes,fecha);
  const q=consulta.normalizar(texto),med=oms.buscar(texto).exacta;
  const referencias=consulta.buscarReferencias(texto);
  const limpia=q.replace(/\d+(?:[.,]\d+)?\s*(?:MCG|MG|G)\b/g,'').replace(/\b(?:TABLETAS?|CAPSULAS?|COMPRIMIDOS?)\b/g,'').trim();
  const ref=referencias.find(r=>[r.nombre,...r.aliases].some(n=>consulta.normalizar(n)===limpia));
  const resultado=new Map();
  function agregar(p,tipo,ambitos){
    if(p.referencia||p.activo===false||p.insumo||p.inconsistente||!(p.vigente>0)||!p.perfil?.completo)return;
    const id=String(p.id),previo=resultado.get(id);
    if(previo){for(const a of ambitos)if(!previo.ambitos.some(b=>b.fuente===a.fuente&&b.indicacion===a.indicacion))previo.ambitos.push(a);if(tipo==='misma')previo.tipo=tipo;return;}
    resultado.set(id,{id,tipo,producto:{id:p.id,nombre:p.nombre,dosificacion:p.dosificacion,presentacion:p.presentacion,unidad:p.unidad,vigente:p.vigente,perfil:p.perfil},ambitos});
  }
  if(ref){
    const g=guia.grupos[ref.grupo],ambito={indicacion:g.indicacion+' · Vía oral · Adultos',fuente:g.fuente,restricciones:[g.nota]};
    for(const o of consulta.opcionesReferencia(ref,lista))agregar(o.producto,'clinica',[ambito]);
    const principioSolicitado=consulta.perfil({nombre:texto,presentacion:'TABLETA'}).principio;
    for(const p of lista)if(ref.principios.includes(p.perfil.principio)&&(!principioSolicitado||p.perfil.principio===principioSolicitado)&&['TABLETA','CAPSULA'].includes(p.perfil.forma))agregar(p,'mismo_principio',[{...ambito,restricciones:['Mismo principio; confirmar dosis, forma y prescripción. No implica equivalencia de dosis.',...ambito.restricciones]}]);
  }
  if(med){
    for(const o of oms.alternativas(med))for(const p of oms.productos(o.medicamento,lista)){
      // El piloto automático limita propuestas a formas orales sólidas cuya vía
      // esté explícitamente incluida en la ficha; las demás siguen en la bibliografía.
      if(!['TABLETA','CAPSULA'].includes(p.perfil.forma))continue;
      const ambitos=o.ambitos.filter(g=>!/ophthalm|eye|topical|dermatolog/i.test(g.seccion+' '+g.indicacion)&&/\boral\b|tablet|capsul/i.test(JSON.stringify(g.formulaciones)+' '+g.notas)).map(g=>({indicacion:oms.indicacion(g),fuente:g.fuente,restricciones:oms.limites(g)}));
      if(ambitos.length)agregar(p,'clinica',ambitos);
    }
    for(const p of oms.productos(med,lista))if(['TABLETA','CAPSULA'].includes(p.perfil.forma))agregar(p,'mismo_principio',[{indicacion:'Mismo principio activo; la indicación y la dosis deben confirmarse.',fuente:med.fuente,restricciones:['No confirma equivalencia de dosis ni intercambiabilidad entre presentaciones.']}]);
  }
  // Una presentación exacta puede confirmar coincidencias más estrechas.
  const exactos=lista.filter(p=>consulta.normalizar(p.nombre)===q&&p.perfil.completo);
  for(const p of exactos)for(const o of consulta.alternativas(p,lista,false,false))agregar(o.producto,'misma',[{indicacion:'Coinciden principio, concentración y forma; confirmar envase y prescripción.',fuente:'https://www.fda.gov/drugs/generic-drugs/generic-drugs-questions-answers',restricciones:['No certifica bioequivalencia ni registro sanitario del producto.']}]);
  return {reconocido:!!(ref||med||exactos.length),opciones:[...resultado.values()].sort((a,b)=>(a.tipo==='misma'?0:a.tipo==='mismo_principio'?1:2)-(b.tipo==='misma'?0:b.tipo==='mismo_principio'?1:2)||a.producto.nombre.localeCompare(b.producto.nombre,'es'))};
}
