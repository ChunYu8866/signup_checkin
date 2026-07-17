var CHECKIN = Object.freeze({
  VERSION: 1,
  SHEET_ID: '179uW_qocdZQ8H-yZNYz3_IhNEyviKWCkBDnrnHZQkQU',
  SHEET_NAME: '簽到表',
  HEADERS: ['姓名', '手機', 'E-mail', '報名類型', '報到狀態', '報到時間', '資料建立時間'],
  TIME_ZONE: 'Asia/Taipei',
  TOKEN_TTL_SECONDS: 300,
  INDEX_TTL_SECONDS: 900,
  LOCK_WAIT_MS: 1200,
  MAX_ROWS: 1000,
  // 近似速率限制（CacheService 計數）：超量回 BUSY，由前端等候室退避。
  RATE_LIMITS: Object.freeze({
    LOOKUP_IDENTITY: Object.freeze({ scope: 'lookup-id', limit: 12, windowSeconds: 600 }),
    LOOKUP_GLOBAL: Object.freeze({ scope: 'lookup-all', limit: 240, windowSeconds: 60 }),
    WALK_IN_GLOBAL: Object.freeze({ scope: 'walkin-all', limit: 20, windowSeconds: 60 })
  }),
  CODES: Object.freeze({
    FOUND: 'FOUND',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
    CHECKED_IN: 'CHECKED_IN',
    WALK_IN_REGISTERED: 'WALK_IN_REGISTERED',
    CAPACITY_REACHED: 'CAPACITY_REACHED',
    DATA_CONFLICT: 'DATA_CONFLICT',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    BUSY: 'BUSY',
    INVALID_INPUT: 'INVALID_INPUT',
    FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
    SYSTEM_ERROR: 'SYSTEM_ERROR'
  })
});
