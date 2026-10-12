package lat.farmasalud.clientes.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Locale

// El widget de saldo (gemelo de targets/saldo/Saldo.swift). Sólo LEE lo que la
// app dejó en sus preferencias (clave «resumen», el mismo JSON que en iOS);
// sin datos —no abrió la app o cerró sesión— invita a abrirla.
class SaldoWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, vista(context))
  }

  companion object {
    const val PREFERENCIAS = "puntos_salud_widget"
    const val CLAVE = "resumen"

    fun refrescar(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, SaldoWidget::class.java))
      for (id in ids) manager.updateAppWidget(id, vista(context))
    }

    private fun leer(context: Context): JSONObject? {
      val texto = context.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE).getString(CLAVE, null) ?: return null
      return try { JSONObject(texto) } catch (e: Exception) { null }
    }

    fun vista(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_saldo)
      val r = leer(context)
      if (r == null) {
        v.setViewVisibility(R.id.con_datos, View.GONE)
        v.setViewVisibility(R.id.sin_datos, View.VISIBLE)
      } else {
        v.setViewVisibility(R.id.con_datos, View.VISIBLE)
        v.setViewVisibility(R.id.sin_datos, View.GONE)
        val saldo = r.optInt("saldo", 0)
        val vencen = r.optInt("vencen90", 0)
        v.setTextViewText(R.id.nombre, r.optString("nombre", "").uppercase(Locale.ROOT))
        v.setTextViewText(R.id.dolares, String.format(Locale.US, "$%.2f", r.optDouble("equivale", 0.0)))
        v.setTextViewText(R.id.puntos, "$saldo puntos")
        if (vencen > 0) {
          v.setTextViewText(R.id.pie, "⏱ $vencen vencen en 3 meses")
          v.setTextColor(R.id.pie, Color.rgb(255, 149, 0))
        } else {
          v.setTextViewText(R.id.pie, if (saldo >= 100) "✓ Listo para canjear" else "✦ Sigue sumando")
          v.setTextColor(R.id.pie, Color.rgb(143, 194, 15))
        }
      }
      // Tocarlo abre la app en Puntos (el `widgetURL` de iOS).
      val abrir = Intent(Intent.ACTION_VIEW, Uri.parse("puntossalud://puntos"))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      v.setOnClickPendingIntent(R.id.raiz, PendingIntent.getActivity(context, 0, abrir,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      return v
    }
  }
}
