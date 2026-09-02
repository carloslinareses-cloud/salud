# -*- coding: utf-8 -*-
"""Traspasa el historial de entregas del Excel.

Entran SOLO PARA CONSULTA: no descuentan del inventario, porque el 87% de
los registros no anota la cantidad. Descontarlos seria inventar numeros.

Los pacientes que aparecen en el historial y no estaban en el registro se
dan de alta, porque el registro diario tiene gente que la Matriz no tiene.
"""
import sys, re, datetime, collections
sys.path.insert(0, '.')
from comun import carga, limpia, inserta, cab_rest, URL, _pide, trae_todo

def fecha(f):
    """Lee la fecha en los formatos en que viene. Lo imposible se deja vacio."""
    if not f: return None
    t = re.sub(r'\s+', '', str(f))
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', t)
    if m: a, me, d = m.groups()
    else:
        m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$', t)
        if m:
            d, me, a = m.groups()
        else:
            # ano de dos cifras: 19/01/26 es enero de 2026. El registro es de
            # este ano, asi que no hay ambiguedad. Leerlo no es inventarlo.
            m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$', t)
            if not m: return None
            d, me, a2 = m.groups()
            a = '20' + a2
    try: f2 = datetime.date(int(a), int(me), int(d))
    except ValueError: return None
    return f2.isoformat() if 2000 <= f2.year <= 2026 else None

def cedula(c):
    if not c: return None
    t = re.sub(r'[\s.\-]', '', str(c))
    m = re.match(r'^([VvEe])?(\d{6,9})$', t)
    return (m.group(1) or 'V').upper() + '|' + m.group(2) if m else None

def sexo(s):
    s = limpia(s)
    if not s: return None
    s = s.strip().upper()[:1]
    return s if s in ('F', 'M') else None

hist = carga('historial.json')
print('entregas en el Excel: %d' % len(hist))

# ---- pacientes que ya existen, por cedula
r = trae_todo('pacientes', 'id,nacionalidad,cedula', '&cedula=not.is.null')
porced = {(p['nacionalidad'] or 'V') + '|' + p['cedula']: p['id'] for p in r}
print('pacientes ya registrados con cedula: %d' % len(porced))

# ---- dar de alta a los que faltan
nuevos, vistos = [], set()
for h in hist:
    k = cedula(h.get('cedula'))
    nom = limpia(h.get('nombre'))
    if not k or k in porced or k in vistos or not nom: continue
    vistos.add(k)
    nac, num = k.split('|')
    nuevos.append({'nombre': nom, 'nacionalidad': nac, 'cedula': num,
                   'cedula_cruda': limpia(h.get('cedula')), 'sexo': sexo(h.get('sexo')),
                   'telefono': limpia(h.get('telefono')), 'direccion': limpia(h.get('direccion')),
                   'estado': 'activo',
                   'origen_fila': '%s fila %s' % (h['fuente'], h['fila'])})

ok, errs = inserta('pacientes', nuevos)
print('pacientes nuevos que aporta el historial: %d (insertados %d)' % (len(nuevos), ok))
for e in errs[:3]: print('   error:', e)

r = trae_todo('pacientes', 'id,nacionalidad,cedula', '&cedula=not.is.null')
porced = {(p['nacionalidad'] or 'V') + '|' + p['cedula']: p['id'] for p in r}

# ---- las entregas
filas, sin_pac, sin_fecha = [], 0, 0
huerfanos, rescatados = {}, set()
for h in hist:
    k = cedula(h.get('cedula'))
    pid = porced.get(k) if k else None
    if not pid:
        # Sin cedula utilizable, pero SI hay nombre: se registra a la persona
        # marcada para revisar, con lo que decia la celda intacto. Nada se pierde.
        nom = limpia(h.get('nombre'))
        if not nom:
            sin_pac += 1
            continue
        clave_nom = nom.upper()
        pid = huerfanos.get(clave_nom)
        if not pid:
            est2, np = _pide('%s/rest/v1/pacientes' % URL,
                {'nombre': nom, 'cedula_cruda': limpia(h.get('cedula')),
                 'estado': 'por_revisar',
                 'motivo_revision': 'aparece en el historial sin una cédula utilizable',
                 'sexo': sexo(h.get('sexo')), 'telefono': limpia(h.get('telefono')),
                 'direccion': limpia(h.get('direccion')),
                 'origen_fila': '%s fila %s' % (h['fuente'], h['fila'])},
                dict(cab_rest(), **{'Prefer': 'return=representation'}))
            if est2 not in (200, 201) or not np:
                sin_pac += 1
                continue
            pid = np[0]['id']
            huerfanos[clave_nom] = pid
            rescatados.add(clave_nom)
    f = fecha(h.get('fecha'))
    if not f: sin_fecha += 1
    lo = limpia(h.get('tratamiento')) or ''
    if h.get('cantidad'): lo += '  ·  cantidad anotada: ' + str(h['cantidad'])
    filas.append({'tipo_destinatario': 'paciente', 'paciente_id': pid,
                  'fecha': f, 'fecha_original': limpia(h.get('fecha')),
                  'observacion': lo[:2000], 'origen': 'migracion_excel',
                  'origen_fila': '%s fila %s' % (h['fuente'], h['fila'])})

ok, errs = inserta('entregas', filas, lote=300)
print()
print('entregas traspasadas: %d (insertadas %d)' % (len(filas), ok))
print('   sin fecha legible, se guarda lo que decia: %d' % sin_fecha)
print('   sin cedula: se registro a la persona para revisar : %d' % len(rescatados))
print('   sin nombre ni cedula, imposible ubicar            : %d' % sin_pac)
for e in errs[:3]: print('   error:', e)
