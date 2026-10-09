// El código de acceso a «Mis puntos» por WhatsApp: el número con su prefijo y
// el texto del mensaje. Vivía en `views/puntos/CodigoDeAcceso.jsx`; lo usan el
// portal y la app. Va aparte de `puntosCodigoTicket` porque aquél arrastra la
// impresora y se carga sólo al imprimir.

/** El número para wa.me: 8 dígitos = El Salvador (503); 11 o más ya trae país; si no, null. */
export function telefonoParaWhatsapp(telefono) {
    const limpio = String(telefono ?? '').replace(/\D/g, '');
    return limpio.length === 8 ? `503${limpio}` : limpio.length >= 11 ? limpio : null;
}

/** El mensaje: saludo con el primer nombre, el código partido en dos y el enlace. */
export function mensajeDelCodigo({ nombre, codigo, enlace }) {
    const valor = String(codigo ?? '');
    return `Hola${nombre ? ` ${String(nombre).split(' ')[0]}` : ''}. Tu código para ver tus puntos es ${valor.slice(0, 3)}-${valor.slice(3)}. Entra aquí: ${enlace}`;
}
