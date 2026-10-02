import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Clock, Lock, SearchX } from 'lucide-react';
import { LoadingState } from '../../components/common/StateViews';
import { fetchEncuestaPublica, responderEncuestaPublica } from '@nucleo/data/encuestasClientes';
import FormularioEncuesta from './FormularioEncuesta';

/**
 * La encuesta que abre el cliente al escanear el QR —o la tablet de sala, con
 * `?modo=tablet`—, SIN iniciar sesión. La guarda es el token del enlace: uno
 * por encuesta y sucursal, así que la sucursal no se pregunta.
 *
 * Lo único que sabe de quien responde es un identificador de este navegador,
 * para frenar el envío repetido. No es un dato de nadie: se genera acá.
 */
const CLAVE_DISPOSITIVO = 'encuesta_dispositivo';

function dispositivo() {
    try {
        let id = window.localStorage.getItem(CLAVE_DISPOSITIVO);
        if (!id) {
            id = `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
            window.localStorage.setItem(CLAVE_DISPOSITIVO, id);
        }
        return id;
    } catch {
        // Sin almacenamiento (navegación privada): uno por visita.
        return `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
}

const MOTIVO = {
    cerrada:       { icon: Lock,     titulo: 'Esta encuesta ya cerró',        texto: '¡Gracias por tu interés!' },
    aun_no:        { icon: Clock,    titulo: 'Esta encuesta todavía no empieza', texto: 'Vuelve a intentarlo en unos días.' },
    no_disponible: { icon: Lock,     titulo: 'Esta encuesta no está disponible', texto: '' },
    no_existe:     { icon: SearchX,  titulo: 'No encontramos esta encuesta',  texto: 'Revisa el enlace o el código QR.' },
};

export default function EncuestaPublicaView() {
    const { token } = useParams();
    const [params] = useSearchParams();
    const modo = params.get('modo') === 'tablet' ? 'tablet' : 'qr';
    const [encuesta, setEncuesta] = useState(null);
    const [error, setError] = useState(null);
    const [miDispositivo] = useState(dispositivo);

    useEffect(() => {
        let vivo = true;
        fetchEncuestaPublica(token)
            .then((e) => { if (vivo) setEncuesta(e); })
            .catch((err) => { if (vivo) setError(err); });
        return () => { vivo = false; };
    }, [token]);

    const enviar = (respuestas, contacto, segundos) =>
        responderEncuestaPublica(token, { respuestas, contacto, segundos, dispositivo: miDispositivo, modo });

    let cuerpo;
    if (error) {
        cuerpo = <Aviso icon={SearchX} titulo="No se pudo abrir la encuesta" texto="Revisa tu conexión e inténtalo de nuevo." />;
    } else if (!encuesta) {
        cuerpo = <LoadingState label="Abriendo la encuesta…" />;
    } else if (encuesta.estado !== 'abierta') {
        const m = MOTIVO[encuesta.estado] || MOTIVO.no_disponible;
        cuerpo = <Aviso icon={m.icon} titulo={m.titulo} texto={encuesta.estado === 'cerrada' && encuesta.mensaje_cierre ? encuesta.mensaje_cierre : m.texto} />;
    } else {
        cuerpo = (
            <>
                <header className="flex items-center gap-3 mb-5">
                    <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                        <ClipboardCheck size={20} />
                    </span>
                    <div className="min-w-0">
                        <h1 className="text-body-lg font-semibold text-content">{encuesta.nombre}</h1>
                        {encuesta.sucursal && <p className="text-micro text-content-3">{encuesta.sucursal}</p>}
                    </div>
                </header>
                <FormularioEncuesta encuesta={encuesta} onEnviar={enviar} reinicioAuto={modo === 'tablet' ? 8 : null} />
            </>
        );
    }

    return (
        <main className="min-h-full flex justify-center px-4 py-6 sm:py-10">
            <div data-surface="card" className="w-full max-w-lg p-5 sm:p-6 self-start">
                {cuerpo}
            </div>
        </main>
    );
}

function Aviso({ icon: Icono, titulo, texto }) {
    return (
        <div className="flex flex-col items-center text-center gap-2 py-10">
            <Icono size={40} className="text-content-3" />
            <p className="text-body-lg font-semibold text-content">{titulo}</p>
            {texto && <p className="text-body-sm text-content-2">{texto}</p>}
        </div>
    );
}
