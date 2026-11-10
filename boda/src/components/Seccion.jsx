import Revelar from './Revelar';

export default function Seccion({ id, script, titulo, alterna, children, angosta }) {
  return (
    <section id={id} className={`seccion ${alterna ? 'alterna' : ''}`}>
      <div className={angosta ? 'angosto' : 'contenedor'}>
        <Revelar className="titulo">
          {script && <span className="script">{script}</span>}
          <h2>{titulo}</h2>
          <div className="adorno">✦</div>
        </Revelar>
        {children}
      </div>
    </section>
  );
}
