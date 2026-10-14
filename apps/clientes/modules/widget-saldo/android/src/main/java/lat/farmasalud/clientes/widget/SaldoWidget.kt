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

    // El material de la tarjeta (2026-10-14): la lámina del nivel o del rango
    // de mayoreo (drawable-nodpi, los mismos shaders de la tarjeta). Una clave
    // que no está acá —o un JSON viejo sin `material`— deja el degradado.
    private val MATERIALES = mapOf(
      "bronce" to R.drawable.widget_material_bronce,
      "plata" to R.drawable.widget_material_plata,
      "oro" to R.drawable.widget_material_oro,
      "platino" to R.drawable.widget_material_platino,
      "jade" to R.drawable.widget_material_jade,
      "zafiro" to R.drawable.widget_material_zafiro,
      "rubi" to R.drawable.widget_material_rubi,
      "diamante" to R.drawable.widget_material_diamante,
    )

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
      // `optString` de un null de JSON devuelve la cadena "null": por eso isNull.
      val material = if (r == null || r.isNull("material")) null else MATERIALES[r.optString("material")]
      val conMaterial = material != null
      v.setViewVisibility(R.id.fondo_material, if (conMaterial) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.velo, if (conMaterial) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.logo, if (conMaterial) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.nivel, if (conMaterial) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.nombre, if (conMaterial) View.GONE else View.VISIBLE)
      v.setViewVisibility(R.id.sello_team, if (conMaterial && r?.optBoolean("equipo", false) == true) View.VISIBLE else View.GONE)
      if (material != null) v.setImageViewResource(R.id.fondo_material, material)
      if (r == null) {
        v.setViewVisibility(R.id.con_datos, View.GONE)
        v.setViewVisibility(R.id.sin_datos, View.VISIBLE)
      } else {
        v.setViewVisibility(R.id.con_datos, View.VISIBLE)
        v.setViewVisibility(R.id.sin_datos, View.GONE)
        val saldo = r.optInt("saldo", 0)
        val vencen = r.optInt("vencen90", 0)
        val equivale = r.optDouble("equivale", 0.0)
        v.setTextViewText(R.id.nombre, r.optString("nombre", "").uppercase(Locale.ROOT))
        if (conMaterial) {
          // Sobre el material, como la tarjeta: «CLIENTE»/«MAYOREO» sobre el
          // rótulo, y el saldo «1,250 pts ≈ $12.50».
          v.setTextViewText(R.id.nivel_tipo, if (r.optBoolean("mayoreo", false)) "MAYOREO" else "CLIENTE")
          v.setTextViewText(R.id.rotulo, if (r.isNull("rotulo")) "" else r.optString("rotulo", ""))
          v.setTextViewText(R.id.dolares, String.format(Locale.US, "%,d pts", saldo))
          v.setTextViewText(R.id.puntos, String.format(Locale.US, "≈ $%.2f", equivale))
        } else {
          v.setTextViewText(R.id.dolares, String.format(Locale.US, "$%.2f", equivale))
          v.setTextViewText(R.id.puntos, "$saldo puntos")
        }
        if (vencen > 0) {
          v.setTextViewText(R.id.pie, "⏱ $vencen vencen en 3 meses")
          v.setTextColor(R.id.pie, Color.rgb(255, 149, 0))
        } else {
          v.setTextViewText(R.id.pie, if (saldo >= 100) "✓ Listo para canjear" else "✦ Sigue sumando")
          // Sobre el material el verde de la marca se pierde en el jade o el oro: blanco.
          v.setTextColor(R.id.pie, if (conMaterial) Color.WHITE else Color.rgb(143, 194, 15))
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
