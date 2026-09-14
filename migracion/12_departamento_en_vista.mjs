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
create or replace view farmacia.v_entregas_renglon as
 SELECT e.id AS entrega_id,
    e.fecha,
    e.fecha_original,
    e.creado_en,
    e.origen,
    e.anulada,
    e.anulada_motivo,
    e.observacion AS lo_entregado,
    COALESCE(e.entregado_por_nombre, 'No consta (viene del Excel)'::text) AS entregado_por,
    e.entregado_por_rol,
    e.tipo_destinatario,
    e.paciente_id,
    e.institucion_id,
    COALESCE(p.nombre, i.nombre) AS destinatario,
        CASE
            WHEN e.tipo_destinatario = 'institucion'::text THEN i.tipo
            ELSE NULL::text
        END AS centro_tipo,
    p.nacionalidad,
    p.cedula,
    e.recibe_nombre,
    e.recibe_cedula,
    d.id AS renglon_id,
    d.cantidad,
    pr.id AS producto_id,
    pr.nombre AS producto,
    pr.dosificacion,
    pr.presentacion,
    pr.categoria,
    pr.unidad,
    pr.empaque,
    pr.unidades_por_empaque,
    farmacia.en_cajas(d.cantidad, pr.unidades_por_empaque, pr.empaque) AS en_cajas,
    l.codigo AS lote,
    l.vence,
    e.departamento
   FROM farmacia.entregas e
     LEFT JOIN farmacia.pacientes p ON p.id = e.paciente_id
     LEFT JOIN farmacia.instituciones i ON i.id = e.institucion_id
     LEFT JOIN farmacia.entrega_detalle d ON d.entrega_id = e.id
     LEFT JOIN farmacia.lotes l ON l.id = d.lote_id
     LEFT JOIN farmacia.productos pr ON pr.id = l.producto_id;
`

const r = await sql(q)
console.log('RESULT:', JSON.stringify(r))
