-- Salud a la Escuela comparte eventos y registros con las jornadas existentes.
-- Se conservan los datos de la persona atendida y se añaden los del representante y plantel.
alter table farmacia.jornadas_eventos drop constraint if exists jornadas_eventos_tipo_check;
alter table farmacia.jornadas_eventos add constraint jornadas_eventos_tipo_check
  check (tipo in ('jornadas', 'ruta_materna', 'salud_escuela'));

alter table farmacia.jornadas_registros drop constraint if exists jornadas_registros_conjunto_check;
alter table farmacia.jornadas_registros add constraint jornadas_registros_conjunto_check
  check (conjunto in ('jornadas', 'ruta_materna', 'salud_escuela'));

alter table farmacia.jornadas_registros
  add column if not exists representante_nombre text,
  add column if not exists representante_cedula text,
  add column if not exists comuna text,
  add column if not exists comunidad text,
  add column if not exists plantel text,
  add column if not exists seccion text;
