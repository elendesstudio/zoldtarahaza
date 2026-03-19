// FIX idősávok (V1)
const TIME_SLOTS = [
  "10:00-12:00",
  "12:00-14:00",
  "14:00-16:00",
  "16:00-18:00",
];

// FIX ünnepnapok (YYYY-MM-DD)
const HOLIDAYS = [
  "2026-01-01",
  "2026-03-15",
  "2026-05-01",
  "2026-08-20",
  "2026-10-23",
  "2026-12-25",
  "2026-12-26",
];

// hétvége ellenőrzés
function isWeekend(dateString) {
  const date = new Date(dateString);
  const day = date.getDay(); // 0 = vasárnap, 6 = szombat
  return day === 0 || day === 6;
}

// ünnepnap ellenőrzés
function isHoliday(dateString) {
  return HOLIDAYS.includes(dateString);
}

module.exports = {
  TIME_SLOTS,
  HOLIDAYS,
  isWeekend,
  isHoliday,
};
