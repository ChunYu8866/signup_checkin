function getIndexGeneration_() {
  var cache = CacheService.getScriptCache();
  var value = cache.get('idx:generation');
  if (value === null) {
    value = Utilities.getUuid();
    cache.put('idx:generation', value, CHECKIN.INDEX_TTL_SECONDS);
  }
  return value;
}

function indexKey_(kind, normalized, generation) {
  var hash = sha256_(kind + ':' + normalized);
  return {
    hash: hash,
    cacheKey: 'idx:' + generation + ':' + kind + ':' + hash.slice(0, 2)
  };
}

function getIndexedRows_(kind, normalized) {
  var generation = getIndexGeneration_();
  var key = indexKey_(kind, normalized, generation);
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key.cacheKey);
  if (raw === null) {
    rebuildIndexes_(generation);
    raw = cache.get(key.cacheKey);
  }
  var shard = raw ? JSON.parse(raw) : {};
  return shard[key.hash] || [];
}

function rebuildIndexes_(generation) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  var shards = {};

  function add_(kind, normalized, row) {
    if (!normalized) return;
    var key = indexKey_(kind, normalized, generation);
    var shard = shards[key.cacheKey] || (shards[key.cacheKey] = {});
    var matches = shard[key.hash] || (shard[key.hash] = []);
    matches.push(row);
  }

  values.forEach(function (value, offset) {
    add_('phone', normalizePhone_(value[1]), offset + 2);
    add_('email', normalizeEmail_(value[2]), offset + 2);
  });

  var payload = {};
  Object.keys(shards).forEach(function (cacheKey) {
    var serialized = JSON.stringify(shards[cacheKey]);
    if (Utilities.newBlob(serialized).getBytes().length >= 95000) {
      throw new Error('INDEX_SHARD_TOO_LARGE');
    }
    payload[cacheKey] = serialized;
  });

  if (Object.keys(payload).length) {
    CacheService.getScriptCache().putAll(payload, CHECKIN.INDEX_TTL_SECONDS);
  }
}

function invalidateIndexes_() {
  CacheService.getScriptCache().put(
    'idx:generation',
    Utilities.getUuid(),
    CHECKIN.INDEX_TTL_SECONDS
  );
}
