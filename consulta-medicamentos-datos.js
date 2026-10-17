/* Criterios conservadores del piloto. No son una receta ni equivalencias de dosis.
   Solo se reconocen principios expresos; nunca se adivina una marca o fórmula. */
window.GUIA_CONSULTA_MEDICAMENTOS = {
  revision: '2026-10-17',
  fuentes: [
    { nombre: 'FDA · requisitos de los genéricos', url: 'https://www.fda.gov/drugs/generic-drugs/generic-drugs-questions-answers' },
    { nombre: 'NHS · opciones para el dolor', url: 'https://www.nhs.uk/medicines/diclofenac/common-questions-about-diclofenac/' },
    { nombre: 'NHS · precauciones de los antiinflamatorios', url: 'https://www.nhs.uk/medicines/nsaids/' },
    { nombre: 'NHS · antihistamínicos', url: 'https://www.nhs.uk/medicines/antihistamines/' },
    { nombre: 'Neo Química · composición de Torsilax', url: 'https://www.neoquimica.com.br/nossas-marcas/bula/torsilax' }
  ],
  principios: ['ACICLOVIR','ACIDO ACETILSALICILICO','ACIDO FOLICO','ACIDO IBANDRONICO',
    'ACIDO TRANEXAMICO','ALBENDAZOL','ALENDRONATO','ALOPURINOL','ALPRAZOLAM',
    'AMBROXOL','AMIODARONA','AMITRIPTILINA','AMLODIPINA','AMOXICILINA','AMPICILINA',
    'ATENOLOL','ATORVASTATINA','AZITROMICINA','BETAMETASONA','BISOPROLOL','BROMHEXINA',
    'BUDESONIDA','CAPTOPRIL','CARBAMAZEPINA','CARVEDILOL','CEFALEXINA','CEFAZOLINA',
    'CEFTRIAXONA','CEFUROXIMA','CETIRIZINA','CIPROFLOXACINA','CLARITROMICINA',
    'CLINDAMICINA','CLONAZEPAM','CLOPIDOGREL','CLOTRIMAZOL','COLCHICINA','DESLORATADINA',
    'DEXAMETASONA','DIAZEPAM','DICLOXACILINA','DIGOXINA','DIMENHIDRINATO','DIPIRONA',
    'DOXICICLINA','ENALAPRIL','ENALAPRIL MALEATO','ESPIRONOLACTONA','ESOMEPRAZOL',
    'FENITOINA','FENOBARBITAL','FLUCONAZOL','FLUOXETINA','FUROSEMIDA','GABAPENTINA',
    'GENTAMICINA','GLIBENCLAMIDA','GLICLAZIDA','GLIMEPIRIDA','HALOPERIDOL',
    'HIDROCLOROTIAZIDA','HIDROCORTISONA','IBUPROFENO','IRBESARTAN','KETOCONAZOL',
    'KETOPROFENO','KETOROLACO','LANSOPRAZOL','LEVETIRACETAM','LEVOTIROXINA','LIDOCAINA',
    'LISINOPRIL','LORATADINA','LOSARTAN','MELOXICAM','MEMANTINA','MEROPENEM',
    'METAMIZOL','METFORMINA','METILDOPA','METILPREDNISOLONA','METOCLOPRAMIDA',
    'METRONIDAZOL','MONTELUKAST','NAPROXENO','NIFEDIPINA','NIFEDIPINO','NITAZOXANIDA',
    'NITROFURAZONA','OMEPRAZOL','ONDANSETRON','PANTOPRAZOL','PARACETAMOL','PREDNISOLONA',
    'PREGABALINA','QUETIAPINA','RANITIDINA','RIFAXIMINA','RISPERIDONA','RIVAROXABAN',
    'ROSUVASTATINA','SALBUTAMOL','SECNIDAZOL','SIMVASTATINA','SULFADIAZINA DE PLATA',
    'TAMSULOSINA','TRIMEBUTINA','VALPROATO DE SODIO','VALSARTAN','VANCOMICINA',
    'VERAPAMILO','VORICONAZOL'],
  dolor: ['PARACETAMOL','IBUPROFENO','DICLOFENAC POTASICO','DICLOFENAC SODICO','NAPROXENO'],
  alergia: ['CETIRIZINA','LORATADINA'],
  notaDolor: 'Solo dolor o fiebre en adultos, según el caso. El profesional debe revisar embarazo, alergias, úlcera, sangrado, enfermedad renal, cardíaca o hepática y otros tratamientos. No combinar diclofenaco, ibuprofeno y naproxeno entre sí. Paracetamol no sustituye el efecto antiinflamatorio y requiere revisar enfermedad hepática y productos combinados.',
  notaAlergia: 'Solo síntomas alérgicos en adultos, según valoración profesional. Revisar otros tratamientos, somnolencia, embarazo y enfermedad renal o hepática. No es una opción para tratar anafilaxia.'
};
