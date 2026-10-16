const sessionId = new URLSearchParams(location.search).get('sid') || '';
const viewer = document.querySelector('.viewer');
const image = document.querySelector('#page-shot');
const empty = document.querySelector('#viewer-empty');
const status = document.querySelector('#viewer-state');
const controlLayer = document.querySelector('#control-layer');
const cursor = document.querySelector('#manual-cursor');
let controlEnabled = false;
let lastMoveAt = 0;
let pendingMove = null;
let moveTimer = null;
let pendingScroll = 0;
let pendingScrollPoint = null;
let scrollTimer = null;
let refreshing = false;
let screenshotSequence = 0;
let currentScreenshotObjectUrl = '';

function releaseScreenshot() {
  screenshotSequence += 1;
  if (currentScreenshotObjectUrl) URL.revokeObjectURL(currentScreenshotObjectUrl);
  currentScreenshotObjectUrl = '';
  image.removeAttribute('src');
}

function sendInput(action, point, extra = {}) {
  if (!controlEnabled || !sessionId || !point) return;
  window.parent.postMessage({
    type: 'market-lens-browser-input',
    sessionId,
    action,
    x: point.x,
    y: point.y,
    ...extra,
  }, location.origin);
}

function mapPoint(event) {
  if (image.hidden || !image.naturalWidth || !image.naturalHeight) return null;
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = rect.width / rect.height;
  let contentWidth = rect.width;
  let contentHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (imageRatio > boxRatio) {
    contentHeight = rect.width / imageRatio;
    offsetY = (rect.height - contentHeight) / 2;
  } else {
    contentWidth = rect.height * imageRatio;
    offsetX = (rect.width - contentWidth) / 2;
  }
  const imageX = event.clientX - rect.left - offsetX;
  const imageY = event.clientY - rect.top - offsetY;
  if (imageX < 0 || imageY < 0 || imageX > contentWidth || imageY > contentHeight) return null;
  return { x: imageX / contentWidth, y: imageY / contentHeight };
}

function positionCursor(event) {
  const rect = viewer.getBoundingClientRect();
  cursor.style.left = `${event.clientX - rect.left}px`;
  cursor.style.top = `${event.clientY - rect.top}px`;
  controlLayer.classList.add('has-pointer');
}

function queueMove(point) {
  pendingMove = point;
  const elapsed = performance.now() - lastMoveAt;
  if (elapsed >= 70) {
    lastMoveAt = performance.now();
    sendInput('move', pendingMove);
    pendingMove = null;
    return;
  }
  if (moveTimer) return;
  moveTimer = window.setTimeout(() => {
    moveTimer = null;
    lastMoveAt = performance.now();
    sendInput('move', pendingMove);
    pendingMove = null;
  }, Math.max(0, 70 - elapsed));
}

function setControl(enabled) {
  controlEnabled = Boolean(enabled && sessionId);
  controlLayer.classList.toggle('is-enabled', controlEnabled);
  if (!controlEnabled) {
    controlLayer.classList.remove('has-pointer');
    pendingMove = null;
    if (moveTimer) window.clearTimeout(moveTimer);
    if (scrollTimer) window.clearTimeout(scrollTimer);
    moveTimer = null;
    scrollTimer = null;
    pendingScroll = 0;
    pendingScrollPoint = null;
  }
}

async function refreshView() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (!sessionId) {
      image.hidden = true;
      status.hidden = true;
      empty.hidden = false;
      setControl(false);
      releaseScreenshot();
      return;
    }
    const response = await fetch(`/api/browser/state?sid=${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    const state = await response.json();
    const active = response.ok && state.active && state.url;
    empty.hidden = Boolean(active);
    image.hidden = !active;
    status.hidden = !active;
    if (active) {
      const display = state.title ? `${state.title} · ${state.url}` : state.url;
      status.textContent = display;
      const nextImageUrl = `/api/browser/screenshot?sid=${encodeURIComponent(sessionId)}&t=${Date.now()}`;
      const requestSequence = ++screenshotSequence;
      const screenshotResponse = await fetch(nextImageUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!screenshotResponse.ok) throw new Error('The browser screenshot could not be refreshed.');
      const screenshotBlob = await screenshotResponse.blob();
      if (requestSequence === screenshotSequence) {
        const nextObjectUrl = URL.createObjectURL(screenshotBlob);
        const previousObjectUrl = currentScreenshotObjectUrl;
        currentScreenshotObjectUrl = nextObjectUrl;
        image.onload = () => {
          if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
          image.onload = null;
          image.onerror = null;
        };
        image.onerror = () => {
          URL.revokeObjectURL(nextObjectUrl);
          if (currentScreenshotObjectUrl === nextObjectUrl) currentScreenshotObjectUrl = '';
          image.onload = null;
          image.onerror = null;
        };
        image.src = nextObjectUrl;
      }
    } else {
      setControl(false);
      releaseScreenshot();
    }
    window.parent.postMessage({ type: 'market-lens-browser-state', sessionId, ...state }, location.origin);
  } catch {
    releaseScreenshot();
    empty.hidden = false;
    image.hidden = true;
    status.hidden = true;
    setControl(false);
  } finally {
    refreshing = false;
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type !== 'market-lens-browser-control' || event.data.sessionId !== sessionId) return;
  setControl(event.data.enabled);
});

controlLayer.addEventListener('pointermove', (event) => {
  if (!controlEnabled) return;
  positionCursor(event);
  queueMove(mapPoint(event));
});

controlLayer.addEventListener('pointerleave', () => controlLayer.classList.remove('has-pointer'));

controlLayer.addEventListener('click', (event) => {
  if (!controlEnabled || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const point = mapPoint(event);
  if (!point) return;
  cursor.classList.add('is-clicking');
  window.setTimeout(() => cursor.classList.remove('is-clicking'), 130);
  sendInput('click', point);
});

controlLayer.addEventListener('wheel', (event) => {
  if (!controlEnabled) return;
  const point = mapPoint(event);
  if (!point) return;
  event.preventDefault();
  pendingScroll = Math.max(-900, Math.min(900, pendingScroll + event.deltaY));
  pendingScrollPoint = point;
  if (scrollTimer) return;
  scrollTimer = window.setTimeout(() => {
    const deltaY = Math.trunc(pendingScroll);
    const latestPoint = pendingScrollPoint;
    pendingScroll = 0;
    pendingScrollPoint = null;
    scrollTimer = null;
    if (deltaY && latestPoint) sendInput('scroll', latestPoint, { deltaY });
  }, 65);
}, { passive: false });

refreshView();
window.setInterval(refreshView, 3000);
