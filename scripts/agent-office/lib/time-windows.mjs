const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function kstDateKey(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstMidnight(dateKey) {
  return new Date(`${dateKey}T00:00:00+09:00`);
}

function addDays(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS)
    .toISOString().slice(0, 10);
}

export function getTimeWindows(now = new Date(), timezone = "Asia/Seoul") {
  if (timezone !== "Asia/Seoul") throw new Error(`지원하지 않는 timezone: ${timezone}`);
  const todayKey = kstDateKey(now);
  const tomorrowKey = addDays(todayKey, 1);
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
  return {
    now,
    timezone,
    todayKey,
    todayStart: kstMidnight(todayKey),
    tomorrowStart: kstMidnight(tomorrowKey),
    sevenDayEnd: kstMidnight(addDays(todayKey, 7)),
    thirtyDayEnd: kstMidnight(addDays(todayKey, 30)),
    weekEnd: kstMidnight(addDays(todayKey, daysUntilNextMonday))
  };
}
