# Voetbal Team App

## Starten

```bash
npm install
npm start
```

## voetbal.nl-integratie

De team-manager beheert de koppeling via **Vereniging**. De applicatie ondersteunt twee importpaden:

- **Officiële API**: kopieer `.env.example` naar `.env` en vul de door KNVB/voetbal.nl verstrekte team-id, access token en feed-URL's in. De JSON-feeds mogen een array zijn of een object met `data` of `items`.
- **CSV-back-up**: kies in de app een CSV-bestand met de volgende kopregel:

```csv
record_type,external_id,name,email,date,time,title,opponent,location,is_away,team_name
```

Ondersteunde `record_type`-waarden zijn `player`, `training`, `match` en `other-match`. Voor `player` zijn `external_id` en `name` vereist. Voor de andere records zijn `external_id` en `date` vereist. Eigen wedstrijden en trainingen worden als activiteiten geïmporteerd; `other-match` wordt getoond onder wedstrijden van andere teams.

Voor de officiële API worden dezelfde velden gebruikt. Gebruik voor trainingen `type: "training"`; wedstrijden worden als `match` behandeld. Externe ids voorkomen dubbele imports en bestaande gegevens worden bij een nieuwe sync bijgewerkt.
