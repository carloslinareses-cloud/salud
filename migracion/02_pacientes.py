# -*- coding: utf-8 -*-
"""Carga los pacientes. NINGUNO se pierde y NINGUNO se corrige solo.

Lo que se puede leer con certeza entra como 'activo'.
Lo dudoso entra como 'por_revisar', con el dato original intacto en
cedula_cruda y el motivo escrito, para que un humano lo resuelva en pantalla.
"""
import sys, re, collections, unicodedata
sys.path.insert(0, '.')
from comun import carga, limpia, inserta

d = carga('pacientes.json')
pac = d['pacientes']
print('pacientes en el Excel: %d' % len(pac))

CED = re.compile(r'^([VvEe])?\s*[-.]?\s*(\d{6,9})$')   # 6 digitos SI: hay abuelos de 1930-1949

def parte_cedula(cruda):
    """Devuelve (nacionalidad, numero) o (None, None) si no es una cedula."""
    if not cruda: return None, None
    t = re.sub(r'[\s.]', '', str(cruda)).replace(',', '')
    m = CED.match(t)
    if not m: return None, None
    return (m.group(1) or 'V').upper(), m.group(2).lstrip('0') or m.group(2)

def limpia_sexo(s):
    s = limpia(s)
    if not s: return None
    s = s.strip().upper()[:1]
    return s if s in ('F', 'M') else None

def fecha(f):
    """Lee la fecha en los formatos en que de verdad viene escrita.
    Leer 30/03/1975 no es inventar nada: es la misma fecha en otro formato.
    Lo que NO se arregla es lo imposible (3/4/19633, 11/110/1986): eso se marca."""
    if not f: return None
    t = re.sub(r'\s+', '', str(f))
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', t)
    if m:
        a, me, d = m.groups()
    else:
        m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$', t)   # dia/mes/ano
        if not m: return None
        d, me, a = m.groups()
    try:
        import datetime
        f2 = datetime.date(int(a), int(me), int(d))
    except ValueError:
        return None
    if not (1900 <= f2.year <= 2026): return None
    return f2.isoformat()

# --- primera pasada: clasificar ---
prep = []
for p in pac:
    nom = limpia(p.get('nombre'))
    cruda = limpia(p.get('cedula'))
    nac, num = parte_cedula(cruda)
    motivos = []
    if not nom: motivos.append('sin nombre')
    if not num: motivos.append('la cédula no es una cédula')
    if p.get('fecha_nac') and not fecha(p.get('fecha_nac')): motivos.append('fecha de nacimiento ilegible')
    prep.append({'nombre': nom or '(sin nombre)', 'nacionalidad': nac, 'cedula': num,
                 'cedula_cruda': cruda, 'sexo': limpia_sexo(p.get('sexo')),
                 'fecha_nac': fecha(p.get('fecha_nac')), 'telefono': limpia(p.get('telefono')),
                 'direccion': limpia(p.get('direccion')), 'origen_fila': 'Matriz fila %s' % p.get('fila'),
                 '_motivos': motivos, '_trat': limpia(p.get('tratamiento'))})

# --- segunda pasada: choques de cedula ---
porced = collections.defaultdict(list)
for x in prep:
    if x['cedula']: porced[(x['nacionalidad'], x['cedula'])].append(x)

def nom_clave(n):
    n = unicodedata.normalize('NFD', n or '')
    return ''.join(c for c in n if unicodedata.category(c) != 'Mn').upper().strip()

repetidas = exactos = 0
for k, grupo in porced.items():
    if len(grupo) < 2: continue
    nombres = {nom_clave(g['nombre']) for g in grupo}
    if len(nombres) == 1:
        # misma persona escrita dos veces: se queda una, las otras se marcan
        exactos += len(grupo) - 1
        for g in grupo[1:]:
            g['_motivos'].append('fila repetida de la misma persona')
    else:
        repetidas += len(grupo)
        for g in grupo:
            g['_motivos'].append('la misma cédula aparece con otro nombre')

# --- armar filas finales ---
filas = []
for x in prep:
    m = x.pop('_motivos'); x.pop('_trat')
    if m:
        x['estado'] = 'por_revisar'
        x['motivo_revision'] = '; '.join(m)
        x['cedula'] = None          # no ocupa la cedula hasta que se aclare
        x['nacionalidad'] = None
    else:
        x['estado'] = 'activo'
        x['motivo_revision'] = None
    filas.append(x)

act = sum(1 for f in filas if f['estado'] == 'activo')
rev = len(filas) - act
print('  entran activos      : %d' % act)
print('  entran por revisar  : %d' % rev)
print('    · cédula que no es cédula     : %d' % sum(1 for f in filas if f['motivo_revision'] and 'no es una cédula' in f['motivo_revision']))
print('    · misma cédula, otro nombre   : %d' % repetidas)
print('    · fila repetida               : %d' % exactos)
print('    · fecha de nacimiento ilegible: %d' % sum(1 for f in filas if f['motivo_revision'] and 'ilegible' in f['motivo_revision']))
print('  NINGUNO se descarta: %d = %d' % (len(filas), len(pac)))

ok, errs = inserta('pacientes', filas)
print('\ninsertados: %d' % ok)
for e in errs[:3]: print('   error:', e)
