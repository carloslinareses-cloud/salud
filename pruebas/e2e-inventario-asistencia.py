# -*- coding: utf-8 -*-
"""Auditoría real de los cambios del 21/09/2026 contra Supabase.

Usa usuarios y datos ZZZ temporales, comprueba los permisos de Administración
e Inventario y limpia todo al finalizar.
"""
import datetime
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TOKEN = os.environ.get('SUPABASE_TOKEN', '')
if not TOKEN:
    sys.exit('Falta la variable SUPABASE_TOKEN.')
REF = os.environ.get('SUPABASE_REF', 'tfbzghjjfcaqmkzsxrrs')
URL = 'https://%s.supabase.co' % REF
UA = {'User-Agent': 'curl/8', 'Accept': 'application/json', 'Content-Type': 'application/json'}
MARCA = secrets.token_hex(4).upper()
ok, mal, fallos = 0, 0, []
usuarios = []


def pide(url, datos=None, cab=None, metodo=None):
    h = dict(UA); h.update(cab or {})
    cuerpo = json.dumps(datos).encode() if datos is not None else None
    req = urllib.request.Request(url, data=cuerpo, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            texto = r.read().decode()
            return r.status, json.loads(texto) if texto.strip() else None
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
        try:
            return e.code, json.loads(texto)
        except Exception:
            return e.code, texto[:500]


def sql(consulta):
    return pide('https://api.supabase.com/v1/projects/%s/database/query' % REF,
                {'query': consulta}, {'Authorization': 'Bearer ' + TOKEN})


def prueba(nombre, condicion, detalle=''):
    global ok, mal
    if condicion:
        ok += 1
        print('  OK    ' + nombre)
    else:
        mal += 1
        fallos.append('%s  %s' % (nombre, detalle))
        print('  FALLA %s   %s' % (nombre, detalle))


_, llaves = pide('https://api.supabase.com/v1/projects/%s/api-keys?reveal=true' % REF,
                 cab={'Authorization': 'Bearer ' + TOKEN})
ANON = next(k['api_key'] for k in llaves if k['name'] == 'anon')
SRV = next(k['api_key'] for k in llaves if k['name'] == 'service_role')
ADM = {'apikey': SRV, 'Authorization': 'Bearer ' + SRV, 'Content-Type': 'application/json'}


def crea_usuario(rol):
    correo = 'zzz.%s.%s@prueba.local' % (rol, MARCA.lower())
    clave = 'Prueba-' + secrets.token_hex(5) + '9a'
    est, res = pide(URL + '/auth/v1/admin/users',
                    {'email': correo, 'password': clave, 'email_confirm': True}, ADM)
    if est not in (200, 201) or not res or not res.get('id'):
        raise RuntimeError('No se pudo crear el usuario %s: HTTP %s %s' % (rol, est, str(res)[:200]))
    uid = res['id']
    usuarios.append(uid)
    est, res = sql("insert into farmacia.perfiles (id,correo,nombre,rol,activo,debe_cambiar_clave) "
                   "values ('%s','%s','ZZZ-PRUEBA %s','%s',true,false) "
                   "on conflict (id) do update set rol='%s',activo=true,debe_cambiar_clave=false;"
                   % (uid, correo, rol.upper(), rol, rol))
    if est not in (200, 201):
        raise RuntimeError('No se pudo preparar el perfil %s: %s' % (rol, str(res)[:200]))
    est, sesion = pide(URL + '/auth/v1/token?grant_type=password',
                       {'email': correo, 'password': clave}, {'apikey': ANON})
    if est != 200:
        raise RuntimeError('No se pudo iniciar sesión como %s: HTTP %s' % (rol, est))
    return uid, {
        'apikey': ANON, 'Authorization': 'Bearer ' + sesion['access_token'],
        'Accept-Profile': 'farmacia', 'Content-Profile': 'farmacia',
        'Content-Type': 'application/json', 'Prefer': 'return=representation'
    }


def filtro(valor):
    return urllib.parse.quote(str(valor), safe='')


def hora_caracas(valor):
    if not valor:
        return ''
    momento = datetime.datetime.fromisoformat(str(valor).replace('Z', '+00:00'))
    return momento.astimezone(datetime.timezone(datetime.timedelta(hours=-4))).strftime('%H:%M')


def crud_catalogo(nombre_rol, cab):
    nombre = 'ZZZ-CRUD-%s-%s' % (nombre_rol.upper(), MARCA)
    est, res = pide(URL + '/rest/v1/productos',
                    {'nombre': nombre, 'categoria': 'medicamento', 'stock_minimo': 2}, cab)
    producto = res[0] if est in (200, 201) and isinstance(res, list) and res else None
    prueba('%s crea un producto' % nombre_rol, producto is not None, 'HTTP %s %s' % (est, str(res)[:120]))
    if not producto:
        return
    pid = producto['id']

    est, res = pide(URL + '/rest/v1/productos?id=eq.' + filtro(pid) + '&select=id,nombre,stock_minimo', cab=cab)
    prueba('%s consulta el producto creado' % nombre_rol,
           est == 200 and res and res[0]['nombre'] == nombre, 'HTTP %s %s' % (est, str(res)[:120]))

    est, res = pide(URL + '/rest/v1/productos?id=eq.' + filtro(pid),
                    {'stock_minimo': 7, 'presentacion': 'PRUEBA'}, cab, metodo='PATCH')
    prueba('%s corrige los datos del producto' % nombre_rol,
           est == 200 and res and res[0]['stock_minimo'] == 7, 'HTTP %s %s' % (est, str(res)[:120]))

    est, res = pide(URL + '/rest/v1/lotes',
                    {'producto_id': pid, 'codigo': 'ZZZ-' + MARCA, 'vence': '2028-12-31'}, cab)
    lote = res[0] if est in (200, 201) and isinstance(res, list) and res else None
    prueba('%s crea un lote' % nombre_rol, lote is not None, 'HTTP %s %s' % (est, str(res)[:120]))
    if lote:
        lid = lote['id']
        est, res = pide(URL + '/rest/v1/lotes?id=eq.' + filtro(lid),
                        {'vence': '2029-01-31'}, cab, metodo='PATCH')
        prueba('%s corrige el lote' % nombre_rol,
               est == 200 and res and res[0]['vence'] == '2029-01-31', 'HTTP %s %s' % (est, str(res)[:120]))
        est, _ = pide(URL + '/rest/v1/lotes?id=eq.' + filtro(lid), cab=cab, metodo='DELETE')
        _, queda = sql("select count(*)::int n from farmacia.lotes where id='%s';" % lid)
        prueba('%s borra el lote vacío y sin historia' % nombre_rol,
               est in (200, 204) and queda[0]['n'] == 0, 'HTTP %s, quedan %s' % (est, queda[0]['n']))

    est, _ = pide(URL + '/rest/v1/productos?id=eq.' + filtro(pid), cab=cab, metodo='DELETE')
    _, queda = sql("select count(*)::int n from farmacia.productos where id='%s';" % pid)
    prueba('%s borra el producto ya vacío' % nombre_rol,
           est in (200, 204) and queda[0]['n'] == 0, 'HTTP %s, quedan %s' % (est, queda[0]['n']))


print('=' * 68)
print('AUDITORÍA REAL · CRUD DE INVENTARIO Y ASISTENCIA MANUAL')
print('=' * 68)

cedula = str(9100000 + int(MARCA[:5], 16) % 899999)
fecha = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()

try:
    uid_admin, A = crea_usuario('admin')
    uid_inv, I = crea_usuario('inventario')

    print('\n--- CRUD real del catálogo ---')
    crud_catalogo('Administración', A)
    crud_catalogo('Inventario', I)

    print('\n--- Asistencia manual real ---')
    est, res = pide(URL + '/rest/v1/rpc/asis_admin_crear_personal', {
        'p_cedula': cedula, 'p_nombre': 'ZZZ-PRUEBA ASISTENCIA ' + MARCA,
        'p_telefono': None, 'p_correo': None, 'p_clave_inicial': 'Prueba123'
    }, A)
    prueba('Administración crea la persona temporal', est == 200 and res is True,
           'HTTP %s %s' % (est, str(res)[:120]))

    est, res = pide(URL + '/rest/v1/rpc/asis_admin_registrar_manual', {
        'p_cedula': cedula, 'p_fecha': fecha, 'p_hora_entrada': '08:10',
        'p_hora_salida': None, 'p_motivo': 'Prueba controlada sin conexión'
    }, A)
    prueba('Administración registra una entrada manual', est == 200 and res,
           'HTTP %s %s' % (est, str(res)[:160]))

    est, res = pide(URL + '/rest/v1/rpc/asis_admin_registrar_manual', {
        'p_cedula': cedula, 'p_fecha': fecha, 'p_hora_entrada': '08:15',
        'p_hora_salida': '17:20', 'p_motivo': 'Corrección controlada de las horas'
    }, A)
    prueba('Administración corrige entrada y salida con la misma pantalla', est == 200 and res,
           'HTTP %s %s' % (est, str(res)[:160]))

    est, filas = pide(URL + '/rest/v1/v_asistencia?cedula=eq.' + cedula + '&fecha=eq.' + fecha +
                      '&select=hora_entrada,hora_salida,nota_correccion,corregido_por,dentro_sede_entrada', cab=A)
    fila = filas[0] if est == 200 and filas else {}
    prueba('las horas corregidas quedaron guardadas',
           hora_caracas(fila.get('hora_entrada')) == '08:15' and hora_caracas(fila.get('hora_salida')) == '17:20',
           str(fila))
    prueba('el cambio identifica al administrador y conserva el motivo',
           fila.get('corregido_por') == uid_admin and 'Corrección controlada' in (fila.get('nota_correccion') or ''),
           str(fila))
    prueba('el registro manual no inventa una ubicación GPS', fila.get('dentro_sede_entrada') is None, str(fila))

    est, res = pide(URL + '/rest/v1/rpc/asis_admin_registrar_manual', {
        'p_cedula': cedula, 'p_fecha': fecha, 'p_hora_entrada': '09:00',
        'p_hora_salida': None, 'p_motivo': 'Intento desde el rol inventario'
    }, I)
    prueba('Inventario no puede modificar asistencia', est >= 400, 'HTTP %s %s' % (est, str(res)[:120]))

    _, filas = sql("select count(*)::int n from farmacia.bitacora where usuario_id='%s' "
                   "and tabla='asistencia_registros' and operacion in ('INSERT','UPDATE');" % uid_admin)
    prueba('alta y corrección quedaron en la bitácora', filas[0]['n'] >= 2, str(filas))
finally:
    print('\n--- Limpieza de la auditoría ---')
    ids = "','".join(usuarios) if usuarios else '00000000-0000-0000-0000-000000000000'
    est, res = sql("""
begin;
set local session_replication_role = replica;
delete from farmacia.bitacora where usuario_id in ('%s');
delete from farmacia.asistencia_registros where cedula='%s';
delete from farmacia.asistencia_personal where cedula='%s';
delete from farmacia.lotes where producto_id in (select id from farmacia.productos where nombre like 'ZZZ-CRUD-%%-%s');
delete from farmacia.productos where nombre like 'ZZZ-CRUD-%%-%s';
delete from farmacia.perfiles where id in ('%s');
set local session_replication_role = origin;
commit;
""" % (ids, cedula, cedula, MARCA, MARCA, ids))
    for uid in usuarios:
        pide(URL + '/auth/v1/admin/users/' + uid, cab=ADM, metodo='DELETE')
    _, resto = sql("select "
                   "(select count(*) from farmacia.asistencia_personal where cedula='%s') + "
                   "(select count(*) from farmacia.productos where nombre like 'ZZZ-CRUD-%%-%s') + "
                   "(select count(*) from farmacia.perfiles where id in ('%s')) as n;" % (cedula, MARCA, ids))
    prueba('la auditoría no dejó datos temporales', resto and resto[0]['n'] == 0, str(resto))

print('\n' + '=' * 68)
if mal:
    print('FALLARON %d de %d' % (mal, ok + mal))
    for fallo in fallos:
        print('   - ' + fallo)
    sys.exit(1)
print('Pasaron las %d pruebas reales.' % ok)
