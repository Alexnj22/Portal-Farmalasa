// La reserva en la pantalla bloqueada (2026-10-15): la Live Activity que
// dibuja targets/reserva. Este módulo sólo la arranca, la pone al día y la
// termina; la lógica de CUÁNDO vive en modules/reserva-viva/index.js.
//
// Se actualiza sólo desde la app (al abrirla, al volver a primer plano o al
// llegar un aviso con la app abierta): los avisos salen por Expo y no hay
// llave de APNs propia para empujarle cambios con la app cerrada. La cuenta
// regresiva y la barra corren solas en el sistema (Text(timerInterval:)), y
// `staleDate` = el vencimiento hace que el sistema la redibuje como vencida.
//
// Desde iOS 17, como la extensión (targets/reserva/expo-target.config.js):
// en 16.x la actividad se podría pedir pero no habría quién la dibuje.
import ExpoModulesCore
import ActivityKit
import Foundation

struct DatosReserva: Record {
  @Field var clave: String = ""
  @Field var titulo: String = ""
  @Field var estado: String = "pendiente"
  @Field var sucursal: String = ""
  @Field var domicilio: Bool = false
  /// Milisegundos desde 1970, como `Date.now()` en JS.
  @Field var desde: Double? = nil
  @Field var vence: Double? = nil
}

public class ReservaVivaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReservaViva")

    // ¿Se pueden mostrar? La persona las puede apagar en Ajustes › Puntos Salud.
    Function("disponible") { () -> Bool in
      guard #available(iOS 17.0, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // Las claves que siguen en pantalla (las que la persona quitó o el
    // sistema terminó ya no cuentan).
    Function("activas") { () -> [String] in
      guard #available(iOS 17.0, *) else { return [] }
      return Activity<ReservaAttributes>.activities
        .filter { $0.activityState == .active || $0.activityState == .stale }
        .map { $0.attributes.clave }
    }

    // Arranca o pone al día la de esa clave. Devuelve si quedó en pantalla.
    AsyncFunction("mostrar") { (datos: DatosReserva) async -> Bool in
      guard #available(iOS 17.0, *) else { return false }
      return await EnVivo.mostrar(datos)
    }

    // ¿Existe una con esa clave? Sin crearla (para no volver a poner una que
    // la persona quitó, ver index.js).
    Function("existe") { (clave: String) -> Bool in
      guard #available(iOS 17.0, *) else { return false }
      return Activity<ReservaAttributes>.activities.contains {
        $0.attributes.clave == clave && ($0.activityState == .active || $0.activityState == .stale)
      }
    }

    // La termina. Con `cierre` (retirada/vencida) la deja un rato mostrando
    // cómo terminó; sin él, o cancelada, se va en el acto.
    AsyncFunction("terminar") { (clave: String, cierre: DatosReserva?) async in
      guard #available(iOS 17.0, *) else { return }
      await EnVivo.terminar(clave, cierre)
    }

    // Al cerrar sesión: en un teléfono compartido, quien entra después no ve
    // las reservas de la cuenta anterior.
    AsyncFunction("terminarTodas") { () async in
      guard #available(iOS 17.0, *) else { return }
      for a in Activity<ReservaAttributes>.activities {
        await a.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}

@available(iOS 17.0, *)
enum EnVivo {
  static func fecha(_ ms: Double?) -> Date? {
    guard let ms, ms > 0 else { return nil }
    return Date(timeIntervalSince1970: ms / 1000)
  }

  static func estado(_ d: DatosReserva) -> ReservaAttributes.ContentState {
    ReservaAttributes.ContentState(estado: d.estado, sucursal: d.sucursal, domicilio: d.domicilio,
                                   desde: fecha(d.desde), vence: fecha(d.vence))
  }

  static func contenido(_ s: ReservaAttributes.ContentState) -> ActivityContent<ReservaAttributes.ContentState> {
    // `staleDate` = el vencimiento: a esa hora el sistema la redibuja como
    // vencida aunque la app no esté abierta. Lista pesa más que en preparación
    // cuando hay varias.
    let futuro = s.vence.flatMap { $0 > Date() ? $0 : nil }
    return ActivityContent(state: s, staleDate: s.estado == "lista" ? futuro : nil,
                           relevanceScore: s.estado == "lista" ? 100 : 50)
  }

  static func vivas(_ clave: String) -> [Activity<ReservaAttributes>] {
    Activity<ReservaAttributes>.activities.filter {
      $0.attributes.clave == clave && ($0.activityState == .active || $0.activityState == .stale)
    }
  }

  static func mostrar(_ d: DatosReserva) async -> Bool {
    guard !d.clave.isEmpty, ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    let s = estado(d)
    if let a = vivas(d.clave).first {
      // Sin cambios no se toca: cada update cuesta presupuesto del sistema.
      if a.content.state != s { await a.update(contenido(s)) }
      return true
    }
    do {
      _ = try Activity.request(attributes: ReservaAttributes(clave: d.clave, titulo: d.titulo),
                               content: contenido(s), pushType: nil)
      return true
    } catch {
      // Demasiadas actividades, la persona las apagó, o la app no está al
      // frente: no es un error de la app, sólo no se muestra.
      return false
    }
  }

  static func terminar(_ clave: String, _ cierre: DatosReserva?) async {
    for a in vivas(clave) {
      if let cierre, cierre.estado == "retirada" || cierre.estado == "vencida" {
        await a.end(ActivityContent(state: estado(cierre), staleDate: nil),
                    dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
      } else {
        await a.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
