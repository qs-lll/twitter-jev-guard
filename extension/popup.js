const DEFAULT_SETTINGS = { enabled: true, threshold: 0.75, showClean: false, apiKey: "" };
const $ = (id) => document.getElementById(id);

async function load() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  $("enabled").checked = settings.enabled;
  $("threshold").value = Math.round(settings.threshold * 100);
  $("thresholdValue").textContent = `${$("threshold").value}%`;
  $("showClean").checked = settings.showClean;
  $("apiKey").value = settings.apiKey;
  updateStatus(settings.apiKey);
}

function updateStatus(apiKey) {
  const status = $("status");
  status.textContent = apiKey ? "已设置 Jev API key，保存后即可判断" : "请先填写 Jev API key";
  status.className = `status ${apiKey ? "ok" : "error"}`;
}

$("threshold").addEventListener("input", () => { $("thresholdValue").textContent = `${$("threshold").value}%`; });
$("apiKey").addEventListener("input", () => updateStatus($("apiKey").value.trim()));
$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    enabled: $("enabled").checked,
    threshold: Number($("threshold").value) / 100,
    showClean: $("showClean").checked,
    apiKey: $("apiKey").value.trim(),
  });
  $("save").textContent = "已保存";
  setTimeout(() => { $("save").textContent = "保存设置"; }, 1200);
  updateStatus($("apiKey").value.trim());
});

load();
