import { APP_CONFIG } from './config.js';
import { runWithWaitingRoom } from './retry.js';
import {
  fullPhone,
  normalizeEmail,
  normalizeName,
  normalizePhoneSuffix,
  validateEmail,
  validateName,
  validatePhoneSuffix,
} from './domain.js';

const state = {
  screen: 'home',
  phoneSuffix: '',
  email: '',
  name: '',
  token: '',
  maskedName: '',
  checkedInAt: '',
  lastAction: null,
};
const host = document.querySelector('#screen-host');
const home = document.querySelector('[data-screen="home"]');
const status = document.querySelector('#status');
const localTest = ['127.0.0.1', 'localhost'].includes(location.hostname)
  ? window.__CHECKIN_TEST_API__
  : null;
const privacyNoticeText = localTest?.privacyNoticeText ?? APP_CONFIG.privacyNoticeText ?? '';
const walkInReleased = localTest
  ? Boolean(privacyNoticeText.trim())
  : Boolean(
      APP_CONFIG.walkInEnabled
      && APP_CONFIG.privacyNoticeApproved
      && privacyNoticeText.trim(),
    );

function announce(text) {
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = text; });
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function show(screen, html) {
  state.screen = screen;
  home.hidden = true;
  host.hidden = false;
  host.dataset.screen = screen;
  host.innerHTML = html;
  const heading = host.querySelector('h2,[data-focus]');
  heading?.focus();
  announce(heading?.textContent ?? '畫面已更新');
}

function fieldError(id, message) {
  const node = document.querySelector(`#${id}-error`);
  if (node) node.textContent = message ?? '';
  const input = document.querySelector(`#${id}`);
  input?.setAttribute('aria-invalid', String(Boolean(message)));
  if (message) input?.focus();
}

function phoneMarkup() {
  return `<h2 tabindex="-1">查詢報名資料</h2><form id="phone-form" novalidate><label for="phone">手機號碼後 8 碼</label><div class="phone-field"><span>09</span><input id="phone" name="phone" type="text" inputmode="numeric" autocomplete="tel-national" maxlength="8" value="${escapeHtml(state.phoneSuffix)}" aria-describedby="phone-error"></div><p id="phone-error" class="field-error"></p><button class="button button--primary" type="submit">查詢報名資料</button><button class="button button--text" type="button" data-home>返回</button></form>`;
}

function emailMarkup() {
  return `<h2 tabindex="-1">改用 E-mail 查詢</h2><p>手機查無報名資料，請輸入報名時使用的 E-mail。</p><form id="email-form" novalidate><label for="email">E-mail</label><input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.email)}" aria-describedby="email-error"><p id="email-error" class="field-error"></p><button class="button button--primary" type="submit">使用 E-mail 查詢</button><button class="button button--text" type="button" data-home>返回</button></form>`;
}

function confirmMarkup() {
  return `<h2 tabindex="-1">確認報到資料</h2><p>請確認以下姓名是否為本人：</p><p class="masked-name">${escapeHtml(state.maskedName)}</p><button id="confirm" class="button button--primary" type="button">確認報到</button><button class="button button--text" type="button" data-home>不是本人，重新查詢</button>`;
}

function walkInMarkup() {
  return `<h2 tabindex="-1">現場報名</h2><form id="walk-in-form" novalidate><label for="name">姓名</label><input id="name" autocomplete="name" maxlength="50" value="${escapeHtml(state.name)}" aria-describedby="name-error"><p id="name-error" class="field-error"></p><label for="walk-phone">手機號碼後 8 碼</label><div class="phone-field"><span>09</span><input id="walk-phone" type="text" inputmode="numeric" autocomplete="tel-national" maxlength="8" value="${escapeHtml(state.phoneSuffix)}" aria-describedby="walk-phone-error"></div><p id="walk-phone-error" class="field-error"></p><label for="walk-email">E-mail</label><input id="walk-email" type="email" inputmode="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.email)}" aria-describedby="walk-email-error"><p id="walk-email-error" class="field-error"></p><details><summary>個人資料蒐集與使用說明</summary><div id="privacy-notice">${escapeHtml(privacyNoticeText)}</div></details><label class="consent"><input id="privacy-consent" type="checkbox" aria-describedby="privacy-consent-error">我已閱讀並同意個人資料蒐集告知</label><p id="privacy-consent-error" class="field-error"></p><button class="button button--primary" type="submit">完成現場報名與報到</button><button class="button button--text" type="button" data-home>返回</button></form>`;
}

function renderPhone(error) {
  show('phone', phoneMarkup());
  bindPhoneForm();
  if (error) fieldError('phone', error);
}

function renderEmail(error) {
  show('email', emailMarkup());
  bindEmailForm();
  if (error) fieldError('email', error);
}

async function call(action, payload, requestId = crypto.randomUUID()) {
  state.lastAction = { action, payload, requestId };
  return runWithWaitingRoom(
    async stableRequestId => {
      const api = localTest ?? await createBridgeClient();
      return api.request(action, payload, stableRequestId);
    },
    {
      onWait: ms => show('waiting', `<h2 tabindex="-1">目前報到人數較多</h2><p>系統正在為您安排報到，請勿關閉頁面。</p><p>約 ${Math.ceil(ms / 1000)} 秒後自動重試</p>`),
    },
    { ...localTest?.retryOptions, requestId },
  );
}

function restoreLastActionForEditing() {
  const action = state.lastAction?.action;
  if (action === 'lookupByPhone') {
    renderPhone();
    document.querySelector('#phone')?.focus();
    return;
  }
  if (action === 'lookupByEmail') {
    renderEmail();
    document.querySelector('#email')?.focus();
    return;
  }
  if (action === 'registerWalkIn') {
    show('walkIn', walkInMarkup());
    bindWalkInForm();
    document.querySelector('#name')?.focus();
    return;
  }
  if (action === 'confirmCheckIn') {
    show('confirm', confirmMarkup());
    return;
  }
  location.reload();
}

function renderActionableError(response) {
  const requestId = escapeHtml(response?.requestId ?? state.lastAction?.requestId ?? '無');
  show('error', `<h2 tabindex="-1">目前無法完成報到</h2><p>請再次嘗試，或返回修改資料。</p><p>請求編號：${requestId}</p><button id="retry" class="button button--primary" type="button">再次嘗試</button><button class="button button--text" type="button" data-edit>返回修改資料</button>`);
}

function restoreInvalidInput() {
  const action = state.lastAction?.action;
  if (action === 'lookupByPhone') return renderPhone('輸入資料格式有誤，請重新確認');
  if (action === 'lookupByEmail') return renderEmail('輸入資料格式有誤，請重新確認');
  if (action === 'registerWalkIn') {
    show('walkIn', walkInMarkup());
    bindWalkInForm();
    fieldError('name', '輸入資料格式有誤，請重新確認');
    return;
  }
  show('error', '<h2 tabindex="-1">輸入資料格式有誤</h2><p>請重新查詢後再試。</p>');
}

function handleResponse(response) {
  const data = response?.data ?? {};
  if (response?.code === 'NOT_FOUND') {
    if (state.lastAction?.action === 'lookupByPhone') return renderEmail();
    return beginWalkIn();
  }
  if (response?.code === 'FOUND') {
    state.maskedName = data.maskedName ?? '';
    state.token = data.token ?? '';
    return show('confirm', confirmMarkup());
  }
  if (response?.code === 'ALREADY_CHECKED_IN') {
    state.checkedInAt = data.checkedInAt ?? '';
    return show('already', `<h2 tabindex="-1">您已完成報到</h2><p>第一次報到時間：${escapeHtml(state.checkedInAt)}</p>`);
  }
  if (response?.code === 'CHECKED_IN') {
    state.checkedInAt = data.checkedInAt ?? '';
    return show('success', `<h2 tabindex="-1">報到成功</h2><p>報到時間：${escapeHtml(state.checkedInAt)}</p>`);
  }
  if (response?.code === 'WALK_IN_REGISTERED') {
    return show('success', '<h2 tabindex="-1">現場登記與報到已完成</h2><p>感謝您的參與。</p>');
  }
  if (response?.code === 'DATA_CONFLICT') {
    return show('conflict', '<h2 tabindex="-1">資料需要確認</h2><p>請洽現場工作人員協助。</p>');
  }
  if (response?.code === 'CAPACITY_REACHED') {
    return show('full', '<h2 tabindex="-1">現場名額已滿</h2><p>請洽現場工作人員協助。</p>');
  }
  if (response?.code === 'TOKEN_EXPIRED') {
    return state.phoneSuffix ? renderPhone() : renderEmail();
  }
  if (response?.code === 'INVALID_INPUT') return restoreInvalidInput();
  if (response?.code === 'FORBIDDEN_ORIGIN') {
    return show('error', '<h2 tabindex="-1">系統設定錯誤</h2><p>目前無法從這個網站進行報到，請洽現場工作人員。</p>');
  }
  if (response?.code === 'BUSY' || response?.code === 'NETWORK_RETRYABLE') {
    return renderActionableError(response);
  }
  return renderActionableError(response);
}

async function createBridgeClient() {
  if (!APP_CONFIG.bridgeUrl) {
    throw Object.assign(new Error('Bridge not configured'), { code: 'SYSTEM_ERROR' });
  }
  return {
    request: async (action, payload, requestId) => {
      const response = await fetch(APP_CONFIG.bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ version: 1, requestId, action, payload })
      });
      if (!response.ok) {
        throw Object.assign(new Error('Network error'), { code: 'NETWORK_RETRYABLE' });
      }
      return await response.json();
    }
  };
}

function beginWalkIn() {
  if (!walkInReleased) {
    return show('error', '<h2 tabindex="-1">現場報名尚未開放</h2><p>請洽現場工作人員。</p>');
  }
  show('walkIn', walkInMarkup());
  bindWalkInForm();
}

function bindPhoneForm() {
  const form = document.querySelector('#phone-form');
  const input = document.querySelector('#phone');
  input.addEventListener('input', () => {
    input.value = normalizePhoneSuffix(input.value);
    state.phoneSuffix = input.value;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    state.phoneSuffix = normalizePhoneSuffix(input.value);
    input.value = state.phoneSuffix;
    const error = validatePhoneSuffix(state.phoneSuffix);
    fieldError('phone', error);
    if (error) {
      announce(error);
      return;
    }
    form.querySelector('[type="submit"]').disabled = true;
    announce('正在查詢報名資料');
    handleResponse(await call('lookupByPhone', { phone: fullPhone(state.phoneSuffix) }));
  });
}

function bindEmailForm() {
  const form = document.querySelector('#email-form');
  const input = document.querySelector('#email');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    state.email = input.value.trim();
    const error = validateEmail(state.email);
    fieldError('email', error);
    if (error) {
      announce(error);
      return;
    }
    form.querySelector('[type="submit"]').disabled = true;
    announce('正在使用 E-mail 查詢');
    handleResponse(await call('lookupByEmail', { email: normalizeEmail(state.email) }));
  });
}

function bindWalkInForm() {
  const form = document.querySelector('#walk-in-form');
  const phone = document.querySelector('#walk-phone');
  phone.addEventListener('input', () => {
    phone.value = normalizePhoneSuffix(phone.value);
    state.phoneSuffix = phone.value;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    state.name = document.querySelector('#name').value;
    state.phoneSuffix = normalizePhoneSuffix(phone.value);
    state.email = document.querySelector('#walk-email').value.trim();
    phone.value = state.phoneSuffix;
    const errors = {
      name: validateName(state.name),
      'walk-phone': validatePhoneSuffix(state.phoneSuffix),
      'walk-email': validateEmail(state.email),
      'privacy-consent': document.querySelector('#privacy-consent').checked
        ? null
        : '請先閱讀並同意個人資料蒐集告知',
    };
    Object.entries(errors).forEach(([id, message]) => fieldError(id, message));
    const first = Object.entries(errors).find(([, message]) => Boolean(message));
    if (first) {
      document.querySelector(`#${first[0]}`)?.focus();
      announce(first[1]);
      return;
    }
    form.querySelector('[type="submit"]').disabled = true;
    announce('正在完成現場報名與報到');
    handleResponse(await call('registerWalkIn', {
      name: normalizeName(state.name),
      phone: fullPhone(state.phoneSuffix),
      email: state.email,
      consent: true,
    }));
  });
}

document.querySelector('#pre-registered').addEventListener('click', () => renderPhone());
document.querySelector('#walk-in').addEventListener('click', beginWalkIn);
if (walkInReleased) {
  document.querySelector('#walk-in').disabled = false;
  document.querySelector('#walk-in-release-note').hidden = true;
}
host.addEventListener('click', async event => {
  if (event.target.closest('[data-home]')) {
    location.reload();
    return;
  }
  if (event.target.closest('#confirm')) {
    event.target.closest('#confirm').disabled = true;
    announce('正在確認報到');
    handleResponse(await call('confirmCheckIn', { token: state.token }));
  }
  if (event.target.closest('#retry') && state.lastAction) {
    event.target.closest('#retry').disabled = true;
    const { action, payload, requestId } = state.lastAction;
    handleResponse(await call(action, payload, requestId));
  }
  if (event.target.closest('[data-edit]')) {
    restoreLastActionForEditing();
  }
});
addEventListener('popstate', () => {
  if (state.screen !== 'home') location.reload();
});

document.documentElement.dataset.appReady = 'true';
