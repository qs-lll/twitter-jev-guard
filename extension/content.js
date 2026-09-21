(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    threshold: 0.75,
    showClean: false,
    apiKey: "",
  };
  const reviewed = new Map();
  const pending = new Set();
  const retryAfter = new Map();
  const evaluationQueue = [];
  let activeEvaluations = 0;
  let settings = { ...DEFAULT_SETTINGS };
  let scanTimer = null;

  const scheduleScan = (delay = 250) => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanTimeline();
    }, delay);
  };

  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();

  function getPostId(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')].find((item) => /\/status\/\d+/.test(item.href));
    const match = link?.href.match(/\/status\/(\d+)/);
    return match?.[1] || `local-${hash(`${text(article)}:${location.pathname}`)}`;
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function detectAd(article) {
    if (article.querySelector('[data-testid="adLabel"], [aria-label="Promoted"], [aria-label="Sponsored"], [aria-label="广告"], [aria-label="推广"]')) return true;
    const adLabel = [...article.querySelectorAll("span, div")].find((node) => {
      if (node.childElementCount > 0 || node.closest('[data-testid="tweetText"]')) return false;
      return /^(广告|推广|赞助内容|ad|promoted|sponsored|advertisement)$/i.test(text(node));
    });
    if (adLabel) return true;
    const signals = [...article.querySelectorAll('[data-testid="socialContext"], [aria-label]')]
      .map((node) => `${text(node)} ${node.getAttribute("aria-label") || ""}`.trim())
      .filter((value) => value.length > 0 && value.length < 80);
    return signals.some((value) => /(^|[\s·|])(?:ad|promoted|sponsored|advertisement)(?:$|[\s·|])/i.test(value) || /广告|推广|赞助内容/.test(value));
  }

  function extractPost(article) {
    const body = article.querySelector('[data-testid="tweetText"]');
    const statusLink = [...article.querySelectorAll('a[href*="/status/"]')].find((item) => /\/status\/\d+/.test(item.href));
    const handleNode = [...article.querySelectorAll('a[href^="/"]')].find((item) => /^\/[^/]+$/.test(new URL(item.href).pathname));
    const author = text(article.querySelector('[data-testid="User-Name"]')) || text(handleNode);
    const handle = handleNode ? new URL(handleNode.href).pathname.slice(1) : "";
    const metrics = {};
    for (const node of article.querySelectorAll('[aria-label]')) {
      const label = node.getAttribute("aria-label") || "";
      const match = label.match(/([\d,.]+[KMB]?)\s+(repl(?:y|ies)|retweet|like|view|bookmark)/i);
      if (match) metrics[match[2].toLowerCase()] = match[1];
    }
    return {
      id: getPostId(article),
      text: text(body),
      author: author.slice(0, 200),
      handle: handle.slice(0, 200),
      metrics,
      isAd: detectAd(article),
      url: statusLink?.href || location.href,
      language: document.documentElement.lang || "",
    };
  }

  function removeBadge(article) {
    article.querySelector(".jev-guard-badge")?.remove();
  }

  function removeWatermark(article) {
    article.querySelector(".jev-guard-watermark")?.remove();
  }

  function watermarkHost(article) {
    return article.querySelector('[data-testid="tweetText"]')?.parentElement || article;
  }

  function removeMarkers(article) {
    removeBadge(article);
    removeWatermark(article);
    article.classList.remove("jev-guard-flagged", "jev-guard-clean");
    delete article.dataset.jevMarkerKey;
  }

  function ensureArticlePosition(article) {
    if (getComputedStyle(article).position === "static") article.style.position = "relative";
  }

  function addBadge(article, className, label, title) {
    const classList = `jev-guard-badge ${className}`;
    const current = article.querySelector(".jev-guard-badge");
    if (!label) {
      current?.remove();
      return;
    }
    if (current?.className === classList && current.textContent === label && current.title === title) return;
    current?.remove();
    ensureArticlePosition(article);
    const badge = document.createElement("span");
    badge.className = classList;
    badge.textContent = label;
    badge.title = title;
    article.appendChild(badge);
  }

  function addWatermark(article, result) {
    const isAd = Boolean(result.isAd);
    const detailText = isAd ? "广告 · PROMOTED POST" : `JEV 低质 ${result.percent}% · ${result.categoryLabel}`;
    const current = article.querySelector(".jev-guard-watermark");
    const marker = `${isAd}:${detailText}`;
    const host = watermarkHost(article);
    if (current?.dataset.jevResult === marker && current.parentElement === host) return;
    current?.remove();
    const watermark = document.createElement("div");
    watermark.className = `jev-guard-watermark${isAd ? " jev-guard-watermark--ad" : ""}`;
    watermark.setAttribute("aria-hidden", "true");
    watermark.title = isAd ? "X 标记为广告/推广帖子" : `Jev 判断为低质量概率 ${result.percent}%，类型：${result.categoryLabel}`;
    watermark.dataset.jevResult = marker;

    const word = document.createElement("span");
    word.className = "jev-guard-watermark__word";
    word.textContent = isAd ? "AD" : "STOP";
    const detail = document.createElement("span");
    detail.className = "jev-guard-watermark__detail";
    detail.textContent = detailText;
    watermark.append(word, detail);
    host.appendChild(watermark);
  }

  function renderResult(article, result) {
    if (!settings.enabled) {
      removeMarkers(article);
      return;
    }
    const flagged = Number(result.probability) >= Number(settings.threshold);
    const markerKey = `${flagged}:${result.percent}:${result.category}:${settings.showClean}:${Boolean(result.isAd)}`;
    if (article.dataset.jevMarkerKey === markerKey) return;
    article.dataset.jevMarkerKey = markerKey;
    if (result.isAd) addWatermark(article, result);
    if (flagged) {
      article.classList.add("jev-guard-flagged");
      article.classList.remove("jev-guard-clean");
      addWatermark(article, result);
      addBadge(article, "jev-guard-badge--flagged", `Jev 低质 ${result.percent}% · ${result.categoryLabel}`, `Jev 判断为低质量概率 ${result.percent}%，类型：${result.categoryLabel}`);
      return;
    }
    article.classList.remove("jev-guard-flagged");
    if (!result.isAd) removeWatermark(article);
    if (settings.showClean) {
      article.classList.add("jev-guard-clean");
      addBadge(article, "jev-guard-badge--clean", `Jev 正常 ${result.percent}%`, `Jev 判断为低质量概率 ${result.percent}%，类型：${result.categoryLabel}`);
    } else {
      removeBadge(article);
      article.classList.remove("jev-guard-clean");
    }
  }

  function pumpEvaluationQueue() {
    while (activeEvaluations < 2 && evaluationQueue.length) {
      const item = evaluationQueue.shift();
      activeEvaluations += 1;
      chrome.runtime.sendMessage({ type: "jev-evaluate", post: item.post }, (response) => {
        activeEvaluations -= 1;
        pending.delete(item.post.id);
        if (chrome.runtime.lastError || !response?.ok) {
          retryAfter.set(item.post.id, Date.now() + 10_000);
          if (item.article.isConnected) addBadge(item.article, "jev-guard-badge--error", "Jev 请求失败", response?.error || chrome.runtime.lastError?.message || "请检查 API key");
        } else if (item.article.isConnected) {
          retryAfter.delete(item.post.id);
          const result = { ...response.data, isAd: item.post.isAd };
          reviewed.set(item.post.id, { signature: item.signature, result });
          renderResult(item.article, result);
        }
        pumpEvaluationQueue();
      });
    }
  }

  function evaluateArticle(article) {
    if (!settings.enabled) return;
    const post = extractPost(article);
    if (!post.text || pending.has(post.id)) return;
    if (retryAfter.get(post.id) > Date.now()) return;
    retryAfter.delete(post.id);
    const signature = hash(`${post.text}:${post.author}:${post.handle}:${post.isAd}`);
    const previous = reviewed.get(post.id);
    if (previous?.signature === signature) {
      renderResult(article, previous.result);
      return;
    }
    pending.add(post.id);
    if (post.isAd) {
      addWatermark(article, { isAd: true, percent: 0, categoryLabel: "广告" });
    } else {
      removeWatermark(article);
    }
    delete article.dataset.jevMarkerKey;
    addBadge(article, "jev-guard-badge--pending", "Jev 判断中…", "正在分析这条帖子");
    evaluationQueue.push({ article, post, signature });
    pumpEvaluationQueue();
  }

  function scanTimeline() {
    if (!settings.enabled) return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) evaluateArticle(article);
  }

  async function loadSettings() {
    settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
    if (!settings.enabled) {
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) removeMarkers(article);
    }
    scheduleScan(50);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") loadSettings();
  });
  new MutationObserver(() => scheduleScan()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", () => scheduleScan(400), { passive: true });
  loadSettings();
})();
