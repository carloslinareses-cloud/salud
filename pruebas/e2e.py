# -*- coding: utf-8 -*-
"""Pruebas de punta a punta contra la API real.

Comprueba lo que de verdad importa en una farmacia: que no se pueda
entregar un medicamento vencido, que nadie firme a nombre de otro, y que
cada perfil solo pueda hacer lo suyo.

Se corre con:
    set SUPABASE_TOKEN=sbp_...        (Windows)
    export SUPABASE_TOKEN=sbp_...     (Git Bash)
    python pruebas/e2e.py

Crea sus propios datos de prueba, con nombres que empiezan por ZZZ-PRUEBA,
y al terminar los deja desactivados. No toca el inventario real.
"""
import os, sys, json, secrets, urllib.request, urllib.error, datetime

TOKEN = os.environ.get('SUPABASE_TOKEN', '')
if not TOKEN:
    sys.exit('Falta la variable SUPABASE_TOKEN.')
REF = os.environ.get('SUPABASE_REF', 'tfbzghjjfcaqmkzsxrrs')
URL = 'https://%s.supabase.co' % REF
UA = {'User-Agent': 'curl/8', 'Accept': 'application/json', 'Content-Type': 'application/json'}

ok, mal, fallos = 0, 0, []

# Marca unica de esta corrida: cada ejecucion crea SUS datos y no
# reutiliza los de la anterior. Sin esto, la segunda vez que se corre
# el inventario ya viene descontado y las pruebas fallan sin motivo.
MARCA = secrets.token_hex(4).upper()


def pide(url, datos=None, cab=None, metodo=None):
    h = dict(UA); h.update(cab or {})
    cuerpo = json.dumps(datos).encode() if datos is not None else None
    req = urllib.request.Request(url, data=cuerpo, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b[:250]


def sql(q):
    return pide('https://api.supabase.com/v1/projects/%s/database/query' % REF, {'query': q},
                {'Authorization': 'Bearer ' + TOKEN})


def prueba(nombre, condicion, detalle=''):
    global ok, mal
    if condicion:
        ok += 1
        print('  OK    %s' % nombre)
    else:
        mal += 1
        fallos.append('%s  %s' % (nombre, detalle))
        print('  FALLA %s   %s' % (nombre, detalle))


def grupo(t):
    print('\n--- %s ---' % t)


# ------------------------------------------------------------------ claves
_, ks = pide('https://api.supabase.com/v1/projects/%s/api-keys?reveal=true' % REF,
             {'x': 1} if False else None, {'Authorization': 'Bearer ' + TOKEN})
ANON = next(k['api_key'] for k in ks if k['name'] == 'anon')
SRV = next(k['api_key'] for k in ks if k['name'] == 'service_role')
ADM = {'apikey': SRV, 'Authorization': 'Bearer ' + SRV, 'Content-Type': 'application/json'}


def crea_usuario(correo, rol):
    clave = 'Prueba-' + secrets.token_hex(5) + '9a'
    est, res = pide(URL + '/auth/v1/admin/users',
                    {'email': correo, 'password': clave, 'email_confirm': True}, ADM)
    if est in (200, 201) and res and res.get('id'):
        uid = res['id']
    else:
        _, l = pide(URL + '/auth/v1/admin/users?page=1&per_page=300', cab=ADM)
        uid = next(u['id'] for u in l['users'] if (u.get('email') or '').lower() == correo)
        pide(URL + '/auth/v1/admin/users/' + uid, {'password': clave, 'email_confirm': True},
             ADM, metodo='PUT')
    sql("insert into farmacia.perfiles (id,correo,nombre,rol,activo) "
        "values ('%s','%s','ZZZ-PRUEBA %s','%s',true) "
        "on conflict (id) do update set rol='%s', activo=true, nombre='ZZZ-PRUEBA %s';"
        % (uid, correo, rol, rol, rol, rol))
    return uid, clave


def entra(correo, clave):
    est, r = pide(URL + '/auth/v1/token?grant_type=password',
                  {'email': correo, 'password': clave}, {'apikey': ANON})
    if est != 200:
        return None
    return {'apikey': ANON, 'Authorization': 'Bearer ' + r['access_token'],
            'Accept-Profile': 'farmacia', 'Content-Profile': 'farmacia',
            'Content-Type': 'application/json', 'Prefer': 'return=representation'}


print('=' * 62)
print('PRUEBAS DE PUNTA A PUNTA · Farmacia Municipal')
print('=' * 62)

# ------------------------------------------------------------------ montaje
grupo('Preparando datos de prueba')
uid_d, cl_d = crea_usuario('zzz.despacho.%s@prueba.local' % MARCA.lower(), 'despacho')
uid_i, cl_i = crea_usuario('zzz.inventario.%s@prueba.local' % MARCA.lower(), 'inventario')
uid_x, cl_x = crea_usuario('zzz.inactivo.%s@prueba.local' % MARCA.lower(), 'despacho')
sql("update farmacia.perfiles set activo=false where correo='zzz.inactivo.%s@prueba.local';" % MARCA.lower())

hoy = datetime.date.today()
MED  = 'ZZZ-PRUEBA MEDICAMENTO ' + MARCA
PAC  = 'ZZZ-PRUEBA PACIENTE ' + MARCA
CDI  = 'ZZZ-PRUEBA CDI ' + MARCA
sql("""
insert into farmacia.productos (nombre, categoria) values ('{med}','medicamento');
insert into farmacia.lotes (producto_id, codigo, vence)
  select id,'ZZZ-BUENO','{bueno}' from farmacia.productos where nombre='{med}';
insert into farmacia.lotes (producto_id, codigo, vence)
  select id,'ZZZ-VENCIDO','{vencido}' from farmacia.productos where nombre='{med}';
insert into farmacia.movimientos (lote_id, tipo, cantidad, origen, motivo)
  select l.id,'entrada',100,'migracion_excel','carga de prueba'
    from farmacia.lotes l join farmacia.productos p on p.id=l.producto_id
   where p.nombre='{med}';
insert into farmacia.pacientes (nombre, nacionalidad, cedula, estado)
  values ('{pac}','V','{ced}','activo');
insert into farmacia.instituciones (nombre,tipo) values ('{cdi}','CDI');
""".format(med=MED, pac=PAC, cdi=CDI,
           ced=str(900000 + int(MARCA[:4], 16) % 99999)[:8],
           bueno=(hoy + datetime.timedelta(days=400)).isoformat(),
           vencido=(hoy - datetime.timedelta(days=40)).isoformat()))

_, r = sql("select l.id, l.codigo from farmacia.lotes l join farmacia.productos p on p.id=l.producto_id "
           "where p.nombre='%s';" % MED)
lotes = {x['codigo']: x['id'] for x in r}
_, r = sql("select id from farmacia.pacientes where nombre='ZZZ-PRUEBA PACIENTE' limit 1;")
pac = r[0]['id']
_, r = sql("select id from farmacia.instituciones where nombre='ZZZ-PRUEBA CDI' limit 1;")
inst = r[0]['id']
print('  datos listos')

# ------------------------------------------------------------------ acceso
grupo('Acceso')
D = entra('zzz.despacho.%s@prueba.local' % MARCA.lower(), cl_d)
I = entra('zzz.inventario.%s@prueba.local' % MARCA.lower(), cl_i)
prueba('el despachador entra', D is not None)
prueba('el de inventario entra', I is not None)

X = entra('zzz.inactivo.%s@prueba.local' % MARCA.lower(), cl_x)
if X:
    est, r = pide(URL + '/rest/v1/pacientes?select=id&limit=1', cab=X)
    prueba('un usuario DESACTIVADO no ve nada', not (isinstance(r, list) and len(r)),
           'devolvio %s' % str(r)[:60])
else:
    prueba('un usuario DESACTIVADO no ve nada', True)

est, r = pide(URL + '/rest/v1/pacientes?select=nombre&limit=1',
              cab={'apikey': ANON, 'Accept-Profile': 'farmacia'})
prueba('sin sesion no se ve nada', est >= 400 or r == [], 'HTTP %s' % est)

prueba('clave equivocada no entra', entra('zzz.despacho.%s@prueba.local' % MARCA.lower(), 'claveMala123') is None)

# ------------------------------------------------------------------ candados
grupo('Los candados del inventario')

est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'paciente', 'paciente_id': pac, 'origen': 'sistema',
               'clave_idempotencia': 'e2e-' + secrets.token_hex(6)}, D)
ent = r[0]['id'] if est in (200, 201) else None
prueba('el despachador registra una entrega', ent is not None, str(r)[:80])
if ent:
    prueba('la entrega la firma el servidor con SU nombre',
           r[0]['entregado_por'] == uid_d and 'despacho' in (r[0]['entregado_por_rol'] or ''),
           str(r[0].get('entregado_por_nombre')))

est, r = pide(URL + '/rest/v1/entrega_detalle',
              {'entrega_id': ent, 'lote_id': lotes['ZZZ-VENCIDO'], 'cantidad': 1}, D)
prueba('NO deja entregar de un lote VENCIDO', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/entrega_detalle',
              {'entrega_id': ent, 'lote_id': lotes['ZZZ-BUENO'], 'cantidad': 99999}, D)
prueba('NO deja dejar la existencia en negativo', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/entrega_detalle',
              {'entrega_id': ent, 'lote_id': lotes['ZZZ-BUENO'], 'cantidad': 4}, D)
prueba('una entrega valida si pasa', est in (200, 201), str(r)[:80])

_, r = sql("select coalesce(sum(cantidad),0)::int as s from farmacia.movimientos where lote_id='%s';"
           % lotes['ZZZ-BUENO'])
prueba('y descuenta del inventario (100 - 4 = 96)', r[0]['s'] == 96, 'quedo %s' % r[0]['s'])

# ------------------------------------------------------------------ suplantación
grupo('Nadie firma a nombre de otro')
est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'paciente', 'paciente_id': pac, 'origen': 'sistema',
               'entregado_por': uid_i,          # intenta firmar como el de inventario
               'clave_idempotencia': 'e2e-sup-' + secrets.token_hex(6)}, D)
if est in (200, 201):
    prueba('el servidor corrige la firma al usuario real', r[0]['entregado_por'] == uid_d,
           'quedo firmada por %s' % r[0]['entregado_por'])
    _, b = sql("select count(*) as n from farmacia.bitacora where operacion='INTENTO_SUPLANTACION';")
    prueba('y el intento queda anotado en la bitacora', b[0]['n'] > 0)
else:
    prueba('el intento de suplantar se rechaza', True)

# ------------------------------------------------------------------ permisos
grupo('Cada perfil hace solo lo suyo')
est, r = pide(URL + '/rest/v1/productos', {'nombre': 'ZZZ-NO DEBERIA ENTRAR ' + MARCA}, D)
prueba('despacho NO puede crear productos', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/movimientos',
              {'lote_id': lotes['ZZZ-BUENO'], 'tipo': 'ajuste', 'cantidad': 50, 'origen': 'sistema'}, D)
prueba('despacho NO puede ajustar existencias', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/productos', {'nombre': 'ZZZ-PRUEBA CREADO POR INVENTARIO ' + MARCA}, I)
prueba('inventario SI puede crear productos', est in (200, 201), str(r)[:70])

est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'paciente', 'paciente_id': pac, 'origen': 'sistema',
               'clave_idempotencia': 'e2e-inv-' + secrets.token_hex(6)}, I)
prueba('inventario NO puede entregar', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/bitacora', {'tabla': 'x', 'operacion': 'y'}, D)
prueba('nadie escribe en la bitacora', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/perfiles?id=eq.' + uid_d, {'rol': 'admin'}, dict(D, **{'X': '1'}),
              metodo='PATCH')
_, rr = sql("select rol from farmacia.perfiles where id='%s';" % uid_d)
prueba('nadie se asciende a si mismo a admin', rr[0]['rol'] == 'despacho',
       'quedo como %s' % rr[0]['rol'])

# ------------------------------------------------------------------ destinatarios
grupo('A quien se entrega')
est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'paciente', 'origen': 'sistema'}, D)
prueba('una entrega sin destinatario se rechaza', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'paciente', 'paciente_id': pac, 'institucion_id': inst,
               'origen': 'sistema'}, D)
prueba('no se puede poner paciente Y centro a la vez', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'institucion', 'institucion_id': inst, 'origen': 'sistema',
               'clave_idempotencia': 'e2e-cdi1-' + secrets.token_hex(6)}, D)
prueba('un CDI sin decir quien recibe se rechaza', est >= 400, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/entregas',
              {'tipo_destinatario': 'institucion', 'institucion_id': inst,
               'recibe_nombre': 'JUAN RECEPTOR DE PRUEBA', 'origen': 'sistema',
               'clave_idempotencia': 'e2e-cdi2-' + secrets.token_hex(6)}, D)
prueba('un CDI con receptor SI pasa', est in (200, 201), str(r)[:70])

# ------------------------------------------------------------------ trazabilidad
grupo('Trazabilidad')
_, r = sql("select count(*) as n from farmacia.bitacora where tabla='entregas';")
prueba('la bitacora registro las entregas', r[0]['n'] > 0)

est, r = sql("delete from farmacia.movimientos where lote_id='%s';" % lotes['ZZZ-BUENO'])
prueba('un movimiento no se puede borrar ni con permisos de servidor',
       est >= 400 or (isinstance(r, dict) and r.get('message')), str(r)[:70])

est, r = sql("update farmacia.bitacora set nota='alterado' where id=(select min(id) from farmacia.bitacora);")
prueba('la bitacora no se puede alterar ni con permisos de servidor',
       est >= 400 or (isinstance(r, dict) and r.get('message')), str(r)[:70])

# ------------------------------------------------------------------ clave
grupo('Cambio de contraseña obligatorio')

_, r = sql("select debe_cambiar_clave from farmacia.perfiles where id='%s';" % uid_d)
prueba('un usuario nuevo nace obligado a cambiar la clave', r[0]['debe_cambiar_clave'] is True)

nueva = 'Charallave' + secrets.token_hex(3) + '7'
est, r = pide(URL + '/auth/v1/user', {'password': nueva}, D, metodo='PUT')
prueba('puede cambiar su propia clave', est == 200, 'HTTP %s' % est)

est, r = pide(URL + '/rest/v1/perfiles?id=eq.' + uid_d,
              {'debe_cambiar_clave': False}, D, metodo='PATCH')
_, rr = sql("select debe_cambiar_clave, rol from farmacia.perfiles where id='%s';" % uid_d)
prueba('y al hacerlo se le quita la marca', rr[0]['debe_cambiar_clave'] is False)
prueba('sin poder cambiarse el rol de paso', rr[0]['rol'] == 'despacho',
       'quedo como %s' % rr[0]['rol'])

D2 = entra('zzz.despacho.%s@prueba.local' % MARCA.lower(), nueva)
prueba('entra con la clave nueva', D2 is not None)
prueba('y ya no entra con la vieja', entra('zzz.despacho.%s@prueba.local' % MARCA.lower(), cl_d) is None)

est, r = pide(URL + '/rest/v1/perfiles?id=eq.' + uid_i,
              {'debe_cambiar_clave': False}, D2, metodo='PATCH')
_, rr = sql("select debe_cambiar_clave from farmacia.perfiles where id='%s';" % uid_i)
prueba('no puede quitarle la marca a OTRO usuario', rr[0]['debe_cambiar_clave'] is True)

# ------------------------------------------------------------------ limpieza
grupo('Limpieza')
sql("""
update farmacia.perfiles set activo=false where correo like 'zzz.%@prueba.local';
update farmacia.productos set activo=false where nombre like 'ZZZ-%';
update farmacia.pacientes set estado='inactivo' where nombre like 'ZZZ-%';
update farmacia.instituciones set activo=false where nombre like 'ZZZ-%';
update farmacia.entregas set anulada=true, anulada_motivo='Entrega de prueba automatica'
 where clave_idempotencia like 'e2e-%';
""")
print('  usuarios, productos y entregas de prueba desactivados')

print('\n' + '=' * 62)
if mal:
    print('FALLARON %d de %d' % (mal, ok + mal))
    for f in fallos: print('   - ' + f)
    sys.exit(1)
print('Pasaron las %d pruebas.' % ok)
