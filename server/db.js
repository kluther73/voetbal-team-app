const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

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
    db.run(`CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        club TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS team_members (
        team_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id)
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
        note TEXT,
        responded_at TEXT,
        UNIQUE(event_id, user_id)
    )`);
    db.run('ALTER TABLE attendance ADD COLUMN note TEXT', () => {});
    db.run('ALTER TABLE attendance ADD COLUMN responded_at TEXT', () => {});
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
    db.run('ALTER TABLE users ADD COLUMN password_hash TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN exclude_flagging INTEGER NOT NULL DEFAULT 0', () => {});
    db.run('ALTER TABLE events ADD COLUMN type TEXT DEFAULT \'match\'', () => {});
    db.run('ALTER TABLE events ADD COLUMN title TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN time TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN location TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN status TEXT DEFAULT \'upcoming\'', () => {});
    db.run('ALTER TABLE events ADD COLUMN team_id INTEGER', () => {});
    db.run("UPDATE events SET title = COALESCE(title, 'Wedstrijd'), type = COALESCE(type, 'match') WHERE title IS NULL OR type IS NULL");
    db.run("UPDATE users SET email = CASE name WHEN 'Sjaak Afhaak' THEN 'sjaak@team.nl' WHEN 'Piet Precies' THEN 'piet@team.nl' WHEN 'Klaas Vaak' THEN 'klaas@team.nl' ELSE email END WHERE email IS NULL");
    db.run('UPDATE users SET password_hash = ? WHERE password_hash IS NULL', [bcrypt.hashSync('voetbal123', 10)]);
    
    db.run("INSERT INTO teams (name, club) SELECT 'JO13-1', 'RoodWit' WHERE NOT EXISTS (SELECT 1 FROM teams)");
    
    // Seed users if empty
    const password_hash = bcrypt.hashSync('voetbal123', 10);
    db.run("DELETE FROM users WHERE id > 0", () => {
        const seedUsers = [
            ['Sjaak Afhaak', 'player', 'sjaak@team.nl', password_hash, 0, 0],
            ['Piet Precies', 'player', 'piet@team.nl', password_hash, 0, 0],
            ['Klaas Vaak', 'player', 'klaas@team.nl', password_hash, 1, 0],
            ['Anne Coach', 'team-manager', 'anne@team.nl', password_hash, 0, 0],
            ['Marco Trainer', 'trainer', 'marco@team.nl', password_hash, 0, 0],
            ['Opa Jan', 'guardian', 'jan@team.nl', password_hash, 0, 0]
        ];
        const stmt = db.prepare('INSERT INTO users (name, role, email, password_hash, exclude_driving, exclude_flagging) VALUES (?, ?, ?, ?, ?, ?)');
        seedUsers.forEach(user => stmt.run(user));
        stmt.finalize(() => {
            // After users are seeded, add them to team_members
            db.run("DELETE FROM team_members WHERE team_id > 0");
            db.run("INSERT OR IGNORE INTO team_members (team_id, user_id) SELECT (SELECT id FROM teams LIMIT 1), id FROM users");
        });
    });
    
    db.run('UPDATE events SET team_id = (SELECT id FROM teams LIMIT 1) WHERE team_id IS NULL');
    
    // Seed events if empty
    db.run("DELETE FROM events WHERE id > 0", () => {
        db.run("INSERT INTO events (type, title, date, time, location, opponent, team_id) VALUES ('match', 'Uitwedstrijd JO13-1', '2026-08-30', '10:00', 'Sportpark De Brug', 'SV Rivierwijk', (SELECT id FROM teams LIMIT 1))");
        db.run("INSERT INTO events (type, title, date, time, location, team_id) VALUES ('training', 'Training', '2026-08-27', '18:30', 'Veld 2', (SELECT id FROM teams LIMIT 1))");
        db.run("INSERT INTO events (type, title, date, time, location, opponent, team_id) VALUES ('match', 'Thuiswedstrijd JO13-1', '2026-09-06', '09:30', 'Sportpark Zuid', 'FC Horizon', (SELECT id FROM teams LIMIT 1))");
    });
    
    // Seed surveys if empty
    db.run("DELETE FROM surveys WHERE id > 0", () => {
        db.run("INSERT INTO surveys (question, deadline, responses, total) VALUES ('Wie kan er mee naar het teamweekend?', '2026-09-02', 8, 12)");
    });
});

module.exports = db;