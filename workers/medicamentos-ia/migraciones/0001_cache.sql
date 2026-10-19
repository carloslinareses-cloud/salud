-- Solo información clínica pública, identificadores de opciones y cuotas.
-- No se guardan tokens de sesión, datos de pacientes ni existencias.
CREATE TABLE IF NOT EXISTS cache_clinica (
  clave TEXT PRIMARY KEY,
  respuesta TEXT NOT NULL,
  creado_en INTEGER NOT NULL,
  vence_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_clinica_vencimiento ON cache_clinica(vence_en);
CREATE TABLE IF NOT EXISTS cuotas (
  clave TEXT PRIMARY KEY,
  usadas INTEGER NOT NULL,
  vence_en INTEGER NOT NULL
);
