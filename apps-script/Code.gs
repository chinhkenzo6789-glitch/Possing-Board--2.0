const CONFIG = {
  SPREADSHEET_ID: '1ZCBdiw3AJb3a6BRUgYJL5ykJJ39bu8lBOc1GC6XOXa0',
  SHEET_GID: 0,
  FALLBACK_BOARD_KEY: 'boards/shared-board.json',
};

function doGet() {
  return jsonOutput_({
    ok: true,
    service: 'posingboard-auth',
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    sheetGid: CONFIG.SHEET_GID,
  });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = normalize_(payload.action || 'login');

    if (action === 'ping') {
      return jsonOutput_({ ok: true, action: 'ping' });
    }

    if (action === 'login') {
      return jsonOutput_(login_(payload));
    }

    return jsonOutput_({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function login_(payload) {
  const username = normalize_(payload.username);
  const password = String(payload.password || '');
  const device = normalize_(payload.device || payload.client || '');

  if (!username || !password) {
    return { ok: false, error: 'Thiếu tài khoản hoặc mật khẩu.' };
  }

  const sheet = getAccountsSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    return { ok: false, error: 'Sheet tài khoản đang trống.' };
  }

  const headers = values[0].map(normalizeKey_);
  const rows = values.slice(1);
  const rowIndex = rows.findIndex((row) => {
    const account = getFirstCell_(row, headers, [
      'username',
      'user',
      'account',
      'tai_khoan',
      'taikhoan',
      'email',
    ]);
    return normalize_(account).toLowerCase() === username.toLowerCase();
  });

  if (rowIndex === -1) {
    return { ok: false, error: 'Tài khoản hoặc mật khẩu không đúng.' };
  }

  const row = rows[rowIndex];
  const status = normalize_(getFirstCell_(row, headers, ['status', 'active', 'enabled', 'trang_thai']));
  if (status && !isTruthyStatus_(status)) {
    writeLoginAudit_(sheet, headers, rowIndex + 2, false, device);
    return { ok: false, error: 'Tài khoản đang bị khóa.' };
  }

  const storedPassword = String(getFirstCell_(row, headers, ['password', 'mat_khau', 'matkhau']) || '');
  const matched = passwordMatches_(password, storedPassword);
  if (!matched) {
    writeLoginAudit_(sheet, headers, rowIndex + 2, false, device);
    return { ok: false, error: 'Tài khoản hoặc mật khẩu không đúng.' };
  }

  writeLoginAudit_(sheet, headers, rowIndex + 2, true, device);

  return {
    ok: true,
    user: {
      username: normalize_(getFirstCell_(row, headers, ['username', 'user', 'account', 'tai_khoan', 'taikhoan'])),
      displayName: normalize_(getFirstCell_(row, headers, ['displayname', 'name', 'ten', 'full_name'])) || username,
      role: normalize_(getFirstCell_(row, headers, ['role', 'permission', 'quyen'])) || 'editor',
      boardKey: normalize_(getFirstCell_(row, headers, ['boardkey', 'board_key', 'project', 'json', 'project_key'])) || CONFIG.FALLBACK_BOARD_KEY,
    },
  };
}

function getAccountsSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheets = spreadsheet.getSheets();
  const sheet = sheets.find((item) => item.getSheetId() === CONFIG.SHEET_GID) || sheets[0];
  if (!sheet) {
    throw new Error('Không tìm thấy sheet tài khoản.');
  }
  return sheet;
}

function writeLoginAudit_(sheet, headers, rowNumber, success, device) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const updates = [
    { keys: ['lastloginat', 'last_login_at', 'lan_dang_nhap_cuoi'], value: now },
    { keys: ['lastloginstatus', 'last_login_status', 'trang_thai_dang_nhap'], value: success ? 'SUCCESS' : 'FAILED' },
    { keys: ['lastdevice', 'last_device', 'thiet_bi'], value: device || '' },
  ];

  updates.forEach((entry) => {
    const columnIndex = findHeaderIndex_(headers, entry.keys);
    if (columnIndex === -1) return;
    sheet.getRange(rowNumber, columnIndex + 1).setValue(entry.value);
  });
}

function passwordMatches_(inputPassword, storedPassword) {
  const normalizedStored = String(storedPassword || '').trim();
  if (!normalizedStored) return false;

  if (normalizedStored.indexOf('sha256:') === 0) {
    return sha256Hex_(inputPassword) === normalizedStored.slice(7).toLowerCase();
  }

  return inputPassword === normalizedStored;
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return digest
    .map((byte) => {
      const normalized = byte < 0 ? byte + 256 : byte;
      return ('0' + normalized.toString(16)).slice(-2);
    })
    .join('');
}

function getFirstCell_(row, headers, aliases) {
  const index = findHeaderIndex_(headers, aliases);
  return index === -1 ? '' : row[index];
}

function findHeaderIndex_(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeKey_);
  return headers.findIndex((header) => normalizedAliases.indexOf(header) !== -1);
}

function isTruthyStatus_(value) {
  return ['1', 'true', 'yes', 'on', 'active', 'open'].indexOf(String(value).toLowerCase()) !== -1;
}

function normalize_(value) {
  return String(value || '').trim();
}

function normalizeKey_(value) {
  return normalize_(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parsePayload_(e) {
  if (!e) return {};

  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (error) {
      return e.parameter || {};
    }
  }

  return e.parameter || {};
}

function jsonOutput_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
