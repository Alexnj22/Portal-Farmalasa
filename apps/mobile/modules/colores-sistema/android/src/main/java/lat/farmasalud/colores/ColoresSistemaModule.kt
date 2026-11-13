// La paleta de Material You del sistema, VIGENTE, para la app del personal.
//
// Por qué (medido el 2026-11-13 en el emulador): en Android, un proceso que
// cargó el WebView deja de recibir los colores nuevos del sistema hasta
// reiniciarse — con una app nativa mínima, sin WebView el color cambia en
// vivo y con WebView no. React Native carga el WebView en todo proceso (lo
// pide para las cookies de fetch y del WebSocket), así que la app no tomaba el
// color nuevo del fondo de pantalla sin cerrarla (usuario, 2026-11-12).
//
// La salida: la paleta la lee un ContentProvider en el proceso «:colores»,
// donde el WebView no se carga nunca. Mismas claves y formato que
// getMaterialColors de @expo/ui, para que JS no distinga.
package lat.farmasalud.colores

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ColoresSistemaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ColoresSistema")

    Function("paleta") { oscuro: Boolean ->
      val ctx = appContext.reactContext ?: return@Function null
      val uri = Uri.parse("content://${ctx.packageName}.colores-sistema")
      val b = ctx.contentResolver.call(uri, "paleta", if (oscuro) "oscuro" else "claro", null) ?: return@Function null
      b.keySet().associateWith { b.getString(it) }
    }
  }
}
