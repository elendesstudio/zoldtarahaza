const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.sqlite");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ DB hiba:", err.message);
  } else {
    console.log("✅ SQLite adatbázis csatlakoztatva");
  }
});

module.exports = db;