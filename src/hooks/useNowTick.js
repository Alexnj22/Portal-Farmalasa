import { useEffect, useState } from 'react';

// Ticking "now" for date-diff badges (días restantes/hace X días) que de otro
// modo quedan congelados en el valor de Date.now() del último render y se
// desincronizan si el componente no vuelve a renderizar por otra razón.
export function useNowTick(intervalMs = 60_000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(t);
    }, [intervalMs]);
    return now;
}
