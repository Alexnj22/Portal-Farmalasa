package lat.farmasalud.clientes.reservaviva

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// La reserva en curso como notificación FIJA (2026-10-15): el gemelo Android de
// la Live Activity de iOS (targets/reserva). «Tu reserva R-001234 · Lista para
// retirar en Salud 3 · hasta las 3:40 p. m.», con la cuenta regresiva del
// propio sistema (cronómetro hacia atrás) y que se va sola al vencer
// (`setTimeoutAfter`), sin despertar a la app.
//
// Por qué un módulo y no expo-notifications (que sí tiene `sticky`): con la app
// abierta, una notificación local de expo-notifications pasa por el manejador
// global y por los oyentes de lib/avisos.js — cada puesta al día sacaba el
// banner propio de la app como si fuera un aviso nuevo. Y no expone el
// cronómetro ni el vencimiento. Ésta va directo al sistema, en su propio canal
// de importancia BAJA: sin sonido, sin banner, sólo en la bandeja y en la
// pantalla bloqueada.
//
// Privacidad: el título y la línea los arma index.js y nunca llevan el nombre
// del producto, por eso puede ser VISIBILITY_PUBLIC.
class DatosReserva : Record {
  @Field var clave: String = ""
  @Field var titulo: String = ""
  @Field var linea: String = ""
  @Field var estado: String = "pendiente"
  /** Milisegundos desde 1970, como `Date.now()` en JS. */
  @Field var vence: Double? = null
}

private const val CANAL = "reservas_en_curso"
private const val ID = 7301 // la etiqueta (tag) es la clave de la reserva

class ReservaVivaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReservaViva")

    // Notificaciones permitidas en el sistema y el canal sin apagar.
    Function("disponible") {
      val c = appContext.reactContext
      c != null && permitido(c)
    }

    Function("activas") {
      val c = appContext.reactContext
      if (c == null) emptyList<String>() else activas(c)
    }

    Function("existe") { clave: String ->
      val c = appContext.reactContext
      c != null && activas(c).contains(clave)
    }

    AsyncFunction("mostrar") { datos: DatosReserva ->
      val c = appContext.reactContext
      c != null && publicar(c, datos, true)
    }

    // Retirada o vencida: queda un rato, ya sin fijar; lo demás se quita.
    AsyncFunction("terminar") { clave: String, cierre: DatosReserva? ->
      val c = appContext.reactContext
      if (c != null) {
        if (cierre != null && (cierre.estado == "retirada" || cierre.estado == "vencida")) publicar(c, cierre, false)
        else gestor(c).cancel(clave, ID)
      }
    }

    // Al cerrar sesión: en un teléfono compartido no se quedan las de la cuenta anterior.
    AsyncFunction("terminarTodas") {
      val c = appContext.reactContext
      if (c != null) for (clave in activas(c)) gestor(c).cancel(clave, ID)
    }
  }

  private fun gestor(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun permitido(c: Context): Boolean {
    val g = gestor(c)
    if (!g.areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val canal = g.getNotificationChannel(CANAL)
      if (canal != null && canal.importance == NotificationManager.IMPORTANCE_NONE) return false
    }
    return true
  }

  private fun activas(c: Context): List<String> =
    gestor(c).activeNotifications.filter { it.id == ID }.mapNotNull { it.tag }

  // Android 7: sin canales, la importancia baja va en la propia notificación.
  @Suppress("DEPRECATION")
  private fun antiguo(c: Context) = Notification.Builder(c).setPriority(Notification.PRIORITY_LOW)

  private fun publicar(c: Context, d: DatosReserva, enCurso: Boolean): Boolean {
    if (d.clave.isEmpty() || !permitido(c)) return false
    val g = gestor(c)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && g.getNotificationChannel(CANAL) == null) {
      g.createNotificationChannel(NotificationChannel(CANAL, "Reservas en curso", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Tu reserva en la pantalla bloqueada mientras está en preparación o lista para retirar."
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      })
    }
    // Tocarla abre Mis reservas.
    val abrir = Intent(Intent.ACTION_VIEW, Uri.parse("puntossalud://reservas"))
      .setPackage(c.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val alTocar = PendingIntent.getActivity(c, d.clave.hashCode(), abrir,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(c, CANAL) else antiguo(c)
    b.setSmallIcon(R.drawable.reserva_viva_icono)
      .setColor(0xFF981D97.toInt())
      .setContentTitle(d.titulo)
      .setContentText(d.linea)
      .setStyle(Notification.BigTextStyle().bigText(d.linea))
      .setContentIntent(alTocar)
      .setOngoing(enCurso)
      .setAutoCancel(!enCurso)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)

    val ahora = System.currentTimeMillis()
    val vence = d.vence?.toLong()
    if (enCurso && vence != null && vence > ahora) {
      // El sistema cuenta hacia atrás solo, y la quita al vencer.
      b.setWhen(vence).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(vence - ahora)
    } else {
      b.setShowWhen(false)
      // La que ya terminó (retirada/vencida) se va sola en 15 min.
      if (!enCurso && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(15 * 60_000L)
    }
    g.notify(d.clave, ID, b.build())
    return true
  }
}
