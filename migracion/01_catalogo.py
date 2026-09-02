# -*- coding: utf-8 -*-
"""Carga el catalogo de medicamentos y sus lotes.

REGLA: el nombre se guarda TAL COMO ESTA ESCRITO. Lo unico que se unifica es
la diferencia puramente cosmetica (acentos, mayusculas, espacios de mas):
"ACIDO VALPROICO 500mg" y "ÁCIDO VALPROÍCO 500mg" son la misma palabra.
NUNCA se unen dosis ni presentaciones distintas: 200mg no es 500mg.
"""
import sys, unicodedata, re
sys.path.insert(0, '.')
from comun import carga, limpia, inserta, consulta, cab_rest, URL, _pide

def clave(t):
    """Clave de comparacion: sin acentos, sin mayusculas, sin espacios de mas."""
    t = unicodedata.normalize('NFD', t or '')
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', t).strip().lower()

def num(x):
    try: return float(str(x).replace(',', '.'))
    except Exception: return None

pac, inv = carga('pacientes.json'), carga('datos.json')

filas = []
for c in pac['catalogo']:
    n = limpia(c.get('medicamento'))
    if n: filas.append({'nombre': n, 'lote': limpia(c.get('lote')), 'vence': c.get('vence'),
                        'cantidad': num(c.get('cantidad')), 'fuente': 'ARCHIVO GENERAL'})
for s in inv['stock']:
    n = limpia(s.get('articulo'))
    if n: filas.append({'nombre': n, 'lote': limpia(s.get('codigo')), 'vence': None,
                        'cantidad': num(s.get('almacen')) or num(s.get('entradas')),
                        'fuente': 'CONTROL E INVENTARIO'})
print('renglones leidos: %d' % len(filas))

INSUMOS = ('jeringa','gasa','algodon','guante','jelco','bolsa','mascara','microgotero',
           'lanceta','esparadrapo','sonda','cateter','aposito','tirilla','equipo de')

# --- productos, deduplicados por clave cosmetica ---
prods, porclave = [], {}
for f in filas:
    k = clave(f['nombre'])
    if k in porclave:
        f['clave'] = k; continue
    porclave[k] = f['nombre']
    f['clave'] = k
    prods.append({'nombre': f['nombre'],
                  'categoria': 'insumo' if any(p in k for p in INSUMOS) else 'medicamento'})

fusionados = len(filas) - len(prods)
ok, errs = inserta('productos', prods)
print('productos distintos: %d  (insertados %d)' % (len(prods), ok))
for e in errs[:3]: print('   error:', e)

est, r = _pide('%s/rest/v1/productos?select=id,nombre&limit=2000' % URL, cab=cab_rest())
idp = {clave(p['nombre']): p['id'] for p in (r or [])}
print('productos en la base: %d' % len(idp))

# --- lotes: identidad = producto + codigo + vencimiento ---
lotes, vistos = [], set()
sin_lote = sin_vence = 0
for f in filas:
    pid = idp.get(f['clave'])
    if not pid: continue
    k = (pid, (f['lote'] or '').lower(), f['vence'] or '')
    if k in vistos: continue
    vistos.add(k)
    if not f['lote']: sin_lote += 1
    if not f['vence']: sin_vence += 1
    lotes.append({'producto_id': pid, 'codigo': f['lote'], 'vence': f['vence'],
                  'nota': 'Cargado de ' + f['fuente']})

ok, errs = inserta('lotes', lotes)
print('lotes distintos: %d  (insertados %d)' % (len(lotes), ok))
print('   sin numero de lote: %d   sin fecha de vencimiento: %d' % (sin_lote, sin_vence))
for e in errs[:3]: print('   error:', e)

# --- existencia inicial como movimiento de entrada migrado (sin autor) ---
est, r = _pide('%s/rest/v1/lotes?select=id,producto_id,codigo,vence&limit=3000' % URL, cab=cab_rest())
idl = {(l['producto_id'], (l['codigo'] or '').lower(), l['vence'] or ''): l['id'] for l in (r or [])}

movs, sin_cant = [], 0
puestos = set()
for f in filas:
    pid = idp.get(f['clave'])
    if not pid: continue
    k = (pid, (f['lote'] or '').lower(), f['vence'] or '')
    lid = idl.get(k)
    if not lid or lid in puestos: continue
    if not f['cantidad'] or f['cantidad'] <= 0:
        sin_cant += 1; continue
    puestos.add(lid)
    movs.append({'lote_id': lid, 'tipo': 'entrada', 'cantidad': f['cantidad'],
                 'motivo': 'Existencia inicial cargada del Excel', 'origen': 'migracion_excel'})

ok, errs = inserta('movimientos', movs)
print('existencia inicial: %d lotes con cantidad (insertados %d), %d sin cantidad' % (len(movs), ok, sin_cant))
for e in errs[:3]: print('   error:', e)
print()
print('nombres unificados solo por acentos/mayusculas/espacios: %d' % fusionados)
