const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database/voetbal.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        email TEXT,
        exclude_driving INTEGER NOT NULL DEFAULT 0,
        exclude_flagging INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        location TEXT,
        opponent TEXT,
        status TEXT DEFAULT 'upcoming'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(event_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS duties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        note TEXT,
        UNIQUE(event_id, user_id, type)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        deadline TEXT NOT NULL,
        responses INTEGER DEFAULT 0,
        total INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open'
    )`);

    // Bring the original starter database forward without losing its data.
    db.run('ALTER TABLE users ADD COLUMN email TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN exclude_flagging INTEGER NOT NULL DEFAULT 0', () => {});
    db.run('ALTER TABLE events ADD COLUMN type TEXT DEFAULT \'match\'', () => {});
    db.run('ALTER TABLE events ADD COLUMN title TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN time TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN location TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN status TEXT DEFAULT \'upcoming\'', () => {});
    db.run("UPDATE events SET title = COALESCE(title, 'Wedstrijd'), type = COALESCE(type, 'match') WHERE title IS NULL OR type IS NULL");
    db.run("UPDATE users SET email = CASE name WHEN 'Sjaak Afhaak' THEN 'sjaak@team.nl' WHEN 'Piet Precies' THEN 'piet@team.nl' WHEN 'Klaas Vaak' THEN 'klaas@team.nl' ELSE email END WHERE email IS NULL");
    db.run("INSERT INTO users (name, role, email) SELECT 'Anne Coach', 'team-manager', 'anne@team.nl' WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'team-manager')");
    db.run("INSERT INTO users (name, role, email) SELECT 'Opa Jan', 'guardian', 'jan@team.nl' WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'guardian')");

    db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
        if (err || row.count > 0) return;
        const users = [
            ['Sjaak Afhaak', 'player', 'sjaak@team.nl', 0, 0],
            ['Piet Precies', 'player', 'piet@team.nl', 0, 0],
            ['Klaas Vaak', 'player', 'klaas@team.nl', 1, 0],
            ['Anne Coach', 'team-manager', 'anne@team.nl', 0, 0],
            ['Opa Jan', 'guardian', 'jan@team.nl', 0, 0]
        ];
        const statement = db.prepare('INSERT INTO users (name, role, email, exclude_driving, exclude_flagging) VALUES (?, ?, ?, ?, ?)');
        users.forEach(user => statement.run(user));
        statement.finalize();
    });
    db.get('SELECT COUNT(*) AS count FROM events', (err, row) => {
        if (err || row.count > 0) return;
        db.run("INSERT INTO events (type, title, date, time, location, opponent) VALUES ('match', 'Uitwedstrijd JO13-1', '2026-08-30', '10:00', 'Sportpark De Brug', 'SV Rivierwijk')");
        db.run("INSERT INTO events (type, title, date, time, location) VALUES ('training', 'Training', '2026-08-27', '18:30', 'Veld 2')");
        db.run("INSERT INTO events (type, title, date, time, location, opponent) VALUES ('match', 'Thuiswedstrijd JO13-1', '2026-09-06', '09:30', 'Sportpark Zuid', 'FC Horizon')");
    });
    db.get('SELECT COUNT(*) AS count FROM surveys', (err, row) => {
        if (!err && row.count === 0) db.run("INSERT INTO surveys (question, deadline, responses, total) VALUES ('Wie kan er mee naar het teamweekend?', '2026-09-02', 8, 12)");
    });
});

module.exports = db;