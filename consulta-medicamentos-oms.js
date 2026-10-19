/* Referencia internacional, no motor de prescripción. Las relaciones conservan
   la indicación y restricciones de una ficha OMS concreta, sin transitividad. */
(function () {
  'use strict';
  var datos = window.REFERENCIA_OMS_MEDICAMENTOS;
  if (!datos) return;
  function normalizar(s) { return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  var ids = new Map(datos.medicamentos.map(function(m) { return [m.id, m]; })), nombres = new Map();
  datos.medicamentos.forEach(function(m) {
    [m.nombre, m.nombreOriginal].concat(m.aliases).forEach(function(n) {
      var k = normalizar(n), anterior = nombres.get(k);
      // Una identidad ambigua no se resuelve de forma automática.
      if (!nombres.has(k)) nombres.set(k, m);
      else if (!anterior || anterior.id !== m.id) nombres.set(k, null);
    });
  });
  var traducciones = new Map((`Venous thromboembolism|Tromboembolismo venoso
Cerebral ischaemic stroke due to embolic occlusion|Ictus isquémico por oclusión embólica
Atrial fibrillation|Fibrilación auricular
Other specified atrial fibrillation|Fibrilación auricular, otras formas especificadas
Other specified diseases of arteries or arterioles|Otras enfermedades especificadas de arterias o arteriolas
Chronic obstructive pulmonary disease|Enfermedad pulmonar obstructiva crónica (EPOC)
Other specified malignant neoplasms of bronchus or lung|Neoplasias malignas especificadas de bronquio o pulmón
Other specified conjunctivitis|Conjuntivitis especificadas
Infectious blepharitis|Blefaritis infecciosa
Female infertility without specification whether primary or secondary|Infertilidad femenina
Systemic or invasive candidosis|Candidiasis sistémica o invasiva
Schizophrenia or other primary psychotic disorders|Esquizofrenia u otros trastornos psicóticos primarios
Schistosomiasis|Esquistosomiasis
Essential hypertension|Hipertensión arterial esencial
Mixed hyperlipidaemia|Hiperlipidemia mixta
Coronary atherosclerosis|Aterosclerosis coronaria
Muscle relaxants|Relajación muscular en el contexto anestésico indicado
Cycloplegic drug|Cicloplejía para uso oftálmico
Asthma|Asma
Constipation|Estreñimiento
Other specified benign neoplasm of endocrine glands|Neoplasias benignas especificadas de glándulas endocrinas
Anuria or oliguria|Anuria u oliguria
Oedema|Edema
Heart failure|Insuficiencia cardíaca
Opioid dependence|Dependencia de opioides
Psoriasis of unspecified type|Psoriasis
Type 2 diabetes mellitus|Diabetes mellitus tipo 2
Acute angle closure with pupillary block|Cierre angular agudo con bloqueo pupilar
Ocular hypertension|Hipertensión ocular
Primary open-angle glaucoma|Glaucoma primario de ángulo abierto
Thyrotoxicosis|Tirotoxicosis
Angina pectoris|Angina de pecho
Cardiac arrhythmia|Arritmia cardíaca
Axial spondyloarthritis|Espondiloartritis axial
Crohn disease site|Enfermedad de Crohn
Rheumatoid arthritis|Artritis reumatoide
Juvenile idiopathic arthritis|Artritis idiopática juvenil
Allergic or hypersensitivity conditions of unspecified type|Afecciones alérgicas o de hipersensibilidad
Infectious keratitis|Queratitis infecciosa
Trachoma|Tracoma
Generalised anxiety disorder|Trastorno de ansiedad generalizada
Coagulation defects, purpura or other haemorrhagic or related conditions|Defectos de coagulación y afecciones hemorrágicas relacionadas
Haemophilia B|Hemofilia B
Calcium deficiency|Deficiencia de calcio
Vitamin D deficiency|Deficiencia de vitamina D
Obstetric haemorrhage|Hemorragia obstétrica
Anterior uveitis|Uveítis anterior
Acute ischaemic heart disease|Cardiopatía isquémica aguda
Anaemia due to chronic disease|Anemia por enfermedad crónica
Other specified sickle cell disorders or other haemoglobinopathies|Trastornos falciformes u otras hemoglobinopatías especificadas
Thalassaemias|Talasemias
Status epilepticus|Estado epiléptico
Bacterial infection of joint|Infección bacteriana articular
Osteomyelitis or osteitis|Osteomielitis u osteítis
Bacterial cellulitis, erysipelas or lymphangitis|Celulitis bacteriana, erisipela o linfangitis
Sepsis without septic shock|Sepsis sin choque séptico
Other specified congenital anomaly of great arteries including arterial duct|Anomalías congénitas especificadas de grandes arterias, incluido el conducto arterial
Palliative care|Cuidados paliativos
Nausea or vomiting|Náuseas o vómitos
Human immunodeficiency virus disease without mention of tuberculosis or malaria, clinical stage unspecified|Enfermedad por VIH, sin tuberculosis o malaria indicadas
Migraine|Migraña
Malignant neoplasms of prostate|Neoplasias malignas de próstata
Acute pharyngitis|Faringitis aguda
Malignant neoplasms of breast|Neoplasias malignas de mama
Pain|Dolor
Peritoneal abscess|Absceso peritoneal
Neutropaenia|Neutropenia
Peritonitis|Peritonitis
Multi-drug resistant Mycobacterium tuberculosis|Tuberculosis multirresistente
Patent arterial duct|Persistencia del conducto arterial
Type 1 diabetes mellitus|Diabetes mellitus tipo 1
Povidone iodine|Antisepsia según el uso de povidona yodada indicado en la fuente
Contact with or exposure to human immunodeficiency virus|Contacto o exposición al VIH
Parkinson disease|Enfermedad de Parkinson
Anxiety|Ansiedad
Ulcerative colitis|Colitis ulcerosa
Postpartum haemorrhage|Hemorragia posparto
Lymphatic filariasis|Filariasis linfática
Onchocerciasis|Oncocercosis
Melanoma of skin|Melanoma cutáneo
Excessive menstruation with irregular cycle|Menstruación excesiva con ciclo irregular
Infectious diseases of external ear|Enfermedades infecciosas del oído externo
Plantar warts|Verrugas plantares
Anogenital warts|Verrugas anogenitales
Hypovolaemia|Hipovolemia
Pediculosis corporis|Pediculosis corporal
Pediculosis capitis|Pediculosis de la cabeza
Pthiriasis|Ladillas (ftiriasis)
Scabies|Escabiosis
Lymphoid leukaemia, not elsewhere classified|Leucemia linfoide no clasificada en otra categoría
Diffuse large B-cell lymphoma, not otherwise specified|Linfoma difuso de células B grandes
Chronic lymphocytic leukaemia or small lymphocytic lymphoma|Leucemia linfocítica crónica o linfoma linfocítico pequeño
Plasma cell myeloma|Mieloma de células plasmáticas
Anaplastic large cell lymphoma, ALK-negative|Linfoma anaplásico de células grandes ALK negativo
Anaplastic large cell lymphoma, ALK-positive|Linfoma anaplásico de células grandes ALK positivo
Langerhans cell histiocytosis|Histiocitosis de células de Langerhans
Hodgkin lymphoma|Linfoma de Hodgkin
Follicular lymphoma|Linfoma folicular
Adrenocortical insufficiency|Insuficiencia suprarrenal
Denatured alcohol|Antisepsia con alcohol desnaturalizado
Methicillin resistant Staphylococcus aureus|Infección por Staphylococcus aureus resistente a meticilina
Vancomycin resistant Staphylococcus aureus|Infección por Staphylococcus aureus resistente a vancomicina
Vancomycin resistant Enterococcus|Infección por enterococos resistentes a vancomicina
Anaesthetics and therapeutic gases|Anestesia y gases terapéuticos
Amoebiasis|Amebiasis
Zoster|Herpes zóster
Herpes simplex infections|Infecciones por herpes simple
Varicella|Varicela
Gastrointestinal bleeding|Hemorragia gastrointestinal
Peptic ulcer, site unspecified|Úlcera péptica
Gastro-oesophageal reflux disease|Reflujo gastroesofágico`).split('\n').map(function(l) { return l.split('|'); }));
  function indicacion(g) { return traducciones.get(g.indicacion) || 'Indicación específica: consultar el texto original de la OMS'; }
  function edad(g) {
    if (/applies only.*\bEMLc\b/i.test(g.notas)) return 'Alternativas limitadas al listado pediátrico (EMLc)';
    if (/applies only.*\bEML\b|does not apply.*\bEMLc\b/i.test(g.notas)) return 'Alternativas del listado de adultos; no extrapolar a niños';
    if (/^Adolescents and adults$/.test(g.edad)) return 'Adolescentes y adultos';
    if (/^Children/.test(g.edad)) return 'Solo población pediátrica de la fuente (1 mes a 12 años)';
    if (/^Newborn/.test(g.edad)) return 'Solo recién nacidos (menores de 1 mes)';
    if (/^Also recommended for children$/.test(g.edad)) return 'Adultos; uso pediátrico sujeto a las restricciones de la fuente';
    return 'Edad por confirmar en la fuente';
  }
  function via(g) {
    if (/oral/i.test(g.notas)) return 'Solo las formas orales autorizadas en esta relación';
    if (/Ophthalmological/i.test(g.seccion+' '+g.formulaciones)) return 'Uso oftálmico de la fuente';
    var vias=[];
    if (/\bOral\b/.test(g.formulaciones)) vias.push('oral');
    if (/Parenteral|General injections/.test(g.formulaciones)) vias.push('parenteral');
    if (/\bLocal\b/.test(g.formulaciones)) vias.push('local');
    return vias.length?'Vías en la fuente: '+vias.join(', ')+'; confirmar la presentación concreta':'Vía y presentación: confirmar en la fuente';
  }
  function limites(g) {
    var notas = [];
    if (g.restriccionEdad) notas.push('Restricción de edad: '+g.restriccionEdad.replace(/months?/g, 'meses').replace(/years?/g, 'años'));
    if (g.sexo && g.sexo!=='All') notas.push('Población especificada por la fuente: '+({'Male':'hombres','Female':'mujeres'}[g.sexo]||g.sexo)+'.');
    if (/applies only.*\bEML\b|does not apply.*\bEMLc\b/i.test(g.notas)) notas.push('Esta relación corresponde al listado de adultos; no extrapolar al pediátrico.');
    else if (/applies only.*\bEMLc\b/i.test(g.notas)) notas.push('Esta relación de alternativas corresponde únicamente al listado pediátrico, no al de adultos.');
    else if (/EMLc|children|child|newborn|neonat/i.test(g.notas+' '+g.limitacionesInfantiles)) notas.push('La autorización de alternativas difiere entre adultos y niños: no extrapolar a población pediátrica.');
    if (/second choice/i.test(g.notas)) notas.push('La fuente la considera una segunda opción, no la primera elección.');
    if (/oral/i.test(g.notas)) notas.push('La relación está limitada a las formas orales indicadas; no aplicarla a inyectables u otras vías.');
    if (/Atenolol/.test(g.notas)) notas.push('Atenolol no se debe usar como primera opción en hipertensión no complicada en mayores de 60 años.');
    if (/support programme/i.test(g.notas)) notas.push('Solo dentro de un programa de apoyo establecido.');
    if (/BMI/.test(g.notas)) notas.push('La fuente exige un índice de masa corporal ≥ 30 kg/m². Revisar además las comorbilidades y el protocolo.');
    if (/PD-L1|oncogene/i.test(g.notas)) notas.push('Tratamiento condicionado a biomarcadores y al contexto oncológico especificado en la fuente.');
    if (/short-term emergency/i.test(g.notas)) notas.push('Solo para el manejo de urgencia y a corto plazo de síntomas agudos y graves.');
    if (/high-risk patients/i.test(g.notas)) notas.push('La fuente limita este uso a pacientes de alto riesgo.');
    if (/biosimilar/i.test(g.notas)) notas.push('Confirmar la calidad y autorización del producto biológico o biosimilar.');
    if (g.clase) notas.push('La OMS admite alternativas de la clase '+g.clase+' para esta indicación. Se muestra una selección contrastada; la clasificación ATC no demuestra por sí sola sustitución ni disponibilidad comercial.');
    if (g.notas && !notas.length) notas.push('Hay condiciones adicionales: revisar las notas originales de la fuente antes de valorar el cambio.');
    notas.unshift(via(g));
    return notas;
  }
  function resolver(texto) { return nombres.get(normalizar(texto)) || null; }
  function buscar(texto) {
    var q = normalizar(texto);
    if (q.length < 3) return {exacta:null,sugerencias:[]};
    var concentraciones=q.match(/\d+(?:[.,]\d+)?\s*(?:MCG|MG|G)\b/g)||[];
    if(new Set(concentraciones).size>1)return {exacta:null,sugerencias:[]};
    var directa = resolver(q);
    // Una combinación solo se reconoce si coincide completa con una identidad publicada.
    if (!directa && /\+|\b(?:CON|PLUS|FORTE|XR|SR|LP|CR|MR|IV|IM)\b|AMPOLL|INYECT|JARABE|SUSPENSION|CREMA|GOTAS|LIBERACION|RETARD|ENTERIC|GASTRORRESIST|%|\bML\b/.test(q)) return {exacta:null,sugerencias:[]};
    if (!directa) {
      q=q.replace(/\b\d+(?:[.,]\d+)?\s*(?:MCG|MG|G)\b/g,'').replace(/\b(?:TABLETAS?|COMPRIMIDOS?|CAPSULAS?)\b/g,'').replace(/\s+/g,' ').trim();
      directa=resolver(q);
    }
    if (directa) return {exacta:directa,sugerencias:[]};
    return {exacta:null,sugerencias:datos.medicamentos.filter(function(m) { return [m.nombre,m.nombreOriginal].concat(m.aliases).some(function(n) { return normalizar(n).startsWith(q); }); }).slice(0,10)};
  }
  function alternativas(m) {
    var salida=new Map();
    datos.grupos.filter(function(g) { return g.base===m.id || g.alternativas.includes(m.id); }).forEach(function(g) {
      [g.base].concat(g.alternativas).filter(function(id) { return id!==m.id; }).forEach(function(id) {
        if(!salida.has(id)) salida.set(id,{medicamento:ids.get(id),ambitos:[]});
        salida.get(id).ambitos.push(g);
      });
    });
    return Array.from(salida.values()).sort(function(a,b) { return a.medicamento.nombre.localeCompare(b.medicamento.nombre,'es'); });
  }
  function productos(m,lista) {
    return lista.filter(function(p) {
      if(p.activo===false||p.insumo||p.inconsistente||!p.perfil?.completo)return false;
      var identificado=resolver(p.perfil.principio);
      return identificado?.id===m.id;
    });
  }
  window.CONSULTA_OMS_MEDICAMENTOS={datos:datos,buscar:buscar,resolver:resolver,alternativas:alternativas,productos:productos,indicacion:indicacion,edad:edad,via:via,limites:limites};
})();
