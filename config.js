/* Conexion con la base de datos.
   La clave "anon" es publica por diseno: lo que protege los datos son las
   politicas RLS del esquema `farmacia`, ya creadas y probadas. */
window.CONFIG = {
  SUPABASE_URL: 'https://tfbzghjjfcaqmkzsxrrs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmYnpnaGpqZmNhcW1renN4cnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjQ1NjQsImV4cCI6MjA5NDUwMDU2NH0.7TPSDGTjCeYu6m-H98tnkt_2v4kUidTdePAUaEZEwXU',
  ESQUEMA: 'farmacia',
  listo: function () { return Boolean(this.SUPABASE_URL && this.SUPABASE_ANON_KEY); }
};
