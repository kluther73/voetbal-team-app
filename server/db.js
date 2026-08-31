const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, 'database/voetbal.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clubs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        email TEXT,
        source_external_id TEXT,
        exclude_driving INTEGER NOT NULL DEFAULT 0,
        exclude_flagging INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        club TEXT NOT NULL,
        required_cars INTEGER NOT NULL DEFAULT 5
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS team_members (
        team_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS guardian_players (
        guardian_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (guardian_id, player_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        location TEXT,
        opponent TEXT,
        status TEXT DEFAULT 'upcoming',
        is_away INTEGER NOT NULL DEFAULT 0,
        source_external_id TEXT
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
        guardian_id INTEGER,
        type TEXT NOT NULL,
        note TEXT,
        UNIQUE(event_id, user_id, type)
    )`);
    db.run('ALTER TABLE duties ADD COLUMN guardian_id INTEGER', () => {});
    db.run(`CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        deadline TEXT NOT NULL,
        responses INTEGER DEFAULT 0,
        total INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        team_id INTEGER,
        target_audience TEXT NOT NULL DEFAULT 'both',
        title TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS survey_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        selection_type TEXT NOT NULL DEFAULT 'single'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS survey_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        position INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS survey_answers (
        survey_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        option_id INTEGER NOT NULL,
        PRIMARY KEY (question_id, user_id, option_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS external_fixtures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        source_external_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        opponent TEXT,
        date TEXT NOT NULL,
        time TEXT,
        location TEXT,
        is_away INTEGER NOT NULL DEFAULT 0,
        UNIQUE(team_id, source_external_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS voetbalnl_integrations (
        team_id INTEGER PRIMARY KEY,
        official_team_id TEXT,
        matches_url TEXT,
        trainings_url TEXT,
        players_url TEXT,
        other_fixtures_url TEXT,
        access_token_encrypted TEXT,
        updated_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        UNIQUE(team_id, name)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS player_positions (
        player_id INTEGER NOT NULL,
        position_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, position_id)
    )`);

    // Bring the original starter database forward without losing its data.
    db.run('ALTER TABLE users ADD COLUMN email TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN password_hash TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN source_external_id TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN exclude_flagging INTEGER NOT NULL DEFAULT 0', () => {});
    db.run('ALTER TABLE events ADD COLUMN type TEXT DEFAULT \'match\'', () => {});
    db.run('ALTER TABLE events ADD COLUMN title TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN time TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN location TEXT', () => {});
    db.run('ALTER TABLE events ADD COLUMN status TEXT DEFAULT \'upcoming\'', () => {});
    db.run('ALTER TABLE events ADD COLUMN team_id INTEGER', () => {});
    db.run('ALTER TABLE events ADD COLUMN is_away INTEGER NOT NULL DEFAULT 0', () => {});
    db.run('ALTER TABLE events ADD COLUMN source_external_id TEXT', () => {});
    db.run('ALTER TABLE teams ADD COLUMN required_cars INTEGER NOT NULL DEFAULT 5', () => {});
    db.run('ALTER TABLE surveys ADD COLUMN team_id INTEGER', () => {});
    db.run("ALTER TABLE surveys ADD COLUMN target_audience TEXT NOT NULL DEFAULT 'both'", () => {});
    db.run('ALTER TABLE surveys ADD COLUMN title TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN first_name TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN last_name TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN phone TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN birth_date TEXT', () => {});
    db.run('ALTER TABLE users ADD COLUMN jersey_number INTEGER', () => {});
    db.run('ALTER TABLE teams ADD COLUMN club_id INTEGER', () => {});
    db.run('ALTER TABLE users ADD COLUMN club_id INTEGER', () => {});
    db.run("UPDATE events SET is_away = 1 WHERE title LIKE 'Uitwedstrijd%'");
    db.run("UPDATE events SET title = COALESCE(title, 'Wedstrijd'), type = COALESCE(type, 'match') WHERE title IS NULL OR type IS NULL");
    db.run("UPDATE users SET email = CASE name WHEN 'Sjaak Afhaak' THEN 'sjaak@team.nl' WHEN 'Piet Precies' THEN 'piet@team.nl' WHEN 'Klaas Vaak' THEN 'klaas@team.nl' ELSE email END WHERE email IS NULL");
    db.run('UPDATE users SET password_hash = ? WHERE password_hash IS NULL', [bcrypt.hashSync('voetbal123', 10)]);
    db.run(`UPDATE users SET first_name = COALESCE(first_name, CASE WHEN instr(name, ' ') > 0 THEN substr(name, 1, instr(name, ' ') - 1) ELSE name END)`);
    db.run(`UPDATE users SET last_name = COALESCE(last_name, CASE WHEN instr(name, ' ') > 0 THEN substr(name, instr(name, ' ') + 1) ELSE '' END)`);
    // Verenigingen bestonden alleen als vrije tekst op teams; normaliseer ze naar de clubs-tabel.
    db.run('INSERT OR IGNORE INTO clubs (name) SELECT DISTINCT club FROM teams');
    db.run('UPDATE teams SET club_id = (SELECT id FROM clubs WHERE clubs.name = teams.club) WHERE club_id IS NULL');

    db.get('SELECT COUNT(*) AS count FROM users', (existingErr, existingUsers) => {
        if (existingErr || existingUsers.count > 0) return;
        db.run("INSERT OR IGNORE INTO clubs (name) VALUES ('RoodWit')", () => {
        db.get('SELECT id FROM clubs WHERE name = ?', ['RoodWit'], (clubErr, club) => {
            if (clubErr || !club) return;
        db.run("INSERT INTO teams (name, club, club_id) SELECT 'JO13-1', 'RoodWit', ? WHERE NOT EXISTS (SELECT 1 FROM teams)", [club.id], () => {
        db.get('SELECT id FROM teams LIMIT 1', (teamErr, team) => {
            if (teamErr || !team) return;
            db.run('INSERT OR IGNORE INTO positions (team_id, name) VALUES (?, ?), (?, ?), (?, ?), (?, ?)',
                [team.id, 'Keeper', team.id, 'Verdediger', team.id, 'Middenvelder', team.id, 'Aanvaller']);
            const passwordHash = bcrypt.hashSync('voetbal123', 10);
            const seedUsers = [
                ['Sjaak Afhaak', 'player', 'sjaak@team.nl', passwordHash, 0, 0, null],
                ['Piet Precies', 'player', 'piet@team.nl', passwordHash, 0, 0, null],
                ['Klaas Vaak', 'player', 'klaas@team.nl', passwordHash, 1, 0, null],
                ['Noor Nuchter', 'player', 'noor@team.nl', passwordHash, 0, 0, null],
                ['Sem Snel', 'player', 'sem@team.nl', passwordHash, 0, 0, null],
                ['Anne Coach', 'team-manager', 'anne@team.nl', passwordHash, 0, 0, null],
                ['Marco Trainer', 'trainer', 'marco@team.nl', passwordHash, 0, 0, null],
                ['Super Admin', 'admin', 'admin@team.nl', passwordHash, 0, 0, null],
                ['Connie Clubbeheer', 'club-manager', 'connie@team.nl', passwordHash, 0, 0, club.id],
                ['Opa Jan', 'guardian', 'jan@team.nl', passwordHash, 0, 0, null],
                ['Maaike Precies', 'guardian', 'maaike@team.nl', passwordHash, 0, 0, null],
                ['Fatima Vaak', 'guardian', 'fatima@team.nl', passwordHash, 0, 0, null],
                ['Tessa Nuchter', 'guardian', 'tessa@team.nl', passwordHash, 0, 0, null],
                ['Rob Snel', 'guardian', 'rob@team.nl', passwordHash, 0, 0, null]
            ];
            const events = [
                ['match', 'Uitwedstrijd JO13-1', '2026-08-30', '10:00', 'Sportpark De Brug', 'SV Rivierwijk', 1],
                ['training', 'Training', '2026-08-27', '18:30', 'Veld 2', null, 0],
                ['match', 'Thuiswedstrijd JO13-1', '2026-09-06', '09:30', 'Sportpark Zuid', 'FC Horizon', 0]
            ];

            db.run('DELETE FROM attendance', () => db.run('DELETE FROM duties', () => db.run('DELETE FROM events', () =>
                db.run('DELETE FROM guardian_players', () => db.run('DELETE FROM team_members', () => db.run('DELETE FROM users', () => {
                    const usersStatement = db.prepare('INSERT INTO users (name, role, email, password_hash, exclude_driving, exclude_flagging, club_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
                    seedUsers.forEach(user => usersStatement.run(user));
                    usersStatement.finalize(() => {
                        db.run("INSERT INTO team_members (team_id, user_id) SELECT ?, id FROM users WHERE role NOT IN ('admin', 'club-manager')", [team.id], () => {
                            db.run(`INSERT INTO guardian_players (guardian_id, player_id)
                                SELECT guardian.id, player.id
                                FROM users guardian JOIN users player
                                WHERE (guardian.email = 'jan@team.nl' AND player.email = 'sjaak@team.nl')
                                    OR (guardian.email = 'maaike@team.nl' AND player.email = 'piet@team.nl')
                                    OR (guardian.email = 'fatima@team.nl' AND player.email = 'klaas@team.nl')
                                    OR (guardian.email = 'tessa@team.nl' AND player.email = 'noor@team.nl')
                                    OR (guardian.email = 'rob@team.nl' AND player.email = 'sem@team.nl')`, () => {
                                const eventsStatement = db.prepare('INSERT INTO events (type, title, date, time, location, opponent, is_away, team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                                events.forEach(event => eventsStatement.run([...event, team.id]));
                                eventsStatement.finalize(() => {
                                    db.run(`INSERT INTO attendance (event_id, user_id, status, responded_at)
                                        SELECT event.id, player.id, 'present', datetime('now')
                                        FROM events event
                                        JOIN team_members tm ON tm.team_id = event.team_id
                                        JOIN users player ON player.id = tm.user_id AND player.role = 'player'
                                        WHERE event.team_id = ?`, [team.id], () => {
                                        db.run('DELETE FROM surveys');
                                    });
                                });
                            });
                        });
                    });
                }))))));
        });
        });
        });
        });
    });
});

module.exports = db;