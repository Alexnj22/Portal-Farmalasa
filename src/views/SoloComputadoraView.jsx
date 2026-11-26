// Portal sólo en computadora (2026-11-26, lo pidió el usuario).
//
// En un teléfono el portal no abre: el personal usa la app. Sale antes y
// después de iniciar sesión (App.jsx la pone en `/login` y en el comodín).
//   · iPhone: el enlace de App Store.
//   · Android: la app vive en la prueba interna de Google Play, que sólo abre
//     para un correo que administración ya agregó. Primero el DUI
//     (`app_android_dui`, sin sesión): sólo un empleado activo sigue. Si ya
//     está agregado, se manda directo a la invitación de Google Play; si no
//     dejó correo, lo pide y lo deja en la lista (`app_android_registrar`),
//     la misma que administración ve en Novedades → Android.
// Las tablets y las rutas públicas (foto por QR, puntos, encuestas) no pasan
// por aquí.
import React, { useState } from 'react';
import { Mail, Monitor, Play, Smartphone, BellRing, CircleAlert, Check, IdCard } from 'lucide-react';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import PortalInput from '../components/common/PortalInput';
import { APP_PERSONAL_IOS, APP_PERSONAL_ANDROID, APP_PERSONAL_NOMBRE } from '@nucleo/constants/novedades';
import { consultarDuiAndroid, registrarCorreoAndroidConDui } from '@nucleo/data/novedades';

function LogoApple({ size = 16, className = '', ...rest }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className} {...rest}>
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
    );
}

// 012345678 → 01234567-8, mientras se escribe.
const formatoDui = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 9);
    return d.length > 8 ? `${d.slice(0, 8)}-${d.slice(8)}` : d;
};

function Android() {
    const [dui, setDui] = useState('');
    const [correo, setCorreo] = useState('');
    // null | 'no_empleado' | 'pedir_correo' | 'esperando' | 'lista' | 'error'
    const [estado, setEstado] = useState(null);
    const [ocupado, setOcupado] = useState(false);
    const duiValido = dui.replace(/\D/g, '').length === 9;
    const correoValido = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo.trim());
    const pideCorreo = estado === 'pedir_correo' || estado === 'error_correo';

    const alResultado = (r) => {
        setEstado(r);
        if (r === 'lista') globalThis.location?.assign(APP_PERSONAL_ANDROID);
    };

    const enviar = async (e) => {
        e?.preventDefault();
        if (ocupado) return;
        if (pideCorreo ? !correoValido : !duiValido) return;
        setOcupado(true);
        try {
            alResultado(pideCorreo
                ? await registrarCorreoAndroidConDui(dui, correo.trim())
                : await consultarDuiAndroid(dui));
        } catch {
            setEstado(pideCorreo ? 'error_correo' : 'error');
        } finally { setOcupado(false); }
    };

    return (
        <form onSubmit={enviar} className="flex flex-col gap-4">
            {!pideCorreo ? (
                <>
                    <p className="text-body-sm text-content-2">Escribe tu DUI para ver si ya puedes descargarla.</p>
                    <PortalInput label="DUI" name="dui-android" icon={IdCard} value={dui} inputMode="numeric"
                        placeholder="00000000-0" autoComplete="off"
                        onChange={(e) => { setDui(formatoDui(e.target.value)); setEstado(null); }} />
                </>
            ) : (
                <>
                    <p className="text-body-sm text-content-2">
                        Escribe el correo de tu cuenta de Google, el que usas en Play Store.
                    </p>
                    <PortalInput label="Correo de Google" name="correo-android" type="email" icon={Mail} value={correo}
                        placeholder="nombre@gmail.com" autoComplete="email" inputMode="email"
                        onChange={(e) => setCorreo(e.target.value)}
                        hasError={!!correo && !correoValido} errorMessage="Revisa el correo: debe verse como nombre@gmail.com." />
                </>
            )}
            <Button type="submit" icon={pideCorreo ? Check : Play} loading={ocupado}
                disabled={pideCorreo ? !correoValido : !duiValido} className="w-full">
                {pideCorreo ? 'Guardar' : 'Continuar'}
            </Button>
            {pideCorreo && (
                <Button variant="ghost" size="sm" onClick={() => { setEstado(null); setCorreo(''); }}>Cambiar DUI</Button>
            )}

            {estado === 'lista' && (
                <Notice variant="success" compact icon={Play}>
                    Ya puedes descargarla. Acepta la invitación y toca Instalar.{' '}
                    <a href={APP_PERSONAL_ANDROID} className="font-semibold underline">Abrir Google Play</a>
                </Notice>
            )}
            {estado === 'esperando' && (
                <Notice variant="info" compact icon={BellRing}>
                    Ya tenemos tu correo. Cuando te den acceso, vuelve aquí, escribe tu DUI y te llevamos a Google Play.
                </Notice>
            )}
            {estado === 'no_empleado' && (
                <Notice variant="warning" compact icon={CircleAlert}>
                    Ese DUI no es de nadie del personal. Revísalo, o pídele a Talento Humano que lo revise en tus datos.
                </Notice>
            )}
            {estado === 'error' && (
                <Notice variant="error" compact icon={CircleAlert}>No se pudo revisar. Intenta de nuevo.</Notice>
            )}
            {estado === 'error_correo' && (
                <Notice variant="error" compact icon={CircleAlert}>No se pudo guardar. Revisa el correo e intenta de nuevo.</Notice>
            )}
        </form>
    );
}

export default function SoloComputadoraView({ telefono }) {
    return (
        <main className="min-h-[100dvh] w-full bg-surface-page flex items-center justify-center px-4 pt-[calc(var(--sa-top)+1.5rem)] pb-[calc(var(--sa-bottom)+1.5rem)]">
            <section data-surface="card" className="w-full max-w-md overflow-hidden">
                <div className="bg-gradient-to-br from-brand to-brand-purple text-white p-6 flex items-center gap-4">
                    <img src="/novedades/2026-11/app-personal.jpg" alt={`Ícono de ${APP_PERSONAL_NOMBRE}`}
                        className="w-16 h-16 rounded-2xl shadow-modal ring-4 ring-brand/40 shrink-0" />
                    <div className="flex flex-col gap-1">
                        <span className="text-caption font-black uppercase tracking-widest text-white/75">En el teléfono, la app</span>
                        <span className="text-title font-black leading-tight">{APP_PERSONAL_NOMBRE}</span>
                    </div>
                </div>
                <div className="p-6 flex flex-col gap-5">
                    <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-xl bg-brand/12 text-brand-text grid place-items-center shrink-0"><Monitor size={18} /></span>
                        <p className="text-body text-content">
                            El portal solo se usa en computadora. En el teléfono, descarga la app y entra con tu usuario y contraseña del portal.
                        </p>
                    </div>
                    {telefono === 'iphone' ? (
                        <Button icon={LogoApple} className="w-full" onClick={() => globalThis.location?.assign(APP_PERSONAL_IOS)}>
                            Descargar en App Store
                        </Button>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 text-body-sm font-semibold text-content">
                                <Smartphone size={16} className="text-success-text" /> Android
                            </div>
                            <Android />
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}
