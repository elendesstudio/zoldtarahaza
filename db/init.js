const db = require("./database");

// foglalások
db.run(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    note TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(service_id) REFERENCES services(id)
  )
`);

db.run(`
  ALTER TABLE bookings ADD COLUMN cancel_token TEXT
`, () => {});

db.run(`
  ALTER TABLE bookings ADD COLUMN cancelled_at DATETIME
`, () => {});

/*db.run(`
  CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_confirmed_slot
  ON bookings(service_id, date, slot)
  WHERE status = 'confirmed';
`, (err) => {
  // Ha a környezet nem támogat partial indexet, itt fogsz err-t kapni.
  if (err) {
    console.warn("⚠️ ux_bookings_confirmed_slot index nem jött létre:", err.message);
  }
});
*/

console.log("✅ Adatbázis táblák készen");
