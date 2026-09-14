import { createRequire } from 'node:module'
const REF = 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(t.slice(0, 500))
  try { return JSON.parse(t) } catch { return [] }
}

const q = `
alter table farmacia.pacientes add column if not exists edad_texto text;

create or replace view farmacia.v_pacientes_ficha as
select p.id, p.nombre, p.nacionalidad, p.cedula, p.cedula_cruda, p.rif_digito, p.sexo,
    p.fecha_nac,
    case when p.fecha_nac is not null then extract(year from age(p.fecha_nac::timestamp with time zone))::integer else null::integer end as edad,
    p.telefono, p.direccion, p.estado, p.motivo_revision,
    coalesce(t.medicamentos, 0::bigint) as medicamentos,
    coalesce(e.entregas, 0::bigint) as entregas,
    e.ultima_entrega,
    farmacia.sin_acentos(upper(p.nombre)) as busqueda,
    coalesce(d.patologias, ''::text) as patologias,
    coalesce(d.n_patologias, 0) as n_patologias,
    coalesce(s.solicitudes, 0) as solicitudes,
    s.ultima_via, s.ultimo_motivo, s.ultima_solicitud,
    p.edad_texto
   from farmacia.pacientes p
     left join ( select tratamientos_paciente.paciente_id, count(*) as medicamentos
           from farmacia.tratamientos_paciente
          where tratamientos_paciente.activo
          group by tratamientos_paciente.paciente_id) t on t.paciente_id = p.id
     left join ( select entregas.paciente_id, count(*) as entregas, max(entregas.fecha) as ultima_entrega
           from farmacia.entregas
          where entregas.paciente_id is not null and not coalesce(entregas.anulada, false)
          group by entregas.paciente_id) e on e.paciente_id = p.id
     left join ( select patologias_paciente.paciente_id,
            string_agg(upper(trim(both from patologias_paciente.patologia)), ' · ' order by upper(trim(both from patologias_paciente.patologia))) as patologias,
            count(*)::integer as n_patologias
           from farmacia.patologias_paciente
          where patologias_paciente.activo
          group by patologias_paciente.paciente_id) d on d.paciente_id = p.id
     left join ( select z.paciente_id, z.solicitudes, z.via as ultima_via, z.motivo as ultimo_motivo, z.creado_en as ultima_solicitud
           from ( select distinct on (solicitudes.paciente_id) solicitudes.paciente_id,
                    solicitudes.via, solicitudes.motivo, solicitudes.creado_en,
                    count(*) over (partition by solicitudes.paciente_id)::integer as solicitudes
                   from farmacia.solicitudes
                  where solicitudes.activa
                  order by solicitudes.paciente_id, solicitudes.creado_en desc) z) s on s.paciente_id = p.id
  where p.estado <> 'inactivo';
`

const r = await sql(q)
console.log('RESULT:', JSON.stringify(r))
