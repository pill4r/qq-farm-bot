/**
 * 自己农田 CRUD
 */

const { queryAll, queryOne, run, saveDb } = require('./index');

function upsertMyLand(userId, landId, plantId, plantName, matureTime, phase, needWater, needWeed, needBug) {
    const existing = queryOne('SELECT id FROM my_lands WHERE user_id = ? AND land_id = ?', [userId, landId]);
    const now = Math.floor(Date.now() / 1000);
    
    if (existing) {
        run(`UPDATE my_lands SET plant_id = ?, plant_name = ?, mature_time = ?, phase = ?, need_water = ?, need_weed = ?, need_bug = ?, updated_at = ? WHERE user_id = ? AND land_id = ?`,
            [plantId, plantName, matureTime, phase, needWater ? 1 : 0, needWeed ? 1 : 0, needBug ? 1 : 0, now, userId, landId]);
    } else {
        run(`INSERT INTO my_lands (user_id, land_id, plant_id, plant_name, mature_time, phase, need_water, need_weed, need_bug, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, landId, plantId, plantName, matureTime, phase, needWater ? 1 : 0, needWeed ? 1 : 0, needBug ? 1 : 0, now]);
    }
}

function getMyLand(userId, landId) {
    return queryOne('SELECT * FROM my_lands WHERE user_id = ? AND land_id = ?', [userId, landId]);
}

function getMyLands(userId) {
    return queryAll('SELECT * FROM my_lands WHERE user_id = ? ORDER BY land_id', [userId]);
}

function getMyMatureLands(userId, currentTime) {
    return queryAll(`
        SELECT * FROM my_lands 
        WHERE user_id = ? AND mature_time > 0 AND mature_time <= ? AND phase = 6
        ORDER BY mature_time
    `, [userId, currentTime]);
}

function getMyNeedCareLands(userId) {
    return queryAll(`
        SELECT * FROM my_lands 
        WHERE user_id = ? AND (need_water = 1 OR need_weed = 1 OR need_bug = 1)
        ORDER BY land_id
    `, [userId]);
}

function getNextMatureTime(userId) {
    const now = Math.floor(Date.now() / 1000);
    const result = queryOne(`
        SELECT MIN(mature_time) as next_mature 
        FROM my_lands 
        WHERE user_id = ? AND mature_time > ? AND phase = 6
    `, [userId, now]);
    return result ? result.next_mature : null;
}

function getAllNextMatureTime(userId) {
    const now = Math.floor(Date.now() / 1000);
    const result = queryOne(`
        SELECT MIN(mature_time) as next_mature 
        FROM my_lands 
        WHERE user_id = ? AND mature_time > ?
    `, [userId, now]);
    return result ? result.next_mature : null;
}

function clearMyLands(userId) {
    run('DELETE FROM my_lands WHERE user_id = ?', [userId]);
}

function deleteMyLand(userId, landId) {
    run('DELETE FROM my_lands WHERE user_id = ? AND land_id = ?', [userId, landId]);
}

module.exports = {
    upsertMyLand,
    getMyLand,
    getMyLands,
    getMyMatureLands,
    getMyNeedCareLands,
    getNextMatureTime,
    getAllNextMatureTime,
    clearMyLands,
    deleteMyLand,
};
