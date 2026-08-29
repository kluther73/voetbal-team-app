const replaceTeamId = (value, teamId) => value.replaceAll('{teamId}', encodeURIComponent(teamId || ''));

const getCollection = async (url, config) => {
    const response = await fetch(replaceTeamId(url, config.official_team_id), {
        headers: {
            Accept: 'application/json',
            ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {})
        }
    });
    if (!response.ok) throw new Error(`voetbal.nl gaf HTTP ${response.status}.`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.data || payload.items || [];
};

const configured = config => Boolean(
    config?.official_team_id &&
    config?.matches_url &&
    config?.trainings_url &&
    config?.players_url
);

const fetchTeamData = async config => {
    if (!configured(config)) throw new Error('De voetbal.nl API is nog niet volledig geconfigureerd.');
    const [matches, trainings, players, otherFixtures] = await Promise.all([
        getCollection(config.matches_url, config),
        getCollection(config.trainings_url, config),
        getCollection(config.players_url, config),
        config.other_fixtures_url ? getCollection(config.other_fixtures_url, config) : Promise.resolve([])
    ]);
    return { matches, trainings, players, otherFixtures };
};

module.exports = { configured, fetchTeamData };
