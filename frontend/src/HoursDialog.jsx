import { useEffect, useRef, useState } from "react";

const TZ = "America/Sao_Paulo";
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

const todayInSaoPaulo = () => {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date());
  return WEEKDAYS[short];
};

export default function HoursDialog({ onClose }) {
  const ref = useRef(null);
  const [hours, setHours] = useState(null);
  const [error, setError] = useState("");
  const [today] = useState(todayInSaoPaulo);

  useEffect(() => {
    ref.current.showModal();
    let alive = true;
    fetch("/api/hours")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (alive) setHours(d); })
      .catch(() => { if (alive) setError("Não foi possível carregar os horários. Tente novamente."); });
    return () => { alive = false; };
  }, []);

  return (
    <dialog ref={ref} className="hours-dialog" onClose={onClose} aria-labelledby="hours-title"
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="cart-top">
        <h2 id="hours-title">Horários de atendimento</h2>
        <button className="close" onClick={() => ref.current.close()} aria-label="Fechar">×</button>
      </div>
      <p>Pedidos imediatos só são aceitos nos dias e horários abaixo. Você também pode agendar para um horário de funcionamento.</p>
      {error ? <p className="error" role="alert">{error}</p> : !hours ? <p>Carregando...</p> : (
        <ul className="hours">
          {ORDER.map(wd => {
            const d = hours.find(x => x.weekday === wd);
            return (
              <li key={wd} className={(!d?.open ? "closed" : "") + (wd === today ? " today" : "")}>
                <span>{NAMES[wd]}{wd === today && <em className="today-tag">hoje</em>}</span>
                <span className="hours-time">{d?.open ? `${d.open_time} – ${d.close_time}` : "Fechado"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p><button className="button" onClick={() => ref.current.close()}>Fechar</button></p>
    </dialog>
  );
}
