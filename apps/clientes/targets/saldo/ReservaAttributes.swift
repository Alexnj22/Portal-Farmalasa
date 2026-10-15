// Lo que la app y la Live Activity se dicen de una reserva (2026-10-15).
//
// ⚠ Este archivo existe DOS veces, idéntico: acá (la extensión que la dibuja)
// y en modules/reserva-viva/ios/ReservaAttributes.swift (el módulo de la app
// que la arranca, la pone al día y la termina). ActivityKit las empareja por
// el NOMBRE del tipo y por su forma en JSON: si una copia cambia un campo y la
// otra no, la actividad se pide bien y no se dibuja nada, sin error. Se
// cambian las dos juntas.
//
// Privacidad: acá NO viaja el nombre del producto — la pantalla bloqueada la
// ve cualquiera. Sólo el código, la sucursal, el estado y el plazo.
import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct ReservaAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// en_revision · pendiente · lista · retirada · vencida · cancelada
    var estado: String
    /// «Salud 3»; vacío si la app no la conoce.
    var sucursal: String
    var domicilio: Bool
    /// Cuándo quedó lista (inicio de la barra) y hasta cuándo se guarda.
    var desde: Date?
    var vence: Date?
  }

  /// «R-001234» o «P-000123»: la llave para encontrarla otra vez.
  var clave: String
  /// «Tu reserva R-001234» / «Tu pedido P-000123».
  var titulo: String
}
