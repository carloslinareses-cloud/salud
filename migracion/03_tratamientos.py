# -*- coding: utf-8 -*-
"""Guarda el tratamiento cronico de cada paciente TAL COMO ESTA ESCRITO.

No se parte por "/" porque ese separador es ambiguo: tambien va dentro del
nombre (DESLORATADINA 0,5MG/ML). Se guarda el renglon completo y se enlaza
con un producto solo cuando el nombre coincide entero, sin adivinar.
"""
import sys, unicodedata, re
sys.path.insert(0, '.')
from comun import carga, limpia, inserta, cab_rest, URL, _pide

def clave(t):
    t = unicodedata.normalize('NFD', t or '')
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', t).strip().lower()

d = carga('pacientes.json')
est, r = _pide('%s/rest/v1/pacientes?select=id,origen_fila&limit=3000' % URL, cab=cab_rest())
porfila = {p['origen_fila']: p['id'] for p in (r or [])}
est, r = _pide('%s/rest/v1/productos?select=id,nombre&limit=2000' % URL, cab=cab_rest())
prod = {clave(p['nombre']): p['id'] for p in (r or [])}

filas, enlazados = [], 0
for p in d['pacientes']:
    t = limpia(p.get('tratamiento'))
    if not t: continue
    pid = porfila.get('Matriz fila %s' % p.get('fila'))
    if not pid: continue
    prid = prod.get(clave(t))
    if prid: enlazados += 1
    filas.append({'paciente_id': pid, 'producto_id': prid, 'texto_original': t})

ok, errs = inserta('tratamientos_paciente', filas)
print('tratamientos: %d cargados (insertados %d)' % (len(filas), ok))
print('  enlazados con un producto del catalogo: %d' % enlazados)
print('  quedan como texto para que un humano los enlace: %d' % (len(filas) - enlazados))
for e in errs[:2]: print('   error:', e)
