// La sala propia de quien tiene la sesión, escrita UNA vez.
//
// El usuario del `AuthContext` trae `branchId` —así lo arma el login—, pero
// hay caminos (una sesión vieja en el almacén, una ficha leída directo de la
// base) que traen `branch_id`. Por eso el portal repetía
// `user?.branchId ?? user?.branch_id ?? null` en ~60 sitios. La app del
// teléfono lo escribió primero con una sola de las dos y la sala propia salía
// vacía: exactamente el defecto que la repetición invita a cometer.
export function salaDelUsuario(user) {
    return user?.branchId ?? user?.branch_id ?? null;
}
