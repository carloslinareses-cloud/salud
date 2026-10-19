// Genera una instantánea revisable a partir de las fuentes oficiales guardadas.
// No actualiza producción ni deduce alternativas a partir de nombres parecidos.
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const raiz=new URL('../',import.meta.url),leer=n=>JSON.parse(fs.readFileSync(new URL(n,raiz),'utf8'));
const catalogo=leer('tmp/oms-eeml-extraido.json'),recomendaciones=leer('tmp/oms-recomendaciones-extraidas.json');
const normalizar=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ').trim();
const traducciones=`Acetylsalicylic acid|ÁCIDO ACETILSALICÍLICO|ASPIRINA|AAS|ASA|ASAPROL|CALOXPIRINA
Aciclovir|ACICLOVIR
Acenocoumarol|ACENOCUMAROL
Acetazolamide|ACETAZOLAMIDA
Aclidinium|ACLIDINIO
Adalimumab|ADALIMUMAB
Albendazole|ALBENDAZOL
Allopurinol|ALOPURINOL
Alprostadil (prostaglandin E1)|ALPROSTADIL
Amikacin|AMIKACINA
Amitriptyline|AMITRIPTILINA
Amlodipine|AMLODIPINO|AMLODIPINA
Amoxicillin|AMOXICILINA
Ampicillin|AMPICILINA
Anastrozole|ANASTROZOL
Anidulafungin|ANIDULAFUNGINA
Apixaban|APIXABÁN
Aripiprazole|ARIPIPRAZOL
Atenolol|ATENOLOL
Atorvastatin|ATORVASTATINA
Atracurium|ATRACURIO
Atropine|ATROPINA
Azithromycin|AZITROMICINA
Beclometasone|BECLOMETASONA
Beclometasone + formoterol|BECLOMETASONA + FORMOTEROL
Benzyl benzoate|BENZOATO DE BENCILO
Bicalutamide|BICALUTAMIDA
Biperiden|BIPERIDENO
Bisacodyl|BISACODILO
Bisoprolol|BISOPROLOL
Bromocriptine|BROMOCRIPTINA
Budesonide|BUDESONIDA
Budesonide + formoterol|BUDESONIDA + FORMOTEROL
Budesonide + salmeterol|BUDESONIDA + SALMETEROL
Bumetanide|BUMETANIDA
Buprenorphine|BUPRENORFINA
Cabergoline|CABERGOLINA
Calcipotriol|CALCIPOTRIOL
Calcitriol|CALCITRIOL
Canagliflozin|CANAGLIFLOZINA
Carbachol|CARBACOL
Carbamazepine|CARBAMAZEPINA
Carbimazole|CARBIMAZOL
Carvedilol|CARVEDILOL
Caspofungin|CASPOFUNGINA
Cefalexin|CEFALEXINA
Cefazolin|CEFAZOLINA
Ceftriaxone|CEFTRIAXONA
Cetirizine|CETIRIZINA
Chlorothiazide|CLOROTIAZIDA
Chlorpromazine|CLORPROMAZINA
Chlortalidone|CLORTALIDONA
Chlortetracycline|CLORTETRACICLINA
Ciclesonide|CICLESONIDA
Ciprofloxacin|CIPROFLOXACINA|CIPROFLOXACINO
Citalopram|CITALOPRAM
Clarithromycin|CLARITROMICINA
Clindamycin|CLINDAMICINA
Clopidogrel|CLOPIDOGREL
Cloxacillin|CLOXACILINA
Clotrimazole|CLOTRIMAZOL
Colecalciferol|COLECALCIFEROL
Cyclopentolate|CICLOPENTOLATO
Cycloserine|CICLOSERINA
Dabigatran|DABIGATRÁN
Dalteparin|DALTEPARINA
Dapagliflozin|DAPAGLIFLOZINA
Darbepoetin alfa|DARBEPOETINA ALFA
Deferasirox|DEFERASIROX
Deferiprone|DEFERIPRONA
Dexamethasone|DEXAMETASONA
Dextran 70|DEXTRANO 70
Diazepam|DIAZEPAM
Dicloxacillin|DICLOXACILINA
Digoxin|DIGOXINA
Dinoprostone (prostaglandin E2)|DINOPROSTONA
Dolasetron|DOLASETRÓN
Doxycycline|DOXICICLINA
Dulaglutide|DULAGLUTIDA
Edoxaban|EDOXABÁN
Empagliflozin|EMPAGLIFLOZINA
Enalapril|ENALAPRIL|ENALAPRIL MALEATO
Enoxaparin|ENOXAPARINA
Epoetin alfa|EPOETINA ALFA
Epoetin beta|EPOETINA BETA
Epoetin theta|EPOETINA THETA
Ergocalciferol|ERGOCALCIFEROL
Ergometrine|ERGOMETRINA
Erlotinib|ERLOTINIB
Erythromycin|ERITROMICINA
Escitalopram|ESCITALOPRAM
Etanercept|ETANERCEPT
Ethanol|ETANOL
Ethionamide|ETIONAMIDA
Fexofenadine|FEXOFENADINA
Flucloxacillin|FLUCLOXACILINA
Fluconazole|FLUCONAZOL
Fluphenazine|FLUFENAZINA
Flutamide|FLUTAMIDA
Fluticasone|FLUTICASONA
Fluticasone + formoterol|FLUTICASONA + FORMOTEROL
Fluticasone furoate + vilanterol|FUROATO DE FLUTICASONA + VILANTEROL
Fluvastatin|FLUVASTATINA
Fluvoxamine|FLUVOXAMINA
Fluoxetine|FLUOXETINA
Folic acid|ÁCIDO FÓLICO
Furosemide|FUROSEMIDA
Gabapentin|GABAPENTINA
Gentamicin|GENTAMICINA
Gliclazide|GLICLAZIDA
Glycopyrronium|GLICOPIRRONIO
Goserelin|GOSERELINA
Granisetron|GRANISETRÓN
Haloperidol|HALOPERIDOL
Haloperidol decanoate|DECANOATO DE HALOPERIDOL
Homatropine|HOMATROPINA
Hydrochlorothiazide|HIDROCLOROTIAZIDA
Hydrocortisone|HIDROCORTISONA
Hydromorphone|HIDROMORFONA
Ibuprofen|IBUPROFENO
Imipenem + cilastatin|IMIPENEM + CILASTATINA
Indapamide|INDAPAMIDA
Indometacin|INDOMETACINA
Infliximab|INFLIXIMAB
Insulin aspart|INSULINA ASPART
Insulin degludec|INSULINA DEGLUDEC
Insulin detemir|INSULINA DETEMIR
Insulin glargine|INSULINA GLARGINA
Insulin glulisine|INSULINA GLULISINA
Insulin lispro|INSULINA LISPRO
Insulin (analogue, long-acting)|INSULINA ANÁLOGA DE ACCIÓN PROLONGADA
Insulin (analogue, rapid-acting)|INSULINA ANÁLOGA DE ACCIÓN RÁPIDA
Iodine|YODO
Ivermectin|IVERMECTINA
Kanamycin|KANAMICINA
Letrozole|LETROZOL
Leuprorelin|LEUPRORELINA
Levetiracetam|LEVETIRACETAM
Levodopa + carbidopa|LEVODOPA + CARBIDOPA
Levodopa + benserazide|LEVODOPA + BENSERAZIDA
Levothyroxine|LEVOTIROXINA
Linezolid|LINEZOLID
Liraglutide|LIRAGLUTIDA
Loratadine|LORATADINA
Lorazepam|LORAZEPAM
Losartan|LOSARTÁN
Lovastatin|LOVASTATINA
Medroxyprogesterone acetate|ACETATO DE MEDROXIPROGESTERONA
Meropenem|MEROPENEM
Mesalazine|MESALAZINA
Metformin|METFORMINA
Methadone|METADONA
Methimazole|METIMAZOL|TIAMAZOL
Methylergometrine|METILERGOMETRINA
Meticillin|METICILINA
Metoprolol|METOPROLOL
Metronidazole|METRONIDAZOL
Micafungin|MICAFUNGINA
Midazolam|MIDAZOLAM
Mometasone|MOMETASONA
Mometasone + formoterol|MOMETASONA + FORMOTEROL
Morphine|MORFINA
Moxidectin|MOXIDECTINA
Nadroparin|NADROPARINA
Nafcillin|NAFCILINA
Naproxen|NAPROXENO
Netilmicin|NETILMICINA
Nifedipine|NIFEDIPINO|NIFEDIPINA
Norethisterone|NORETISTERONA
Ofloxacin|OFLOXACINO|OFLOXACINA
Olanzapine|OLANZAPINA
Omeprazole|OMEPRAZOL
Ondansetron|ONDANSETRÓN
Oxacillin|OXACILINA
Oxycodone|OXICODONA
Oxytetracycline|OXITETRACICLINA
Paliperidone|PALIPERIDONA
Palonosetron|PALONOSETRÓN
Paracetamol (acetaminophen)|PARACETAMOL|ACETAMINOFÉN|ACETAMINOPHEN
Paroxetine|PAROXETINA
Pilocarpine|PILOCARPINA
Podophyllotoxin|PODOFILOTOXINA
Podophyllum resin|RESINA DE PODOFILO
Povidone iodine|POVIDONA YODADA
Praziquantel|PRAZIQUANTEL
Pravastatin|PRAVASTATINA
Prednisolone|PREDNISOLONA
Prednisone|PREDNISONA
Propofol|PROPOFOL
Protionamide|PROTIONAMIDA
Quetiapine|QUETIAPINA
Risperidone|RISPERIDONA
Rivaroxaban|RIVAROXABÁN
Salbutamol|SALBUTAMOL|ALBUTEROL
Semaglutide|SEMAGLUTIDA
Senna|SEN
Sertraline|SERTRALINA
Simvastatin|SIMVASTATINA
Spironolactone|ESPIRONOLACTONA
Sulfasalazine|SULFASALAZINA
Sumatriptan|SUMATRIPTÁN
Tacalcitol|TACALCITOL
Tamsulosin|TAMSULOSINA
Tedizolid|TEDIZOLID
Terbutaline|TERBUTALINA
Terizidone|TERIZIDONA
Tetracycline|TETRACICLINA
Thiopental|TIOPENTAL
Tinidazole|TINIDAZOL
Tiotropium bromide|BROMURO DE TIOTROPIO|TIOTROPIO
Tirzepatide|TIRZEPATIDA
Tobramycin|TOBRAMICINA
Torasemide|TORASEMIDA
Tranexamic acid|ÁCIDO TRANEXÁMICO
Trihexyphenidyl|TRIHEXIFENIDILO
Triptorelin|TRIPTORELINA
Tropicamide|TROPICAMIDA
Tropisetron|TROPISETRÓN
Umeclidinium|UMECLIDINIO
Valaciclovir|VALACICLOVIR
Valproic acid|ÁCIDO VALPROICO
Vancomycin|VANCOMICINA
Vecuronium|VECURONIO
Verapamil|VERAPAMILO
Voriconazole|VORICONAZOL
Warfarin|WARFARINA
Zuclopenthixol decanoate|DECANOATO DE ZUCLOPENTIXOL`;
const nombres=new Map(traducciones.split('\n').map(l=>{const [en,...es]=l.split('|');return [normalizar(en),es];}));
const medicamentos=catalogo.map(m=>({id:m.id,nombre:nombres.get(normalizar(m.nombre))?.[0]||m.nombre,nombreOriginal:m.nombre,aliases:nombres.get(normalizar(m.nombre))||[],fuente:m.url}));
const porId=new Map(medicamentos.map(m=>[m.id,m]));
const grupos=new Map(),exclusiones=[];
for(const m of catalogo)for(const s of m.secciones)for(const i of s.indicaciones){
 if(!i.alternativaDe)continue;
 const r=recomendaciones.find(r=>r.url===i.url);assert.ok(r,'Falta fuente de la relación');
 const base=i.urlOrigen.split('/').pop();assert.ok(porId.has(base),'Origen desconocido');
 const enlaces=r.campos['Therapeutic alternatives']?.enlaces||[];
 if(!enlaces.some(a=>a.url===m.url)){exclusiones.push({medicamento:m.id,fuente:i.url,motivo:'La ficha detallada no confirma el enlace del índice'});continue;}
 const key=i.url;
 if(!grupos.has(key))grupos.set(key,{id:key.split('/').pop(),base,alternativas:[],indicacion:i.nombre,seccion:s.seccion,fuente:key,edad:r.campos.Age?.texto||'Not specified',restriccionEdad:r.campos['Age restriction']?.texto||'',sexo:r.campos.Sex?.texto||'',formulaciones:r.campos.Formulations?.texto||'',notas:r.campos['Additional notes']?.texto||'',limitaciones:r.campos['Therapeutic alternatives limitations']?.texto||'',limitacionesInfantiles:r.campos['Therapeutic alternatives limitations for EMLc']?.texto||'',resumen:r.resumen});
 grupos.get(key).alternativas.push(m.id);
}
// Las clases solo se expanden donde la recomendación OMS lo permite expresamente.
// La pertenencia ATC se conserva como segunda fuente; no usamos las DDD como dosis.
const clases=leer('tmp/oms-clases-atc.json');
for(const clase of clases){
 const recs=recomendaciones.filter(r=>r.campos['Therapeutic alternatives limitations']?.texto.includes(clase.codigo));
 assert.ok(recs.length,'La OMS no autorizó esta clase para ninguna indicación');
 const base=catalogo.find(m=>normalizar(m.nombre)===normalizar(recs[0].campos.INN.texto));assert.ok(base);
 const ids=clase.miembros.map(m=>{let med=medicamentos.find(x=>normalizar(x.nombreOriginal)===normalizar(m.nombre));if(!med){med={id:'atc-'+m.codigo,nombre:m.es||m.nombre,nombreOriginal:m.nombre,aliases:[m.es||m.nombre],fuente:clase.fuente};medicamentos.push(med);porId.set(med.id,med);}return med.id;});
 for(const r of recs){const id=r.url.split('/').pop();grupos.set(r.url,{id,base:base.id,alternativas:ids.filter(id=>id!==base.id),indicacion:r.campos.Indication.texto.replace(/ ICD11 code:.*/,''),seccion:r.seccion,fuente:r.url,fuenteClase:clase.fuente,clase:clase.codigo,edad:r.campos.Age?.texto||'Not specified',restriccionEdad:r.campos['Age restriction']?.texto||'',sexo:r.campos.Sex?.texto||'',formulaciones:r.campos.Formulations?.texto||'',notas:r.campos['Additional notes']?.texto||'',limitaciones:r.campos['Therapeutic alternatives limitations'].texto,limitacionesInfantiles:r.campos['Therapeutic alternatives limitations for EMLc']?.texto||'',resumen:r.resumen});}
}
for(const g of grupos.values()){g.alternativas=[...new Set(g.alternativas)];assert.ok(g.alternativas.length);assert.ok(!g.alternativas.includes(g.base));}
const salida={revision:'2026-10-19',fuente:'https://list.essentialmeds.org/',edicion:'eEML consultada el 19/10/2026; lista modelo OMS 2025',licencia:'CC BY 3.0 IGO',atribucion:'WHO electronic Essential Medicines List (eEML), World Health Organization, 2020 (beta version 1.0). Licence: CC BY 3.0 IGO.',adaptacion:'Adaptación y traducción local, no creadas ni avaladas por la OMS. La OMS no responde por su contenido o exactitud. Prevalecen el original inglés y los PDF oficiales EML/EMLc 2025.',pdf:'https://iris.who.int/handle/10665/382243',medicamentos,grupos:[...grupos.values()],exclusiones};
salida.integridadFuente=crypto.createHash('sha256').update(fs.readFileSync(new URL('tmp/oms-eeml.html',raiz))).digest('hex');
const destino=process.argv.includes('--publicar-datos')?'consulta-medicamentos-oms-datos.js':'tmp/consulta-medicamentos-oms-datos-revision.js';
fs.writeFileSync(new URL(destino,raiz),'/* Datos OMS adaptados: ver atribución y límites en el objeto. No son recetas. */\nwindow.REFERENCIA_OMS_MEDICAMENTOS = '+JSON.stringify(salida,null,2)+';\n');
console.log(JSON.stringify({destino,medicamentos:medicamentos.length,indicaciones:grupos.size,relaciones:[...grupos.values()].reduce((n,g)=>n+g.alternativas.length,0)}));
