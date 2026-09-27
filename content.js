(() => {
  console.log(
    "[TFV] content script injected on", location.href,
    "| top frame:", window.top === window.self
  );

  // Change this if you want a different combo. This is handled entirely
  // in-page, so it does NOT depend on the background script being awake.
  const SHORTCUT = { key: "f", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };

  const EXPAND_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

  let active = false;
  let sourceVideo = null; // the <video> that triggered the current fill
  let fillTarget = null; // the element actually resized/reparented (video or a wrapper)
  let closeBtn = null;
  let saved = null; // { parent, nextSibling, style } for fillTarget, for restore

  const attachedVideos = new WeakSet();
  const hoverControllers = new Set(); // { hide() } — used to force-hide hover buttons on enter

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function collectAllVideos(root, out) {
    out = out || [];
    if (!root || !root.querySelectorAll) return out;
    root.querySelectorAll("video").forEach((v) => out.push(v));
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) collectAllVideos(el.shadowRoot, out);
    });
    return out;
  }

  function findBestVideo() {
    const videos = collectAllVideos(document);
    if (videos.length === 0) return null;

    const playing = videos.filter(
      (v) => !v.paused && !v.ended && v.readyState > 2 && isVisible(v)
    );
    const pool = playing.length ? playing : videos.filter(isVisible);
    if (!pool.length) return null;

    pool.sort((a, b) => {
      const areaA = a.clientWidth * a.clientHeight;
      const areaB = b.clientWidth * b.clientHeight;
      return areaB - areaA;
    });
    return pool[0];
  }

  function findFillTarget(video) {
    let target = video;
    let node = video.parentElement;
    const videoRect = video.getBoundingClientRect();
    const videoArea = Math.max(videoRect.width * videoRect.height, 1);
    let steps = 0;

    while (node && node !== document.body && node !== document.documentElement && steps < 6) {
      const rect = node.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > videoArea * 3) break;

      const pos = getComputedStyle(node).position;
      if (pos === "relative" || pos === "absolute" || pos === "fixed" || pos === "sticky") {
        target = node;
      }
      node = node.parentElement;
      steps++;
    }
    return target;
  }

  function reportState() {
    try {
      browser.runtime.sendMessage({ type: "TFV_STATE", active });
    } catch (err) {
      
    }
  }

  function makeCloseButton() {
    const btn = document.createElement("button");
    btn.className = "tfv-close-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Exit tabbed-fullscreen");
    btn.textContent = "\u2715";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      exitFill();
    });
    return btn;
  }

  function nudgeSiteResize() {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
        console.log("[TFV] dispatched synthetic resize event");
      } catch (err) {
        console.warn("[TFV] resize dispatch failed:", err);
      }
    };
    requestAnimationFrame(fire);
    setTimeout(fire, 150);
    setTimeout(fire, 400);
  }

  function enterFill(video) {
    if (active) return;

    for (const ctrl of hoverControllers) ctrl.hide();

    sourceVideo = video;
    const el = findFillTarget(video);
    fillTarget = el;
    console.log("[TFV] fill target chosen:", el === video ? "the <video> itself (no wrapper found)" : el);

    saved = {
      parent: el.parentNode,
      nextSibling: el.nextSibling,
      style: {
        position: el.style.position,
        top: el.style.top,
        left: el.style.left,
        width: el.style.width,
        height: el.style.height,
        maxWidth: el.style.maxWidth,
        maxHeight: el.style.maxHeight,
        objectFit: el.style.objectFit,
        background: el.style.background,
        zIndex: el.style.zIndex,
        margin: el.style.margin
      }
    };

    document.documentElement.appendChild(el);
    el.classList.add("tfv-fill-target");
    if (el.tagName === "VIDEO") {
      el.classList.add("tfv-video-fit");
    }

    closeBtn = makeCloseButton();
    document.documentElement.appendChild(closeBtn);
    document.documentElement.classList.add("tfv-active");

    active = true;
    reportState();
    nudgeSiteResize();
  }

  function exitFill() {
    if (!active || !fillTarget) return;

    fillTarget.classList.remove("tfv-fill-target", "tfv-video-fit");
    for (const [prop, value] of Object.entries(saved.style)) {
      fillTarget.style[prop] = value;
    }

    if (saved.parent) {
      if (saved.nextSibling && saved.nextSibling.parentNode === saved.parent) {
        saved.parent.insertBefore(fillTarget, saved.nextSibling);
      } else {
        saved.parent.appendChild(fillTarget);
      }
    }

    if (closeBtn && closeBtn.parentNode) {
      closeBtn.parentNode.removeChild(closeBtn);
    }
    closeBtn = null;

    document.documentElement.classList.remove("tfv-active");

    active = false;
    sourceVideo = null;
    fillTarget = null;
    saved = null;
    reportState();
    nudgeSiteResize();
  }

  function toggle() {
    if (active) {
      exitFill();
      return;
    }
    const candidate = findBestVideo();
    if (candidate) {
      enterFill(candidate);
    }
  }

  // ---- Per-video hover button (top-right corner of the video) ----

  function setupHoverButton(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);

    const hoverEl = findFillTarget(video);

    const btn = document.createElement("button");
    btn.className = "tfv-hover-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Tab-fullscreen this video");
    btn.innerHTML = EXPAND_ICON_SVG;
    document.documentElement.appendChild(btn);

    let rafId = null;
    let hideTimer = null;

    function positionBtn() {
      const rect = video.getBoundingClientRect();
      const onScreen =
        rect.width >= 40 &&
        rect.height >= 40 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;

      if (!onScreen || active) {
        btn.classList.remove("tfv-hover-visible");
      } else {
        btn.classList.add("tfv-hover-visible");
        const top = Math.max(rect.top, 0) + 10;
        const left = Math.min(rect.right, window.innerWidth) - 42;
        btn.style.top = `${top}px`;
        btn.style.left = `${left}px`;
      }
      rafId = requestAnimationFrame(positionBtn);
    }

    function hide() {
      clearTimeout(hideTimer);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      btn.classList.remove("tfv-hover-visible");
    }

    function show() {
      if (active) return;
      clearTimeout(hideTimer);
      if (!rafId) positionBtn();
    }

    function scheduleHide() {
      hideTimer = setTimeout(hide, 200);
    }

    video.addEventListener("mouseenter", show);
    video.addEventListener("mouseleave", scheduleHide);
    if (hoverEl !== video) {
      hoverEl.addEventListener("mouseenter", show);
      hoverEl.addEventListener("mouseleave", scheduleHide);
    }
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    btn.addEventListener("mouseleave", scheduleHide);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (active) {
        exitFill();
      } else {
        enterFill(video);
      }
    });

    hoverControllers.add({ hide });
  }

  function scanForVideos(root) {
    if (!root) return;
    collectAllVideos(root).forEach(setupHoverButton);  
    if (root.tagName === "VIDEO") setupHoverButton(root);
  }

  scanForVideos(document);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) scanForVideos(node);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => scanForVideos(document), 2000);

  // ---- Keyboard shortcut (handled entirely in-page) ----

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  function matchesShortcut(e) {
    return (
      e.key.toLowerCase() === SHORTCUT.key &&
      e.ctrlKey === SHORTCUT.ctrlKey &&
      e.shiftKey === SHORTCUT.shiftKey &&
      e.altKey === SHORTCUT.altKey &&
      e.metaKey === SHORTCUT.metaKey
    );
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && active) {
        exitFill();
        return;
      }
      if (matchesShortcut(e) && !isEditableTarget(e.target)) {
        e.preventDefault();
        toggle();
      }
    },
    true
  );

  // ---- Toolbar-icon path, relayed via the background script ----

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "TFV_TOGGLE") {
      toggle();
    }
  });
})();
