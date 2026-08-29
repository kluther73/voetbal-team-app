# Voetbal Team App

## Starten

```bash
npm install
npm start
```

Demo-admin: `admin@team.nl` met wachtwoord `voetbal123`.

## Deployen naar Railway

Deze app is een gewone Node/Express-server met een SQLite-bestand, dus Railway (of een vergelijkbare host zoals Render.com) werkt zonder aanpassingen aan de code. SQLite vereist wel een **persistente schijf**, anders verdwijnt de database bij elke nieuwe deploy.

1. Maak op [railway.app](https://railway.app) een nieuw project van dit GitHub-repository. Railway herkent Node automatisch via Nixpacks en gebruikt `npm start` (zie `railway.json`).
2. Voeg in **Variables** minimaal toe:
   - `JWT_SECRET` — een lange, willekeurige string.
   - `INTEGRATION_ENCRYPTION_KEY` — een lange, willekeurige string (nodig zodra een team-manager de voetbal.nl-koppeling instelt).
   - `DATABASE_PATH` — `/data/voetbal.sqlite`.
   - Optioneel de `VOETBAL_NL_*`-variabelen als je de officiële API-koppeling standaard wilt voorconfigureren.
3. Voeg een **Volume** toe aan de service, gemount op `/data`. Zonder volume gaat de database bij iedere deploy verloren.
4. Railway geeft de service automatisch een `*.up.railway.app`-domein en zet `PORT`; de app luistert daar al naar (`process.env.PORT`).
5. Koppel je eigen domein (`schorp.nl` bij TransIP):
   - Voeg in Railway onder **Settings → Domains** een custom domain toe, bijvoorbeeld `team.schorp.nl`.
   - Railway toont een CNAME-doel. Maak in het TransIP-controlepaneel bij DNS-instellingen van `schorp.nl` een CNAME-record aan voor `team` naar dat doel.
   - Wacht tot de DNS is doorgevoerd; Railway regelt automatisch een geldig TLS-certificaat.

**Alternatief:** Render.com werkt vergelijkbaar (Node-app + persistent disk voor het SQLite-bestand) als Railway niet gewenst is; de omgevingsvariabelen en het volume-principe zijn identiek.

## voetbal.nl-integratie

De team-manager beheert de koppeling via **Instellingen**. Vul daar de teamnaam, officiële team-id, endpoints en het access token in. Het token wordt versleuteld in de lokale database opgeslagen en komt niet terug naar de browser. Maak voor productie een `.env` met een stabiele `INTEGRATION_ENCRYPTION_KEY`; zie [.env.example](.env.example).

De applicatie ondersteunt twee importpaden:

- **Officiële API**: vul de door KNVB/voetbal.nl verstrekte team-id, access token en feed-URL's in via **Instellingen**. De JSON-feeds mogen een array zijn of een object met `data` of `items`.
- **CSV-back-up**: kies in de app een CSV-bestand met de volgende kopregel:

```csv
record_type,external_id,name,email,date,time,title,opponent,location,is_away,team_name
```

Ondersteunde `record_type`-waarden zijn `player`, `training`, `match` en `other-match`. Voor `player` zijn `external_id` en `name` vereist. Voor de andere records zijn `external_id` en `date` vereist. Eigen wedstrijden en trainingen worden als activiteiten geïmporteerd; `other-match` wordt getoond onder wedstrijden van andere teams.

Voor de officiële API worden dezelfde velden gebruikt. Gebruik voor trainingen `type: "training"`; wedstrijden worden als `match` behandeld. Externe ids voorkomen dubbele imports en bestaande gegevens worden bij een nieuwe sync bijgewerkt.
