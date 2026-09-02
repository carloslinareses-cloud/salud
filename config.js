/* Configuración de conexión.
   La clave "anon" de Supabase es pública por diseño: lo que protege los datos son
   las políticas RLS de la base, no el secreto de esta clave.
   Se rellena cuando el esquema y las políticas estén creados. */
window.CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // Mientras esté vacío, la aplicación muestra el aviso de "en preparación"
  // en vez de un formulario que no podría funcionar.
  listo: function () {
    return Boolean(this.SUPABASE_URL && this.SUPABASE_ANON_KEY);
  }
};
