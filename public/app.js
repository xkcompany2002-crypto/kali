const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const messageList = document.querySelector('#message-list');
const suggestions = document.querySelector('#suggestions');
const welcomeBlock = document.querySelector('#welcome-block');
const typingRow = document.querySelector('#typing-row');
const typingLabel = document.querySelector('#typing-label');
const errorRow = document.querySelector('#error-row');
const aiStatus = document.querySelector('#ai-status');
const webStatus = document.querySelector('#web-status');
const modelSelect = document.querySelector('#model-select');
const conversationHistory = document.querySelector('#conversation-history');
const mobileConversationHistory = document.querySelector('#mobile-conversation-history');
const historyDialog = document.querySelector('#history-dialog');
const activeConversationTitle = document.querySelector('#active-conversation-title');
const CONVERSATION_STORAGE_KEY = 'xk-trade-bot.conversations.v1';
const MODEL_STORAGE_KEY = 'xk-trade-bot.selected-model.v1';
const tickerForm = document.querySelector('#ticker-analyzer');
const tickerInput = document.querySelector('#ticker-input');
const horizonSelect = document.querySelector('#analysis-horizon');
const chatScroll = document.querySelector('#chat-scroll');
const imageInput = document.querySelector('#image-input');
const attachmentTray = document.querySelector('#attachment-tray');
const imageCount = document.querySelector('#image-count');
const browserFrame = document.querySelector('#browser-frame');
const browserForm = document.querySelector('#browser-form');
const browserAddress = document.querySelector('#browser-address');
const browserError = document.querySelector('#browser-error');
const browserTitle = document.querySelector('#browser-page-title');
const browserUrlLabel = document.querySelector('#browser-current-url');
const browserAgentStatus = document.querySelector('#browser-agent-status');
const browserControlToggle = document.querySelector('#browser-control-toggle');
const browserControlLabel = document.querySelector('#browser-control-label');
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 3;
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const messages = [];
let activeConversationId = null;
let savedConversations = readSavedConversations();
let waiting = false;
let loadingFiles = false;
let pendingAttachments = [];
let retryHistory = null;
let browserPageUrl = '';
let browserSessionId = newSessionId();
let manualBrowserControl = false;
let browserInputQueue = { busy: false, currentAction: '', nextMove: null, nextAction: null };
let browserNavigationBusy = false;

function newSessionId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function readSavedConversations() {
  try {
    const value = JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        title: typeof item.title === 'string' ? item.title.slice(0, 72) : 'Saved analysis',
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
        messages: item.messages.filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
          .slice(-14).map((message) => ({ role: message.role, content: message.content.slice(0, 8000) })),
      }));
  } catch { return []; }
}

function getConversationTitle(history) {
  const first = history.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim());
  if (!first) return 'Untitled analysis';
  const normalized = first.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 46 ? `${normalized.slice(0, 45).trimEnd()}…` : normalized;
}

function renderConversationHistory(target = conversationHistory) {
  if (!target) return;
  target.replaceChildren();
  const ordered = [...savedConversations].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!ordered.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Your analyses will appear here.';
    target.append(empty);
    return;
  }
  ordered.forEach((conversation) => {
    const item = document.createElement('div');
    item.className = `history-item${conversation.id === activeConversationId ? ' is-active' : ''}`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    open.title = conversation.title;
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = conversation.title;
    const date = document.createElement('small');
    date.textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(conversation.updatedAt));
    open.append(title, date);
    open.addEventListener('click', () => openSavedConversation(conversation.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-delete';
    remove.textContent = '×';
    remove.title = 'Delete this conversation';
    remove.setAttribute('aria-label', `Delete ${conversation.title}`);
    remove.addEventListener('click', () => deleteSavedConversation(conversation.id));
    item.append(open, remove);
    target.append(item);
  });
}

function renderAllConversationHistories() {
  renderConversationHistory(conversationHistory);
  renderConversationHistory(mobileConversationHistory);
}

function closeHistoryDialog() {
  if (historyDialog) historyDialog.hidden = true;
}

function openHistoryDialog() {
  renderAllConversationHistories();
  if (historyDialog) historyDialog.hidden = false;
}

function persistConversations() {
  savedConversations = savedConversations.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  try { localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(savedConversations)); }
  catch {
    savedConversations = savedConversations.slice(0, 10);
    try { localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(savedConversations)); } catch {}
  }
  renderAllConversationHistories();
}

function saveCurrentConversation() {
  if (!messages.length) return;
  if (!activeConversationId) activeConversationId = newSessionId();
  const conversation = {
    id: activeConversationId,
    title: getConversationTitle(messages),
    updatedAt: Date.now(),
    // Keep text only in local history; image data URLs are intentionally never persisted.
    messages: messages.slice(-14).map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 8000),
    })),
  };
  savedConversations = savedConversations.filter((item) => item.id !== activeConversationId);
  savedConversations.unshift(conversation);
  persistConversations();
  if (activeConversationTitle) activeConversationTitle.textContent = conversation.title;
}

function resetBrowserWorkspace() {
  const previousSessionId = browserSessionId;
  browserSessionId = newSessionId();
  browserPageUrl = '';
  manualBrowserControl = false;
  browserInputQueue.nextMove = null;
  browserInputQueue.nextAction = null;
  setBrowserFrameSession();
  updateBrowserControlButton();
  fetch('/api/browser/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: previousSessionId }) }).catch(() => {});
  if (browserAddress) browserAddress.value = '';
  if (browserTitle) browserTitle.textContent = 'No page open';
  if (browserUrlLabel) browserUrlLabel.textContent = 'Search or enter a public web address.';
  clearBrowserError();
}

function openSavedConversation(id) {
  closeHistoryDialog();
  if (waiting || browserNavigationBusy || loadingFiles) return;
  const conversation = savedConversations.find((item) => item.id === id);
  if (!conversation) return;
  activeConversationId = conversation.id;
  messages.splice(0, messages.length, ...conversation.messages.map((message) => ({ ...message, images: [] })));
  resetBrowserWorkspace();
  messageList.replaceChildren();
  messages.forEach((message) => createMessage(message.role, message));
  clearError();
  suggestions.hidden = messages.length > 0;
  welcomeBlock.classList.toggle('has-conversation', messages.length > 0);
  if (activeConversationTitle) activeConversationTitle.textContent = conversation.title;
  input.value = '';
  pendingAttachments = [];
  renderAttachmentTray();
  updateComposer();
  chatScroll.scrollTop = chatScroll.scrollHeight;
  setMobilePanel('chat-column');
  renderAllConversationHistories();
}

function deleteSavedConversation(id) {
  savedConversations = savedConversations.filter((item) => item.id !== id);
  if (activeConversationId === id) {
    activeConversationId = null;
    messages.splice(0, messages.length);
    messageList.replaceChildren();
    welcomeBlock.classList.remove('has-conversation');
    suggestions.hidden = false;
    clearError();
    if (activeConversationTitle) activeConversationTitle.textContent = 'New analysis';
    resetBrowserWorkspace();
  }
  persistConversations();
}

function updateComposer() {
  const hasContent = input.value.trim().length > 0 || pendingAttachments.length > 0;
  sendButton.disabled = waiting || browserNavigationBusy || loadingFiles || !hasContent;
  if (modelSelect) modelSelect.disabled = waiting || browserNavigationBusy;
  input.disabled = waiting || browserNavigationBusy;
  document.querySelector('#attach-button').disabled = waiting || browserNavigationBusy || loadingFiles || pendingAttachments.length >= MAX_IMAGES;
  document.querySelector('#new-chat').disabled = waiting || browserNavigationBusy || loadingFiles;
  imageCount.hidden = pendingAttachments.length === 0;
  imageCount.textContent = pendingAttachments.length ? `${pendingAttachments.length}/${MAX_IMAGES}` : '';
}

function scrollToBottom() {
  requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
}

function formatTime() {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date());
}

async function copyText(text, button) {
  const original = button.dataset.originalLabel || button.textContent || 'Copy';
  let copied = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {}
  if (!copied) {
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.append(temporary);
    temporary.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    temporary.remove();
  }
  if (!copied) {
    button.textContent = 'Copy failed';
    window.setTimeout(() => { button.textContent = original; }, 1400);
    return;
  }
  button.textContent = 'Copied';
  button.classList.add('is-copied');
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove('is-copied');
  }, 1400);
}

function makeCopyButton(label, textGetter, className = 'copy-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.originalLabel = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', () => copyText(textGetter(), button));
  return button;
}

function appendInline(container, text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1] !== undefined) {
      try {
        const target = new URL(match[2]);
        if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Blocked protocol');
        const link = document.createElement('a');
        link.href = target.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = match[1];
        container.append(link);
      } catch {
        container.append(document.createTextNode(match[0]));
      }
    } else if (match[3] !== undefined) {
      const bold = document.createElement('strong');
      bold.textContent = match[3];
      container.append(bold);
    } else {
      const italic = document.createElement('em');
      italic.textContent = match[4];
      container.append(italic);
    }
    cursor = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function appendProse(container, text) {
  if (!text) return;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  const isBlockStart = (line) => /^\s{0,3}(#{1,3}\s|[-*+]\s+|\d+[.)]\s+|>\s*)/.test(line) || /^\s*\|.*\|\s*$/.test(line);
  const parseCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const line = lines[index];
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(heading[1].length === 1 ? 'h3' : 'h4');
      element.className = 'assistant-heading';
      appendInline(element, heading[2].trim());
      container.append(element);
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const headers = parseCells(line);
      const table = document.createElement('table');
      table.className = 'assistant-table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headers.forEach((value) => { const cell = document.createElement('th'); appendInline(cell, value); headRow.append(cell); });
      thead.append(headRow);
      table.append(thead);
      index += 2;
      const body = document.createElement('tbody');
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const cells = parseCells(lines[index]);
        const row = document.createElement('tr');
        headers.forEach((_, cellIndex) => { const cell = document.createElement('td'); appendInline(cell, cells[cellIndex] || '—'); row.append(cell); });
        body.append(row);
        index += 1;
      }
      table.append(body);
      container.append(table);
      continue;
    }

    const listMatch = line.match(/^\s{0,3}([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      list.className = 'assistant-list';
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s{0,3}([-*+]|\d+[.)])\s+(.+)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
        const item = document.createElement('li');
        appendInline(item, itemMatch[2]);
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote = document.createElement('blockquote');
      quote.className = 'assistant-quote';
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        const paragraph = document.createElement('p');
        appendInline(paragraph, lines[index].replace(/^\s{0,3}>\s?/, ''));
        quote.append(paragraph);
        index += 1;
      }
      container.append(quote);
      continue;
    }

    const paragraphText = [];
    while (index < lines.length && lines[index].trim() && !(paragraphText.length && isBlockStart(lines[index]))) {
      paragraphText.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement('p');
    paragraph.className = 'assistant-prose';
    appendInline(paragraph, paragraphText.join(' '));
    container.append(paragraph);
  }
}

function renderAssistantContent(bubble, text, { streaming = false } = {}) {
  bubble.replaceChildren();
  const pattern = /```([^\n`]*)\n/g;
  let cursor = 0;
  let opening;
  while ((opening = pattern.exec(text))) {
    appendProse(bubble, text.slice(cursor, opening.index));
    const codeStart = pattern.lastIndex;
    const closingIndex = text.indexOf('```', codeStart);
    if (closingIndex === -1 && !streaming) {
      appendProse(bubble, text.slice(opening.index));
      cursor = text.length;
      break;
    }
    const codeEnd = closingIndex === -1 ? text.length : closingIndex;
    const codeText = text.slice(codeStart, codeEnd).replace(/\n$/, '');
    const codeCard = document.createElement('section');
    codeCard.className = 'code-card';
    const codeHeader = document.createElement('div');
    codeHeader.className = 'code-header';
    const language = document.createElement('span');
    language.textContent = opening[1].trim() || 'Code';
    const copyCode = makeCopyButton('Copy code', () => codeText, 'copy-button code-copy');
    copyCode.disabled = streaming;
    codeHeader.append(language, copyCode);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeText;
    pre.append(code);
    codeCard.append(codeHeader, pre);
    bubble.append(codeCard);
    cursor = closingIndex === -1 ? text.length : closingIndex + 3;
    if (closingIndex === -1) break;
    pattern.lastIndex = cursor;
  }
  appendProse(bubble, text.slice(cursor));
  if (!bubble.childNodes.length) appendProse(bubble, text);
}

function createMessage(role, message, draft = false) {
  const row = document.createElement('article');
  row.className = `message-row ${role === 'assistant' ? 'assistant-row' : 'user-row'}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'assistant-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = 'XK';
    row.append(avatar);
  }

  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content';
  const meta = document.createElement('div');
  meta.className = `message-meta ${role === 'user' ? 'user-meta' : ''}`;
  const identity = document.createElement('div');
  identity.className = 'message-identity';
  const name = document.createElement('strong');
  name.textContent = role === 'assistant' ? 'XK-TRADE-BOT' : 'You';
  const time = document.createElement('span');
  time.textContent = formatTime();
  identity.append(name, time);
  meta.append(identity);

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${role === 'assistant' ? 'assistant-bubble' : 'user-bubble'}`;
  let copyValue = message.content || '';
  let copyButton;
  if (role === 'assistant') {
    copyButton = makeCopyButton('Copy answer', () => copyValue, 'copy-button answer-copy');
    copyButton.disabled = draft;
    meta.append(copyButton);
    if (!draft) renderAssistantContent(bubble, message.content || '');
  } else {
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) {
      const textNode = document.createElement('div');
      textNode.className = 'user-message-text';
      textNode.textContent = text;
      bubble.append(textNode);
    }
    if (Array.isArray(message.images) && message.images.length) {
      const imageList = document.createElement('div');
      imageList.className = 'message-images';
      for (const src of message.images) {
        const image = document.createElement('img');
        image.src = src;
        image.alt = 'User-attached image';
        image.loading = 'lazy';
        imageList.append(image);
      }
      bubble.append(imageList);
    }
  }

  contentWrap.append(meta, bubble);
  row.append(contentWrap);
  messageList.append(row);
  scrollToBottom();
  return {
    row,
    bubble,
    setCopyText(value) { copyValue = value; },
    finishCopy() { if (copyButton) copyButton.disabled = false; },
  };
}

function showError(message, { canRetry = false } = {}) {
  errorRow.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  errorRow.append(text);
  if (canRetry && retryHistory) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => requestReply(retryHistory));
    errorRow.append(retry);
  }
  errorRow.hidden = false;
  scrollToBottom();
}

function clearError() {
  errorRow.hidden = true;
  errorRow.replaceChildren();
}

function serializeHistory(history) {
  const recent = history.slice(-14);
  let latestImageIndex = -1;
  for (let index = 0; index < recent.length; index += 1) {
    if (recent[index].role === 'user' && Array.isArray(recent[index].images) && recent[index].images.length) latestImageIndex = index;
  }
  const lastIndex = recent.length - 1;
  const imageIndex = recent[lastIndex]?.role === 'user' && recent[lastIndex].images?.length ? lastIndex : latestImageIndex;
  return recent.map((message, index) => ({
    role: message.role,
    content: message.content,
    images: message.role === 'user' && index === imageIndex ? (message.images || []) : [],
  }));
}

function compactHistory() {
  if (messages.length > 14) messages.splice(0, messages.length - 14);
  let latestImageIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user' && Array.isArray(message.images) && message.images.length) latestImageIndex = index;
  });
  messages.forEach((message, index) => {
    if (message.role === 'user' && index !== latestImageIndex && Array.isArray(message.images)) message.images = [];
  });
}

function consumeSseBlock(block, draft, state) {
  let eventName = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return;
  let payload;
  try { payload = JSON.parse(data.join('\n')); } catch { return; }
  if (eventName === 'token' && typeof payload.text === 'string') {
    state.answer += payload.text;
    typingRow.hidden = true;
    draft.setCopyText(state.answer);
    state.render?.();
  } else if (eventName === 'status') {
    typingLabel.textContent = payload.text || 'Working in the browser';
    browserAgentStatus.querySelector('span').textContent = 'Browsing';
    browserAgentStatus.classList.add('is-busy');
    if (payload.tool?.startsWith('browser_') && window.matchMedia('(max-width: 880px)').matches) setMobilePanel('browser-panel');
  } else if (eventName === 'error') {
    state.error = payload.message || 'The reply could not be completed.';
  } else if (eventName === 'done') {
    state.done = true;
    state.mode = payload.mode || 'live';
  }
}

async function requestReply(history) {
  if (waiting || browserNavigationBusy) return;
  waiting = true;
  setBrowserControlMode(false);
  retryHistory = history;
  clearError();
  typingLabel.textContent = 'Thinking through your question';
  typingRow.hidden = false;
  browserAgentStatus.querySelector('span').textContent = 'Ready';
  browserAgentStatus.classList.remove('is-busy');
  updateComposer();
  scrollToBottom();
  const draft = createMessage('assistant', { content: '' }, true);
  const state = { answer: '', error: '', done: false, mode: 'live' };
  let renderFrame = null;
  const stopRender = () => {
    if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
    renderFrame = null;
  };
  state.render = () => {
    if (renderFrame !== null) return;
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = null;
      if (!draft.bubble.isConnected) return;
      renderAssistantContent(draft.bubble, state.answer, { streaming: true });
      scrollToBottom();
    });
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: serializeHistory(history), browserSessionId, model: modelSelect?.value || 'deepseek-v4.1-flash:free' }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'The message could not be sent. Please try again.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        consumeSseBlock(buffer.slice(0, boundary), draft, state);
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, '\n');
    if (buffer.trim()) consumeSseBlock(buffer, draft, state);
    if (state.error) throw new Error(state.error);
    if (!state.done) throw new Error('The reply ended unexpectedly. Please retry.');
    if (!state.answer.trim()) throw new Error('The model returned an empty reply. Please retry.');

    stopRender();
    messages.push({ role: 'assistant', content: state.answer });
    compactHistory();
    saveCurrentConversation();
    renderAssistantContent(draft.bubble, state.answer);
    draft.setCopyText(state.answer);
    draft.finishCopy();
    retryHistory = null;
    if (state.mode === 'demo') {
      aiStatus.classList.add('is-demo');
      aiStatus.querySelector('span:last-child').textContent = 'Demo mode';
    }
  } catch (error) {
    stopRender();
    draft.row.remove();
    showError(error.message || 'The message could not be sent. Please try again.', { canRetry: true });
  } finally {
    stopRender();
    waiting = false;
    typingRow.hidden = true;
    browserAgentStatus.querySelector('span').textContent = 'Ready';
    browserAgentStatus.classList.remove('is-busy');
    updateComposer();
    updateBrowserControlButton();
    input.focus();
  }
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if ((!text && !pendingAttachments.length) || waiting || browserNavigationBusy || loadingFiles) return;
  const images = pendingAttachments.map((file) => file.dataUrl);
  const message = { role: 'user', content: text, images };
  messages.push(message);
  saveCurrentConversation();
  createMessage('user', message);
  welcomeBlock.classList.add('has-conversation');
  suggestions.hidden = true;
  input.value = '';
  input.style.height = '28px';
  pendingAttachments = [];
  renderAttachmentTray();
  updateComposer();
  await requestReply(messages.slice());
}

function renderAttachmentTray() {
  attachmentTray.replaceChildren();
  attachmentTray.hidden = pendingAttachments.length === 0;
  pendingAttachments.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'attachment-item';
    const image = document.createElement('img');
    image.src = file.dataUrl;
    image.alt = '';
    const details = document.createElement('span');
    details.textContent = file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {
      pendingAttachments.splice(index, 1);
      renderAttachmentTray();
      updateComposer();
    });
    item.append(image, details, remove);
    attachmentTray.append(item);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function handleImageFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (pendingAttachments.length + files.length > MAX_IMAGES) {
    showError('Attach up to three images to one message.');
    imageInput.value = '';
    return;
  }
  for (const file of files) {
    if (!acceptedImageTypes.has(file.type)) {
      showError('Use a JPEG, PNG, GIF, or WebP image.');
      imageInput.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showError(`${file.name} is larger than 3 MiB. Choose a smaller image.`);
      imageInput.value = '';
      return;
    }
  }

  loadingFiles = true;
  updateComposer();
  try {
    const results = await Promise.all(files.map(async (file) => ({ name: file.name, dataUrl: await readFileAsDataUrl(file) })));
    pendingAttachments.push(...results);
    clearError();
    renderAttachmentTray();
  } catch (error) {
    showError(error.message || 'Could not read the selected images.');
  } finally {
    loadingFiles = false;
    imageInput.value = '';
    updateComposer();
  }
}

function setMobilePanel(panelId) {
  document.querySelectorAll('.mobile-tab').forEach((tab) => {
    const active = tab.dataset.panel === panelId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#chat-column').classList.toggle('is-active', panelId === 'chat-column');
  document.querySelector('#browser-panel').classList.toggle('is-active', panelId === 'browser-panel');
}

function setBrowserFrameSession() {
  browserFrame.src = `/browser-view.html?sid=${encodeURIComponent(browserSessionId)}`;
}

function syncBrowserFrameControl() {
  browserFrame.contentWindow?.postMessage({
    type: 'market-lens-browser-control',
    sessionId: browserSessionId,
    enabled: manualBrowserControl,
  }, location.origin);
}

function updateBrowserControlButton() {
  const browserBusy = waiting || browserNavigationBusy;
  browserControlToggle.disabled = browserBusy || !browserPageUrl;
  browserAddress.disabled = browserBusy;
  document.querySelector('#browser-open').disabled = browserBusy;
  document.querySelector('#browser-back').disabled = browserBusy || !browserPageUrl;
  document.querySelector('#browser-reload').disabled = browserBusy || !browserPageUrl;
  browserControlToggle.setAttribute('aria-pressed', String(manualBrowserControl));
  browserControlToggle.classList.toggle('is-active', manualBrowserControl);
  browserControlLabel.textContent = manualBrowserControl ? 'Mouse on' : 'Mouse off';
  browserControlToggle.title = manualBrowserControl ? 'Turn off safe mouse control' : 'Enable safe mouse control';
  syncBrowserFrameControl();
}

function setBrowserControlMode(enabled) {
  manualBrowserControl = Boolean(enabled && browserPageUrl && !waiting && !browserNavigationBusy);
  if (!manualBrowserControl) {
    browserInputQueue.nextMove = null;
    browserInputQueue.nextAction = null;
  }
  updateBrowserControlButton();
}

async function processBrowserInput(data) {
  if (!manualBrowserControl || waiting || browserNavigationBusy || data.sessionId !== browserSessionId) return;
  if (!['move', 'click', 'scroll'].includes(data.action)) return;
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
  const openingLink = data.action === 'click';
  if (openingLink) {
    browserNavigationBusy = true;
    setBrowserControlMode(false);
    browserAgentStatus.querySelector('span').textContent = 'Opening';
    browserAgentStatus.classList.add('is-busy');
    updateComposer();
  }
  try {
    const response = await fetch('/api/browser/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: browserSessionId,
        action: data.action,
        x: data.x,
        y: data.y,
        deltaY: data.deltaY,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error || result.blocked) {
      if (data.action !== 'move') showBrowserError(result.reason || result.error || 'That browser action is blocked.');
      return;
    }
    if (data.action === 'click') clearBrowserError();
  } catch {
    if (data.action !== 'move') showBrowserError('Manual browser control is temporarily unavailable.');
  } finally {
    if (openingLink) {
      browserNavigationBusy = false;
      browserAgentStatus.querySelector('span').textContent = 'Ready';
      browserAgentStatus.classList.remove('is-busy');
      updateBrowserControlButton();
      updateComposer();
    }
  }
}

function queueBrowserInput(data) {
  if (!manualBrowserControl || waiting || browserNavigationBusy || data.sessionId !== browserSessionId) return;
  if (!['move', 'click', 'scroll'].includes(data.action)) return;
  if (data.action === 'move') {
    browserInputQueue.nextMove = data;
  } else {
    if (browserInputQueue.nextAction || (browserInputQueue.busy && browserInputQueue.currentAction !== 'move')) {
      showBrowserError('Wait for the current browser action to finish.');
      return;
    }
    browserInputQueue.nextAction = data;
    browserInputQueue.nextMove = null;
  }
  void drainBrowserInputQueue();
}

async function drainBrowserInputQueue() {
  if (browserInputQueue.busy) return;
  const data = browserInputQueue.nextAction || browserInputQueue.nextMove;
  if (!data) return;
  if (data.action === 'move') browserInputQueue.nextMove = null;
  else browserInputQueue.nextAction = null;
  browserInputQueue.busy = true;
  browserInputQueue.currentAction = data.action;
  try {
    await processBrowserInput(data);
  } finally {
    browserInputQueue.busy = false;
    browserInputQueue.currentAction = '';
    if (manualBrowserControl && (browserInputQueue.nextAction || browserInputQueue.nextMove)) {
      window.setTimeout(() => { void drainBrowserInputQueue(); }, 0);
    }
  }
}

function showBrowserError(message) {
  browserError.textContent = message;
  browserError.hidden = false;
}

function clearBrowserError() {
  browserError.textContent = '';
  browserError.hidden = true;
}

async function openBrowserAddress(rawValue) {
  if (waiting || browserNavigationBusy) return;
  const value = rawValue.trim();
  if (!value) return;
  browserNavigationBusy = true;
  setBrowserControlMode(false);
  browserPageUrl = '';
  updateBrowserControlButton();
  updateComposer();
  clearBrowserError();
  browserAgentStatus.querySelector('span').textContent = 'Opening';
  browserAgentStatus.classList.add('is-busy');
  let endpoint;
  let payload;
  const looksLikeUrl = /^https?:\/\//i.test(value) || (!/\s/.test(value) && /\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(value));
  if (looksLikeUrl) {
    endpoint = '/api/browser/navigate';
    payload = { sessionId: browserSessionId, url: /^https?:\/\//i.test(value) ? value : `https://${value}` };
  } else {
    endpoint = '/api/browser/search';
    payload = { sessionId: browserSessionId, query: value };
  }
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The page could not be opened.');
    if (result.url) browserAddress.value = result.url;
    browserAgentStatus.querySelector('span').textContent = 'Ready';
    browserAgentStatus.classList.remove('is-busy');
  } catch (error) {
    showBrowserError(error.message || 'The page could not be opened.');
    browserAgentStatus.querySelector('span').textContent = 'Ready';
    browserAgentStatus.classList.remove('is-busy');
  } finally {
    browserNavigationBusy = false;
    updateBrowserControlButton();
    updateComposer();
  }
}

async function browserBack() {
  if (waiting || browserNavigationBusy || !browserPageUrl) return;
  browserNavigationBusy = true;
  setBrowserControlMode(false);
  browserPageUrl = '';
  updateBrowserControlButton();
  updateComposer();
  clearBrowserError();
  try {
    const response = await fetch('/api/browser/back', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: browserSessionId }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not go back.');
  } catch (error) {
    showBrowserError(error.message || 'Could not go back.');
  } finally {
    browserNavigationBusy = false;
    updateBrowserControlButton();
    updateComposer();
  }
}

if (modelSelect) modelSelect.addEventListener('change', () => {
  try { localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value); } catch {}
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendMessage(input.value);
});

tickerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ticker = tickerInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9.^=_-]{1,15}$/.test(ticker)) {
    tickerInput.setCustomValidity('Enter a valid ticker symbol, such as AAPL or JBDI.');
    tickerInput.reportValidity();
    return;
  }
  tickerInput.setCustomValidity('');
  const horizon = horizonSelect.value;
  const prompt = `Analyze ${ticker} for the ${horizon}. Use current market data and verifiable public evidence to compare bullish, sideways, and bearish scenarios, explain what would confirm or invalidate each, cite sources, and tell me whether the evidence supports watching, waiting, or remaining undecided. Do not invent prices or promise outcomes.`
  await sendMessage(prompt);
});

tickerInput?.addEventListener('input', () => tickerInput.setCustomValidity(''));

input.addEventListener('input', () => {
  input.style.height = '28px';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  updateComposer();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector('#attach-button').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => handleImageFiles(imageInput.files));

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt || ''));
});

document.querySelector('#new-chat').addEventListener('click', () => {
  if (waiting || browserNavigationBusy || loadingFiles) return;
  saveCurrentConversation();
  activeConversationId = null;
  retryHistory = null;
  resetBrowserWorkspace();
  messages.splice(0, messages.length);
  if (activeConversationTitle) activeConversationTitle.textContent = 'New analysis';
  messageList.replaceChildren();
  clearError();
  suggestions.hidden = false;
  welcomeBlock.classList.remove('has-conversation');
  input.value = '';
  input.style.height = '28px';
  pendingAttachments = [];
  renderAttachmentTray();
  updateComposer();
  chatScroll.scrollTop = 0;
  setMobilePanel('chat-column');
  input.focus();
});

function clearAllSavedConversations() {
  if (!savedConversations.length) return;
  if (!window.confirm('Delete all saved conversations from this browser? This cannot be undone.')) return;
  savedConversations = [];
  activeConversationId = null;
  messages.splice(0, messages.length);
  messageList.replaceChildren();
  welcomeBlock.classList.remove('has-conversation');
  suggestions.hidden = false;
  clearError();
  if (activeConversationTitle) activeConversationTitle.textContent = 'New analysis';
  resetBrowserWorkspace();
  persistConversations();
  closeHistoryDialog();
}

document.querySelector('#clear-history')?.addEventListener('click', clearAllSavedConversations);
document.querySelector('#mobile-clear-history')?.addEventListener('click', clearAllSavedConversations);
document.querySelector('#mobile-history-open')?.addEventListener('click', openHistoryDialog);
document.querySelector('#mobile-history-close')?.addEventListener('click', closeHistoryDialog);
document.querySelectorAll('[data-history-close]').forEach((button) => button.addEventListener('click', closeHistoryDialog));
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeHistoryDialog(); });

renderAllConversationHistories();

browserForm.addEventListener('submit', (event) => {
  event.preventDefault();
  openBrowserAddress(browserAddress.value);
});

document.querySelector('#browser-back').addEventListener('click', browserBack);
document.querySelector('#browser-reload').addEventListener('click', () => openBrowserAddress(browserPageUrl || browserAddress.value));
browserControlToggle.addEventListener('click', () => {
  setBrowserControlMode(!manualBrowserControl);
  clearBrowserError();
});
browserFrame.addEventListener('load', syncBrowserFrameControl);
document.querySelectorAll('.mobile-tab').forEach((tab) => tab.addEventListener('click', () => setMobilePanel(tab.dataset.panel)));

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== browserFrame.contentWindow) return;
  const data = event.data;
  if (data?.type === 'market-lens-browser-input') {
    if (manualBrowserControl && data.sessionId === browserSessionId) queueBrowserInput(data);
    return;
  }
  if (data?.type !== 'market-lens-browser-state' || data.sessionId !== browserSessionId) return;
  const state = data;
  if (state.active && state.url) {
    browserPageUrl = state.url;
    if (!waiting && browserAgentStatus.querySelector('span').textContent === 'Opening') {
      browserAgentStatus.querySelector('span').textContent = 'Ready';
      browserAgentStatus.classList.remove('is-busy');
    }
    browserTitle.textContent = state.title || 'Public webpage';
    browserUrlLabel.textContent = state.url;
    if (document.activeElement !== browserAddress) browserAddress.value = state.url;
  } else {
    browserPageUrl = '';
    manualBrowserControl = false;
    browserTitle.textContent = 'No page open';
    browserUrlLabel.textContent = 'Search or enter a public web address.';
  }
  updateBrowserControlButton();
});

async function loadStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const status = await response.json();
    const aiLabel = aiStatus.querySelector('span:last-child');
    if (Array.isArray(status.models) && modelSelect) {
      const validIds = new Set(status.models.map((item) => item.id));
      for (const option of modelSelect.options) option.disabled = !validIds.has(option.value);
      let savedModel = '';
      try { savedModel = localStorage.getItem(MODEL_STORAGE_KEY) || ''; } catch {}
      const preferredModel = validIds.has(savedModel) ? savedModel : status.model;
      if (validIds.has(preferredModel)) modelSelect.value = preferredModel;
    }
    if (status.configured) {
      aiLabel.textContent = 'AI configured';
      aiStatus.title = 'A provider key is configured. Live availability is confirmed after a successful response.';
      aiStatus.classList.remove('is-demo');
    } else {
      aiLabel.textContent = 'Demo mode';
      aiStatus.title = 'No API key configured; demo responses are shown.';
      aiStatus.classList.add('is-demo');
    }
    const browserLabel = webStatus.querySelector('span:last-child');
    if (status.browserReady) {
      browserLabel.textContent = 'Browser ready';
      webStatus.classList.remove('status-muted');
    } else {
      browserLabel.textContent = 'Browser offline';
      webStatus.classList.add('status-muted');
    }
  } catch {
    aiStatus.classList.add('is-demo');
    aiStatus.querySelector('span:last-child').textContent = 'Status unavailable';
    webStatus.classList.add('status-muted');
    webStatus.querySelector('span:last-child').textContent = 'Browser offline';
  }
}

setBrowserFrameSession();
updateComposer();
loadStatus();
