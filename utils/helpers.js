/**
 * HELPER: SUPER-GREEDY BOOTH FINDER
 */
function findBoothDeeply(obj) {
    if (!obj) return null;
    const priorityKeys = ['boothNumber', 'standNumber', 'stand', 'location', 'booth'];
    for (let key of priorityKeys) {
        if (obj[key] && typeof obj[key] !== 'object') return obj[key];
    }
    if (obj.stands && Array.isArray(obj.stands) && obj.stands[0]) return obj.stands[0].label || obj.stands[0].boothNumber || obj.stands[0].stand;
    if (obj.locations && Array.isArray(obj.locations) && obj.locations[0]) return obj.locations[0].label || obj.locations[0].name;
    for (let key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            let found = findBoothDeeply(obj[key]);
            if (found) return found;
        }
    }
    return 'N/A';
}

module.exports = { findBoothDeeply };