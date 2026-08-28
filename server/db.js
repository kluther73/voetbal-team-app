const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database/voetbal.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Gebruikers tabel
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        role TEXT,
        exclude_driving INTEGER DEFAULT 0
    )`);

    // Events tabel
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opponent TEXT,
        date DATETIME,
        is_away INTEGER DEFAULT 0
    )`);

    console.log("Database en tabellen zijn gereed.");
});

module.exports = db;