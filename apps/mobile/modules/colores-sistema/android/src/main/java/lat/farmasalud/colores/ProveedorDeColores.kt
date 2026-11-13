// Corre en el proceso «:colores» de la app y devuelve la paleta de Material
// You VIGENTE. Ver ColoresSistemaModule.kt para el porqué.
package lat.farmasalud.colores

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb

class ProveedorDeColores : ContentProvider() {
  override fun onCreate() = true

  override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
    if (method != "paleta") return null
    val ctx = context ?: return null
    val oscuro = arg == "oscuro"
    val s = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (oscuro) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
    } else {
      if (oscuro) darkColorScheme() else lightColorScheme()
    }
    return tokens(s)
  }

  // Mismo formato que getMaterialColors de @expo/ui: #RRGGBBAA.
  private fun hex(c: Color): String {
    val argb = c.toArgb()
    return "#%08X".format((argb shl 8) or ((argb ushr 24) and 0xFF))
  }

  private fun tokens(s: ColorScheme) = Bundle().apply {
      putString("primary", hex(s.primary))
      putString("onPrimary", hex(s.onPrimary))
      putString("primaryContainer", hex(s.primaryContainer))
      putString("onPrimaryContainer", hex(s.onPrimaryContainer))
      putString("inversePrimary", hex(s.inversePrimary))
      putString("secondary", hex(s.secondary))
      putString("onSecondary", hex(s.onSecondary))
      putString("secondaryContainer", hex(s.secondaryContainer))
      putString("onSecondaryContainer", hex(s.onSecondaryContainer))
      putString("tertiary", hex(s.tertiary))
      putString("onTertiary", hex(s.onTertiary))
      putString("tertiaryContainer", hex(s.tertiaryContainer))
      putString("onTertiaryContainer", hex(s.onTertiaryContainer))
      putString("background", hex(s.background))
      putString("onBackground", hex(s.onBackground))
      putString("surface", hex(s.surface))
      putString("onSurface", hex(s.onSurface))
      putString("surfaceVariant", hex(s.surfaceVariant))
      putString("onSurfaceVariant", hex(s.onSurfaceVariant))
      putString("surfaceTint", hex(s.surfaceTint))
      putString("inverseSurface", hex(s.inverseSurface))
      putString("inverseOnSurface", hex(s.inverseOnSurface))
      putString("error", hex(s.error))
      putString("onError", hex(s.onError))
      putString("errorContainer", hex(s.errorContainer))
      putString("onErrorContainer", hex(s.onErrorContainer))
      putString("outline", hex(s.outline))
      putString("outlineVariant", hex(s.outlineVariant))
      putString("scrim", hex(s.scrim))
      putString("surfaceBright", hex(s.surfaceBright))
      putString("surfaceDim", hex(s.surfaceDim))
      putString("surfaceContainer", hex(s.surfaceContainer))
      putString("surfaceContainerHigh", hex(s.surfaceContainerHigh))
      putString("surfaceContainerHighest", hex(s.surfaceContainerHighest))
      putString("surfaceContainerLow", hex(s.surfaceContainerLow))
      putString("surfaceContainerLowest", hex(s.surfaceContainerLowest))
      putString("primaryFixed", hex(s.primaryFixed))
      putString("primaryFixedDim", hex(s.primaryFixedDim))
      putString("onPrimaryFixed", hex(s.onPrimaryFixed))
      putString("onPrimaryFixedVariant", hex(s.onPrimaryFixedVariant))
      putString("secondaryFixed", hex(s.secondaryFixed))
      putString("secondaryFixedDim", hex(s.secondaryFixedDim))
      putString("onSecondaryFixed", hex(s.onSecondaryFixed))
      putString("onSecondaryFixedVariant", hex(s.onSecondaryFixedVariant))
      putString("tertiaryFixed", hex(s.tertiaryFixed))
      putString("tertiaryFixedDim", hex(s.tertiaryFixedDim))
      putString("onTertiaryFixed", hex(s.onTertiaryFixed))
      putString("onTertiaryFixedVariant", hex(s.onTertiaryFixedVariant))
  }

  override fun query(uri: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, s: String?, a: Array<String>?) = 0
  override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
