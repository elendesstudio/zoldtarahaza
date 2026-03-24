console.log("NEW VERSION DEPLOY");

require("dotenv").config();

require("./db/init");

const pg = require("./db/postgres");
const db = require("./db/database");
const { sendMail } = require("./utils/mailer");

// =====================================================
// ADD SOFT DELETE FIELD
// =====================================================

db.run(`
ALTER TABLE bookings ADD COLUMN deleted INTEGER DEFAULT 0
`, (err)=>{
  if(err && !err.message.includes("duplicate column")){
    console.error("DB column error:", err.message);
  }
});

const express = require("express");
const cors = require("cors");
const session = require("express-session");

const servicesRoutes = require("./routes/services");
const availabilityRoutes = require("./routes/availability");
const bookingsRoutes = require("./routes/bookings");

const contactRoutes = require("./routes/contact");

const app = express();


// =====================================================
// 🗄️ DATABASE TABLES
// =====================================================

// Globális nap tiltás
db.run(`
  CREATE TABLE IF NOT EXISTS blocked_days (
    date TEXT PRIMARY KEY
  )
`);

// Napi idősáv felülírás
db.run(`
  CREATE TABLE IF NOT EXISTS daily_slots (
    date TEXT,
    slot TEXT,
    enabled INTEGER,
    PRIMARY KEY (date, slot)
  )
`);


// =====================================================
// ⚙️ MIDDLEWARE
// =====================================================

app.use(cors());
app.use(express.json());

app.use("/api/contact", contactRoutes);

app.use(
  session({
    secret: "SuperSecretSessionKey_2026!@#",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);


app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pg.query("SELECT NOW()");
    res.json(result.rows);
  } catch (err) {
    console.error("DB ERROR FULL:", err);
    res.status(500).send(err.message); // 👈 EZ FONTOS
  }
});


// Statikus fájlok
app.use(express.static("public"));


// =====================================================
// 🔐 ADMIN AUTH
// =====================================================

const ADMIN_PASSWORD = "Zt@2026!Admin#Secure";

app.post("/admin/login", (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

app.get("/admin/check", (req, res) => {
  if (req.session && req.session.admin) return res.json({ loggedIn: true });
  res.json({ loggedIn: false });
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: "Nincs jogosultság" });
}


// =====================================================
// 📦 PUBLIC API ROUTES
// =====================================================

app.use("/api/services", servicesRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/bookings", bookingsRoutes);


// =====================================================
// ⏱️ PUBLIC: TIME SLOTS (admin + user frontend ugyanazt használja)
// =====================================================

app.get("/api/time-slots", (req, res) => {
  const { TIME_SLOTS } = require("./utils/calendar");
  res.json(TIME_SLOTS);
});


// =====================================================
// 🟥 ADMIN – GLOBÁLIS NAP TILTÁS
// =====================================================

app.get("/api/admin/blocked-days", requireAdmin, (req, res) => {
  db.all("SELECT date FROM blocked_days ORDER BY date ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Adatbázis hiba" });
    res.json(rows.map(r => r.date));
  });
});

app.post("/api/admin/blocked-days", requireAdmin, (req, res) => {
  const { date, blocked } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Hibás dátum formátum (YYYY-MM-DD)" });
  }

  if (blocked) {
    db.run(
      "INSERT OR IGNORE INTO blocked_days(date) VALUES (?)",
      [date],
      (err) => {
        if (err) return res.status(500).json({ error: "Mentési hiba" });
        res.json({ success: true });
      }
    );
  } else {
    db.run(
      "DELETE FROM blocked_days WHERE date = ?",
      [date],
      (err) => {
        if (err) return res.status(500).json({ error: "Törlési hiba" });
        res.json({ success: true });
      }
    );
  }
});


// =====================================================
// 🟢 ADMIN – NAPI IDŐSÁVOK
// =====================================================

app.get("/api/admin/daily-slots/:date", requireAdmin, (req, res) => {
  const date = req.params.date;

  db.all(
    "SELECT slot, enabled FROM daily_slots WHERE date = ?",
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Adatbázis hiba" });
      res.json(rows);
    }
  );
});

app.post("/api/admin/daily-slots", requireAdmin, (req, res) => {
  const { date, slots } = req.body;

  if (!date || !Array.isArray(slots)) {
    return res.status(400).json({ error: "Hibás adat" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Hibás dátum formátum (YYYY-MM-DD)" });
  }

  db.serialize(() => {
    db.run("DELETE FROM daily_slots WHERE date = ?", [date]);

    const stmt = db.prepare(
      "INSERT INTO daily_slots (date, slot, enabled) VALUES (?, ?, ?)"
    );

    slots.forEach(s => {
      stmt.run(date, s.slot, s.enabled ? 1 : 0);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: "Mentési hiba" });
      res.json({ success: true });
    });
  });
});


//helper
function getNextMonth(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const next = new Date(y, m, 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}


// =====================================================
// 📅 ADMIN – BOOKING LIST (napi + havi összesítő)
// =====================================================

// GET /api/admin/bookings?date=YYYY-MM-DD  -> részletes napi lista
// GET /api/admin/bookings?month=YYYY-MM    -> havi összesítő map: {date: [slot,...]}
app.get("/api/admin/bookings", requireAdmin, async (req, res) => {

  const { date, month } = req.query;

  try {

    if (date) {

      const result = await pg.query(`
        SELECT b.id, b.date, b.slot, b.name, b.phone, b.email, b.note, b.created_at,
               s.name AS service_name
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.date = $1
        AND (b.deleted = 0 OR b.deleted IS NULL)
        ORDER BY b.slot ASC
      `, [date]);

      return res.json(result.rows);
    }

    if (month) {

      const result = await pg.query(`
        SELECT date, slot
        FROM bookings
        WHERE date >= $1
        AND date < $2
        AND (deleted = 0 OR deleted IS NULL)
      `, [
        `${month}-01`,
        getNextMonth(month)
      ]);

      const map = {};

      result.rows.forEach(r => {

      const d = new Date(r.date);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");

      const dateStr = `${y}-${m}-${day}`;

      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(r.slot);

    });

      return res.json(map);
    }

    res.status(400).json({ error: "Add meg: date vagy month" });

  } catch (err) {
    console.error("POSTGRES ERROR:", err);
    res.status(500).json({ error: "DB hiba" });
  }

});


// =====================================================
// 🗑️ ADMIN – FOGLALÁS TÖRLÉS
// =====================================================

app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    const result = await pg.query(
      `
      SELECT b.*, s.name as service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.id = $1
      `,
      [bookingId]
    );

    const booking = result.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Foglalás nem található" });
    }

    // ✅ POSTGRES TÖRLÉS
    await pg.query(
      "UPDATE bookings SET deleted = 1, cancelled_by = 'admin' WHERE id = $1",
      [bookingId]
    );

    // ✅ AZONNAL VÁLASZ
    res.json({ success: true });

    if (!booking.email) {
      console.log("NINCS EMAIL");
      return;
    }

    sendMail({
  to: booking.email,
  subject: "Időpont törölve",
  html: `
        <div style="margin:0;padding:0;background:#0f2e2a;font-family:Arial,sans-serif;">
          
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
            <tr>
              <td align="center">

                <table width="100%" cellpadding="0" cellspacing="0" 
                  style="max-width:480px;background:#123d36;border-radius:14px;padding:24px;color:#ffffff;">

                  <tr>
                    <td align="center" style="font-size:20px;font-weight:700;padding-bottom:6px;">
                      Zöld Tara háza
                    </td>
                  </tr>

                  <tr>
                    <td align="center" style="font-size:13px;color:#9fe3c7;padding-bottom:18px;">
                      Időpont törölve
                    </td>
                  </tr>

                  <tr>
                    <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
                      Kedves <strong>${booking.name || "Vendég"}</strong>!<br><br>
                      Az időpontod <strong>törlésre került</strong>.
                    </td>
                  </tr>

                  <tr>
                    <td style="background:#0f2e2a;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;">
                      <b>Dátum:</b> ${booking.date}<br>
                      <b>Időpont:</b> ${booking.slot}<br>
                      <b>Kezelés:</b> ${booking.service_name || ""}
                    </td>
                  </tr>

                  <tr>
                    <td align="center" style="padding-top:22px;">
                      <a href="${process.env.BASE_URL}/foglalas.html" 
                        style="
                          display:inline-block;
                          background:#16a34a;
                          color:#ffffff;
                          padding:12px 20px;
                          border-radius:8px;
                          text-decoration:none;
                          font-size:14px;
                          font-weight:600;
                        ">
                        Új időpont foglalása
                      </a>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding-top:20px;font-size:12px;color:#9fe3c7;text-align:center;">
                      Ha kérdésed van, válaszolj erre az emailre.
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </div>
        `
      }).catch(err => console.error("ADMIN DELETE EMAIL FAIL:", err));

  } catch (err) {
    console.error("POSTGRES ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});


// =====================================================
// 🧹 AUTO CLEANUP – 30 napnál régebbi foglalások törlése
// =====================================================

function cleanupOldBookings() {
  db.run(
    `
    DELETE FROM bookings
    WHERE created_at IS NOT NULL
      AND datetime(created_at) < datetime('now', '-30 days')
    `,
    [],
    (err) => {
      if (err) console.error("cleanupOldBookings hiba:", err.message);
    }
  );
}

//cleanupOldBookings();
//setInterval(cleanupOldBookings, 60 * 60 * 1000);


// =====================================================
// 🩺 HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend fut ✅" });
});

app.get("/", (req, res) => {
  res.send("Backend fut 🚀");
});

// =====================================================
// 🚀 SERVER START
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server fut: http://localhost:${PORT}`);
});

// =====================================================
// RESTORE BOOKING
// =====================================================

app.post("/api/admin/bookings/:id/restore", requireAdmin, async (req, res) => {

  try {

    await pg.query(
      "UPDATE bookings SET deleted = 0, cancelled_by = NULL WHERE id = $1",
      [req.params.id]
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: "Restore hiba" });
  }

});


// ===== SERVICES LIST =====
app.get("/api/admin/services", (req, res) => {
  db.all("SELECT id, name, duration_minutes FROM services", [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json([]);
    }

    console.log("ADMIN SERVICES:", rows); // debug

    res.json(rows);
  });
});

// ===== UPDATE SERVICE NAME =====
app.post("/api/admin/services/update", (req, res) => {
  const { id, name, duration } = req.body;

  db.run(
    "UPDATE services SET name = ?, duration_minutes = ? WHERE id = ?",
    [name, duration, id],
    (err) => {
      if (err) return res.status(500).send(err);
      res.json({ success: true });
    }
  );
});


// ===== ADD SERVICE NAME =====
app.post("/api/admin/services/add", (req, res) => {
  const { name, duration } = req.body;

  db.run(
    "INSERT INTO services (name, duration_minutes) VALUES (?, ?)",
    [name, duration || 120],
    (err) => {
      if (err) return res.status(500).send(err);
      res.json({ success: true });
    }
  );
});

// ===== DELETE SERVICE NAME =====
app.delete("/api/admin/services/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  db.run(
    "DELETE FROM services WHERE id = ?",
    [id],
    function (err) {
      if (err) return res.status(500).send(err);

      res.json({ success: true, deleted: this.changes });
    }
  );
});

// =====================================================
// ADMIN – ALL BOOKINGS
// =====================================================

app.get("/api/admin/bookings-all", requireAdmin, async (req, res) => {

  const { filter } = req.query;

  let where = "";

  if (filter === "active") where = "WHERE deleted = 0";
  if (filter === "deleted") where = "WHERE deleted = 1";

  try {

    const result = await pg.query(`
      SELECT b.*, s.name as service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      ${where}
      ORDER BY b.date DESC, b.slot DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB hiba" });
  }

});

app.post("/api/bookings/:id/cancel", async (req, res) => {

  const bookingId = req.params.id;

  try {

    const result = await pg.query(`
      SELECT b.*, s.name as service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.id = $1
    `, [bookingId]);

    const booking = result.rows[0];

    if (!booking)
      return res.status(404).json({ error: "Nem található" });

    await pg.query(
      "UPDATE bookings SET deleted = 1, cancelled_by = 'user' WHERE id = $1",
      [bookingId]
    );

    res.json({ success: true });

    sendMail({
  to: process.env.OWNER_EMAIL,
  subject: "Foglalás lemondva",
  html: `
    <p>Foglalás lemondva:</p>
    <p>${booking.date} - ${booking.slot}</p>
    <p>${booking.name} (${booking.email})</p>
  `
}).catch(err => console.error("ADMIN EMAIL FAIL:", err));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Hiba" });
  }

});


module.exports = app;