console.log("NEW VERSION DEPLOY");

require("dotenv").config();
const nodemailer = require("nodemailer");

require("./db/database");
require("./db/init");

const db = require("./db/database");

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

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.get("/api/test-email", (req, res) => {

  console.log("TEST EMAIL ROUTE HIT");

  // AZONNAL válaszolunk!
  res.send("ROUTE OK - email küldés indul");

  transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.OWNER_EMAIL,
    subject: "Teszt email",
    text: "Ez egy teszt email"
  }, (err, info) => {

    if (err) {
      console.error("EMAIL ERROR:", err);
    } else {
      console.log("EMAIL SENT:", info.response);
    }

  });

});

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


// =====================================================
// 📅 ADMIN – BOOKING LIST (napi + havi összesítő)
// =====================================================

// GET /api/admin/bookings?date=YYYY-MM-DD  -> részletes napi lista
// GET /api/admin/bookings?month=YYYY-MM    -> havi összesítő map: {date: [slot,...]}
app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const { date, month } = req.query;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Hibás date formátum (YYYY-MM-DD)" });
    }

    db.all(
      `
      SELECT b.id, b.date, b.slot, b.name, b.phone, b.email, b.note, b.created_at,
             s.name AS service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.date = ?
      AND b.status = 'confirmed'
      AND b.deleted = 0
      ORDER BY b.slot ASC, b.created_at DESC
      `,
      [date],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "Adatbázis hiba" });
        res.json(rows);
      }
    );
    return;
  }

  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Hibás month formátum (YYYY-MM)" });
    }

    db.all(
      `
      SELECT date, slot, COUNT(*) as cnt
      FROM bookings
      WHERE substr(date,1,7) = ?
      AND status = 'confirmed'
      AND deleted = 0
      GROUP BY date, slot
      ORDER BY date ASC, slot ASC
      `,
      [month],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "Adatbázis hiba" });

        const map = {};
        rows.forEach(r => {
          if (!map[r.date]) map[r.date] = [];
          map[r.date].push(r.slot);
        });

        res.json(map);
      }
    );
    return;
  }

  res.status(400).json({ error: "Add meg: date=YYYY-MM-DD vagy month=YYYY-MM" });
});


// =====================================================
// 🗑️ ADMIN – FOGLALÁS TÖRLÉS
// =====================================================

app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const bookingId = req.params.id;

  db.get(
    `
    SELECT b.*, s.name as service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.id = ?
    `,
    [bookingId],
    (err, booking) => {

      if (err) return res.status(500).json({ error: "Adatbázis hiba" });
      if (!booking) return res.status(404).json({ error: "Foglalás nem található" });

      db.run(
        "UPDATE bookings SET deleted = 1 WHERE id = ?",
        [bookingId],
        function (err) {

          if (err) return res.status(500).json({ error: "Törlés hiba" });

          // ✅ AZONNALI RESPONSE
          res.json({ success: true });

          // ❗ extra védelem
          if (!booking.email) {
            console.log("NINCS EMAIL EHHEZ A FOGLALÁSHOZ");
            return;
          }

          // ✅ EMAIL (nem blokkol)
          transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: booking.email,
            subject: `Időpont törölve – ${booking.date} ${booking.slot}`,
            text: `Kedves ${booking.name}!

Az alábbi időpontfoglalás törlésre került:

Szolgáltatás: ${booking.service_name}
Dátum: ${booking.date}
Időpont: ${booking.slot}

Üdvözlettel,
Zöld Tara háza`
          }, (err, info) => {

            if (err) {
              console.error("EMAIL HIBA:", err);
            } else {
              console.log("EMAIL ELKÜLDVE:", booking.email);
            }

          });

        }
      );

    }
  );
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

app.post("/api/admin/bookings/:id/restore", requireAdmin, (req, res) => {

  db.run(
    "UPDATE bookings SET deleted = 0 WHERE id = ?",
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Restore hiba" });
      res.json({ success: true });
    }
  );

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

app.get("/api/admin/bookings-all", requireAdmin, (req,res)=>{

  const { filter } = req.query;

  let where = "";

  if(filter === "active"){
    where = "WHERE deleted = 0";
  }

  if(filter === "deleted"){
    where = "WHERE deleted = 1";
  }

  db.all(
    `
    SELECT b.*, s.name as service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    ${where}
    ORDER BY b.date DESC, b.slot DESC
    `,
    [],
    (err,rows)=>{
      if(err) return res.status(500).json({error:"DB hiba"});
      res.json(rows);
    }
  );

});

app.post("/api/bookings/:id/cancel", async (req, res) => {

  const bookingId = req.params.id;

  db.get(
    `
    SELECT b.*, s.name as service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.id = ?
    `,
    [bookingId],
    async (err, booking) => {

      if (err || !booking)
        return res.status(500).json({ error: "Foglalás nem található" });

      db.run(
        "UPDATE bookings SET deleted = 1 WHERE id = ?",
        [bookingId],
        async function (err) {

          if (err)
            return res.status(500).json({ error: "Törlés hiba" });

          try {

            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: process.env.OWNER_EMAIL,
              subject: "Foglalás törölve a felhasználó által",
              text: `
A felhasználó törölte az időpontját.

Név: ${booking.name}
Email: ${booking.email}

Szolgáltatás: ${booking.service_name}
Dátum: ${booking.date}
Időpont: ${booking.slot}
              `
            });

          } catch (emailErr) {
            console.error("Email hiba:", emailErr);
          }

          res.json({ success: true });

        }
      );

    }
  );

});