package lat.farmasalud.clientes.widget

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Lo que la app le pasa al widget (lib/widget.js): guardar el resumen y
// redibujar, o borrarlo al cerrar sesión — para que en un teléfono compartido
// el widget no siga mostrando el saldo de la persona anterior.
class WidgetSaldoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetSaldo")

    Function("guardar") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      preferencias(context).edit().putString(SaldoWidget.CLAVE, json).apply()
      SaldoWidget.refrescar(context)
      true
    }

    Function("borrar") {
      val context = appContext.reactContext ?: return@Function false
      preferencias(context).edit().remove(SaldoWidget.CLAVE).apply()
      SaldoWidget.refrescar(context)
      true
    }
  }

  private fun preferencias(context: Context) =
    context.getSharedPreferences(SaldoWidget.PREFERENCIAS, Context.MODE_PRIVATE)
}
