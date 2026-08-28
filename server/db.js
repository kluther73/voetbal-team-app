const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database/voetbal.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Tabel voor gebruikers
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'player',
        exclude_driving INTEGER DEFAULT 0
    )`);

    // Voeg wat test-data toe als de tabel leeg is
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO users (name, role) VALUES ('Sjaak Afhaak', 'player')");
            db.run("INSERT INTO users (name, role) VALUES ('Piet Precies', 'player')");
            db.run("INSERT INTO users (name, role) VALUES ('Klaas Vaak', 'player')");
            console.log("Test-spelers toegevoegd.");
        }
    });
});

module.exports = db;