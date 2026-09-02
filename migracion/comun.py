# -*- coding: utf-8 -*-
"""Utilidades compartidas por los scripts de migracion."""
import json, urllib.request, urllib.error, re, unicodedata

import os

# El token NUNCA va escrito aqui. Se pasa por variable de entorno:
#   Windows :  set SUPABASE_TOKEN=sbp_...
#   Git Bash:  export SUPABASE_TOKEN=sbp_...
SB = os.environ.get('SUPABASE_TOKEN', '')
if not SB:
    raise SystemExit('Falta la variable SUPABASE_TOKEN. Ponla antes de correr el script.')
REF = os.environ.get('SUPABASE_REF', 'tfbzghjjfcaqmkzsxrrs')
URL = 'https://%s.supabase.co' % REF
DATOS = 'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/'
UA = {'User-Agent': 'curl/8', 'Accept': 'application/json', 'Content-Type': 'application/json'}

def _pide(url, datos=None, cab=None, metodo=None):
    h = dict(UA); h.update(cab or {})
    cuerpo = json.dumps(datos).encode() if datos is not None else None
    req = urllib.request.Request(url, data=cuerpo, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b[:300]

_srv = None
def servicio():
    """Clave de servicio: salta RLS. Solo para migrar, nunca en el navegador."""
    global _srv
    if _srv is None:
        _, ks = _pide('https://api.supabase.com/v1/projects/%s/api-keys?reveal=true' % REF,
                      cab={'Authorization': 'Bearer ' + SB})
        _srv = next(k['api_key'] for k in ks if k.get('name') == 'service_role')
    return _srv

def cab_rest():
    s = servicio()
    return {'apikey': s, 'Authorization': 'Bearer ' + s,
            'Accept-Profile': 'farmacia', 'Content-Profile': 'farmacia'}

def inserta(tabla, filas, conflicto=None, lote=400):
    """Inserta en bloques. Devuelve (insertadas, errores)."""
    ok, errs = 0, []
    cab = cab_rest()
    cab['Prefer'] = 'return=representation' + (',resolution=merge-duplicates' if conflicto else '')
    url = '%s/rest/v1/%s' % (URL, tabla) + ('?on_conflict=%s' % conflicto if conflicto else '')
    for i in range(0, len(filas), lote):
        est, r = _pide(url, filas[i:i+lote], cab)
        if est in (200, 201):
            ok += len(r or [])
        else:
            errs.append((i, est, str(r)[:220]))
    return ok, errs

def consulta(sql):
    est, r = _pide('https://api.supabase.com/v1/projects/%s/database/query' % REF, {'query': sql},
                   {'Authorization': 'Bearer ' + SB})
    return est, r

def limpia(t):
    """Quita espacios raros y caracteres invisibles. NO corrige contenido."""
    if t is None: return None
    t = str(t).replace('\u200b', '').replace('\u00a0', ' ')
    t = unicodedata.normalize('NFC', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t or None

def carga(nombre):
    import io
    return json.load(io.open(DATOS + nombre, encoding='utf-8'))


def trae_todo(tabla, campos, filtro='', pagina=1000):
    """Trae TODAS las filas paginando.

    La API de Supabase devuelve como maximo 1000 filas por consulta
    (max_rows). Pedir mas sin paginar da una lista incompleta en silencio,
    que es peor que un error: parece que funciono.
    """
    filas, desde = [], 0
    while True:
        cab = cab_rest()
        cab['Range-Unit'] = 'items'
        cab['Range'] = '%d-%d' % (desde, desde + pagina - 1)
        url = '%s/rest/v1/%s?select=%s%s' % (URL, tabla, campos, filtro)
        est, r = _pide(url, cab=cab)
        if not isinstance(r, list) or not r:
            break
        filas.extend(r)
        if len(r) < pagina:
            break
        desde += pagina
    return filas
