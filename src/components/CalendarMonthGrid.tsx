import { useMemo } from "react";

export type CalendarItem = {
  id: string;
  date: string;
  title: string;
  tone: "planned" | "doing" | "done" | "hold" | "cancelled" | "session";
  label?: string;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!match) return new Date();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function shiftMonth(value: string, delta: number) {
  const base = parseMonth(value);
  const next = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  return monthKey(next);
}

export function currentMonth(now = new Date()) {
  return monthKey(now);
}

export function monthLabel(value: string) {
  const base = parseMonth(value);
  return `${base.getFullYear()}년 ${base.getMonth() + 1}월`;
}

/**
 * 달력은 외부 라이브러리 없이 CSS grid로 그린다(번들·오프라인 우선).
 * 칸 하나에 업무 3개까지만 보이고 나머지는 '+n'으로 접는다.
 */
export function CalendarMonthGrid({
  month,
  items,
  onMonthChange,
  onSelect
}: {
  month: string;
  items: CalendarItem[];
  onMonthChange: (month: string) => void;
  onSelect?: (id: string) => void;
}) {
  const base = parseMonth(month);
  const cells = useMemo(() => {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const list: Array<{ key: string; day: number; date: string; outside: boolean }> = [];
    for (let index = 0; index < startOffset; index += 1) {
      list.push({ key: `prev-${index}`, day: 0, date: "", outside: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      list.push({
        key: `day-${day}`,
        day,
        date: `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(day)}`,
        outside: false
      });
    }
    while (list.length % 7 !== 0) {
      list.push({ key: `next-${list.length}`, day: 0, date: "", outside: true });
    }
    return list;
  }, [month]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      if (!item.date) continue;
      const list = map.get(item.date) || [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items]);

  const today = new Date();
  const todayText = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <section className="pc-calendar" aria-label={`${monthLabel(month)} 업무 달력`}>
      <header className="pc-calendar-head">
        <button className="secondary-button" type="button" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="이전 달">
          ‹ 이전
        </button>
        <strong>{monthLabel(month)}</strong>
        <button className="secondary-button" type="button" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="다음 달">
          다음 ›
        </button>
      </header>
      <div className="pc-calendar-week" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="pc-calendar-grid">
        {cells.map((cell) => {
          const dayItems = cell.date ? byDate.get(cell.date) || [] : [];
          return (
            <div
              key={cell.key}
              className={`pc-calendar-cell ${cell.outside ? "is-outside" : ""} ${cell.date === todayText ? "is-today" : ""}`}
            >
              {cell.day > 0 && <span className="pc-calendar-day">{cell.day}</span>}
              <div className="pc-calendar-items">
                {dayItems.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    className={`pc-calendar-chip is-${item.tone}`}
                    type="button"
                    title={item.title}
                    onClick={() => onSelect?.(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
                {dayItems.length > 3 && <span className="pc-calendar-more">+{dayItems.length - 3}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
